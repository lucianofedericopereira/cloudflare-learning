-- API Gateway Database Schema

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,  -- First 8 chars for display (gw_abc123...)
  name TEXT NOT NULL,
  user_id TEXT,
  permissions TEXT DEFAULT '["read"]',  -- JSON array
  rate_limit INTEGER DEFAULT 100,  -- Requests per minute
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  total_requests INTEGER DEFAULT 0
);

-- Request logs table (for metrics)
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER,
  ip_hash TEXT,
  user_agent TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
);

-- Rate limit tracking (backup to KV)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,  -- api_key_id:minute_bucket
  count INTEGER DEFAULT 0,
  window_start DATETIME
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_request_logs_key ON request_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_path ON request_logs(path);

-- Sample API key for testing (key: gw_test_key_12345)
-- Hash of "gw_test_key_12345"
INSERT OR IGNORE INTO api_keys (id, key_hash, key_prefix, name, permissions, rate_limit)
VALUES (
  'key_demo',
  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
  'gw_test_',
  'Demo API Key',
  '["read", "write"]',
  100
);
