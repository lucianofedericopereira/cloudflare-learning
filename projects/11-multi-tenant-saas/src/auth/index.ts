/**
 * Authentication routes
 */

import type { Env } from "../index";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function handleAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // POST /auth/register
  if (pathname === "/auth/register" && request.method === "POST") {
    const body = (await request.json()) as {
      email: string;
      password: string;
      name?: string;
      teamName: string;
      subdomain: string;
    };

    if (!body.email || !body.password || !body.teamName || !body.subdomain) {
      return Response.json(
        { error: "email, password, teamName, and subdomain are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate subdomain
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(body.subdomain)) {
      return Response.json(
        { error: "Invalid subdomain format" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Check if email exists
    const existingUser = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(body.email.toLowerCase())
      .first();

    if (existingUser) {
      return Response.json(
        { error: "Email already registered" },
        { status: 409, headers: corsHeaders }
      );
    }

    // Check if subdomain exists
    const existingTenant = await env.DB.prepare(
      "SELECT id FROM tenants WHERE subdomain = ?"
    )
      .bind(body.subdomain.toLowerCase())
      .first();

    if (existingTenant) {
      return Response.json(
        { error: "Subdomain already taken" },
        { status: 409, headers: corsHeaders }
      );
    }

    // Create user, tenant, and membership in a batch
    const userId = `user_${crypto.randomUUID().slice(0, 12)}`;
    const tenantId = `tenant_${crypto.randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(body.password);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)"
      ).bind(userId, body.email.toLowerCase(), passwordHash, body.name || null),
      env.DB.prepare(
        "INSERT INTO tenants (id, name, subdomain) VALUES (?, ?, ?)"
      ).bind(tenantId, body.teamName, body.subdomain.toLowerCase()),
      env.DB.prepare(
        "INSERT INTO team_members (id, tenant_id, user_id, role) VALUES (?, ?, ?, 'owner')"
      ).bind(`tm_${crypto.randomUUID().slice(0, 8)}`, tenantId, userId),
      env.DB.prepare(
        "INSERT INTO subscriptions (id, tenant_id, plan, status) VALUES (?, ?, 'free', 'active')"
      ).bind(`sub_${crypto.randomUUID().slice(0, 8)}`, tenantId),
    ]);

    // Generate token
    const token = await createJWT(
      { userId, tenantId, role: "owner" },
      env.JWT_SECRET,
      86400 // 24 hours
    );

    return Response.json(
      {
        user: { id: userId, email: body.email, name: body.name },
        tenant: { id: tenantId, name: body.teamName, subdomain: body.subdomain },
        token,
      },
      { status: 201, headers: corsHeaders }
    );
  }

  // POST /auth/login
  if (pathname === "/auth/login" && request.method === "POST") {
    const body = (await request.json()) as {
      email: string;
      password: string;
      tenantId?: string;
    };

    if (!body.email || !body.password) {
      return Response.json(
        { error: "email and password are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Get user
    const user = await env.DB.prepare(
      "SELECT id, email, password_hash, name FROM users WHERE email = ?"
    )
      .bind(body.email.toLowerCase())
      .first<{ id: string; email: string; password_hash: string; name: string }>();

    if (!user) {
      return Response.json(
        { error: "Invalid credentials" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Verify password
    const validPassword = await verifyPassword(body.password, user.password_hash);
    if (!validPassword) {
      return Response.json(
        { error: "Invalid credentials" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Get user's teams
    const { results: memberships } = await env.DB.prepare(
      `SELECT t.id, t.name, t.subdomain, t.plan, tm.role
       FROM team_members tm
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = ?`
    )
      .bind(user.id)
      .all<{ id: string; name: string; subdomain: string; plan: string; role: string }>();

    if (!memberships || memberships.length === 0) {
      return Response.json(
        { error: "No team membership found" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Use specified tenant or first one
    const tenant = body.tenantId
      ? memberships.find((m) => m.id === body.tenantId)
      : memberships[0];

    if (!tenant) {
      return Response.json(
        { error: "Invalid tenant" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Generate token
    const token = await createJWT(
      { userId: user.id, tenantId: tenant.id, role: tenant.role },
      env.JWT_SECRET,
      86400
    );

    return Response.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain, plan: tenant.plan },
        teams: memberships,
        token,
      },
      { headers: corsHeaders }
    );
  }

  // POST /auth/invite
  if (pathname === "/auth/invite" && request.method === "POST") {
    // This would be protected, but for simplicity, handle auth here
    return Response.json(
      { error: "Use /teams/members to invite users" },
      { status: 400, headers: corsHeaders }
    );
  }

  return Response.json(
    { error: "Not Found" },
    { status: 404, headers: corsHeaders }
  );
}

// Password hashing
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    passwordKey,
    256
  );

  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts[0] !== "pbkdf2") return false;

  const iterations = parseInt(parts[1]);
  const saltHex = parts[2];
  const expectedHashHex = parts[3];

  const salt = new Uint8Array(saltHex.length / 2);
  for (let i = 0; i < saltHex.length; i += 2) {
    salt[i / 2] = parseInt(saltHex.slice(i, i + 2), 16);
  }

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passwordKey,
    256
  );

  const actualHashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return actualHashHex === expectedHashHex;
}

// JWT creation
async function createJWT(
  payload: { userId: string; tenantId: string; role: string },
  secret: string,
  expiresIn: number
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signatureInput)
  );

  return `${signatureInput}.${base64url(signature)}`;
}

function base64url(data: string | ArrayBuffer): string {
  let base64: string;
  if (typeof data === "string") {
    base64 = btoa(data);
  } else {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
