/**
 * Image transformation utilities
 *
 * Note: Full image transformation requires Cloudflare Image Resizing (paid)
 * or an external service. This implementation provides the interface
 * and basic passthrough functionality.
 */

export interface TransformParams {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "scale-down";
  quality?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
  hasTransforms: boolean;
  cacheKey: string;
}

export function parseTransformParams(
  searchParams: URLSearchParams
): TransformParams {
  const width = parseInt(searchParams.get("w") || "0") || undefined;
  const height = parseInt(searchParams.get("h") || "0") || undefined;
  const fit = searchParams.get("fit") as TransformParams["fit"];
  const quality = parseInt(searchParams.get("q") || "0") || undefined;
  const format = searchParams.get("f") as TransformParams["format"];

  const hasTransforms = !!(width || height || fit || quality || format);

  // Generate cache key based on params
  const parts: string[] = [];
  if (width) parts.push(`w${width}`);
  if (height) parts.push(`h${height}`);
  if (fit) parts.push(`f${fit}`);
  if (quality) parts.push(`q${quality}`);
  if (format) parts.push(format);

  const cacheKey = parts.length > 0 ? parts.join("_") : "original";

  return {
    width: width && width > 0 && width <= 4096 ? width : undefined,
    height: height && height > 0 && height <= 4096 ? height : undefined,
    fit: fit && ["cover", "contain", "fill", "scale-down"].includes(fit)
      ? fit
      : undefined,
    quality:
      quality && quality >= 1 && quality <= 100 ? quality : undefined,
    format:
      format && ["webp", "avif", "jpeg", "png"].includes(format)
        ? format
        : undefined,
    hasTransforms,
    cacheKey,
  };
}

export interface TransformResult {
  data: ArrayBuffer;
  contentType: string;
}

export async function transformImage(
  data: ArrayBuffer,
  contentType: string,
  params: TransformParams
): Promise<TransformResult> {
  // Option 1: Use Cloudflare Image Resizing (requires paid plan)
  // This would be done via a subrequest with cf.image options

  // Option 2: Use an external service like Cloudinary, imgix, etc.

  // Option 3: Basic format conversion only (limited)

  // For this implementation, we'll return the original image
  // with adjusted content type if format change was requested

  let outputContentType = contentType;

  if (params.format) {
    const formatMap: Record<string, string> = {
      webp: "image/webp",
      avif: "image/avif",
      jpeg: "image/jpeg",
      png: "image/png",
    };
    outputContentType = formatMap[params.format] || contentType;
  }

  // In a real implementation, you would:
  // 1. Use a library like sharp (not available in Workers)
  // 2. Use Cloudflare Image Resizing
  // 3. Call an external transformation service

  // Example with Cloudflare Image Resizing (requires Images product):
  /*
  const imageUrl = `https://your-bucket.r2.dev/original/${key}`;
  const response = await fetch(imageUrl, {
    cf: {
      image: {
        width: params.width,
        height: params.height,
        fit: params.fit,
        quality: params.quality,
        format: params.format,
      },
    },
  });
  return {
    data: await response.arrayBuffer(),
    contentType: response.headers.get("Content-Type") || outputContentType,
  };
  */

  // Passthrough for now
  return {
    data,
    contentType: outputContentType,
  };
}
