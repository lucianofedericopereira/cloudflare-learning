# 01 - URL Shortener

Build a URL shortener service using Workers and KV storage.

## Learning Objectives

- Use Cloudflare KV for key-value storage
- Design REST API endpoints
- Handle redirects
- Track analytics (click counts)

## Concepts

### Cloudflare KV

KV is a globally distributed key-value store:
- **Eventually consistent** (reads may be stale for ~60 seconds)
- **High read throughput** (optimized for read-heavy workloads)
- **Low latency** (data cached at edge locations)

```typescript
// Write
await env.URLS.put("abc123", "https://example.com");

// Write with metadata
await env.URLS.put("abc123", "https://example.com", {
  metadata: { clicks: 0, created: Date.now() }
});

// Write with expiration
await env.URLS.put("abc123", "https://example.com", {
  expirationTtl: 86400 // 24 hours in seconds
});

// Read
const url = await env.URLS.get("abc123");

// Read with metadata
const { value, metadata } = await env.URLS.getWithMetadata("abc123");

// Delete
await env.URLS.delete("abc123");

// List keys
const { keys } = await env.URLS.list({ prefix: "url:" });
```

### URL Shortening Strategy

```typescript
// Option 1: Random ID
const id = crypto.randomUUID().slice(0, 8);

// Option 2: Base62 encoding
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const id = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => chars[b % 62])
  .join("");

// Option 3: Custom slug (user-provided)
const id = request.json().slug;
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/shorten` | Create short URL |
| GET | `/:code` | Redirect to original URL |
| GET | `/api/stats/:code` | Get URL statistics |
| DELETE | `/api/urls/:code` | Delete a short URL |

### Request/Response Examples

**Create Short URL:**
```bash
POST /api/shorten
Content-Type: application/json

{
  "url": "https://developers.cloudflare.com/workers/",
  "customSlug": "cf-workers"  // optional
}

# Response
{
  "shortUrl": "https://short.example.com/cf-workers",
  "code": "cf-workers",
  "originalUrl": "https://developers.cloudflare.com/workers/"
}
```

**Get Stats:**
```bash
GET /api/stats/cf-workers

# Response
{
  "code": "cf-workers",
  "originalUrl": "https://developers.cloudflare.com/workers/",
  "clicks": 42,
  "created": "2024-01-15T10:30:00Z"
}
```

## Project Tasks

### Task 1: Basic Shortener
- Create short URLs with random codes
- Redirect short codes to original URLs
- Return 404 for unknown codes

### Task 2: Custom Slugs
- Allow users to specify custom slugs
- Validate slug format (alphanumeric, 3-20 chars)
- Check for slug collisions

### Task 3: Analytics
- Track click counts
- Store creation timestamp
- Create stats endpoint

### Task 4: URL Validation
- Validate URL format
- Block malicious URLs (optional)
- Normalize URLs

## Commands

```bash
# Create KV namespace
npx wrangler kv:namespace create URLS

# Create preview namespace (for local dev)
npx wrangler kv:namespace create URLS --preview

# Update wrangler.toml with the IDs from above commands

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
01-url-shortener/
├── src/
│   └── index.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Create short URL
curl -X POST http://localhost:8787/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://cloudflare.com"}'

# Test redirect
curl -I http://localhost:8787/abc123

# Get stats
curl http://localhost:8787/api/stats/abc123

# Custom slug
curl -X POST http://localhost:8787/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://cloudflare.com", "customSlug": "cf"}'
```

## Key Takeaways

1. KV is perfect for URL shorteners (read-heavy, simple key-value)
2. Metadata allows storing additional info without separate keys
3. `expirationTtl` enables auto-cleanup of temporary URLs
4. Always validate and sanitize user input
