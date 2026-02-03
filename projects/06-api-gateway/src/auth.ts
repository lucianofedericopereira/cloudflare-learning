/**
 * API key authentication
 */

interface ApiKeyInfo {
  id: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  enabled: boolean;
}

interface ApiKeyRecord {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  user_id: string | null;
  permissions: string;
  rate_limit: number;
  enabled: number;
  created_at: string;
  last_used_at: string | null;
  total_requests: number;
}

export async function validateApiKey(
  db: D1Database,
  apiKey: string
): Promise<ApiKeyInfo | null> {
  // Hash the provided key
  const keyHash = await hashKey(apiKey);

  // Look up in database
  const record = await db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first<ApiKeyRecord>();

  if (!record) {
    return null;
  }

  // Update last used timestamp (fire-and-forget in caller)
  await db
    .prepare(
      "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, total_requests = total_requests + 1 WHERE id = ?"
    )
    .bind(record.id)
    .run();

  return {
    id: record.id,
    name: record.name,
    permissions: JSON.parse(record.permissions),
    rateLimit: record.rate_limit,
    enabled: record.enabled === 1,
  };
}

export async function createApiKey(
  db: D1Database,
  options: {
    name: string;
    rateLimit: number;
    permissions: string[];
    userId?: string;
  }
): Promise<{ id: string; key: string; name: string }> {
  // Generate a new API key
  const key = `gw_${crypto.randomUUID().replace(/-/g, "")}`;
  const keyHash = await hashKey(key);
  const keyPrefix = key.slice(0, 8);
  const id = `key_${crypto.randomUUID().slice(0, 8)}`;

  await db
    .prepare(
      `INSERT INTO api_keys (id, key_hash, key_prefix, name, user_id, permissions, rate_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      keyHash,
      keyPrefix,
      options.name,
      options.userId || null,
      JSON.stringify(options.permissions),
      options.rateLimit
    )
    .run();

  return {
    id,
    key, // Only returned on creation
    name: options.name,
  };
}

export async function listApiKeys(
  db: D1Database
): Promise<
  Array<{
    id: string;
    keyPrefix: string;
    name: string;
    rateLimit: number;
    enabled: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    totalRequests: number;
  }>
> {
  const { results } = await db
    .prepare(
      "SELECT id, key_prefix, name, rate_limit, enabled, created_at, last_used_at, total_requests FROM api_keys ORDER BY created_at DESC"
    )
    .all<ApiKeyRecord>();

  return (results || []).map((r) => ({
    id: r.id,
    keyPrefix: r.key_prefix,
    name: r.name,
    rateLimit: r.rate_limit,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    totalRequests: r.total_requests,
  }));
}

export async function revokeApiKey(db: D1Database, keyId: string): Promise<void> {
  await db
    .prepare("UPDATE api_keys SET enabled = 0 WHERE id = ?")
    .bind(keyId)
    .run();
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
