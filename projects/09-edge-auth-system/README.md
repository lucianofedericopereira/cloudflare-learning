# 09 - Edge Auth System

A complete authentication system at the edge with JWT, sessions, refresh tokens, and RBAC.

## Learning Objectives

- JWT creation and verification at the edge
- Session management with Durable Objects
- Refresh token rotation
- Role-based access control (RBAC)

## Concepts

### JWT at the Edge

```typescript
// Create JWT using Web Crypto API
async function createJWT(
  payload: object,
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

// Verify JWT
async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const [header, payload, signature] = token.split(".");
  const signatureInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(signatureInput)
  );

  if (!valid) return null;

  const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));

  if (claims.exp < Math.floor(Date.now() / 1000)) {
    return null; // Expired
  }

  return claims;
}
```

### Session Management with Durable Objects

```typescript
export class SessionManager {
  private state: DurableObjectState;

  async createSession(userId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session = {
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    await this.state.storage.put(`session:${sessionId}`, session);
    return sessionId;
  }

  async validateSession(sessionId: string): Promise<Session | null> {
    const session = await this.state.storage.get(`session:${sessionId}`);
    if (!session) return null;

    // Update last activity
    session.lastActivity = Date.now();
    await this.state.storage.put(`session:${sessionId}`, session);

    return session;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.state.storage.delete(`session:${sessionId}`);
  }
}
```

### Refresh Token Rotation

```typescript
interface TokenPair {
  accessToken: string;   // Short-lived (15 min)
  refreshToken: string;  // Long-lived (7 days)
}

async function rotateTokens(refreshToken: string): Promise<TokenPair> {
  // Verify refresh token
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) throw new Error("Invalid refresh token");

  // Invalidate old refresh token
  await revokeRefreshToken(refreshToken);

  // Generate new token pair
  return {
    accessToken: await createAccessToken(payload.userId),
    refreshToken: await createRefreshToken(payload.userId),
  };
}
```

### Role-Based Access Control

```typescript
interface Permission {
  resource: string;
  action: "create" | "read" | "update" | "delete";
}

interface Role {
  name: string;
  permissions: Permission[];
}

const roles: Record<string, Role> = {
  admin: {
    name: "admin",
    permissions: [
      { resource: "*", action: "create" },
      { resource: "*", action: "read" },
      { resource: "*", action: "update" },
      { resource: "*", action: "delete" },
    ],
  },
  user: {
    name: "user",
    permissions: [
      { resource: "profile", action: "read" },
      { resource: "profile", action: "update" },
      { resource: "posts", action: "create" },
      { resource: "posts", action: "read" },
    ],
  },
};

function hasPermission(userRole: string, resource: string, action: string): boolean {
  const role = roles[userRole];
  if (!role) return false;

  return role.permissions.some(
    (p) => (p.resource === "*" || p.resource === resource) &&
           (p.action === action)
  );
}
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login, get tokens |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout, revoke tokens |
| GET | `/auth/me` | Get current user |
| PUT | `/auth/me` | Update profile |
| POST | `/auth/password` | Change password |
| GET | `/users` | List users (admin) |
| PUT | `/users/:id/role` | Update user role (admin) |

### Token Response

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "rt_abc123...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

## Project Tasks

### Task 1: User Registration & Login
- Password hashing with PBKDF2
- JWT generation
- Refresh token creation

### Task 2: Token Management
- Access token verification middleware
- Refresh token rotation
- Token revocation

### Task 3: Session Management
- Durable Object for sessions
- Multiple device support
- Session listing and revocation

### Task 4: RBAC Implementation
- Role definitions
- Permission checking middleware
- Admin user management

## Commands

```bash
# Create D1 database
npx wrangler d1 create edge-auth
npx wrangler d1 execute edge-auth --file=schema.sql

# Set secrets
npx wrangler secret put JWT_SECRET
npx wrangler secret put REFRESH_SECRET

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
09-edge-auth-system/
├── src/
│   ├── index.ts          # Main router
│   ├── jwt.ts            # JWT utilities
│   ├── password.ts       # Password hashing
│   ├── session.ts        # Session DO
│   ├── middleware.ts     # Auth middleware
│   └── rbac.ts           # Role-based access
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Register
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123","name":"John"}'

# Login
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}'

# Access protected route
curl http://localhost:8787/auth/me \
  -H "Authorization: Bearer eyJhbGc..."

# Refresh token
curl -X POST http://localhost:8787/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"rt_abc123..."}'

# Logout
curl -X POST http://localhost:8787/auth/logout \
  -H "Authorization: Bearer eyJhbGc..."
```

## Security Considerations

1. **Password Storage**: Use PBKDF2 with high iterations
2. **Token Storage**: Never store tokens in localStorage for sensitive apps
3. **HTTPS Only**: Always use HTTPS in production
4. **Token Expiry**: Short access tokens (15 min), longer refresh tokens (7 days)
5. **Refresh Rotation**: Invalidate old refresh tokens on use
6. **Rate Limiting**: Protect login endpoint from brute force

## Key Takeaways

1. JWT can be created/verified entirely at the edge with Web Crypto
2. Durable Objects provide consistent session state
3. Refresh token rotation prevents token theft
4. RBAC should be checked on every request
5. Always hash passwords with a strong algorithm (PBKDF2, bcrypt)
