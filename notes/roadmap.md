# Learning Roadmap

Your path from zero to production-ready Cloudflare developer.

---

## How to Use This Roadmap

1. **Go in order** — Each level builds on the previous one
2. **Don't skip projects** — They're designed to teach concepts progressively
3. **Check boxes as you go** — Track your progress at the bottom

---

## Level 1: Getting Started

**You'll learn:** How Cloudflare works and deploy your first Worker.

| Topic | What to Learn | Try This |
|-------|---------------|----------|
| DNS Basics | How Cloudflare sits between users and your server | Add a domain to Cloudflare, set up A/CNAME records |
| SSL/TLS | The difference between Flexible, Full, and Strict modes | Enable Full (Strict) on your domain |
| Caching | How edge caching reduces load on your origin | Set up a Page Rule with "Cache Everything" |
| WAF | Basic firewall rules to block bad traffic | Create a rule blocking a specific country |
| Your First Worker | The Wrangler CLI and fetch handler basics | Complete **Project 00** |

**Milestone:** Deploy a Worker that returns different content based on the visitor's country.

---

## Level 2: Workers Deep Dive

**You'll learn:** How to build real applications with Workers.

| Topic | What to Learn | Try This |
|-------|---------------|----------|
| Request Object | Headers, cookies, query params, body parsing | Log all request headers to console |
| Response Object | Status codes, headers, JSON, streaming | Return different content types |
| Routing | Matching URLs to handlers | Build a mini router with 3+ routes |
| Middleware | Chaining handlers (CORS, auth, logging) | Add CORS headers to all responses |
| Error Handling | Graceful failures, structured errors | Return proper error JSON with stack traces in dev |

**Milestone:** Complete **Project 01** (URL Shortener) with analytics tracking.

---

## Level 3: Storage

**You'll learn:** When to use KV vs R2 vs D1 vs Durable Objects.

### Quick Decision Guide

| If you need... | Use |
|----------------|-----|
| Fast config reads, sessions, feature flags | **KV** |
| File uploads, images, backups | **R2** |
| SQL queries, relational data, joins | **D1** |
| Real-time state, coordination, WebSockets | **Durable Objects** |

### Topics

| Storage | Key Concepts | Project |
|---------|--------------|---------|
| KV | Eventually consistent, 60s propagation, TTL | **Project 02** |
| R2 | S3-compatible, zero egress fees, presigned URLs | **Project 05** |
| D1 | SQLite at edge, prepared statements, batch ops | **Project 04** |
| Durable Objects | Single instance, strong consistency, alarms | **Project 08** |

**Milestone:** Complete **Project 05** (Image CDN) with upload, transform, and caching.

---

## Level 4: Security & Zero Trust

**You'll learn:** How to secure internal services without a VPN.

| Topic | What to Learn | Try This |
|-------|---------------|----------|
| Cloudflare Tunnel | Connect servers without opening ports | Tunnel to a local dev server |
| Access Policies | Require login to access resources | Protect a route with Google login |
| Service Tokens | Machine-to-machine auth | Create a token for CI/CD access |
| Gateway | DNS and HTTP filtering | Block malware domains |
| Advanced WAF | Rate limiting, bot detection | Limit API to 100 req/min per IP |

**Milestone:** Set up Zero Trust access to a personal dashboard with SSO.

---

## Level 5: Advanced Patterns

**You'll learn:** Production patterns used by large-scale applications.

| Topic | What to Learn | Project |
|-------|---------------|---------|
| Queues | Async processing, retries, dead letter | **Project 07** |
| Cron Triggers | Scheduled jobs, cleanup tasks | Add daily cleanup to any project |
| WebSockets | Real-time with Durable Objects hibernation | **Project 08** |
| Workers AI | Embeddings, inference at the edge | **Project 10** |
| Service Bindings | Multi-worker architecture | **Project 11** |

**Milestone:** Complete **Project 11** — a full-stack SaaS with auth, billing, and real-time features.

---

## Projects Checklist

Complete these in order. Each one teaches new skills.

### Beginner

- [ ] **00 - Hello Worker** — Your first Worker, routing basics
- [ ] **01 - URL Shortener** — KV storage, redirects, analytics
- [ ] **02 - Redirect Engine** — Bulk operations, admin API
- [ ] **03 - Contact Form** — Email sending, spam protection

### Intermediate

- [ ] **04 - Link in Bio** — D1 database, dynamic pages
- [ ] **05 - Image CDN** — R2 storage, image transforms
- [ ] **06 - API Gateway** — Rate limiting, auth middleware
- [ ] **07 - Webhook Relay** — Queues, async processing

### Advanced

- [ ] **08 - Real-time Chat** — Durable Objects, WebSockets
- [ ] **09 - Edge Auth** — JWT, sessions, RBAC
- [ ] **10 - AI Search** — Embeddings, vector search, RAG
- [ ] **11 - Multi-tenant SaaS** — Everything combined

---

## Skills Progress

Track the concepts you've mastered:

### Foundations
- [ ] DNS records (A, AAAA, CNAME, TXT)
- [ ] SSL/TLS modes
- [ ] Cache rules and purging
- [ ] Basic WAF rules

### Workers
- [ ] Request/response handling
- [ ] URL routing
- [ ] Middleware pattern
- [ ] Error handling
- [ ] `ctx.waitUntil()` for background tasks

### Storage
- [ ] KV: read, write, list, delete with TTL
- [ ] R2: upload, download, presigned URLs
- [ ] D1: queries, prepared statements, batch
- [ ] Durable Objects: state, storage, alarms

### Security
- [ ] Cloudflare Tunnel setup
- [ ] Access policies with identity providers
- [ ] Rate limiting
- [ ] Bot management

### Advanced
- [ ] Queues: produce, consume, retry
- [ ] Cron triggers
- [ ] WebSocket hibernation
- [ ] Workers AI inference
- [ ] Service bindings

---

## Certifications & Badges

Cloudflare doesn't have formal certs like AWS, but you can earn badges:

**Cloudflare University** (at events/workshops)
- Zero Trust Foundations
- WAF Essentials
- Workers Developer Lab

**Developer Events** (watch the [blog](https://blog.cloudflare.com/))
- Developer Week challenges
- Hackathons
- Workers AI challenges

---

## What's Next?

After completing all projects:

1. **Build something real** — Use these skills for a side project or at work
2. **Contribute** — Open source projects using Cloudflare Workers
3. **Stay current** — Follow [Cloudflare Blog](https://blog.cloudflare.com/) for new features
4. **Join the community** — [Discord](https://discord.gg/cloudflaredev) is active and helpful
