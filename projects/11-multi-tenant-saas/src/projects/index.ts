/**
 * Project routes (example multi-tenant resource)
 */

import type { Env } from "../index";
import type { TenantContext } from "../auth/middleware";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

interface Project {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  settings: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function handleProjects(
  request: Request,
  env: Env,
  ctx: TenantContext
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // GET /projects
  if (pathname === "/projects" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

    let query = "SELECT * FROM projects WHERE tenant_id = ?";
    const params: (string | number)[] = [ctx.tenantId];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const { results } = await env.DB.prepare(query)
      .bind(...params)
      .all<Project>();

    return Response.json(
      { projects: results || [] },
      { headers: corsHeaders }
    );
  }

  // POST /projects
  if (pathname === "/projects" && request.method === "POST") {
    // Check limit
    const limit = await checkProjectLimit(env, ctx.tenantId, ctx.plan);
    if (!limit.allowed) {
      return Response.json(
        { error: limit.message },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = (await request.json()) as {
      name: string;
      description?: string;
      settings?: unknown;
    };

    if (!body.name) {
      return Response.json(
        { error: "name is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const projectId = `proj_${crypto.randomUUID().slice(0, 12)}`;

    await env.DB.prepare(
      `INSERT INTO projects (id, tenant_id, name, description, settings, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        projectId,
        ctx.tenantId,
        body.name,
        body.description || null,
        body.settings ? JSON.stringify(body.settings) : null,
        ctx.userId
      )
      .run();

    const project = await env.DB.prepare(
      "SELECT * FROM projects WHERE id = ?"
    )
      .bind(projectId)
      .first<Project>();

    // Track usage
    await env.JOBS.send({
      type: "track_usage",
      data: { tenantId: ctx.tenantId, metric: "projects_created", value: 1 },
    });

    return Response.json(project, { status: 201, headers: corsHeaders });
  }

  // GET /projects/:id
  if (pathname.match(/^\/projects\/[\w_-]+$/) && request.method === "GET") {
    const projectId = pathname.split("/").pop()!;

    const project = await env.DB.prepare(
      "SELECT * FROM projects WHERE id = ? AND tenant_id = ?"
    )
      .bind(projectId, ctx.tenantId)
      .first<Project>();

    if (!project) {
      return Response.json(
        { error: "Project not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    return Response.json(project, { headers: corsHeaders });
  }

  // PUT /projects/:id
  if (pathname.match(/^\/projects\/[\w_-]+$/) && request.method === "PUT") {
    const projectId = pathname.split("/").pop()!;

    const body = (await request.json()) as {
      name?: string;
      description?: string;
      status?: string;
      settings?: unknown;
    };

    // Check exists and belongs to tenant
    const existing = await env.DB.prepare(
      "SELECT id FROM projects WHERE id = ? AND tenant_id = ?"
    )
      .bind(projectId, ctx.tenantId)
      .first();

    if (!existing) {
      return Response.json(
        { error: "Project not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    await env.DB.prepare(
      `UPDATE projects SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        settings = COALESCE(?, settings),
        updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        body.name || null,
        body.description || null,
        body.status || null,
        body.settings ? JSON.stringify(body.settings) : null,
        projectId
      )
      .run();

    const project = await env.DB.prepare(
      "SELECT * FROM projects WHERE id = ?"
    )
      .bind(projectId)
      .first<Project>();

    return Response.json(project, { headers: corsHeaders });
  }

  // DELETE /projects/:id
  if (pathname.match(/^\/projects\/[\w_-]+$/) && request.method === "DELETE") {
    const projectId = pathname.split("/").pop()!;

    // Check exists and belongs to tenant
    const existing = await env.DB.prepare(
      "SELECT id FROM projects WHERE id = ? AND tenant_id = ?"
    )
      .bind(projectId, ctx.tenantId)
      .first();

    if (!existing) {
      return Response.json(
        { error: "Project not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    await env.DB.prepare("DELETE FROM projects WHERE id = ?")
      .bind(projectId)
      .run();

    return Response.json(
      { message: "Project deleted", id: projectId },
      { headers: corsHeaders }
    );
  }

  return Response.json(
    { error: "Not Found" },
    { status: 404, headers: corsHeaders }
  );
}

async function checkProjectLimit(
  env: Env,
  tenantId: string,
  plan: string
): Promise<{ allowed: boolean; message?: string }> {
  const limits = await env.DB.prepare(
    "SELECT max_projects FROM plan_limits WHERE plan = ?"
  )
    .bind(plan)
    .first<{ max_projects: number }>();

  if (!limits || limits.max_projects === -1) {
    return { allowed: true };
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM projects WHERE tenant_id = ?"
  )
    .bind(tenantId)
    .first<{ count: number }>();

  if ((count?.count || 0) >= limits.max_projects) {
    return {
      allowed: false,
      message: `Project limit reached (${limits.max_projects}). Upgrade your plan for more projects.`,
    };
  }

  return { allowed: true };
}
