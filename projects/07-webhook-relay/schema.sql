-- Webhook Relay Database Schema

-- Webhook events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  headers TEXT,           -- JSON of relevant headers
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending',  -- pending, processing, delivered, failed
  delivery_attempts INTEGER DEFAULT 0,
  last_attempt_at DATETIME,
  error TEXT,
  delivered_at DATETIME
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_types TEXT NOT NULL,  -- JSON array or "*" for all
  target_url TEXT NOT NULL,
  secret TEXT NOT NULL,       -- For signing outgoing webhooks
  headers TEXT,               -- JSON of custom headers to include
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Delivery attempts log
CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  error TEXT,
  latency_ms INTEGER,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Source secrets (for verifying incoming webhooks)
CREATE TABLE IF NOT EXISTS source_secrets (
  source TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_source ON subscriptions(source);
CREATE INDEX IF NOT EXISTS idx_delivery_event ON delivery_attempts(event_id);

-- Sample data
INSERT OR IGNORE INTO source_secrets (source, secret)
VALUES
  ('stripe', 'whsec_test_stripe_secret'),
  ('github', 'gh_webhook_secret_123'),
  ('custom', 'custom_webhook_secret');

INSERT OR IGNORE INTO subscriptions (id, source, event_types, target_url, secret)
VALUES (
  'sub_demo',
  'stripe',
  '["payment_intent.succeeded", "customer.created"]',
  'https://httpbin.org/post',
  'outgoing_webhook_secret'
);
