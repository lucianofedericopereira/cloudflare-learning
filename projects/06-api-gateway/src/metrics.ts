/**
 * Metrics collection and reporting
 */

interface RequestLog {
  id: string;
  apiKeyId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ipHash: string;
  userAgent: string;
  error?: string;
}

export async function logRequest(db: D1Database, log: RequestLog): Promise<void> {
  await db
    .prepare(
      `INSERT INTO request_logs (id, api_key_id, method, path, status_code, latency_ms, ip_hash, user_agent, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      log.id,
      log.apiKeyId,
      log.method,
      log.path,
      log.statusCode,
      log.latencyMs,
      log.ipHash,
      log.userAgent,
      log.error || null
    )
    .run();
}

interface Metrics {
  totalRequests: number;
  requestsLast24h: number;
  requestsLastHour: number;
  averageLatency: number;
  errorRate: number;
  topPaths: Array<{ path: string; count: number }>;
  requestsByStatus: Array<{ status: number; count: number }>;
  requestsByKey: Array<{ keyId: string; keyName: string; count: number }>;
  requestsByHour: Array<{ hour: string; count: number }>;
}

export async function getMetrics(db: D1Database): Promise<Metrics> {
  // Total requests
  const totalResult = await db
    .prepare("SELECT COUNT(*) as count FROM request_logs")
    .first<{ count: number }>();

  // Requests last 24h
  const last24hResult = await db
    .prepare(
      "SELECT COUNT(*) as count FROM request_logs WHERE created_at >= datetime('now', '-24 hours')"
    )
    .first<{ count: number }>();

  // Requests last hour
  const lastHourResult = await db
    .prepare(
      "SELECT COUNT(*) as count FROM request_logs WHERE created_at >= datetime('now', '-1 hour')"
    )
    .first<{ count: number }>();

  // Average latency
  const latencyResult = await db
    .prepare("SELECT AVG(latency_ms) as avg FROM request_logs")
    .first<{ avg: number }>();

  // Error rate (5xx responses)
  const errorResult = await db
    .prepare(
      "SELECT COUNT(*) as count FROM request_logs WHERE status_code >= 500"
    )
    .first<{ count: number }>();

  // Top paths
  const { results: topPaths } = await db
    .prepare(
      `SELECT path, COUNT(*) as count FROM request_logs
       GROUP BY path ORDER BY count DESC LIMIT 10`
    )
    .all<{ path: string; count: number }>();

  // Requests by status
  const { results: requestsByStatus } = await db
    .prepare(
      `SELECT status_code as status, COUNT(*) as count FROM request_logs
       GROUP BY status_code ORDER BY count DESC`
    )
    .all<{ status: number; count: number }>();

  // Requests by API key
  const { results: requestsByKey } = await db
    .prepare(
      `SELECT r.api_key_id as keyId, k.name as keyName, COUNT(*) as count
       FROM request_logs r
       LEFT JOIN api_keys k ON k.id = r.api_key_id
       GROUP BY r.api_key_id
       ORDER BY count DESC
       LIMIT 10`
    )
    .all<{ keyId: string; keyName: string; count: number }>();

  // Requests by hour (last 24 hours)
  const { results: requestsByHour } = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) as hour, COUNT(*) as count
       FROM request_logs
       WHERE created_at >= datetime('now', '-24 hours')
       GROUP BY hour
       ORDER BY hour`
    )
    .all<{ hour: string; count: number }>();

  const total = totalResult?.count || 0;
  const errors = errorResult?.count || 0;

  return {
    totalRequests: total,
    requestsLast24h: last24hResult?.count || 0,
    requestsLastHour: lastHourResult?.count || 0,
    averageLatency: Math.round(latencyResult?.avg || 0),
    errorRate: total > 0 ? (errors / total) * 100 : 0,
    topPaths: topPaths || [],
    requestsByStatus: requestsByStatus || [],
    requestsByKey: requestsByKey || [],
    requestsByHour: requestsByHour || [],
  };
}
