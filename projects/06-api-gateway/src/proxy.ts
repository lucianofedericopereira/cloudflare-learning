/**
 * Request proxying to upstream service
 */

interface ProxyOptions {
  requestId: string;
  clientIP: string;
  apiKeyId: string;
}

export async function proxyRequest(
  request: Request,
  upstreamUrl: string,
  options: ProxyOptions
): Promise<Response> {
  const url = new URL(request.url);

  // Build upstream URL
  const upstream = new URL(upstreamUrl);
  upstream.pathname = url.pathname.replace(/^\/api/, "") || "/";
  upstream.search = url.search;

  // Create new headers
  const headers = new Headers(request.headers);

  // Add forwarding headers
  headers.set("X-Forwarded-For", options.clientIP);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("X-Request-ID", options.requestId);
  headers.set("X-API-Key-ID", options.apiKeyId);

  // Remove headers that shouldn't be forwarded
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");
  headers.delete("CF-IPCountry");
  headers.delete("CF-RAY");

  // Create proxied request
  const proxyRequest = new Request(upstream.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual", // Don't follow redirects automatically
  });

  try {
    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(proxyRequest, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json(
        { error: "Upstream timeout" },
        { status: 504 }
      );
    }

    console.error("Proxy error:", error);
    return Response.json(
      { error: "Upstream error", message: "Failed to reach upstream service" },
      { status: 502 }
    );
  }
}
