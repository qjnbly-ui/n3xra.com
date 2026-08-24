const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const PRESERVED_FOLDERS = new Set(["logo", "brand"]);
const PRESERVED_NAME_PATTERN = /(^|[\s._-])(favicon|icon|logo|logomark|wordmark)([\s._-]|$)/i;

export const CDN_BROWSER_CACHE_SECONDS = "31536000";
export const CDN_MAX_IMAGE_EDGE = 2400;
export const CDN_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

export function canOptimizeCdnImage(asset, version) {
  const mimeType = String(version?.mime_type || "").toLowerCase();
  if (!OPTIMIZABLE_TYPES.has(mimeType)) return false;
  if (PRESERVED_FOLDERS.has(String(asset?.category || "").toLowerCase())) return false;
  return !PRESERVED_NAME_PATTERN.test(String(version?.original_filename || ""));
}

export function shouldOptimizeCdnImage(asset, version, sourceSizeBytes = 0) {
  const mimeType = String(version?.mime_type || "").toLowerCase();
  if (!OPTIMIZABLE_TYPES.has(mimeType)) return false;
  return sourceSizeBytes > CDN_MAX_OBJECT_BYTES || canOptimizeCdnImage(asset, version);
}

function preferredOutputType(asset, sourceType) {
  if (asset?.replacement_type === "metadata") return sourceType === "image/jpeg" ? "image/jpeg" : "image/png";
  if (sourceType === "image/jpeg") return "image/jpeg";
  return "image/webp";
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("This browser could not prepare the optimized image."));
    }, type, quality);
  });
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some Safari versions expose createImageBitmap without supporting imageOrientation.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This browser could not read the image."));
      image.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareCdnImage(blob, asset, version) {
  const sourceType = String(version?.mime_type || blob.type || "application/octet-stream").toLowerCase();
  const forceWithinCdnLimit = blob.size > CDN_MAX_OBJECT_BYTES;
  if (!shouldOptimizeCdnImage(asset, { ...version, mime_type: sourceType }, blob.size)) {
    return { blob, contentType: sourceType, width: null, height: null, optimized: false };
  }

  const decoded = await decodeImage(blob);
  try {
    const outputType = preferredOutputType(asset, sourceType);
    const longestEdge = Math.max(decoded.width, decoded.height);
    const targetEdges = forceWithinCdnLimit ? [CDN_MAX_IMAGE_EDGE, 1920, 1600, 1200] : [CDN_MAX_IMAGE_EDGE];
    let bestCandidate = null;

    for (const [index, targetEdge] of targetEdges.entries()) {
      const scale = Math.min(1, targetEdge / longestEdge);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("This browser could not prepare the optimized image.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);

      const baseQuality = outputType === "image/jpeg" ? 0.86 : 0.84;
      const encoded = await canvasBlob(canvas, outputType, Math.max(0.68, baseQuality - index * 0.04));
      const candidate = { blob: encoded, width, height };
      if (!bestCandidate || encoded.size < bestCandidate.blob.size) bestCandidate = candidate;
      if (!forceWithinCdnLimit || encoded.size <= CDN_MAX_OBJECT_BYTES) break;
    }

    const encoded = bestCandidate.blob;
    const encodedType = encoded.type || outputType;
    const resized = bestCandidate.width !== decoded.width || bestCandidate.height !== decoded.height;
    const fitsCdn = !forceWithinCdnLimit || encoded.size <= CDN_MAX_OBJECT_BYTES;
    const useEncoded = fitsCdn && encoded.size < blob.size && (forceWithinCdnLimit || resized || encoded.size <= blob.size * 0.94);
    return {
      blob: useEncoded ? encoded : blob,
      contentType: useEncoded ? encodedType : sourceType,
      width: useEncoded ? bestCandidate.width : decoded.width,
      height: useEncoded ? bestCandidate.height : decoded.height,
      optimized: useEncoded,
    };
  } finally {
    decoded.close();
  }
}
