/**
 * 02 - Redirect Engine
 *
 * A production-ready redirect management system with:
 * - Bulk operations
 * - Admin API with authentication
 * - Wildcard pattern matching
 * - Analytics tracking
 */

import { Env, RedirectRule, CreateRedirectRequest, BulkImportResult } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function isAuthenticated(request: Request, env: Env): boolean {
  const apiKey = request.headers.get("X-API-Key");
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");

  return apiKey === env.API_KEY || bearerToken === env.API_KEY;
}

function hasWildcard(source: string): boolean {
  return source.includes("*") || source.includes(":");
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  // Exact match
  if (!hasWildcard(pattern)) {
    return pattern === path ? {} : null;
  }

  // Convert pattern to regex
  // /blog/* -> /blog/(.*)
  // /users/:id -> /users/([^/]+)
  const regexPattern = pattern
    .replace(/\*/g, "(.*)")
    .replace(/:([^/]+)/g, "([^/]+)");

  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);

  if (!match) return null;

  // Extract named parameters
  const params: Record<string, string> = {};
  const paramNames = pattern.match(/:([^/]+)/g) || [];
  paramNames.forEach((name, index) => {
    params[name.slice(1)] = match[index + 1];
  });

  // Handle wildcards
  if (pattern.includes("*")) {
    params["*"] = match[match.length - 1];
  }

  return params;
}

function buildDestination(
  destination: string,
  params: Record<string, string>,
  queryString: string,
  preserveQueryString: boolean
): string {
  let result = destination;

  // Replace parameters in destination
  for (const [key, value] of Object.entries(params)) {
    if (key === "*") {
      result = result.replace("*", value);
    } else {
      result = result.replace(`:${key}`, value);
    }
  }

  // Preserve query string if enabled
  if (preserveQueryString && queryString) {
    const separator = result.includes("?") ? "&" : "?";
    result += separator + queryString;
  }

  return result;
}

async function getRedirect(env: Env, id: string): Promise<RedirectRule | null> {
  const data = await env.REDIRECTS.get(`redirect:${id}`);
  return data ? JSON.parse(data) : null;
}

async function saveRedirect(env: Env, rule: RedirectRule): Promise<void> {
  await env.REDIRECTS.put(`redirect:${rule.id}`, JSON.stringify(rule));
  // Also index by source for quick lookup
  await env.REDIRECTS.put(`source:${rule.source}`, rule.id);
}

async function deleteRedirect(env: Env, rule: RedirectRule): Promise<void> {
  await env.REDIRECTS.delete(`redirect:${rule.id}`);
  await env.REDIRECTS.delete(`source:${rule.source}`);
}

async function findRedirectBySource(env: Env, source: string): Promise<RedirectRule | null> {
  const id = await env.REDIRECTS.get(`source:${source}`);
  if (id) {
    return getRedirect(env, id);
  }
  return null;
}

async function getAllRedirects(env: Env): Promise<RedirectRule[]> {
  const redirects: RedirectRule[] = [];
  let cursor: string | undefined;

  do {
    const result = await env.REDIRECTS.list({ prefix: "redirect:", cursor, limit: 1000 });

    for (const key of result.keys) {
      const data = await env.REDIRECTS.get(key.name);
      if (data) {
        redirects.push(JSON.parse(data));
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return redirects;
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, search } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // Admin API Routes (require authentication)
      // ============================================

      if (pathname.startsWith("/api/")) {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized. Provide X-API-Key header." },
            { status: 401, headers: corsHeaders }
          );
        }

        // GET /api/redirects - List all
        if (pathname === "/api/redirects" && request.method === "GET") {
          const redirects = await getAllRedirects(env);
          return Response.json(
            { redirects, total: redirects.length },
            { headers: corsHeaders }
          );
        }

        // POST /api/redirects - Create
        if (pathname === "/api/redirects" && request.method === "POST") {
          const body = (await request.json()) as CreateRedirectRequest;

          if (!body.source || !body.destination) {
            return Response.json(
              { error: "source and destination are required" },
              { status: 400, headers: corsHeaders }
            );
          }

          // Check for existing redirect
          const existing = await findRedirectBySource(env, body.source);
          if (existing) {
            return Response.json(
              { error: "Redirect for this source already exists", existing },
              { status: 409, headers: corsHeaders }
            );
          }

          const now = new Date().toISOString();
          const rule: RedirectRule = {
            id: generateId(),
            source: body.source,
            destination: body.destination,
            statusCode: body.statusCode || 301,
            preserveQueryString: body.preserveQueryString ?? true,
            enabled: body.enabled ?? true,
            isPattern: hasWildcard(body.source),
            created: now,
            updated: now,
            hits: 0,
          };

          await saveRedirect(env, rule);

          return Response.json(rule, { status: 201, headers: corsHeaders });
        }

        // PUT /api/redirects/:id - Update
        if (pathname.match(/^\/api\/redirects\/[\w-]+$/) && request.method === "PUT") {
          const id = pathname.split("/").pop()!;
          const rule = await getRedirect(env, id);

          if (!rule) {
            return Response.json(
              { error: "Redirect not found" },
              { status: 404, headers: corsHeaders }
            );
          }

          const body = (await request.json()) as Partial<CreateRedirectRequest>;
          const oldSource = rule.source;

          // Update fields
          if (body.source !== undefined) rule.source = body.source;
          if (body.destination !== undefined) rule.destination = body.destination;
          if (body.statusCode !== undefined) rule.statusCode = body.statusCode;
          if (body.preserveQueryString !== undefined) rule.preserveQueryString = body.preserveQueryString;
          if (body.enabled !== undefined) rule.enabled = body.enabled;

          rule.isPattern = hasWildcard(rule.source);
          rule.updated = new Date().toISOString();

          // If source changed, delete old index
          if (oldSource !== rule.source) {
            await env.REDIRECTS.delete(`source:${oldSource}`);
          }

          await saveRedirect(env, rule);

          return Response.json(rule, { headers: corsHeaders });
        }

        // DELETE /api/redirects/:id
        if (pathname.match(/^\/api\/redirects\/[\w-]+$/) && request.method === "DELETE") {
          const id = pathname.split("/").pop()!;
          const rule = await getRedirect(env, id);

          if (!rule) {
            return Response.json(
              { error: "Redirect not found" },
              { status: 404, headers: corsHeaders }
            );
          }

          await deleteRedirect(env, rule);

          return Response.json(
            { message: "Redirect deleted", id },
            { headers: corsHeaders }
          );
        }

        // POST /api/redirects/bulk - Bulk import
        if (pathname === "/api/redirects/bulk" && request.method === "POST") {
          const body = (await request.json()) as CreateRedirectRequest[];

          if (!Array.isArray(body)) {
            return Response.json(
              { error: "Request body must be an array" },
              { status: 400, headers: corsHeaders }
            );
          }

          const result: BulkImportResult = { success: 0, failed: 0, errors: [] };
          const now = new Date().toISOString();

          for (const item of body) {
            try {
              if (!item.source || !item.destination) {
                throw new Error("source and destination are required");
              }

              const rule: RedirectRule = {
                id: generateId(),
                source: item.source,
                destination: item.destination,
                statusCode: item.statusCode || 301,
                preserveQueryString: item.preserveQueryString ?? true,
                enabled: item.enabled ?? true,
                isPattern: hasWildcard(item.source),
                created: now,
                updated: now,
                hits: 0,
              };

              await saveRedirect(env, rule);
              result.success++;
            } catch (error) {
              result.failed++;
              result.errors.push({
                source: item.source || "unknown",
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }

          return Response.json(result, { headers: corsHeaders });
        }

        // GET /api/redirects/export
        if (pathname === "/api/redirects/export" && request.method === "GET") {
          const redirects = await getAllRedirects(env);
          const format = url.searchParams.get("format") || "json";

          if (format === "csv") {
            const csv = [
              "source,destination,statusCode,preserveQueryString,enabled",
              ...redirects.map(
                (r) =>
                  `${r.source},${r.destination},${r.statusCode},${r.preserveQueryString},${r.enabled}`
              ),
            ].join("\n");

            return new Response(csv, {
              headers: {
                ...corsHeaders,
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=redirects.csv",
              },
            });
          }

          return Response.json(redirects, { headers: corsHeaders });
        }

        return Response.json(
          { error: "Not Found" },
          { status: 404, headers: corsHeaders }
        );
      }

      // ============================================
      // Redirect Processing
      // ============================================

      // Home / API Documentation
      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Redirect Engine",
            version: "1.0.0",
            endpoints: {
              "GET /*": "Process redirect",
              "GET /api/redirects": "List all redirects (auth required)",
              "POST /api/redirects": "Create redirect (auth required)",
              "PUT /api/redirects/:id": "Update redirect (auth required)",
              "DELETE /api/redirects/:id": "Delete redirect (auth required)",
              "POST /api/redirects/bulk": "Bulk import (auth required)",
              "GET /api/redirects/export": "Export redirects (auth required)",
            },
            authentication: "X-API-Key header or Bearer token",
          },
          { headers: corsHeaders }
        );
      }

      // Process redirect
      const path = pathname;
      const queryString = search.slice(1); // Remove leading "?"

      // First, try exact match
      let rule = await findRedirectBySource(env, path);

      // If no exact match, try pattern matching
      if (!rule) {
        const allRedirects = await getAllRedirects(env);
        const patterns = allRedirects.filter((r) => r.isPattern && r.enabled);

        for (const pattern of patterns) {
          const params = matchPattern(pattern.source, path);
          if (params !== null) {
            rule = pattern;

            // Build destination with parameters
            const destination = buildDestination(
              rule.destination,
              params,
              queryString,
              rule.preserveQueryString
            );

            // Track hit (fire-and-forget)
            ctx.waitUntil(
              (async () => {
                rule!.hits++;
                rule!.updated = new Date().toISOString();
                await saveRedirect(env, rule!);
              })()
            );

            return Response.redirect(destination, rule.statusCode);
          }
        }
      }

      // Process exact match redirect
      if (rule && rule.enabled) {
        let destination = rule.destination;

        if (rule.preserveQueryString && queryString) {
          const separator = destination.includes("?") ? "&" : "?";
          destination += separator + queryString;
        }

        // Track hit
        ctx.waitUntil(
          (async () => {
            rule!.hits++;
            rule!.updated = new Date().toISOString();
            await saveRedirect(env, rule!);
          })()
        );

        return Response.redirect(destination, rule.statusCode);
      }

      // No redirect found
      return Response.json(
        {
          error: "No redirect found",
          path,
          hint: "Create redirects via POST /api/redirects",
        },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
