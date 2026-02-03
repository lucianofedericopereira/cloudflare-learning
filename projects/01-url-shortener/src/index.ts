/**
 * 01 - URL Shortener
 *
 * A URL shortening service demonstrating:
 * - KV storage for URLs
 * - REST API design
 * - Redirects
 * - Click tracking
 */

export interface Env {
  URLS: KVNamespace;
}

interface UrlMetadata {
  originalUrl: string;
  clicks: number;
  created: string;
}

interface ShortenRequest {
  url: string;
  customSlug?: string;
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Generate a random short code
function generateCode(length = 6): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues)
    .map((byte) => chars[byte % 62])
    .join("");
}

// Validate URL format
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Validate slug format
function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{3,20}$/.test(slug);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // API Routes
      // ============================================

      // POST /api/shorten - Create short URL
      if (pathname === "/api/shorten" && request.method === "POST") {
        const body = (await request.json()) as ShortenRequest;

        // Validate URL
        if (!body.url || !isValidUrl(body.url)) {
          return Response.json(
            { error: "Invalid URL provided" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Determine code (custom or generated)
        let code: string;
        if (body.customSlug) {
          if (!isValidSlug(body.customSlug)) {
            return Response.json(
              {
                error:
                  "Invalid slug. Must be 3-20 alphanumeric characters, hyphens, or underscores",
              },
              { status: 400, headers: corsHeaders }
            );
          }

          // Check if slug already exists
          const existing = await env.URLS.get(body.customSlug);
          if (existing) {
            return Response.json(
              { error: "Slug already taken" },
              { status: 409, headers: corsHeaders }
            );
          }

          code = body.customSlug;
        } else {
          // Generate unique code
          code = generateCode();
          // In production, you'd want to check for collisions
        }

        // Store URL with metadata
        const metadata: UrlMetadata = {
          originalUrl: body.url,
          clicks: 0,
          created: new Date().toISOString(),
        };

        await env.URLS.put(code, body.url, { metadata });

        const shortUrl = `${url.origin}/${code}`;

        return Response.json(
          {
            shortUrl,
            code,
            originalUrl: body.url,
          },
          { status: 201, headers: corsHeaders }
        );
      }

      // GET /api/stats/:code - Get URL statistics
      if (pathname.startsWith("/api/stats/") && request.method === "GET") {
        const code = pathname.replace("/api/stats/", "");

        const { value, metadata } =
          await env.URLS.getWithMetadata<UrlMetadata>(code);

        if (!value || !metadata) {
          return Response.json(
            { error: "URL not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        return Response.json(
          {
            code,
            originalUrl: metadata.originalUrl,
            clicks: metadata.clicks,
            created: metadata.created,
          },
          { headers: corsHeaders }
        );
      }

      // DELETE /api/urls/:code - Delete short URL
      if (pathname.startsWith("/api/urls/") && request.method === "DELETE") {
        const code = pathname.replace("/api/urls/", "");

        const existing = await env.URLS.get(code);
        if (!existing) {
          return Response.json(
            { error: "URL not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        await env.URLS.delete(code);

        return Response.json(
          { message: "URL deleted", code },
          { headers: corsHeaders }
        );
      }

      // GET /api/urls - List all URLs (for admin/demo purposes)
      if (pathname === "/api/urls" && request.method === "GET") {
        const { keys } = await env.URLS.list();

        const urls = await Promise.all(
          keys.slice(0, 50).map(async (key) => {
            const { value, metadata } =
              await env.URLS.getWithMetadata<UrlMetadata>(key.name);
            return {
              code: key.name,
              originalUrl: value,
              ...metadata,
            };
          })
        );

        return Response.json({ urls, total: keys.length }, { headers: corsHeaders });
      }

      // ============================================
      // Redirect Route
      // ============================================

      // GET /:code - Redirect to original URL
      if (pathname.length > 1 && !pathname.startsWith("/api/")) {
        const code = pathname.slice(1);

        const { value, metadata } =
          await env.URLS.getWithMetadata<UrlMetadata>(code);

        if (!value) {
          return Response.json(
            {
              error: "Short URL not found",
              code,
              hint: "Create one at POST /api/shorten",
            },
            { status: 404, headers: corsHeaders }
          );
        }

        // Increment click count (fire-and-forget)
        if (metadata) {
          ctx.waitUntil(
            env.URLS.put(code, value, {
              metadata: {
                ...metadata,
                clicks: metadata.clicks + 1,
              },
            })
          );
        }

        // Redirect to original URL
        return Response.redirect(value, 302);
      }

      // ============================================
      // Home / Documentation
      // ============================================

      if (pathname === "/" || pathname === "") {
        return Response.json(
          {
            name: "URL Shortener API",
            version: "1.0.0",
            endpoints: {
              "POST /api/shorten": {
                description: "Create a short URL",
                body: { url: "string (required)", customSlug: "string (optional)" },
              },
              "GET /:code": {
                description: "Redirect to original URL",
              },
              "GET /api/stats/:code": {
                description: "Get URL statistics",
              },
              "DELETE /api/urls/:code": {
                description: "Delete a short URL",
              },
              "GET /api/urls": {
                description: "List all URLs (limit 50)",
              },
            },
          },
          { headers: corsHeaders }
        );
      }

      // 404 for unknown routes
      return Response.json(
        { error: "Not Found" },
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
