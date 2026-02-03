/**
 * 04 - Link in Bio
 *
 * A Linktree-style link-in-bio service with:
 * - D1 database for storage
 * - Dynamic profile pages
 * - Click analytics
 * - Theme support
 */

import { renderProfilePage, renderNotFoundPage } from "./templates";
import { trackEvent, getAnalytics } from "./analytics";

export interface Env {
  DB: D1Database;
  AUTH_TOKEN: string;
}

interface User {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string;
  created_at: string;
}

interface Link {
  id: string;
  user_id: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
  enabled: number;
  clicks: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function isAuthenticated(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.AUTH_TOKEN}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // Public Routes
      // ============================================

      // GET /@username - Profile page
      if (pathname.startsWith("/@") && request.method === "GET") {
        const username = pathname.slice(2).toLowerCase();

        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE username = ?"
        )
          .bind(username)
          .first<User>();

        if (!user) {
          return new Response(renderNotFoundPage(username), {
            status: 404,
            headers: { "Content-Type": "text/html" },
          });
        }

        const { results: links } = await env.DB.prepare(
          "SELECT * FROM links WHERE user_id = ? AND enabled = 1 ORDER BY position ASC"
        )
          .bind(user.id)
          .all<Link>();

        // Track page view asynchronously
        ctx.waitUntil(
          trackEvent(env.DB, {
            userId: user.id,
            eventType: "page_view",
            request,
          })
        );

        return new Response(renderProfilePage(user, links || []), {
          headers: { "Content-Type": "text/html" },
        });
      }

      // GET /go/:linkId - Redirect and track click
      if (pathname.startsWith("/go/") && request.method === "GET") {
        const linkId = pathname.slice(4);

        const link = await env.DB.prepare(
          "SELECT * FROM links WHERE id = ? AND enabled = 1"
        )
          .bind(linkId)
          .first<Link>();

        if (!link) {
          return Response.json(
            { error: "Link not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Track click and increment counter asynchronously
        ctx.waitUntil(
          Promise.all([
            trackEvent(env.DB, {
              userId: link.user_id,
              linkId: link.id,
              eventType: "link_click",
              request,
            }),
            env.DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE id = ?")
              .bind(linkId)
              .run(),
          ])
        );

        return Response.redirect(link.url, 302);
      }

      // ============================================
      // API Routes (require authentication)
      // ============================================

      // GET /api/users/:id
      if (pathname.match(/^\/api\/users\/[\w_-]+$/) && request.method === "GET") {
        const userId = pathname.split("/").pop()!;

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
          .bind(userId)
          .first<User>();

        if (!user) {
          return Response.json(
            { error: "User not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        return Response.json(user, { headers: corsHeaders });
      }

      // PUT /api/users/:id
      if (pathname.match(/^\/api\/users\/[\w_-]+$/) && request.method === "PUT") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const userId = pathname.split("/").pop()!;
        const body = (await request.json()) as Partial<User>;

        await env.DB.prepare(
          `UPDATE users SET
            display_name = COALESCE(?, display_name),
            bio = COALESCE(?, bio),
            avatar_url = COALESCE(?, avatar_url),
            theme = COALESCE(?, theme),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
        )
          .bind(
            body.display_name || null,
            body.bio || null,
            body.avatar_url || null,
            body.theme || null,
            userId
          )
          .run();

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
          .bind(userId)
          .first<User>();

        return Response.json(user, { headers: corsHeaders });
      }

      // POST /api/users - Create user
      if (pathname === "/api/users" && request.method === "POST") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as { username: string; display_name?: string };

        if (!body.username || !/^[a-z0-9_]{3,20}$/.test(body.username)) {
          return Response.json(
            { error: "Invalid username. Use 3-20 lowercase letters, numbers, or underscores." },
            { status: 400, headers: corsHeaders }
          );
        }

        const id = generateId("user");

        try {
          await env.DB.prepare(
            "INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)"
          )
            .bind(id, body.username.toLowerCase(), body.display_name || body.username)
            .run();
        } catch (error) {
          return Response.json(
            { error: "Username already taken" },
            { status: 409, headers: corsHeaders }
          );
        }

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
          .bind(id)
          .first<User>();

        return Response.json(user, { status: 201, headers: corsHeaders });
      }

      // GET /api/users/:id/links
      if (
        pathname.match(/^\/api\/users\/[\w_-]+\/links$/) &&
        request.method === "GET"
      ) {
        const userId = pathname.split("/")[3];

        const { results: links } = await env.DB.prepare(
          "SELECT * FROM links WHERE user_id = ? ORDER BY position ASC"
        )
          .bind(userId)
          .all<Link>();

        return Response.json({ links: links || [] }, { headers: corsHeaders });
      }

      // POST /api/links - Create link
      if (pathname === "/api/links" && request.method === "POST") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as {
          userId: string;
          title: string;
          url: string;
          icon?: string;
        };

        if (!body.userId || !body.title || !body.url) {
          return Response.json(
            { error: "userId, title, and url are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Get max position
        const maxPos = await env.DB.prepare(
          "SELECT MAX(position) as max FROM links WHERE user_id = ?"
        )
          .bind(body.userId)
          .first<{ max: number | null }>();

        const position = (maxPos?.max || 0) + 1;
        const id = generateId("link");

        await env.DB.prepare(
          "INSERT INTO links (id, user_id, title, url, icon, position) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(id, body.userId, body.title, body.url, body.icon || null, position)
          .run();

        const link = await env.DB.prepare("SELECT * FROM links WHERE id = ?")
          .bind(id)
          .first<Link>();

        return Response.json(link, { status: 201, headers: corsHeaders });
      }

      // PUT /api/links/:id - Update link
      if (pathname.match(/^\/api\/links\/[\w_-]+$/) && request.method === "PUT") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const linkId = pathname.split("/").pop()!;
        const body = (await request.json()) as Partial<Link>;

        await env.DB.prepare(
          `UPDATE links SET
            title = COALESCE(?, title),
            url = COALESCE(?, url),
            icon = COALESCE(?, icon),
            position = COALESCE(?, position),
            enabled = COALESCE(?, enabled),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
        )
          .bind(
            body.title || null,
            body.url || null,
            body.icon || null,
            body.position ?? null,
            body.enabled ?? null,
            linkId
          )
          .run();

        const link = await env.DB.prepare("SELECT * FROM links WHERE id = ?")
          .bind(linkId)
          .first<Link>();

        return Response.json(link, { headers: corsHeaders });
      }

      // DELETE /api/links/:id
      if (pathname.match(/^\/api\/links\/[\w_-]+$/) && request.method === "DELETE") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const linkId = pathname.split("/").pop()!;

        await env.DB.prepare("DELETE FROM links WHERE id = ?").bind(linkId).run();

        return Response.json({ message: "Link deleted" }, { headers: corsHeaders });
      }

      // GET /api/analytics
      if (pathname === "/api/analytics" && request.method === "GET") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const userId = url.searchParams.get("userId");
        if (!userId) {
          return Response.json(
            { error: "userId query parameter required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const analytics = await getAnalytics(env.DB, userId);
        return Response.json(analytics, { headers: corsHeaders });
      }

      // ============================================
      // Home / API Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Link in Bio API",
            version: "1.0.0",
            demo: "/@demo",
            endpoints: {
              "GET /@:username": "View profile page",
              "GET /go/:linkId": "Redirect to link (tracks click)",
              "GET /api/users/:id": "Get user",
              "PUT /api/users/:id": "Update user (auth)",
              "POST /api/users": "Create user (auth)",
              "GET /api/users/:id/links": "Get user's links",
              "POST /api/links": "Create link (auth)",
              "PUT /api/links/:id": "Update link (auth)",
              "DELETE /api/links/:id": "Delete link (auth)",
              "GET /api/analytics": "Get analytics (auth)",
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
