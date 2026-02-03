# 11 - Multi-tenant SaaS

A complete multi-tenant SaaS application using the full Cloudflare stack.

## Learning Objectives

- Multi-tenancy patterns at the edge
- Combining all Cloudflare services
- Production deployment patterns
- Billing and usage tracking

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Workers   │    │   Pages     │    │   Durable Objects   │  │
│  │   (API)     │    │   (UI)      │    │   (Real-time)       │  │
│  └──────┬──────┘    └─────────────┘    └──────────┬──────────┘  │
│         │                                          │             │
│  ┌──────┴──────────────────────────────────────────┴──────────┐ │
│  │                       D1 Database                          │ │
│  │  (Users, Teams, Subscriptions, Projects, ...)              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │     KV      │    │     R2      │    │     Queues          │  │
│  │  (Cache)    │    │   (Files)   │    │  (Background Jobs)  │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Multi-tenancy Patterns

### Database-level Isolation

```sql
-- Every table has tenant_id
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- ...
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Always filter by tenant
SELECT * FROM projects WHERE tenant_id = ?;
```

### Subdomain-based Routing

```typescript
// Extract tenant from subdomain
const host = request.headers.get("Host");
const subdomain = host?.split(".")[0];

// acme.yourapp.com -> tenant: acme
const tenant = await getTenantBySubdomain(subdomain);
```

### API Key Scoping

```typescript
// API keys are scoped to tenant
interface ApiKey {
  id: string;
  tenantId: string;
  permissions: string[];
}
```

## Data Model

```sql
-- Tenants (organizations)
tenants (id, name, subdomain, plan, status, ...)

-- Users
users (id, email, password_hash, ...)

-- Team memberships
team_members (tenant_id, user_id, role, ...)

-- Subscriptions
subscriptions (id, tenant_id, plan, status, stripe_id, ...)

-- Usage tracking
usage_records (id, tenant_id, metric, value, timestamp, ...)

-- Projects (example resource)
projects (id, tenant_id, name, ...)
```

## Features

### Authentication & Authorization
- User registration/login
- Team invitations
- Role-based permissions (owner, admin, member)
- API key management

### Team Management
- Create/manage teams
- Invite members by email
- Role assignment
- Member removal

### Billing & Subscriptions
- Plan selection (Free, Pro, Enterprise)
- Usage-based limits
- Stripe integration
- Invoice history

### Multi-tenant Resources
- Projects (example resource)
- File storage per tenant
- API rate limits per plan

## API Design

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register + create tenant |
| POST | `/auth/login` | Login |
| POST | `/auth/invite` | Send team invite |
| POST | `/auth/accept-invite` | Accept invite |

### Teams
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/teams/current` | Get current team |
| PUT | `/teams/current` | Update team |
| GET | `/teams/members` | List members |
| POST | `/teams/members` | Add member |
| DELETE | `/teams/members/:id` | Remove member |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/billing/subscription` | Get subscription |
| POST | `/billing/subscribe` | Create subscription |
| POST | `/billing/cancel` | Cancel subscription |
| GET | `/billing/usage` | Get usage stats |
| GET | `/billing/invoices` | List invoices |

### Projects (Example Resource)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List projects |
| POST | `/projects` | Create project |
| GET | `/projects/:id` | Get project |
| PUT | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |

## Plans & Limits

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Team Members | 1 | 10 | Unlimited |
| Projects | 3 | 50 | Unlimited |
| Storage | 100MB | 10GB | 100GB |
| API Requests | 1K/day | 100K/day | Unlimited |
| Support | Community | Email | Priority |

## Project Tasks

### Task 1: Core Infrastructure
- Database schema
- Authentication system
- Tenant isolation

### Task 2: Team Management
- User invitations
- Role management
- Permissions

### Task 3: Billing Integration
- Stripe webhooks
- Plan management
- Usage tracking

### Task 4: Production Features
- Custom domains
- Audit logging
- Admin dashboard

## Commands

```bash
# Create all resources
npx wrangler d1 create multi-tenant-saas
npx wrangler kv:namespace create CACHE
npx wrangler r2 bucket create tenant-files
npx wrangler queues create background-jobs

# Initialize database
npx wrangler d1 execute multi-tenant-saas --file=schema.sql

# Set secrets
npx wrangler secret put JWT_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
11-multi-tenant-saas/
├── src/
│   ├── index.ts           # Main router
│   ├── auth/
│   │   ├── index.ts       # Auth routes
│   │   ├── jwt.ts         # JWT utilities
│   │   └── middleware.ts  # Auth middleware
│   ├── teams/
│   │   ├── index.ts       # Team routes
│   │   └── invites.ts     # Invitation logic
│   ├── billing/
│   │   ├── index.ts       # Billing routes
│   │   ├── stripe.ts      # Stripe integration
│   │   └── usage.ts       # Usage tracking
│   ├── projects/
│   │   └── index.ts       # Project CRUD
│   └── lib/
│       ├── db.ts          # Database helpers
│       └── tenant.ts      # Tenant utilities
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Register and create tenant
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@acme.com",
    "password": "secret123",
    "teamName": "Acme Inc",
    "subdomain": "acme"
  }'

# Login
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@acme.com","password":"secret123"}'

# Create project (with auth)
curl -X POST http://localhost:8787/projects \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"name":"My Project"}'

# Invite team member
curl -X POST http://localhost:8787/auth/invite \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"email":"member@acme.com","role":"member"}'
```

## Stripe Webhook Events

Handle these webhook events:

- `checkout.session.completed` - New subscription
- `customer.subscription.updated` - Plan change
- `customer.subscription.deleted` - Cancellation
- `invoice.paid` - Successful payment
- `invoice.payment_failed` - Failed payment

## Key Takeaways

1. Always scope data queries by tenant_id
2. Use middleware to inject tenant context
3. Track usage asynchronously with Queues
4. Cache tenant lookups in KV
5. Use Durable Objects for real-time per-tenant features
6. Stripe handles payment complexity - integrate early
