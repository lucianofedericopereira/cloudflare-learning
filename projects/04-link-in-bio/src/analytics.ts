/**
 * Analytics tracking and reporting
 */

interface TrackEventParams {
  userId: string;
  linkId?: string;
  eventType: "page_view" | "link_click";
  request: Request;
}

interface AnalyticsResult {
  totalPageViews: number;
  totalClicks: number;
  clicksByLink: Array<{
    linkId: string;
    title: string;
    clicks: number;
  }>;
  viewsByDay: Array<{
    date: string;
    views: number;
  }>;
  clicksByDay: Array<{
    date: string;
    clicks: number;
  }>;
  topCountries: Array<{
    country: string;
    count: number;
  }>;
}

export async function trackEvent(
  db: D1Database,
  params: TrackEventParams
): Promise<void> {
  const { userId, linkId, eventType, request } = params;

  // Hash IP for privacy
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashString(ip);

  // Get country from Cloudflare headers
  const country = (request.cf as { country?: string })?.country || "Unknown";

  const userAgent = request.headers.get("User-Agent") || "";
  const referer = request.headers.get("Referer") || "";

  const id = `evt_${crypto.randomUUID().slice(0, 12)}`;

  await db
    .prepare(
      `INSERT INTO events (id, user_id, link_id, event_type, ip_hash, country, user_agent, referer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, userId, linkId || null, eventType, ipHash, country, userAgent, referer)
    .run();
}

export async function getAnalytics(
  db: D1Database,
  userId: string
): Promise<AnalyticsResult> {
  // Total page views
  const pageViewsResult = await db
    .prepare(
      "SELECT COUNT(*) as count FROM events WHERE user_id = ? AND event_type = 'page_view'"
    )
    .bind(userId)
    .first<{ count: number }>();

  // Total clicks
  const clicksResult = await db
    .prepare(
      "SELECT COUNT(*) as count FROM events WHERE user_id = ? AND event_type = 'link_click'"
    )
    .bind(userId)
    .first<{ count: number }>();

  // Clicks by link
  const { results: clicksByLink } = await db
    .prepare(
      `SELECT l.id as linkId, l.title, COUNT(e.id) as clicks
       FROM links l
       LEFT JOIN events e ON e.link_id = l.id AND e.event_type = 'link_click'
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY clicks DESC`
    )
    .bind(userId)
    .all<{ linkId: string; title: string; clicks: number }>();

  // Views by day (last 30 days)
  const { results: viewsByDay } = await db
    .prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as views
       FROM events
       WHERE user_id = ? AND event_type = 'page_view'
         AND created_at >= DATE('now', '-30 days')
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    )
    .bind(userId)
    .all<{ date: string; views: number }>();

  // Clicks by day (last 30 days)
  const { results: clicksByDay } = await db
    .prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as clicks
       FROM events
       WHERE user_id = ? AND event_type = 'link_click'
         AND created_at >= DATE('now', '-30 days')
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    )
    .bind(userId)
    .all<{ date: string; clicks: number }>();

  // Top countries
  const { results: topCountries } = await db
    .prepare(
      `SELECT country, COUNT(*) as count
       FROM events
       WHERE user_id = ?
       GROUP BY country
       ORDER BY count DESC
       LIMIT 10`
    )
    .bind(userId)
    .all<{ country: string; count: number }>();

  return {
    totalPageViews: pageViewsResult?.count || 0,
    totalClicks: clicksResult?.count || 0,
    clicksByLink: clicksByLink || [],
    viewsByDay: viewsByDay || [],
    clicksByDay: clicksByDay || [],
    topCountries: topCountries || [],
  };
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
