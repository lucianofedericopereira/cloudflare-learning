/**
 * 06 - API Gateway
 *
 * A full-featured API gateway with:
 * - API key authentication
 * - Rate limiting
 * - Request/response transformation
 * - Metrics and logging
 */

import { validateApiKey, createApiKey, listApiKeys, revokeApiKey } from "./auth";
import { checkRateLimit, getRateLimitHeaders } from "./ratelimit";
import { proxyRequest } from "./proxy";
import { logRequest, getMetrics } from "./metrics";

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  ADMIN_KEY: string;
  UPSTREAM_URL: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.ADMIN_KEY}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const startTime = Date.now();
    const requestId = generateRequestId();

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // Gateway Admin Endpoints
      // ============================================

      // Health check (public)
      if (pathname === "/gateway/health") {
        return Response.json(
          {
            status: "healthy",
            timestamp: new Date().toISOString(),
            requestId,
          },
          {
            headers: {
              ...corsHeaders,
              "X-Request-ID": requestId,
            },
          }
        );
      }

      // Admin: List API keys
      if (pathname === "/gateway/keys" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const keys = await listApiKeys(env.DB);
        return Response.json({ keys }, { headers: corsHeaders });
      }

      // Admin: Create API key
      if (pathname === "/gateway/keys" && request.method === "POST") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as {
          name: string;
          rateLimit?: number;
          permissions?: string[];
        };

        if (!body.name) {
          return Response.json(
            { error: "name is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const result = await createApiKey(env.DB, {
          name: body.name,
          rateLimit: body.rateLimit || 100,
          permissions: body.permissions || ["read"],
        });

        return Response.json(result, { status: 201, headers: corsHeaders });
      }

      // Admin: Revoke API key
      if (pathname.match(/^\/gateway\/keys\/[\w_-]+$/) && request.method === "DELETE") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const keyId = pathname.split("/").pop()!;
        await revokeApiKey(env.DB, keyId);

        return Response.json(
          { message: "API key revoked", id: keyId },
          { headers: corsHeaders }
        );
      }

      // Admin: Get metrics
      if (pathname === "/gateway/metrics" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const metrics = await getMetrics(env.DB);
        return Response.json(metrics, { headers: corsHeaders });
      }

      // ============================================
      // API Proxy (requires API key)
      // ============================================

      if (pathname.startsWith("/api/")) {
        // Extract API key
        const apiKey =
          request.headers.get("X-API-Key") ||
          request.headers.get("Authorization")?.replace("Bearer ", "");

        if (!apiKey) {
          return Response.json(
            {
              error: "API key required",
              message: "Provide X-API-Key header or Authorization: Bearer <key>",
            },
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "X-Request-ID": requestId,
              },
            }
          );
        }

        // Validate API key
        const keyInfo = await validateApiKey(env.DB, apiKey);

        if (!keyInfo) {
          return Response.json(
            { error: "Invalid API key" },
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "X-Request-ID": requestId,
              },
            }
          );
        }

        if (!keyInfo.enabled) {
          return Response.json(
            { error: "API key is disabled" },
            {
              status: 403,
              headers: {
                ...corsHeaders,
                "X-Request-ID": requestId,
              },
            }
          );
        }

        // Check rate limit
        const rateLimitResult = await checkRateLimit(
          env.RATE_LIMIT,
          keyInfo.id,
          keyInfo.rateLimit
        );

        if (!rateLimitResult.allowed) {
          const rateLimitHeaders = getRateLimitHeaders(
            keyInfo.rateLimit,
            rateLimitResult.remaining,
            rateLimitResult.resetTime
          );

          return Response.json(
            {
              error: "Rate limit exceeded",
              retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
            },
            {
              status: 429,
              headers: {
                ...corsHeaders,
                ...rateLimitHeaders,
                "X-Request-ID": requestId,
              },
            }
          );
        }

        // Proxy the request
        const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";

        const proxyResponse = await proxyRequest(request, env.UPSTREAM_URL, {
          requestId,
          clientIP,
          apiKeyId: keyInfo.id,
        });

        // Add gateway headers to response
        const responseHeaders = new Headers(proxyResponse.headers);
        responseHeaders.set("X-Request-ID", requestId);
        responseHeaders.set("X-Response-Time", `${Date.now() - startTime}ms`);

        const rateLimitHeaders = getRateLimitHeaders(
          keyInfo.rateLimit,
          rateLimitResult.remaining,
          rateLimitResult.resetTime
        );
        Object.entries(rateLimitHeaders).forEach(([k, v]) =>
          responseHeaders.set(k, v)
        );

        // Set CORS headers
        Object.entries(corsHeaders).forEach(([k, v]) =>
          responseHeaders.set(k, v)
        );

        // Log request (fire-and-forget)
        ctx.waitUntil(
          logRequest(env.DB, {
            id: requestId,
            apiKeyId: keyInfo.id,
            method: request.method,
            path: pathname,
            statusCode: proxyResponse.status,
            latencyMs: Date.now() - startTime,
            ipHash: await hashIP(clientIP),
            userAgent: request.headers.get("User-Agent") || "",
          })
        );

        return new Response(proxyResponse.body, {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: responseHeaders,
        });
      }

      // ============================================
      // Root / Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "API Gateway",
            version: "1.0.0",
            endpoints: {
              "* /api/*": "Proxy to upstream (requires X-API-Key)",
              "GET /gateway/health": "Health check",
              "GET /gateway/keys": "List API keys (admin)",
              "POST /gateway/keys": "Create API key (admin)",
              "DELETE /gateway/keys/:id": "Revoke API key (admin)",
              "GET /gateway/metrics": "Usage metrics (admin)",
            },
            headers: {
              "X-API-Key": "Your API key",
              "X-Request-ID": "Returned with every response",
              "X-RateLimit-*": "Rate limit information",
            },
          },
          {
            headers: {
              ...corsHeaders,
              "X-Request-ID": requestId,
            },
          }
        );
      }

      return Response.json(
        { error: "Not Found" },
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "X-Request-ID": requestId,
          },
        }
      );
    } catch (error) {
      console.error("Gateway error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";

      return Response.json(
        {
          error: "Internal Server Error",
          message,
          requestId,
        },
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "X-Request-ID": requestId,
          },
        }
      );
    }
  },
};

async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
