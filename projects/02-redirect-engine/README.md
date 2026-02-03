# 02 - Redirect Engine

A production-ready redirect management system with bulk operations and admin API.

## Learning Objectives

- KV bulk operations
- Admin API with authentication
- Redirect rules (301 vs 302, wildcards)
- Import/export functionality

## Concepts

### Redirect Types

| Code | Type | Use Case | Caching |
|------|------|----------|---------|
| 301 | Permanent | URL changed forever | Browsers cache indefinitely |
| 302 | Temporary | A/B tests, maintenance | Not cached |
| 307 | Temporary | Preserve method (POST) | Not cached |
| 308 | Permanent | Preserve method (POST) | Cached |

### KV Bulk Operations

```typescript
// Bulk write (up to 10,000 pairs per request)
await env.REDIRECTS.put("key1", "value1");
// Note: True bulk write requires the API, not the binding

// List with pagination
let cursor: string | undefined;
const allKeys: string[] = [];

do {
  const result = await env.REDIRECTS.list({ cursor, limit: 1000 });
  allKeys.push(...result.keys.map(k => k.name));
  cursor = result.list_complete ? undefined : result.cursor;
} while (cursor);

// Prefix-based listing
const { keys } = await env.REDIRECTS.list({ prefix: "redirect:" });
```

### Redirect Rule Schema

```typescript
interface RedirectRule {
  source: string;        // Path or pattern to match
  destination: string;   // Target URL
  statusCode: 301 | 302 | 307 | 308;
  preserveQueryString: boolean;
  enabled: boolean;
  created: string;
  updated: string;
  hits: number;
}
```

### Pattern Matching

```typescript
// Exact match
"/old-page" → "/new-page"

// Wildcard (*)
"/blog/*" → "/articles/*"

// Path parameter
"/users/:id" → "/profiles/:id"

// Query string preservation
"/search" → "/find" (with ?q=... preserved)
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Check redirect or show API docs |
| GET | `/*` | Process redirect |
| GET | `/api/redirects` | List all redirects |
| POST | `/api/redirects` | Create redirect |
| PUT | `/api/redirects/:id` | Update redirect |
| DELETE | `/api/redirects/:id` | Delete redirect |
| POST | `/api/redirects/bulk` | Bulk import |
| GET | `/api/redirects/export` | Export all |

### Authentication

```typescript
// API Key in header
headers: {
  "X-API-Key": "your-secret-key"
}

// Or Bearer token
headers: {
  "Authorization": "Bearer your-secret-key"
}
```

## Project Tasks

### Task 1: Basic Redirects
- Store and retrieve redirect rules
- Support 301 and 302 redirects
- Handle exact path matching

### Task 2: Pattern Matching
- Implement wildcard matching (`*`)
- Support path parameters (`:id`)
- Query string preservation

### Task 3: Admin API
- CRUD endpoints for redirects
- API key authentication
- List with pagination

### Task 4: Bulk Operations
- Import from CSV/JSON
- Export functionality
- Validation and error reporting

## Commands

```bash
# Create KV namespace
npx wrangler kv:namespace create REDIRECTS
npx wrangler kv:namespace create REDIRECTS --preview

# Set API key secret
npx wrangler secret put API_KEY

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
02-redirect-engine/
├── src/
│   ├── index.ts       # Main router
│   ├── redirects.ts   # Redirect logic
│   ├── admin.ts       # Admin API
│   └── types.ts       # TypeScript types
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Create redirect
curl -X POST http://localhost:8787/api/redirects \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "/old",
    "destination": "https://example.com/new",
    "statusCode": 301
  }'

# Test redirect
curl -I http://localhost:8787/old

# Bulk import
curl -X POST http://localhost:8787/api/redirects/bulk \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '[
    {"source": "/a", "destination": "/b"},
    {"source": "/x", "destination": "/y"}
  ]'

# Export
curl http://localhost:8787/api/redirects/export \
  -H "X-API-Key: your-key"
```

## Sample CSV Import Format

```csv
source,destination,statusCode,preserveQueryString
/old-page,/new-page,301,true
/blog/*,/articles/*,301,true
/temp,/maintenance,302,false
```

## Key Takeaways

1. KV list operations are paginated (max 1000 keys per call)
2. Use prefixes to organize keys (`redirect:/old-page`)
3. Wildcard matching requires custom logic (not built into KV)
4. Always validate redirects to prevent loops
5. 301 redirects are cached by browsers - use carefully
