# Cloudflare Core Concepts

A comprehensive reference for understanding Cloudflare's architecture, services, and best practices.

---

## Table of Contents

1. [Edge Computing Fundamentals](#edge-computing-fundamentals)
2. [Workers Runtime](#workers-runtime)
3. [Storage Options](#storage-options)
4. [Networking & Security](#networking--security)
5. [Performance Optimization](#performance-optimization)
6. [Architectural Patterns](#architectural-patterns)

---

## Edge Computing Fundamentals

### What is the Edge?

The "edge" refers to servers distributed globally, physically close to end users. Instead of requests traveling to a central data center, they're handled by the nearest edge location.

```
Traditional:
User (Brazil) → Origin Server (US-East) → Response
Latency: ~200ms

Edge:
User (Brazil) → Edge (São Paulo) → Response
Latency: ~20ms
```

### Cloudflare's Network

- **300+ cities** worldwide
- **100+ countries** covered
- **Anycast routing**: Same IP, nearest server responds
- **< 50ms** to 95% of internet-connected population

### Cold Starts

Unlike AWS Lambda, Workers have **zero cold starts**:
- V8 isolates instead of containers
- Isolates spin up in < 5ms
- Multiple Workers share the same runtime

---

## Workers Runtime

### The V8 Isolate Model

Workers don't run in containers—they run in V8 isolates (same engine as Chrome):

```
┌─────────────────────────────────────┐
│           V8 Runtime                │
├─────────┬─────────┬─────────┬──────┤
│ Isolate │ Isolate │ Isolate │ ...  │
│ (Your   │ (Other  │ (Other  │      │
│ Worker) │ Worker) │ Worker) │      │
└─────────┴─────────┴─────────┴──────┘
```

**Benefits:**
- Lightweight (< 5ms startup)
- Memory efficient (shared runtime)
- Secure (strong isolation between isolates)

**Constraints:**
- No file system access
- No native Node.js modules
- CPU time limits (10-50ms per request on free plan)
- Memory limit (128MB)

### Request Lifecycle

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 1. Request comes in
    // 2. Your code executes (< 50ms CPU time)
    // 3. Response goes out
    // 4. ctx.waitUntil() tasks complete after response

    ctx.waitUntil(logAnalytics(request)); // Non-blocking
    return new Response("Hello");
  }
}
```

### ExecutionContext Methods

| Method | Purpose |
|--------|---------|
| `ctx.waitUntil(promise)` | Extend lifetime for background work |
| `ctx.passThroughOnException()` | Fall through to origin on error |

### Environment Bindings

```typescript
interface Env {
  // KV Namespace
  MY_KV: KVNamespace;

  // R2 Bucket
  MY_BUCKET: R2Bucket;

  // D1 Database
  DB: D1Database;

  // Durable Object
  COUNTER: DurableObjectNamespace;

  // Service Binding (another Worker)
  AUTH_SERVICE: Fetcher;

  // Environment Variables
  API_KEY: string;

  // Secrets (same as vars, but hidden in dashboard)
  SECRET_KEY: string;
}
```

---

## Storage Options

### Decision Matrix

| Need | Use | Why |
|------|-----|-----|
| Config, feature flags | KV | Fast reads, eventual consistency OK |
| User sessions | KV | TTL support, global replication |
| Files, images, backups | R2 | S3-compatible, no egress fees |
| Relational data | D1 | SQL queries, joins, transactions |
| Real-time state | Durable Objects | Strong consistency, WebSockets |
| Background jobs | Queues | Async processing, retries |
| Vector search | Vectorize | Embeddings, similarity search |

### KV (Key-Value)

**Characteristics:**
- Eventually consistent (60s propagation)
- Optimized for reads (< 10ms globally)
- Writes are slower (~1s)
- Max value size: 25MB
- Max key size: 512 bytes

**Best for:**
- Configuration
- Feature flags
- Static content caching
- Session tokens (with TTL)

```typescript
// Write with expiration
await env.KV.put("session:abc", JSON.stringify(data), {
  expirationTtl: 3600 // 1 hour
});

// Read with type
const data = await env.KV.get("config", "json");

// List keys with prefix
const { keys } = await env.KV.list({ prefix: "user:" });

// Delete
await env.KV.delete("session:abc");
```

### R2 (Object Storage)

**Characteristics:**
- S3-compatible API
- Zero egress fees
- Max object size: 5TB
- Strong consistency for single objects

**Best for:**
- User uploads
- Static assets
- Backups
- Log archives

```typescript
// Upload
await env.BUCKET.put("images/photo.jpg", imageData, {
  httpMetadata: { contentType: "image/jpeg" }
});

// Download
const object = await env.BUCKET.get("images/photo.jpg");
if (object) {
  return new Response(object.body, {
    headers: { "Content-Type": object.httpMetadata?.contentType }
  });
}

// List objects
const { objects } = await env.BUCKET.list({ prefix: "images/" });

// Delete
await env.BUCKET.delete("images/photo.jpg");
```

### D1 (SQLite)

**Characteristics:**
- Full SQLite at the edge
- Read replicas globally
- Writes go to primary (single region)
- Max database size: 2GB (free), 10GB (paid)

**Best for:**
- User data
- Application state
- Analytics aggregation
- Any relational data

```typescript
// Prepared statement (always use for user input!)
const { results } = await env.DB
  .prepare("SELECT * FROM users WHERE id = ?")
  .bind(userId)
  .all();

// Insert with returning
const { results } = await env.DB
  .prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING *")
  .bind(name, email)
  .all();

// Batch operations (transaction)
await env.DB.batch([
  env.DB.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?").bind(100, fromId),
  env.DB.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?").bind(100, toId),
]);
```

### Durable Objects

**Characteristics:**
- Single instance globally (strong consistency)
- In-memory state + persistent storage
- WebSocket support with hibernation
- Transactional storage API

**Best for:**
- Real-time collaboration
- Rate limiting
- Game state
- Chat rooms
- Distributed locks

```typescript
// Durable Object class
export class Counter implements DurableObject {
  private value: number = 0;

  constructor(private state: DurableObjectState, private env: Env) {
    // Load persisted state
    state.blockConcurrencyWhile(async () => {
      this.value = await state.storage.get("value") ?? 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    this.value++;
    await this.state.storage.put("value", this.value);
    return Response.json({ value: this.value });
  }
}

// Getting a stub (from Worker)
const id = env.COUNTER.idFromName("my-counter");
const stub = env.COUNTER.get(id);
const response = await stub.fetch(request);
```

### Queues

**Characteristics:**
- At-least-once delivery
- Automatic retries with backoff
- Batching support
- Max message size: 128KB

**Best for:**
- Background jobs
- Webhook processing
- Email sending
- Data pipelines

```typescript
// Producer (Worker)
await env.MY_QUEUE.send({
  type: "email",
  to: "user@example.com",
  subject: "Hello"
});

// Consumer (separate export)
export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      try {
        await processMessage(message.body);
        message.ack();
      } catch (error) {
        message.retry(); // Will retry with backoff
      }
    }
  }
}
```

---

## Networking & Security

### SSL/TLS Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Off** | No encryption | Never in production |
| **Flexible** | HTTPS to Cloudflare, HTTP to origin | Legacy servers |
| **Full** | HTTPS everywhere, any cert on origin | Self-signed certs |
| **Full (Strict)** | HTTPS everywhere, valid cert required | Production default |

### Origin Certificates

Cloudflare can issue free certificates for your origin:

```bash
# Generate in dashboard or API
# Valid for 15 years
# Only trusted by Cloudflare (not browsers directly)
```

### Firewall Rules (WAF)

```javascript
// Block by country
(ip.geoip.country eq "RU")

// Rate limit by IP
(http.request.uri.path contains "/api/") and (cf.threat_score gt 10)

// Require authentication header
(http.request.uri.path contains "/admin") and (not http.request.headers["x-auth-token"])
```

### Zero Trust Architecture

```
┌─────────────┐     ┌───────────────┐     ┌────────────┐
│ User +      │────▶│ Cloudflare    │────▶│ Origin     │
│ WARP Client │     │ Access        │     │ (tunneled) │
└─────────────┘     └───────────────┘     └────────────┘
                           │
                    ┌──────┴──────┐
                    │ Identity    │
                    │ Provider    │
                    │ (Google,    │
                    │ Okta, etc)  │
                    └─────────────┘
```

**Components:**
- **WARP**: Client VPN replacement
- **Access**: Identity-aware proxy
- **Tunnel**: Secure origin connection (no open ports)
- **Gateway**: DNS/HTTP filtering

---

## Performance Optimization

### Cache API

```typescript
// Check cache first
const cache = caches.default;
const cached = await cache.match(request);
if (cached) return cached;

// Generate response
const response = await generateResponse();

// Cache for future requests
ctx.waitUntil(cache.put(request, response.clone()));
return response;
```

### Cache Headers

```typescript
return new Response(body, {
  headers: {
    // Browser cache: 1 hour
    "Cache-Control": "public, max-age=3600",

    // CDN cache: 1 day (overrides browser)
    "CDN-Cache-Control": "max-age=86400",

    // Cloudflare-specific: 1 week
    "Cloudflare-CDN-Cache-Control": "max-age=604800",
  }
});
```

### Cache Tags (Enterprise)

```typescript
// Tag responses for targeted purging
return new Response(body, {
  headers: {
    "Cache-Tag": "product-123, category-electronics"
  }
});

// Purge by tag via API
// POST /zones/{zone_id}/purge_cache
// { "tags": ["product-123"] }
```

### Smart Placement

Workers automatically run at the edge, but for database-heavy workloads:

```toml
# wrangler.toml
[placement]
mode = "smart"
# Worker runs closer to your D1 database
```

### Streaming Responses

```typescript
// Don't buffer—stream large responses
const { readable, writable } = new TransformStream();

ctx.waitUntil((async () => {
  const writer = writable.getWriter();
  for await (const chunk of generateChunks()) {
    await writer.write(chunk);
  }
  await writer.close();
})());

return new Response(readable);
```

---

## Architectural Patterns

### Router Pattern

```typescript
type Handler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Record<string, Handler>> = {
  GET: {
    "/api/users": getUsers,
    "/api/users/:id": getUser,
  },
  POST: {
    "/api/users": createUser,
  }
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const method = request.method;

    const handler = routes[method]?.[url.pathname];
    if (handler) {
      return handler(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  }
}
```

### Middleware Pattern

```typescript
type Middleware = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  next: () => Promise<Response>
) => Promise<Response>;

const cors: Middleware = async (req, env, ctx, next) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
      }
    });
  }
  const response = await next();
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
};

const auth: Middleware = async (req, env, ctx, next) => {
  const token = req.headers.get("Authorization");
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next();
};

// Compose middlewares
function compose(...middlewares: Middleware[]): Handler {
  return async (req, env, ctx) => {
    let index = 0;
    const next = async (): Promise<Response> => {
      if (index >= middlewares.length) {
        return new Response("Not Found", { status: 404 });
      }
      return middlewares[index++](req, env, ctx, next);
    };
    return next();
  };
}
```

### Service Bindings (Microservices)

```toml
# wrangler.toml
[[services]]
binding = "AUTH_SERVICE"
service = "auth-worker"
```

```typescript
// Call another Worker directly (no HTTP overhead)
const authResponse = await env.AUTH_SERVICE.fetch(
  new Request("https://auth/verify", {
    method: "POST",
    body: JSON.stringify({ token })
  })
);
```

### Durable Object Singleton

```typescript
// Rate limiter as a singleton per key
export class RateLimiter implements DurableObject {
  private requests: number[] = [];

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;

    // Remove old requests
    this.requests = this.requests.filter(t => t > now - windowMs);

    if (this.requests.length >= maxRequests) {
      return new Response("Rate limited", { status: 429 });
    }

    this.requests.push(now);
    return new Response("OK");
  }
}

// Usage
const id = env.RATE_LIMITER.idFromName(clientIP);
const limiter = env.RATE_LIMITER.get(id);
const result = await limiter.fetch(request);
```

### Fan-out with Queues

```typescript
// Receive webhook, fan out to multiple destinations
export default {
  async fetch(request: Request, env: Env) {
    const webhook = await request.json();

    // Fan out to queue
    await env.WEBHOOK_QUEUE.send({
      payload: webhook,
      destinations: [
        "https://service-a.com/webhook",
        "https://service-b.com/webhook",
        "https://service-c.com/webhook"
      ]
    });

    return new Response("Accepted", { status: 202 });
  },

  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const { payload, destinations } = message.body;

      // Deliver to all destinations in parallel
      await Promise.all(
        destinations.map(url =>
          fetch(url, {
            method: "POST",
            body: JSON.stringify(payload)
          })
        )
      );

      message.ack();
    }
  }
}
```

---

## Common Gotchas

### 1. KV is Eventually Consistent

```typescript
// This might fail!
await env.KV.put("key", "value");
const result = await env.KV.get("key"); // Might be null!

// Solution: Design for eventual consistency
// Or use Durable Objects for strong consistency
```

### 2. Subrequests Count Against Limits

```typescript
// Free plan: 50 subrequests per request
// Each fetch() counts!
const results = await Promise.all(
  urls.map(url => fetch(url)) // 10 URLs = 10 subrequests
);
```

### 3. CPU Time vs Wall Time

```typescript
// CPU time limit: 10-50ms (depends on plan)
// Wall time limit: 30 seconds

// This is fine (mostly waiting, little CPU):
await fetch("https://slow-api.com"); // 5 seconds wall time, ~1ms CPU

// This will fail (pure computation):
for (let i = 0; i < 1000000000; i++) {} // Burns CPU time
```

### 4. Request Bodies Can Only Be Read Once

```typescript
// Wrong:
const body1 = await request.json();
const body2 = await request.json(); // Error!

// Right:
const body = await request.json();
// Use body multiple times
```

### 5. Response Bodies Can Only Be Read Once

```typescript
// Wrong:
const data1 = await response.json();
const data2 = await response.json(); // Error!

// Right:
const response = await fetch(url);
const cloned = response.clone();
await cache.put(request, cloned);
return response;
```

---

## Best Practices Checklist

### Security
- [ ] Always use prepared statements for D1
- [ ] Validate and sanitize all user input
- [ ] Use secrets for API keys (not vars)
- [ ] Implement rate limiting
- [ ] Set appropriate CORS headers
- [ ] Use Full (Strict) SSL mode

### Performance
- [ ] Use Cache API for expensive operations
- [ ] Stream large responses
- [ ] Use `ctx.waitUntil()` for non-critical work
- [ ] Enable Smart Placement for database-heavy Workers
- [ ] Minimize subrequests

### Reliability
- [ ] Handle errors gracefully
- [ ] Use Queues for background processing
- [ ] Implement retries with exponential backoff
- [ ] Monitor with Workers Analytics
- [ ] Set up alerting for error spikes

### Cost Optimization
- [ ] Use KV for read-heavy data
- [ ] Use R2 instead of external storage (no egress)
- [ ] Batch D1 operations when possible
- [ ] Cache aggressively
- [ ] Use Durable Object hibernation for WebSockets
