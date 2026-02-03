/**
 * 05 - Image CDN
 *
 * An image hosting and transformation service with:
 * - R2 storage for images
 * - On-the-fly transformations
 * - CDN-optimized caching
 * - Presigned upload URLs
 */

import { handleUpload, generateUploadUrl } from "./upload";
import { transformImage, parseTransformParams } from "./transform";
import { setCacheHeaders, handleConditionalRequest } from "./cache";

export interface Env {
  IMAGES: R2Bucket;
  AUTH_TOKEN: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  ACCOUNT_ID?: string;
}

interface ImageMetadata {
  originalName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function isAuthenticated(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.AUTH_TOKEN}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // POST /upload - Upload image
      // ============================================

      if (pathname === "/upload" && request.method === "POST") {
        return handleUpload(request, env);
      }

      // ============================================
      // GET /upload-url - Get presigned URL
      // ============================================

      if (pathname === "/upload-url" && request.method === "GET") {
        const filename = url.searchParams.get("filename");
        if (!filename) {
          return Response.json(
            { error: "filename query parameter required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const uploadUrl = await generateUploadUrl(env, filename);
        return Response.json(uploadUrl, { headers: corsHeaders });
      }

      // ============================================
      // GET /images/:key - Get image
      // ============================================

      if (pathname.startsWith("/images/") && request.method === "GET") {
        const key = pathname.slice(8); // Remove "/images/"

        if (!key) {
          return Response.json(
            { error: "Image key required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Parse transformation parameters
        const params = parseTransformParams(url.searchParams);

        // Build the storage key
        let storageKey = `original/${key}`;

        // Check if we have a cached transformed version
        if (params.hasTransforms) {
          const transformedKey = `transformed/${key}_${params.cacheKey}`;
          const cached = await env.IMAGES.get(transformedKey);

          if (cached) {
            const headers = new Headers();
            cached.writeHttpMetadata(headers);
            setCacheHeaders(headers, true);
            headers.set("X-Cache", "HIT");

            // Handle conditional request
            const conditionalResponse = handleConditionalRequest(
              request,
              cached.httpEtag
            );
            if (conditionalResponse) return conditionalResponse;

            return new Response(cached.body, { headers });
          }
        }

        // Get original image
        const object = await env.IMAGES.get(storageKey);

        if (!object) {
          return Response.json(
            { error: "Image not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Handle conditional request for original
        const conditionalResponse = handleConditionalRequest(
          request,
          object.httpEtag
        );
        if (conditionalResponse) return conditionalResponse;

        let responseBody: ReadableStream | ArrayBuffer = object.body;
        let contentType = object.httpMetadata?.contentType || "image/jpeg";

        // Apply transformations if requested
        if (params.hasTransforms) {
          const transformed = await transformImage(
            await object.arrayBuffer(),
            contentType,
            params
          );

          responseBody = transformed.data;
          contentType = transformed.contentType;

          // Cache transformed version (fire-and-forget)
          const transformedKey = `transformed/${key}_${params.cacheKey}`;
          ctx.waitUntil(
            env.IMAGES.put(transformedKey, transformed.data, {
              httpMetadata: { contentType },
            })
          );
        }

        const headers = new Headers();
        headers.set("Content-Type", contentType);
        headers.set("ETag", `"${object.httpEtag}"`);
        setCacheHeaders(headers, true);
        headers.set("X-Cache", "MISS");

        return new Response(responseBody, { headers });
      }

      // ============================================
      // DELETE /images/:key - Delete image
      // ============================================

      if (pathname.startsWith("/images/") && request.method === "DELETE") {
        if (!isAuthenticated(request, env)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const key = pathname.slice(8);

        // Delete original
        await env.IMAGES.delete(`original/${key}`);

        // Delete any transformed versions
        const transformed = await env.IMAGES.list({
          prefix: `transformed/${key}_`,
        });

        for (const obj of transformed.objects) {
          await env.IMAGES.delete(obj.key);
        }

        return Response.json(
          { message: "Image deleted", key },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // GET /images - List images
      // ============================================

      if (pathname === "/images" && request.method === "GET") {
        const cursor = url.searchParams.get("cursor") || undefined;
        const limit = Math.min(
          parseInt(url.searchParams.get("limit") || "50"),
          100
        );

        const listed = await env.IMAGES.list({
          prefix: "original/",
          cursor,
          limit,
        });

        const images = listed.objects.map((obj) => ({
          key: obj.key.replace("original/", ""),
          size: obj.size,
          uploaded: obj.uploaded.toISOString(),
          etag: obj.etag,
        }));

        return Response.json(
          {
            images,
            cursor: listed.truncated ? listed.cursor : null,
            hasMore: listed.truncated,
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Home / API Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "Image CDN",
            version: "1.0.0",
            endpoints: {
              "POST /upload": {
                description: "Upload image (multipart/form-data)",
                field: "file",
              },
              "GET /upload-url": {
                description: "Get presigned upload URL",
                query: { filename: "required" },
              },
              "GET /images/:key": {
                description: "Get image with optional transforms",
                query: {
                  w: "width",
                  h: "height",
                  fit: "cover|contain|fill|scale-down",
                  q: "quality (1-100)",
                  f: "format (webp|avif|jpeg|png)",
                },
              },
              "DELETE /images/:key": {
                description: "Delete image (auth required)",
              },
              "GET /images": {
                description: "List images",
                query: { cursor: "optional", limit: "optional (max 100)" },
              },
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
