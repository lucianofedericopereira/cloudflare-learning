/**
 * Rate limiting using KV
 */

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

const WINDOW_SIZE_MS = 60000; // 1 minute

export async function checkRateLimit(
  kv: KVNamespace,
  keyId: string,
  limit: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;
  const resetTime = windowStart + WINDOW_SIZE_MS;

  // Use two windows for sliding window approximation
  const currentWindow = `rate:${keyId}:${windowStart}`;
  const previousWindow = `rate:${keyId}:${windowStart - WINDOW_SIZE_MS}`;

  // Get counts from both windows
  const [currentCount, previousCount] = await Promise.all([
    kv.get(currentWindow).then((v) => parseInt(v || "0")),
    kv.get(previousWindow).then((v) => parseInt(v || "0")),
  ]);

  // Calculate weighted count (sliding window approximation)
  const elapsed = now - windowStart;
  const weight = 1 - elapsed / WINDOW_SIZE_MS;
  const weightedCount = currentCount + previousCount * weight;

  if (weightedCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime,
    };
  }

  // Increment current window
  await kv.put(currentWindow, String(currentCount + 1), {
    expirationTtl: 120, // 2 minutes
  });

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - weightedCount - 1)),
    resetTime,
  };
}

export function getRateLimitHeaders(
  limit: number,
  remaining: number,
  resetTime: number
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetTime / 1000)),
  };
}
