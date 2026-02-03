/**
 * Billing routes
 */

import type { Env } from "../index";
import type { TenantContext } from "../auth/middleware";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

export async function handleBilling(
  request: Request,
  env: Env,
  ctx: TenantContext
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // GET /billing/subscription
  if (pathname === "/billing/subscription" && request.method === "GET") {
    const subscription = await env.DB.prepare(
      `SELECT s.*, pl.max_members, pl.max_projects, pl.max_storage_mb, pl.max_api_requests_daily
       FROM subscriptions s
       JOIN plan_limits pl ON pl.plan = s.plan
       WHERE s.tenant_id = ?`
    )
      .bind(ctx.tenantId)
      .first();

    return Response.json({ subscription }, { headers: corsHeaders });
  }

  // POST /billing/subscribe
  if (pathname === "/billing/subscribe" && request.method === "POST") {
    if (ctx.role !== "owner") {
      return Response.json(
        { error: "Only team owner can manage billing" },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = (await request.json()) as { plan: string };

    if (!["free", "pro", "enterprise"].includes(body.plan)) {
      return Response.json(
        { error: "Invalid plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    // In production, integrate with Stripe:
    // 1. Create Stripe Checkout session
    // 2. Redirect user to Stripe
    // 3. Handle webhook on completion

    // For demo, just update the plan
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE subscriptions SET plan = ?, updated_at = datetime('now') WHERE tenant_id = ?"
      ).bind(body.plan, ctx.tenantId),
      env.DB.prepare(
        "UPDATE tenants SET plan = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(body.plan, ctx.tenantId),
    ]);

    return Response.json(
      { message: "Plan updated", plan: body.plan },
      { headers: corsHeaders }
    );
  }

  // POST /billing/cancel
  if (pathname === "/billing/cancel" && request.method === "POST") {
    if (ctx.role !== "owner") {
      return Response.json(
        { error: "Only team owner can manage billing" },
        { status: 403, headers: corsHeaders }
      );
    }

    // In production: Cancel Stripe subscription

    await env.DB.prepare(
      "UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = datetime('now') WHERE tenant_id = ?"
    )
      .bind(ctx.tenantId)
      .run();

    return Response.json(
      { message: "Subscription will be cancelled at period end" },
      { headers: corsHeaders }
    );
  }

  // GET /billing/usage
  if (pathname === "/billing/usage" && request.method === "GET") {
    // Get current period usage
    const { results: usage } = await env.DB.prepare(
      `SELECT metric, SUM(value) as total
       FROM usage_records
       WHERE tenant_id = ?
         AND period_start >= date('now', 'start of month')
       GROUP BY metric`
    )
      .bind(ctx.tenantId)
      .all<{ metric: string; total: number }>();

    // Get limits
    const limits = await env.DB.prepare(
      "SELECT * FROM plan_limits WHERE plan = ?"
    )
      .bind(ctx.plan)
      .first();

    // Get counts
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM team_members WHERE tenant_id = ?) as members,
        (SELECT COUNT(*) FROM projects WHERE tenant_id = ?) as projects`
    )
      .bind(ctx.tenantId, ctx.tenantId)
      .first<{ members: number; projects: number }>();

    return Response.json(
      {
        usage: usage || [],
        counts,
        limits,
        period: {
          start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
          end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString(),
        },
      },
      { headers: corsHeaders }
    );
  }

  return Response.json(
    { error: "Not Found" },
    { status: 404, headers: corsHeaders }
  );
}
