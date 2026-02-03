/**
 * Team management routes
 */

import type { Env } from "../index";
import type { TenantContext } from "../auth/middleware";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

export async function handleTeams(
  request: Request,
  env: Env,
  ctx: TenantContext
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // GET /teams/current
  if (pathname === "/teams/current" && request.method === "GET") {
    const tenant = await env.DB.prepare(
      "SELECT * FROM tenants WHERE id = ?"
    )
      .bind(ctx.tenantId)
      .first();

    return Response.json({ tenant }, { headers: corsHeaders });
  }

  // PUT /teams/current
  if (pathname === "/teams/current" && request.method === "PUT") {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return Response.json(
        { error: "Only owners and admins can update team settings" },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = (await request.json()) as { name?: string; settings?: unknown };

    await env.DB.prepare(
      `UPDATE tenants SET
        name = COALESCE(?, name),
        settings = COALESCE(?, settings),
        updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        body.name || null,
        body.settings ? JSON.stringify(body.settings) : null,
        ctx.tenantId
      )
      .run();

    return Response.json({ message: "Team updated" }, { headers: corsHeaders });
  }

  // GET /teams/members
  if (pathname === "/teams/members" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT tm.id, tm.role, tm.joined_at, u.id as user_id, u.email, u.name
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.tenant_id = ?
       ORDER BY tm.joined_at`
    )
      .bind(ctx.tenantId)
      .all();

    return Response.json({ members: results || [] }, { headers: corsHeaders });
  }

  // POST /teams/members (invite)
  if (pathname === "/teams/members" && request.method === "POST") {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return Response.json(
        { error: "Only owners and admins can invite members" },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = (await request.json()) as { email: string; role?: string };

    if (!body.email) {
      return Response.json(
        { error: "email is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const role = body.role || "member";
    if (!["admin", "member"].includes(role)) {
      return Response.json(
        { error: "Invalid role. Use 'admin' or 'member'" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Check plan limits
    const limit = await checkMemberLimit(env, ctx.tenantId, ctx.plan);
    if (!limit.allowed) {
      return Response.json(
        { error: `Member limit reached. ${limit.message}` },
        { status: 403, headers: corsHeaders }
      );
    }

    // Check if user exists
    const existingUser = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(body.email.toLowerCase())
      .first<{ id: string }>();

    if (existingUser) {
      // Check if already a member
      const existingMember = await env.DB.prepare(
        "SELECT id FROM team_members WHERE tenant_id = ? AND user_id = ?"
      )
        .bind(ctx.tenantId, existingUser.id)
        .first();

      if (existingMember) {
        return Response.json(
          { error: "User is already a team member" },
          { status: 409, headers: corsHeaders }
        );
      }

      // Add existing user to team
      const memberId = `tm_${crypto.randomUUID().slice(0, 8)}`;
      await env.DB.prepare(
        "INSERT INTO team_members (id, tenant_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(memberId, ctx.tenantId, existingUser.id, role, ctx.userId)
        .run();

      return Response.json(
        { message: "Member added", memberId },
        { status: 201, headers: corsHeaders }
      );
    }

    // Create invitation for new user
    const inviteId = `inv_${crypto.randomUUID().slice(0, 12)}`;
    const token = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO invitations (id, tenant_id, email, role, token, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'))`
    )
      .bind(inviteId, ctx.tenantId, body.email.toLowerCase(), role, token, ctx.userId)
      .run();

    // Queue email job
    await env.JOBS.send({
      type: "send_invite_email",
      data: { email: body.email, token, teamName: ctx.tenantName },
    });

    return Response.json(
      {
        message: "Invitation sent",
        inviteId,
        inviteUrl: `https://yourapp.com/invite/${token}`,
      },
      { status: 201, headers: corsHeaders }
    );
  }

  // DELETE /teams/members/:id
  if (pathname.match(/^\/teams\/members\/[\w_-]+$/) && request.method === "DELETE") {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return Response.json(
        { error: "Only owners and admins can remove members" },
        { status: 403, headers: corsHeaders }
      );
    }

    const memberId = pathname.split("/").pop()!;

    // Get member details
    const member = await env.DB.prepare(
      "SELECT user_id, role FROM team_members WHERE id = ? AND tenant_id = ?"
    )
      .bind(memberId, ctx.tenantId)
      .first<{ user_id: string; role: string }>();

    if (!member) {
      return Response.json(
        { error: "Member not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // Prevent removing owner
    if (member.role === "owner") {
      return Response.json(
        { error: "Cannot remove team owner" },
        { status: 403, headers: corsHeaders }
      );
    }

    // Prevent self-removal (use leave instead)
    if (member.user_id === ctx.userId) {
      return Response.json(
        { error: "Use /teams/leave to leave the team" },
        { status: 400, headers: corsHeaders }
      );
    }

    await env.DB.prepare(
      "DELETE FROM team_members WHERE id = ?"
    )
      .bind(memberId)
      .run();

    return Response.json({ message: "Member removed" }, { headers: corsHeaders });
  }

  return Response.json(
    { error: "Not Found" },
    { status: 404, headers: corsHeaders }
  );
}

async function checkMemberLimit(
  env: Env,
  tenantId: string,
  plan: string
): Promise<{ allowed: boolean; message?: string }> {
  const limits = await env.DB.prepare(
    "SELECT max_members FROM plan_limits WHERE plan = ?"
  )
    .bind(plan)
    .first<{ max_members: number }>();

  if (!limits || limits.max_members === -1) {
    return { allowed: true };
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM team_members WHERE tenant_id = ?"
  )
    .bind(tenantId)
    .first<{ count: number }>();

  if ((count?.count || 0) >= limits.max_members) {
    return {
      allowed: false,
      message: `Upgrade to add more than ${limits.max_members} members.`,
    };
  }

  return { allowed: true };
}
