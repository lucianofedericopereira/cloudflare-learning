/**
 * Queue consumer for webhook delivery
 */

import { deliverWebhook, calculateBackoff } from "./delivery";
import type { Env, WebhookMessage, WebhookEvent, Subscription } from "./types";

export async function handleQueue(
  batch: MessageBatch<WebhookMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { eventId, subscriptionId, attempt } = message.body;

      // Get event
      const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?")
        .bind(eventId)
        .first<WebhookEvent>();

      if (!event) {
        console.error(`Event not found: ${eventId}`);
        message.ack();
        continue;
      }

      // Get subscription
      const subscription = await env.DB.prepare(
        "SELECT * FROM subscriptions WHERE id = ? AND enabled = 1"
      )
        .bind(subscriptionId)
        .first<Subscription>();

      if (!subscription) {
        console.error(`Subscription not found or disabled: ${subscriptionId}`);
        message.ack();
        continue;
      }

      // Update event status to processing
      await env.DB.prepare("UPDATE events SET status = 'processing' WHERE id = ?")
        .bind(eventId)
        .run();

      // Attempt delivery
      const result = await deliverWebhook(env, event, subscription, attempt);

      if (result.success) {
        message.ack();
      } else if (attempt < 3) {
        // Schedule retry with backoff
        const delay = calculateBackoff(attempt);
        console.log(
          `Retrying ${eventId} in ${delay}ms (attempt ${attempt + 1})`
        );

        // For now, use message.retry() which uses default queue retry behavior
        // In production, you might want to implement custom delay logic
        message.retry({
          delaySeconds: Math.ceil(delay / 1000),
        });
      } else {
        // Max retries exceeded, ack and mark as failed
        console.error(`Max retries exceeded for ${eventId}`);
        message.ack();
      }
    } catch (error) {
      console.error("Queue processing error:", error);
      message.retry();
    }
  }
}
