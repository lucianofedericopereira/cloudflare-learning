/**
 * 11 - Multi-tenant SaaS
 *
 * A complete multi-tenant SaaS application using:
 * - D1 for relational data
 * - KV for caching
 * - R2 for file storage
 * - Queues for background jobs
 * - Durable Objects for real-time
 */

import { handleAuth } from "./auth";
import { handleTeams } from "./teams";
import { handleBilling } from "./billing";
import { handleProjects } from "./projects";
import { authMiddleware, TenantContext } from "./auth/middleware";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  FILES: R2Bucket;
  JOBS: Queue;
  JWT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tenant-ID",
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // Public Routes (no auth required)
      // ============================================

      // Auth routes
      if (pathname.startsWith("/auth/")) {
        return handleAuth(request, env, ctx);
      }

      // Stripe webhooks
      if (pathname === "/webhooks/stripe") {
        return handleStripeWebhook(request, env);
      }

      // Health check
      if (pathname === "/health") {
        return Response.json(
          { status: "healthy", timestamp: new Date().toISOString() },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Protected Routes (auth required)
      // ============================================

      // Authenticate request
      const tenantContext = await authMiddleware(request, env);

      if (!tenantContext) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }

      // Team management
      if (pathname.startsWith("/teams")) {
        return handleTeams(request, env, tenantContext);
      }

      // Billing
      if (pathname.startsWith("/billing")) {
        return handleBilling(request, env, tenantContext);
      }

      // Projects
      if (pathname.startsWith("/projects")) {
        return handleProjects(request, env, tenantContext);
      }

      // Current user
      if (pathname === "/me" && request.method === "GET") {
        return Response.json(
          {
            user: {
              id: tenantContext.userId,
              email: tenantContext.email,
              name: tenantContext.name,
            },
            tenant: {
              id: tenantContext.tenantId,
              name: tenantContext.tenantName,
              subdomain: tenantContext.subdomain,
              plan: tenantContext.plan,
            },
            role: tenantContext.role,
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // API Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Multi-tenant SaaS API",
            version: "1.0.0",
            endpoints: {
              auth: {
                "POST /auth/register": "Register and create team",
                "POST /auth/login": "Login",
                "POST /auth/invite": "Send team invite",
                "POST /auth/accept-invite": "Accept invite",
              },
              teams: {
                "GET /teams/current": "Get current team",
                "PUT /teams/current": "Update team",
                "GET /teams/members": "List members",
                "POST /teams/members": "Add member",
                "DELETE /teams/members/:id": "Remove member",
              },
              billing: {
                "GET /billing/subscription": "Get subscription",
                "POST /billing/subscribe": "Create subscription",
                "POST /billing/cancel": "Cancel subscription",
                "GET /billing/usage": "Get usage stats",
              },
              projects: {
                "GET /projects": "List projects",
                "POST /projects": "Create project",
                "GET /projects/:id": "Get project",
                "PUT /projects/:id": "Update project",
                "DELETE /projects/:id": "Delete project",
              },
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },

  // Queue consumer for background jobs
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const job = message.body as { type: string; data: unknown };

        switch (job.type) {
          case "send_invite_email":
            // Send invitation email
            console.log("Sending invite email:", job.data);
            break;
          case "track_usage":
            // Record usage metric
            console.log("Tracking usage:", job.data);
            break;
          case "sync_stripe":
            // Sync with Stripe
            console.log("Syncing Stripe:", job.data);
            break;
          default:
            console.log("Unknown job type:", job.type);
        }

        message.ack();
      } catch (error) {
        console.error("Job failed:", error);
        message.retry();
      }
    }
  },
};

async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) {
    return Response.json({ error: "No signature" }, { status: 400 });
  }

  try {
    const body = await request.text();

    // In production, verify the webhook signature with Stripe SDK
    // const event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);

    const event = JSON.parse(body) as { type: string; data: { object: unknown } };

    switch (event.type) {
      case "checkout.session.completed":
        console.log("Checkout completed:", event.data.object);
        break;
      case "customer.subscription.updated":
        console.log("Subscription updated:", event.data.object);
        break;
      case "customer.subscription.deleted":
        console.log("Subscription cancelled:", event.data.object);
        break;
      case "invoice.paid":
        console.log("Invoice paid:", event.data.object);
        break;
      case "invoice.payment_failed":
        console.log("Payment failed:", event.data.object);
        break;
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: "Webhook failed" }, { status: 400 });
  }
}
