/**
 * Cache utilities for CDN optimization
 */

/**
 * Set appropriate cache headers for image responses
 */
export function setCacheHeaders(headers: Headers, isImmutable: boolean): void {
  if (isImmutable) {
    // Images are content-addressed, so they can be cached forever
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );
  } else {
    // Cache with revalidation
    headers.set(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=604800"
    );
  }

  // Add Vary header for content negotiation
  headers.set("Vary", "Accept");
}

/**
 * Handle conditional requests (If-None-Match, If-Modified-Since)
 */
export function handleConditionalRequest(
  request: Request,
  etag: string
): Response | null {
  const ifNoneMatch = request.headers.get("If-None-Match");

  if (ifNoneMatch) {
    // Remove weak validator prefix if present
    const clientEtag = ifNoneMatch.replace(/^W\//, "").replace(/"/g, "");
    const serverEtag = etag.replace(/^W\//, "").replace(/"/g, "");

    if (clientEtag === serverEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: `"${etag}"`,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return null;
}

/**
 * Determine best format based on Accept header
 */
export function getBestFormat(
  acceptHeader: string | null,
  originalFormat: string
): string {
  if (!acceptHeader) return originalFormat;

  // Prefer modern formats if supported
  if (acceptHeader.includes("image/avif")) {
    return "avif";
  }

  if (acceptHeader.includes("image/webp")) {
    return "webp";
  }

  // Fall back to original format
  return originalFormat;
}

/**
 * Generate cache key for transformed images
 */
export function generateCacheKey(
  originalKey: string,
  params: Record<string, string | number | undefined>
): string {
  const parts = [originalKey];

  // Sort params for consistent cache keys
  const sortedParams = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, value] of sortedParams) {
    parts.push(`${key}=${value}`);
  }

  return parts.join("_");
}
