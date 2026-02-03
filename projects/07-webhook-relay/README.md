# 07 - Webhook Relay

A webhook ingestion and delivery service using Cloudflare Workers and Queues.

## Learning Objectives

- Cloudflare Queues for async processing
- Webhook signature verification
- Retry logic with exponential backoff
- Dead letter queues

## Concepts

### Cloudflare Queues

Queues enable asynchronous message processing:

```typescript
// Producer: Send message to queue
await env.WEBHOOK_QUEUE.send({
  webhookId: "wh_123",
  payload: { event: "user.created", data: {} },
  timestamp: Date.now(),
});

// Send batch of messages
await env.WEBHOOK_QUEUE.sendBatch([
  { body: { id: 1 } },
  { body: { id: 2 } },
]);

// Consumer: Process messages
export default {
  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processWebhook(message.body);
        message.ack(); // Mark as processed
      } catch (error) {
        message.retry(); // Retry later
      }
    }
  },
};
```

### Queue Configuration

```toml
# wrangler.toml
[[queues.producers]]
queue = "webhooks"
binding = "WEBHOOK_QUEUE"

[[queues.consumers]]
queue = "webhooks"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "webhooks-dlq"
```

### Webhook Signature Verification

```typescript
// HMAC signature verification
async function verifySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signatureBytes = hexToBytes(signature);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(payload)
  );
}

// Create signature for outgoing webhooks
async function createSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
}
```

### Retry with Exponential Backoff

```typescript
function calculateBackoff(attempt: number): number {
  // Base delay of 1 second, doubles each attempt, max 5 minutes
  const baseDelay = 1000;
  const maxDelay = 300000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return delay + jitter;
}
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhooks/ingest/:source` | Receive incoming webhook |
| GET | `/webhooks/subscriptions` | List subscriptions |
| POST | `/webhooks/subscriptions` | Create subscription |
| DELETE | `/webhooks/subscriptions/:id` | Delete subscription |
| GET | `/webhooks/events` | List recent events |
| GET | `/webhooks/events/:id` | Get event details |
| POST | `/webhooks/events/:id/retry` | Retry failed delivery |

### Webhook Event Schema

```typescript
interface WebhookEvent {
  id: string;
  source: string;           // e.g., "stripe", "github"
  eventType: string;        // e.g., "payment.completed"
  payload: unknown;
  receivedAt: string;
  status: "pending" | "delivered" | "failed";
  deliveryAttempts: number;
  lastAttemptAt?: string;
  error?: string;
}

interface Subscription {
  id: string;
  source: string;
  eventTypes: string[];     // Filter by event type
  targetUrl: string;
  secret: string;           // For signing outgoing webhooks
  enabled: boolean;
  created: string;
}
```

## Project Tasks

### Task 1: Webhook Ingestion
- Accept incoming webhooks
- Verify signatures (per source)
- Store events in D1

### Task 2: Queue Processing
- Set up Cloudflare Queue
- Process webhooks asynchronously
- Implement retry logic

### Task 3: Subscription Management
- CRUD for subscriptions
- Filter by event types
- Sign outgoing webhooks

### Task 4: Monitoring
- Track delivery status
- Dead letter queue handling
- Manual retry endpoint

## Commands

```bash
# Create queue
npx wrangler queues create webhooks
npx wrangler queues create webhooks-dlq

# Create D1 database
npx wrangler d1 create webhook-relay
npx wrangler d1 execute webhook-relay --file=schema.sql

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
07-webhook-relay/
├── src/
│   ├── index.ts           # HTTP handlers
│   ├── queue.ts           # Queue consumer
│   ├── signatures.ts      # Signature handling
│   ├── delivery.ts        # Webhook delivery
│   └── types.ts           # Type definitions
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Receive webhook
curl -X POST http://localhost:8787/webhooks/ingest/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=...,v1=..." \
  -d '{"type": "payment_intent.succeeded", "data": {}}'

# Create subscription
curl -X POST http://localhost:8787/webhooks/subscriptions \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "stripe",
    "eventTypes": ["payment_intent.succeeded"],
    "targetUrl": "https://myapp.com/webhook"
  }'

# List events
curl http://localhost:8787/webhooks/events \
  -H "Authorization: Bearer admin-key"

# Retry event
curl -X POST http://localhost:8787/webhooks/events/evt_123/retry \
  -H "Authorization: Bearer admin-key"
```

## Supported Webhook Sources

| Source | Signature Header | Algorithm |
|--------|-----------------|-----------|
| Stripe | `Stripe-Signature` | HMAC-SHA256 |
| GitHub | `X-Hub-Signature-256` | HMAC-SHA256 |
| Shopify | `X-Shopify-Hmac-SHA256` | HMAC-SHA256 |
| Custom | `X-Signature` | HMAC-SHA256 |

## Key Takeaways

1. Queues decouple ingestion from processing for reliability
2. Always verify webhook signatures before processing
3. Implement exponential backoff for retries
4. Dead letter queues catch permanently failing messages
5. Store events for debugging and manual retry
