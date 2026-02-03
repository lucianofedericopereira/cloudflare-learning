/**
 * Authentication middleware
 */

import type { Env } from "../index";

export interface TenantContext {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  tenantName: string;
  subdomain: string;
  plan: string;
  role: string;
}

interface JWTPayload {
  userId: string;
  tenantId: string;
  role: string;
  iat: number;
  exp: number;
}

export async function authMiddleware(
  request: Request,
  env: Env
): Promise<TenantContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return null;

    // Get user and tenant info
    const result = await env.DB.prepare(
      `SELECT
        u.id as user_id, u.email, u.name,
        t.id as tenant_id, t.name as tenant_name, t.subdomain, t.plan,
        tm.role
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE u.id = ? AND t.id = ?`
    )
      .bind(payload.userId, payload.tenantId)
      .first<{
        user_id: string;
        email: string;
        name: string | null;
        tenant_id: string;
        tenant_name: string;
        subdomain: string;
        plan: string;
        role: string;
      }>();

    if (!result) return null;

    return {
      userId: result.user_id,
      email: result.email,
      name: result.name,
      tenantId: result.tenant_id,
      tenantName: result.tenant_name,
      subdomain: result.subdomain,
      plan: result.plan,
      role: result.role,
    };
  } catch (error) {
    console.error("Auth middleware error:", error);
    return null;
  }
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const signatureInput = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = base64urlDecode(signature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signatureInput)
    );

    if (!valid) return null;

    const payloadJson = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(payloadJson) as JWTPayload;

    if (claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
