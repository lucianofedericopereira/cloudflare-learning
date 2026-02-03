# 04 - Link in Bio

A "Linktree-style" link-in-bio page using Cloudflare Pages, D1 database, and Workers.

## Learning Objectives

- D1 (SQLite at the edge) for relational data
- Cloudflare Pages deployment
- Analytics tracking
- Dynamic page generation

## Concepts

### Cloudflare D1

D1 is SQLite at the edge - a relational database with familiar SQL syntax:

```typescript
// Query with parameters (prevents SQL injection)
const { results } = await env.DB.prepare(
  "SELECT * FROM users WHERE id = ?"
).bind(userId).all();

// Single row
const user = await env.DB.prepare(
  "SELECT * FROM users WHERE id = ?"
).bind(userId).first();

// Insert
await env.DB.prepare(
  "INSERT INTO links (title, url, user_id) VALUES (?, ?, ?)"
).bind(title, url, userId).run();

// Update
await env.DB.prepare(
  "UPDATE links SET clicks = clicks + 1 WHERE id = ?"
).bind(linkId).run();

// Batch operations
await env.DB.batch([
  env.DB.prepare("INSERT INTO links ...").bind(...),
  env.DB.prepare("UPDATE users ...").bind(...),
]);
```

### D1 Schema Design

```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  theme TEXT DEFAULT 'default',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Links table
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  clicks INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Analytics events
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  link_id TEXT,
  event_type TEXT NOT NULL,
  ip_hash TEXT,
  country TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_links_user ON links(user_id);
CREATE INDEX idx_events_user_date ON events(user_id, created_at);
```

## Features

- **Public Profile**: `/@username` displays user's links
- **Click Tracking**: Every link click is recorded
- **Analytics Dashboard**: View stats per link
- **Themes**: Customizable appearance
- **Admin API**: CRUD operations for links

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/@:username` | Public profile page |
| GET | `/api/users/:id` | Get user profile |
| PUT | `/api/users/:id` | Update profile |
| GET | `/api/users/:id/links` | Get user's links |
| POST | `/api/links` | Create link |
| PUT | `/api/links/:id` | Update link |
| DELETE | `/api/links/:id` | Delete link |
| GET | `/api/analytics` | Get analytics |
| GET | `/go/:linkId` | Redirect & track |

## Project Tasks

### Task 1: Database Setup
- Create D1 database
- Design and run schema migrations
- Seed with sample data

### Task 2: Profile Page
- Fetch user and links from D1
- Render HTML page
- Apply theme styling

### Task 3: Link Management
- CRUD API for links
- Reorder links (drag & drop support)
- Enable/disable links

### Task 4: Analytics
- Track page views
- Track link clicks
- Country/date aggregations

## Commands

```bash
# Create D1 database
npx wrangler d1 create link-in-bio

# Run migrations
npx wrangler d1 execute link-in-bio --file=schema.sql

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
04-link-in-bio/
├── src/
│   ├── index.ts        # Main router
│   ├── db.ts           # Database helpers
│   ├── templates.ts    # HTML templates
│   └── analytics.ts    # Analytics logic
├── schema.sql          # Database schema
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Get profile page
curl http://localhost:8787/@johndoe

# Create link
curl -X POST http://localhost:8787/api/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{
    "userId": "user_123",
    "title": "My Website",
    "url": "https://example.com"
  }'

# Get analytics
curl http://localhost:8787/api/analytics?userId=user_123 \
  -H "Authorization: Bearer token"
```

## Sample Profile Page

```
┌─────────────────────────────────┐
│         [Avatar Image]          │
│          @johndoe               │
│    Full Stack Developer         │
│    Building cool things         │
│                                 │
│  ┌───────────────────────────┐  │
│  │     🌐 My Website         │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │     🐦 Twitter            │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │     💼 LinkedIn           │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │     📧 Email Me           │  │
│  └───────────────────────────┘  │
│                                 │
│     Powered by Cloudflare       │
└─────────────────────────────────┘
```

## Key Takeaways

1. D1 is great for relational data with joins and aggregations
2. Use parameterized queries to prevent SQL injection
3. `batch()` for atomic multi-statement operations
4. Indexes are crucial for query performance
5. Track analytics asynchronously with `ctx.waitUntil()`
