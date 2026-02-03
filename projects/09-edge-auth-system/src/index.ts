/**
 * 09 - Edge Auth System
 *
 * A complete authentication system at the edge with:
 * - JWT creation and verification
 * - Session management
 * - Refresh token rotation
 * - Role-based access control
 */

import { createAccessToken, createRefreshToken, verifyAccessToken } from "./jwt";
import { hashPassword, verifyPassword } from "./password";
import { hasPermission } from "./rbac";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  REFRESH_SECRET: string;
}

interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
  email_verified: number;
  created_at: string;
}

interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Auth middleware helper
async function authenticate(
  request: Request,
  env: Env
): Promise<{ user: User; claims: { userId: string; role: string } } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const claims = await verifyAccessToken(token, env.JWT_SECRET);
  if (!claims) return null;

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(claims.userId)
    .first<User>();

  if (!user) return null;

  return { user, claims };
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
      // Public Auth Routes
      // ============================================

      // POST /auth/register
      if (pathname === "/auth/register" && request.method === "POST") {
        const body = (await request.json()) as {
          email: string;
          password: string;
          name?: string;
        };

        if (!body.email || !body.password) {
          return Response.json(
            { error: "email and password are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        if (body.password.length < 8) {
          return Response.json(
            { error: "Password must be at least 8 characters" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Check if email exists
        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ?"
        )
          .bind(body.email.toLowerCase())
          .first();

        if (existing) {
          return Response.json(
            { error: "Email already registered" },
            { status: 409, headers: corsHeaders }
          );
        }

        // Hash password
        const passwordHash = await hashPassword(body.password);
        const userId = generateId("user");

        // Create user
        await env.DB.prepare(
          `INSERT INTO users (id, email, password_hash, name)
           VALUES (?, ?, ?, ?)`
        )
          .bind(userId, body.email.toLowerCase(), passwordHash, body.name || null)
          .run();

        // Generate tokens
        const accessToken = await createAccessToken(
          { userId, role: "user" },
          env.JWT_SECRET,
          ACCESS_TOKEN_EXPIRY
        );

        const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, "")}`;
        const refreshTokenHash = await hashToken(refreshToken);

        await env.DB.prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, datetime('now', '+7 days'))`
        )
          .bind(generateId("rt"), userId, refreshTokenHash)
          .run();

        return Response.json(
          {
            user: { id: userId, email: body.email, name: body.name, role: "user" },
            accessToken,
            refreshToken,
            expiresIn: ACCESS_TOKEN_EXPIRY,
            tokenType: "Bearer",
          },
          { status: 201, headers: corsHeaders }
        );
      }

      // POST /auth/login
      if (pathname === "/auth/login" && request.method === "POST") {
        const body = (await request.json()) as {
          email: string;
          password: string;
        };

        if (!body.email || !body.password) {
          return Response.json(
            { error: "email and password are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Find user
        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE email = ?"
        )
          .bind(body.email.toLowerCase())
          .first<User>();

        if (!user) {
          return Response.json(
            { error: "Invalid credentials" },
            { status: 401, headers: corsHeaders }
          );
        }

        // Verify password
        const validPassword = await verifyPassword(
          body.password,
          user.password_hash
        );

        if (!validPassword) {
          return Response.json(
            { error: "Invalid credentials" },
            { status: 401, headers: corsHeaders }
          );
        }

        // Generate tokens
        const accessToken = await createAccessToken(
          { userId: user.id, role: user.role },
          env.JWT_SECRET,
          ACCESS_TOKEN_EXPIRY
        );

        const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, "")}`;
        const refreshTokenHash = await hashToken(refreshToken);

        await env.DB.prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, datetime('now', '+7 days'))`
        )
          .bind(generateId("rt"), user.id, refreshTokenHash)
          .run();

        // Log audit event
        ctx.waitUntil(
          env.DB.prepare(
            `INSERT INTO audit_log (id, user_id, action, ip_address)
             VALUES (?, ?, 'login', ?)`
          )
            .bind(
              generateId("log"),
              user.id,
              request.headers.get("CF-Connecting-IP")
            )
            .run()
        );

        return Response.json(
          {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
            },
            accessToken,
            refreshToken,
            expiresIn: ACCESS_TOKEN_EXPIRY,
            tokenType: "Bearer",
          },
          { headers: corsHeaders }
        );
      }

      // POST /auth/refresh
      if (pathname === "/auth/refresh" && request.method === "POST") {
        const body = (await request.json()) as { refreshToken: string };

        if (!body.refreshToken) {
          return Response.json(
            { error: "refreshToken is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const tokenHash = await hashToken(body.refreshToken);

        // Find valid refresh token
        const storedToken = await env.DB.prepare(
          `SELECT rt.*, u.role FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           WHERE rt.token_hash = ?
             AND rt.revoked_at IS NULL
             AND rt.expires_at > datetime('now')`
        )
          .bind(tokenHash)
          .first<RefreshToken & { role: string }>();

        if (!storedToken) {
          return Response.json(
            { error: "Invalid or expired refresh token" },
            { status: 401, headers: corsHeaders }
          );
        }

        // Revoke old token (rotation)
        await env.DB.prepare(
          "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?"
        )
          .bind(storedToken.id)
          .run();

        // Generate new tokens
        const accessToken = await createAccessToken(
          { userId: storedToken.user_id, role: storedToken.role },
          env.JWT_SECRET,
          ACCESS_TOKEN_EXPIRY
        );

        const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, "")}`;
        const newTokenHash = await hashToken(refreshToken);

        await env.DB.prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, datetime('now', '+7 days'))`
        )
          .bind(generateId("rt"), storedToken.user_id, newTokenHash)
          .run();

        return Response.json(
          {
            accessToken,
            refreshToken,
            expiresIn: ACCESS_TOKEN_EXPIRY,
            tokenType: "Bearer",
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Protected Routes
      // ============================================

      // POST /auth/logout
      if (pathname === "/auth/logout" && request.method === "POST") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        // Revoke all refresh tokens for user
        await env.DB.prepare(
          "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
        )
          .bind(auth.user.id)
          .run();

        return Response.json({ message: "Logged out" }, { headers: corsHeaders });
      }

      // GET /auth/me
      if (pathname === "/auth/me" && request.method === "GET") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        return Response.json(
          {
            id: auth.user.id,
            email: auth.user.email,
            name: auth.user.name,
            role: auth.user.role,
            emailVerified: auth.user.email_verified === 1,
            createdAt: auth.user.created_at,
          },
          { headers: corsHeaders }
        );
      }

      // PUT /auth/me
      if (pathname === "/auth/me" && request.method === "PUT") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as { name?: string };

        await env.DB.prepare(
          "UPDATE users SET name = COALESCE(?, name), updated_at = datetime('now') WHERE id = ?"
        )
          .bind(body.name || null, auth.user.id)
          .run();

        return Response.json({ message: "Profile updated" }, { headers: corsHeaders });
      }

      // POST /auth/password
      if (pathname === "/auth/password" && request.method === "POST") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as {
          currentPassword: string;
          newPassword: string;
        };

        if (!body.currentPassword || !body.newPassword) {
          return Response.json(
            { error: "currentPassword and newPassword are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Verify current password
        const validPassword = await verifyPassword(
          body.currentPassword,
          auth.user.password_hash
        );

        if (!validPassword) {
          return Response.json(
            { error: "Current password is incorrect" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Hash and update new password
        const newHash = await hashPassword(body.newPassword);

        await env.DB.prepare(
          "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
        )
          .bind(newHash, auth.user.id)
          .run();

        // Revoke all refresh tokens
        await env.DB.prepare(
          "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?"
        )
          .bind(auth.user.id)
          .run();

        return Response.json(
          { message: "Password changed. Please log in again." },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Admin Routes
      // ============================================

      // GET /users (admin only)
      if (pathname === "/users" && request.method === "GET") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        if (!hasPermission(auth.user.role, "users", "read")) {
          return Response.json(
            { error: "Forbidden" },
            { status: 403, headers: corsHeaders }
          );
        }

        const { results } = await env.DB.prepare(
          "SELECT id, email, name, role, email_verified, created_at FROM users ORDER BY created_at DESC"
        ).all();

        return Response.json({ users: results || [] }, { headers: corsHeaders });
      }

      // PUT /users/:id/role (admin only)
      if (pathname.match(/^\/users\/[\w_-]+\/role$/) && request.method === "PUT") {
        const auth = await authenticate(request, env);
        if (!auth) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        if (!hasPermission(auth.user.role, "users", "update")) {
          return Response.json(
            { error: "Forbidden" },
            { status: 403, headers: corsHeaders }
          );
        }

        const userId = pathname.split("/")[2];
        const body = (await request.json()) as { role: string };

        if (!["user", "admin", "moderator"].includes(body.role)) {
          return Response.json(
            { error: "Invalid role" },
            { status: 400, headers: corsHeaders }
          );
        }

        await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
          .bind(body.role, userId)
          .run();

        return Response.json({ message: "Role updated" }, { headers: corsHeaders });
      }

      // ============================================
      // Home / Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Edge Auth System",
            version: "1.0.0",
            endpoints: {
              "POST /auth/register": "Register new user",
              "POST /auth/login": "Login, get tokens",
              "POST /auth/refresh": "Refresh access token",
              "POST /auth/logout": "Logout, revoke tokens",
              "GET /auth/me": "Get current user",
              "PUT /auth/me": "Update profile",
              "POST /auth/password": "Change password",
              "GET /users": "List users (admin)",
              "PUT /users/:id/role": "Update user role (admin)",
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
