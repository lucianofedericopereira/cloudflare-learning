/**
 * 00 - Hello Worker
 *
 * Your first Cloudflare Worker demonstrating:
 * - Fetch handler pattern
 * - Request parsing
 * - Response creation
 * - Basic routing
 */

export interface Env {
  // Environment bindings will go here (KV, R2, etc.)
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // ============================================
    // CORS Headers (for browser requests)
    // ============================================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ============================================
    // Router
    // ============================================
    try {
      // Home route
      if (pathname === "/" || pathname === "") {
        return new Response("Hello from Cloudflare Workers! 🚀", {
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      // About route
      if (pathname === "/about") {
        return new Response(
          "This is a Cloudflare Worker running on the edge network.",
          {
            headers: { ...corsHeaders, "Content-Type": "text/plain" },
          }
        );
      }

      // API: Current time
      if (pathname === "/api/time") {
        return Response.json(
          {
            utc: new Date().toISOString(),
            timestamp: Date.now(),
          },
          { headers: corsHeaders }
        );
      }

      // API: Request info (useful for debugging)
      if (pathname === "/api/info") {
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return Response.json(
          {
            url: request.url,
            method: request.method,
            headers,
            cf: request.cf, // Cloudflare-specific request properties
            query: Object.fromEntries(searchParams),
          },
          { headers: corsHeaders }
        );
      }

      // Echo endpoint (POST)
      if (pathname === "/echo" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        let body: unknown;

        if (contentType.includes("application/json")) {
          body = await request.json();
        } else {
          body = await request.text();
        }

        return Response.json(
          {
            received: body,
            contentType,
            timestamp: new Date().toISOString(),
          },
          { headers: corsHeaders }
        );
      }

      // Search demo (query params)
      if (pathname === "/search") {
        const query = searchParams.get("q") || "";
        return Response.json(
          {
            query,
            message: query
              ? `You searched for: ${query}`
              : "No search query provided. Use ?q=your+search",
          },
          { headers: corsHeaders }
        );
      }

      // 404 for everything else
      return Response.json(
        {
          error: "Not Found",
          message: `No route matches ${pathname}`,
          availableRoutes: [
            "GET /",
            "GET /about",
            "GET /api/time",
            "GET /api/info",
            "POST /echo",
            "GET /search?q=query",
          ],
        },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      // Error handling
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
