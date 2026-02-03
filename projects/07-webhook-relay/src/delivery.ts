/**
 * Webhook delivery logic
 */

import { createTimestampedSignature } from "./signatures";
import type { Env, Subscription, WebhookEvent } from "./types";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

export async function deliverWebhook(
  env: Env,
  event: WebhookEvent,
  subscription: Subscription,
  attempt: number
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const startTime = Date.now();
  const attemptId = `att_${crypto.randomUUID().slice(0, 12)}`;

  try {
    const payload = event.payload;

    // Create signature
    const signature = await createTimestampedSignature(
      payload,
      subscription.secret
    );

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature,
      "X-Webhook-Event-ID": event.id,
      "X-Webhook-Event-Type": event.event_type,
      "X-Webhook-Source": event.source,
      "X-Webhook-Attempt": String(attempt),
    };

    // Add custom headers from subscription
    if (subscription.headers) {
      const customHeaders = JSON.parse(subscription.headers);
      Object.assign(headers, customHeaders);
    }

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(subscription.target_url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    const responseBody = await response.text().catch(() => "");

    // Log attempt
    await logDeliveryAttempt(env.DB, {
      id: attemptId,
      eventId: event.id,
      subscriptionId: subscription.id,
      attemptNumber: attempt,
      statusCode: response.status,
      responseBody: responseBody.slice(0, 1000),
      error: null,
      latencyMs,
    });

    // Consider 2xx as success
    if (response.ok) {
      await updateEventStatus(env.DB, event.id, "delivered");
      return { success: true, statusCode: response.status };
    }

    // Non-2xx response
    const error = `HTTP ${response.status}: ${responseBody.slice(0, 200)}`;

    if (attempt >= MAX_RETRIES) {
      await updateEventStatus(env.DB, event.id, "failed", error);
    }

    return { success: false, statusCode: response.status, error };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Log failed attempt
    await logDeliveryAttempt(env.DB, {
      id: attemptId,
      eventId: event.id,
      subscriptionId: subscription.id,
      attemptNumber: attempt,
      statusCode: null,
      responseBody: null,
      error: errorMessage,
      latencyMs,
    });

    if (attempt >= MAX_RETRIES) {
      await updateEventStatus(env.DB, event.id, "failed", errorMessage);
    }

    return { success: false, error: errorMessage };
  }
}

async function logDeliveryAttempt(
  db: D1Database,
  attempt: {
    id: string;
    eventId: string;
    subscriptionId: string;
    attemptNumber: number;
    statusCode: number | null;
    responseBody: string | null;
    error: string | null;
    latencyMs: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO delivery_attempts
       (id, event_id, subscription_id, attempt_number, status_code, response_body, error, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      attempt.id,
      attempt.eventId,
      attempt.subscriptionId,
      attempt.attemptNumber,
      attempt.statusCode,
      attempt.responseBody,
      attempt.error,
      attempt.latencyMs
    )
    .run();

  // Update event
  await db
    .prepare(
      `UPDATE events SET
       delivery_attempts = ?,
       last_attempt_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(attempt.attemptNumber, attempt.eventId)
    .run();
}

async function updateEventStatus(
  db: D1Database,
  eventId: string,
  status: string,
  error?: string
): Promise<void> {
  if (status === "delivered") {
    await db
      .prepare(
        `UPDATE events SET status = ?, delivered_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .bind(status, eventId)
      .run();
  } else {
    await db
      .prepare(`UPDATE events SET status = ?, error = ? WHERE id = ?`)
      .bind(status, error || null, eventId)
      .run();
  }
}

// Calculate backoff delay
export function calculateBackoff(attempt: number): number {
  const baseDelay = 1000; // 1 second
  const maxDelay = 300000; // 5 minutes
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Add jitter
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return Math.floor(delay + jitter);
}
