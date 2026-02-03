# 05 - Image CDN

An image hosting and transformation service using Cloudflare Workers and R2 storage.

## Learning Objectives

- R2 object storage (S3-compatible)
- Image transformations at the edge
- Cache headers and CDN optimization
- Presigned URLs for uploads

## Concepts

### Cloudflare R2

R2 is S3-compatible object storage with zero egress fees:

```typescript
// Upload object
await env.IMAGES.put("path/to/image.jpg", imageData, {
  httpMetadata: {
    contentType: "image/jpeg",
  },
  customMetadata: {
    uploadedBy: "user123",
    originalName: "photo.jpg",
  },
});

// Get object
const object = await env.IMAGES.get("path/to/image.jpg");
if (object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
}

// Delete object
await env.IMAGES.delete("path/to/image.jpg");

// List objects
const listed = await env.IMAGES.list({
  prefix: "user123/",
  limit: 100,
});

// Head (metadata only)
const head = await env.IMAGES.head("path/to/image.jpg");
```

### Image Transformations

Using Cloudflare Image Resizing (requires paid plan) or manual transforms:

```typescript
// Cloudflare Image Resizing via fetch
const response = await fetch(imageUrl, {
  cf: {
    image: {
      width: 400,
      height: 300,
      fit: "cover",
      quality: 80,
      format: "webp",
    },
  },
});

// URL-based transformations
// https://your-worker.dev/image/photo.jpg?w=400&h=300&fit=cover&q=80
```

### Cache Headers

```typescript
// Cache for 1 year (immutable content)
headers.set("Cache-Control", "public, max-age=31536000, immutable");

// Cache with revalidation
headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

// No cache
headers.set("Cache-Control", "no-store");

// ETag for conditional requests
headers.set("ETag", `"${object.httpEtag}"`);
```

### Presigned URLs

```typescript
// Generate presigned upload URL (using S3 SDK)
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const url = await getSignedUrl(
  S3,
  new PutObjectCommand({ Bucket: "images", Key: "photo.jpg" }),
  { expiresIn: 3600 }
);
```

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload image (multipart) |
| GET | `/upload-url` | Get presigned upload URL |
| GET | `/images/:key` | Get image (with transforms) |
| DELETE | `/images/:key` | Delete image |
| GET | `/images` | List images |

### Query Parameters for Transforms

| Param | Description | Example |
|-------|-------------|---------|
| `w` | Width | `?w=400` |
| `h` | Height | `?h=300` |
| `fit` | Fit mode | `?fit=cover` (cover, contain, fill, scale-down) |
| `q` | Quality (1-100) | `?q=80` |
| `f` | Format | `?f=webp` (webp, avif, jpeg, png) |

## Project Tasks

### Task 1: Basic Upload/Download
- Accept multipart file uploads
- Store in R2 with metadata
- Serve images with proper headers

### Task 2: Image Transformations
- Parse transform query params
- Apply transformations (resize, format)
- Cache transformed versions

### Task 3: CDN Optimization
- Set proper cache headers
- Handle conditional requests (ETag, If-None-Match)
- Serve appropriate format based on Accept header

### Task 4: Presigned URLs
- Generate upload URLs
- Validate uploads
- Handle CORS for browser uploads

## Commands

```bash
# Create R2 bucket
npx wrangler r2 bucket create images

# Set secrets for presigned URLs
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
05-image-cdn/
├── src/
│   ├── index.ts        # Main router
│   ├── upload.ts       # Upload handling
│   ├── transform.ts    # Image transformations
│   └── cache.ts        # Cache utilities
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Upload image
curl -X POST http://localhost:8787/upload \
  -F "file=@photo.jpg"

# Get image
curl http://localhost:8787/images/abc123.jpg

# Get resized image
curl "http://localhost:8787/images/abc123.jpg?w=200&h=200&fit=cover"

# Get WebP version
curl "http://localhost:8787/images/abc123.jpg?f=webp"

# Get presigned upload URL
curl http://localhost:8787/upload-url?filename=photo.jpg

# Delete image
curl -X DELETE http://localhost:8787/images/abc123.jpg \
  -H "Authorization: Bearer token"
```

## Image Path Structure

```
images/
├── original/
│   └── {id}.{ext}          # Original uploads
├── transformed/
│   └── {id}_{params}.{ext} # Cached transforms
└── metadata/
    └── {id}.json           # Image metadata
```

## Key Takeaways

1. R2 has no egress fees - great for serving static assets
2. Use Cache-Control headers to leverage Cloudflare's CDN
3. Store transformed versions to avoid re-processing
4. Content-based ETags enable efficient conditional requests
5. Presigned URLs allow direct browser-to-R2 uploads
