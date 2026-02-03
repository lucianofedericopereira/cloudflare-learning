# 06 - API Gateway

A full-featured API gateway with authentication, rate limiting, and request transformation.

## Learning Objectives

- Rate limiting with KV and Durable Objects
- API key management
- Request/response transformation
- Middleware patterns
- Metrics and logging

## Concepts

### Rate Limiting Strategies

#### KV-based (Simple, Eventually Consistent)
```typescript
// Sliding window counter in KV
const key = `rate:${apiKey}:${Math.floor(Date.now() / 60000)}`;
const count = parseInt(await env.RATE_LIMIT.get(key) || "0");

if (count >= limit) {
  return new Response("Rate limit exceeded", { status: 429 });
}

await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 120 });
```

#### Durable Objects (Precise, Strongly Consistent)
```typescript
// In Durable Object
export class RateLimiter {
  private requests: number[] = [];
  private limit = 100;
  private window = 60000; // 1 minute

  async fetch(request: Request) {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.window);

    if (this.requests.length >= this.limit) {
      return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    this.requests.push(now);
    return new Response("OK");
  }
}
```

### API Key Management

```typescript
interface ApiKey {
  id: string;
  key: string;           // Hashed
  name: string;
  userId: string;
  permissions: string[];
  rateLimit: number;
  enabled: boolean;
  created: string;
  lastUsed: string;
}

// Generate API key
const key = `gw_${crypto.randomUUID().replace(/-/g, "")}`;

// Hash for storage
const hash = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(key)
);
```

### Request Transformation

```typescript
// Add headers
request = new Request(request.url, {
  ...request,
  headers: new Headers([
    ...request.headers,
    ["X-Forwarded-For", clientIP],
    ["X-Request-ID", requestId],
  ]),
});

// Modify URL
const url = new URL(request.url);
url.pathname = url.pathname.replace("/api/v1", "/internal");
request = new Request(url, request);

// Transform body
const body = await request.json();
body.timestamp = Date.now();
request = new Request(request.url, {
  ...request,
  body: JSON.stringify(body),
});
```

### Response Transformation

```typescript
// Clone and modify response
const response = await fetch(upstream);
const body = await response.json();

// Add metadata
body.meta = {
  requestId,
  latency: Date.now() - startTime,
};

return Response.json(body, {
  status: response.status,
  headers: {
    ...Object.fromEntries(response.headers),
    "X-Request-ID": requestId,
  },
});
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/*` | Proxy to upstream |
| GET | `/gateway/health` | Health check |
| GET | `/gateway/keys` | List API keys (admin) |
| POST | `/gateway/keys` | Create API key (admin) |
| DELETE | `/gateway/keys/:id` | Revoke API key (admin) |
| GET | `/gateway/metrics` | Usage metrics (admin) |

### Request Headers

| Header | Description |
|--------|-------------|
| `X-API-Key` | API key for authentication |
| `Authorization` | Bearer token alternative |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Request-ID` | Unique request identifier |
| `X-RateLimit-Limit` | Rate limit ceiling |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Reset timestamp |
| `X-Response-Time` | Processing time in ms |

## Project Tasks

### Task 1: Basic Proxy
- Forward requests to upstream
- Add request/response headers
- Error handling

### Task 2: API Key Authentication
- Validate API keys
- Store keys in D1
- Track last used timestamp

### Task 3: Rate Limiting
- Implement sliding window
- Per-key rate limits
- Return rate limit headers

### Task 4: Metrics & Logging
- Track request counts
- Measure latency
- Log errors

## Commands

```bash
# Create KV namespace
npx wrangler kv:namespace create RATE_LIMIT
npx wrangler kv:namespace create RATE_LIMIT --preview

# Create D1 database
npx wrangler d1 create api-gateway
npx wrangler d1 execute api-gateway --file=schema.sql

# Set admin secret
npx wrangler secret put ADMIN_KEY

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
06-api-gateway/
├── src/
│   ├── index.ts        # Main router
│   ├── auth.ts         # API key validation
│   ├── ratelimit.ts    # Rate limiting
│   ├── proxy.ts        # Request proxying
│   ├── transform.ts    # Request/response transforms
│   └── metrics.ts      # Metrics collection
├── schema.sql          # Database schema
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Test API proxy
curl http://localhost:8787/api/users \
  -H "X-API-Key: your-api-key"

# Check rate limit headers
curl -I http://localhost:8787/api/users \
  -H "X-API-Key: your-api-key"

# Create API key (admin)
curl -X POST http://localhost:8787/gateway/keys \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "rateLimit": 1000}'

# Get metrics (admin)
curl http://localhost:8787/gateway/metrics \
  -H "Authorization: Bearer admin-key"
```

## Configuration

```typescript
interface GatewayConfig {
  upstream: string;           // Backend URL
  defaultRateLimit: number;   // Requests per minute
  timeout: number;            // Request timeout in ms
  retries: number;            // Retry count
  cors: {
    origins: string[];
    methods: string[];
    headers: string[];
  };
}
```

## Key Takeaways

1. Use KV for simple rate limiting, Durable Objects for precise limits
2. Always hash API keys before storage
3. Include request ID in all responses for debugging
4. Set appropriate timeouts for upstream requests
5. Use `ctx.waitUntil()` for non-blocking logging/metrics
