/**
 * Image upload handling
 */

import type { Env } from "./index";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
];

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

interface UploadResult {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

export async function handleUpload(
  request: Request,
  env: Env
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return Response.json(
        { error: "Content-Type must be multipart/form-data" },
        { status: 400, headers: corsHeaders }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json(
        { error: "No file provided. Use 'file' field." },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return Response.json(
        {
          error: `Invalid file type: ${file.type}`,
          allowedTypes: ALLOWED_TYPES,
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      return Response.json(
        {
          error: `File too large. Max size is ${MAX_SIZE / 1024 / 1024}MB`,
          size: file.size,
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Generate unique key
    const ext = getExtension(file.type);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const key = `${id}.${ext}`;

    // Upload to R2
    await env.IMAGES.put(`original/${key}`, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    });

    const result: UploadResult = {
      key,
      url: `/images/${key}`,
      size: file.size,
      contentType: file.type,
    };

    return Response.json(result, { status: 201, headers: corsHeaders });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: "Upload failed", message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function generateUploadUrl(
  env: Env,
  filename: string
): Promise<{ uploadUrl: string; key: string; expiresAt: string }> {
  // For presigned URLs, you would typically use the S3 SDK
  // This is a simplified version that returns a direct upload endpoint

  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `${id}.${ext}`;

  // In a real implementation, you would generate a presigned URL using:
  // import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
  // import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  return {
    uploadUrl: `/upload?key=${key}`,
    key,
    expiresAt,
  };
}

function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  return map[contentType] || "jpg";
}
