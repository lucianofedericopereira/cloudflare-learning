# 00 - Hello Worker

Your first Cloudflare Worker! Learn the fundamentals of the Workers runtime.

## Learning Objectives

- Set up Wrangler CLI
- Understand the fetch handler pattern
- Handle requests and create responses
- Deploy to Cloudflare's edge network

## Concepts

### The Fetch Handler

Every Worker exports a `fetch` handler that receives incoming HTTP requests:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("Hello World!");
  }
};
```

**Parameters:**
- `request` - The incoming HTTP request
- `env` - Environment bindings (KV, R2, secrets, etc.)
- `ctx` - Execution context (for `waitUntil`)

### Request Object

```typescript
const url = new URL(request.url);
const method = request.method;
const headers = request.headers;
const body = await request.text(); // or .json(), .formData(), .arrayBuffer()
```

### Response Object

```typescript
// Simple text
new Response("Hello");

// JSON
Response.json({ message: "Hello" });

// With headers
new Response("Hello", {
  headers: { "Content-Type": "text/plain" }
});

// Status codes
new Response("Not Found", { status: 404 });
```

## Project Tasks

### Task 1: Basic Response
Create a Worker that returns "Hello from Cloudflare Workers!"

### Task 2: Request Info
Return JSON with request details:
- URL
- Method
- Headers (as object)
- Query parameters

### Task 3: Path Router
Handle different paths:
- `/` → Welcome message
- `/about` → About info
- `/api/time` → Current UTC time as JSON
- `*` → 404 Not Found

### Task 4: Method Handling
- `GET /` → Return greeting
- `POST /echo` → Echo back the request body
- `OPTIONS *` → Return CORS headers

## Commands

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy
npm run deploy

# View logs
npx wrangler tail
```

## File Structure

```
00-hello-worker/
├── src/
│   └── index.ts      # Main Worker code
├── wrangler.toml     # Wrangler configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Testing Your Worker

```bash
# Basic request
curl http://localhost:8787/

# With headers
curl -H "X-Custom: value" http://localhost:8787/

# POST request
curl -X POST -d '{"name":"test"}' http://localhost:8787/echo

# Query params
curl "http://localhost:8787/search?q=cloudflare"
```

## Key Takeaways

1. Workers run on Cloudflare's edge network (300+ locations)
2. Cold start is ~0ms (V8 isolates, not containers)
3. Request/Response follow the Web Standard Fetch API
4. `ctx.waitUntil()` for background tasks that shouldn't block response
