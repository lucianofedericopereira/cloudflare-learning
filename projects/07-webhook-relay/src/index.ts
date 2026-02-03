/**
 * 07 - Webhook Relay
 *
 * A webhook ingestion and delivery service with:
 * - Cloudflare Queues for async processing
 * - Signature verification
 * - Retry logic with exponential backoff
 * - Subscription management
 */

import { verifySignature } from "./signatures";
import { handleQueue } from "./queue";
import type { Env, WebhookEvent, Subscription, SourceSecret, WebhookMessage } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.ADMIN_KEY}`;
}

export default {
  // HTTP handler
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
      // Webhook Ingestion
      // ============================================

      // POST /webhooks/ingest/:source
      if (pathname.startsWith("/webhooks/ingest/") && request.method === "POST") {
        const source = pathname.split("/").pop()!;
        const payload = await request.text();

        // Get source secret for verification
        const sourceSecret = await env.DB.prepare(
          "SELECT * FROM source_secrets WHERE source = ?"
        )
          .bind(source)
          .first<SourceSecret>();

        // Verify signature if we have a secret
        if (sourceSecret) {
          const signatureHeader = getSignatureHeader(request, source);

          if (signatureHeader) {
            const valid = await verifySignature(
              payload,
              signatureHeader,
              sourceSecret.secret,
              source
            );

            if (!valid) {
              return Response.json(
                { error: "Invalid signature" },
                { status: 401, headers: corsHeaders }
              );
            }
          }
        }

        // Parse event type from payload
        let eventType = "unknown";
        try {
          const parsed = JSON.parse(payload);
          eventType = parsed.type || parsed.event || parsed.action || "unknown";
        } catch {
          // Keep "unknown" if not JSON
        }

        // Store event
        const eventId = `evt_${crypto.randomUUID().slice(0, 12)}`;

        await env.DB.prepare(
          `INSERT INTO events (id, source, event_type, payload, headers)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(
            eventId,
            source,
            eventType,
            payload,
            JSON.stringify(Object.fromEntries(request.headers))
          )
          .run();

        // Find matching subscriptions
        const { results: subscriptions } = await env.DB.prepare(
          `SELECT * FROM subscriptions WHERE source = ? AND enabled = 1`
        )
          .bind(source)
          .all<Subscription>();

        // Queue delivery for each matching subscription
        const matchingSubscriptions = (subscriptions || []).filter((sub) => {
          const eventTypes = JSON.parse(sub.event_types);
          return eventTypes === "*" ||
            eventTypes.includes("*") ||
            eventTypes.includes(eventType);
        });

        for (const sub of matchingSubscriptions) {
          await env.WEBHOOK_QUEUE.send({
            eventId,
            subscriptionId: sub.id,
            attempt: 1,
          } as WebhookMessage);
        }

        return Response.json(
          {
            received: true,
            eventId,
            source,
            eventType,
            subscriptionsMatched: matchingSubscriptions.length,
          },
          { status: 202, headers: corsHeaders }
        );
      }

      // ============================================
      // Subscription Management (Admin)
      // ============================================

      // GET /webhooks/subscriptions
      if (pathname === "/webhooks/subscriptions" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const { results } = await env.DB.prepare(
          "SELECT * FROM subscriptions ORDER BY created_at DESC"
        ).all<Subscription>();

        const subscriptions = (results || []).map((s) => ({
          ...s,
          event_types: JSON.parse(s.event_types),
          headers: s.headers ? JSON.parse(s.headers) : null,
          enabled: s.enabled === 1,
        }));

        return Response.json({ subscriptions }, { headers: corsHeaders });
      }

      // POST /webhooks/subscriptions
      if (pathname === "/webhooks/subscriptions" && request.method === "POST") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = (await request.json()) as {
          source: string;
          eventTypes?: string[];
          targetUrl: string;
          headers?: Record<string, string>;
        };

        if (!body.source || !body.targetUrl) {
          return Response.json(
            { error: "source and targetUrl are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const id = `sub_${crypto.randomUUID().slice(0, 12)}`;
        const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;

        await env.DB.prepare(
          `INSERT INTO subscriptions (id, source, event_types, target_url, secret, headers)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            body.source,
            JSON.stringify(body.eventTypes || ["*"]),
            body.targetUrl,
            secret,
            body.headers ? JSON.stringify(body.headers) : null
          )
          .run();

        return Response.json(
          {
            id,
            source: body.source,
            eventTypes: body.eventTypes || ["*"],
            targetUrl: body.targetUrl,
            secret, // Only returned on creation
          },
          { status: 201, headers: corsHeaders }
        );
      }

      // DELETE /webhooks/subscriptions/:id
      if (
        pathname.match(/^\/webhooks\/subscriptions\/[\w_-]+$/) &&
        request.method === "DELETE"
      ) {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const id = pathname.split("/").pop()!;

        await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?")
          .bind(id)
          .run();

        return Response.json({ message: "Deleted", id }, { headers: corsHeaders });
      }

      // ============================================
      // Event Management (Admin)
      // ============================================

      // GET /webhooks/events
      if (pathname === "/webhooks/events" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const status = url.searchParams.get("status");
        const source = url.searchParams.get("source");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

        let query = "SELECT * FROM events";
        const conditions: string[] = [];
        const params: string[] = [];

        if (status) {
          conditions.push("status = ?");
          params.push(status);
        }
        if (source) {
          conditions.push("source = ?");
          params.push(source);
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY received_at DESC LIMIT ?";
        params.push(String(limit));

        const stmt = env.DB.prepare(query);
        const { results } = await stmt.bind(...params).all<WebhookEvent>();

        return Response.json({ events: results || [] }, { headers: corsHeaders });
      }

      // GET /webhooks/events/:id
      if (pathname.match(/^\/webhooks\/events\/[\w_-]+$/) && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const id = pathname.split("/").pop()!;

        const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?")
          .bind(id)
          .first<WebhookEvent>();

        if (!event) {
          return Response.json(
            { error: "Event not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        const { results: attempts } = await env.DB.prepare(
          "SELECT * FROM delivery_attempts WHERE event_id = ? ORDER BY attempted_at"
        )
          .bind(id)
          .all();

        return Response.json(
          { event, deliveryAttempts: attempts || [] },
          { headers: corsHeaders }
        );
      }

      // POST /webhooks/events/:id/retry
      if (
        pathname.match(/^\/webhooks\/events\/[\w_-]+\/retry$/) &&
        request.method === "POST"
      ) {
        if (!isAdmin(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const id = pathname.split("/")[3];

        const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?")
          .bind(id)
          .first<WebhookEvent>();

        if (!event) {
          return Response.json(
            { error: "Event not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Reset status
        await env.DB.prepare(
          "UPDATE events SET status = 'pending', error = NULL WHERE id = ?"
        )
          .bind(id)
          .run();

        // Find subscriptions and re-queue
        const { results: subscriptions } = await env.DB.prepare(
          "SELECT * FROM subscriptions WHERE source = ? AND enabled = 1"
        )
          .bind(event.source)
          .all<Subscription>();

        for (const sub of subscriptions || []) {
          await env.WEBHOOK_QUEUE.send({
            eventId: id,
            subscriptionId: sub.id,
            attempt: 1,
          } as WebhookMessage);
        }

        return Response.json(
          { message: "Retry queued", eventId: id },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Home / Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Webhook Relay",
            version: "1.0.0",
            endpoints: {
              "POST /webhooks/ingest/:source": "Receive incoming webhook",
              "GET /webhooks/subscriptions": "List subscriptions (admin)",
              "POST /webhooks/subscriptions": "Create subscription (admin)",
              "DELETE /webhooks/subscriptions/:id": "Delete subscription (admin)",
              "GET /webhooks/events": "List events (admin)",
              "GET /webhooks/events/:id": "Get event details (admin)",
              "POST /webhooks/events/:id/retry": "Retry failed event (admin)",
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

  // Queue consumer
  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },
};

function getSignatureHeader(request: Request, source: string): string | null {
  switch (source) {
    case "stripe":
      return request.headers.get("Stripe-Signature");
    case "github":
      return request.headers.get("X-Hub-Signature-256");
    case "shopify":
      return request.headers.get("X-Shopify-Hmac-SHA256");
    default:
      return request.headers.get("X-Signature") ||
        request.headers.get("X-Webhook-Signature");
  }
}
