/**
 * Type definitions for Webhook Relay
 */

export interface Env {
  DB: D1Database;
  WEBHOOK_QUEUE: Queue<WebhookMessage>;
  ADMIN_KEY: string;
}

export interface WebhookMessage {
  eventId: string;
  subscriptionId: string;
  attempt: number;
}

export interface WebhookEvent {
  id: string;
  source: string;
  event_type: string;
  payload: string;
  headers: string | null;
  received_at: string;
  status: "pending" | "processing" | "delivered" | "failed";
  delivery_attempts: number;
  last_attempt_at: string | null;
  error: string | null;
  delivered_at: string | null;
}

export interface Subscription {
  id: string;
  source: string;
  event_types: string;
  target_url: string;
  secret: string;
  headers: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttempt {
  id: string;
  event_id: string;
  subscription_id: string;
  attempt_number: number;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
  latency_ms: number | null;
  attempted_at: string;
}

export interface SourceSecret {
  source: string;
  secret: string;
}
