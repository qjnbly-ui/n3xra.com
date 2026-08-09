const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const PRESERVED_FOLDERS = new Set(["logo", "brand"]);
const PRESERVED_NAME_PATTERN = /(^|[\s._-])(favicon|icon|logo|logomark|wordmark)([\s._-]|$)/i;

export const CDN_BROWSER_CACHE_SECONDS = "31536000";
export const CDN_MAX_IMAGE_EDGE = 2400;

export function canOptimizeCdnImage(asset, version) {
  const mimeType = String(version?.mime_type || "").toLowerCase();
  if (!OPTIMIZABLE_TYPES.has(mimeType)) return false;
  if (PRESERVED_FOLDERS.has(String(asset?.category || "").toLowerCase())) return false;
  return !PRESERVED_NAME_PATTERN.test(String(version?.original_filename || ""));
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
  if (!canOptimizeCdnImage(asset, { ...version, mime_type: sourceType })) {
    return { blob, contentType: sourceType, width: null, height: null, optimized: false };
  }

  const decoded = await decodeImage(blob);
  try {
    const longestEdge = Math.max(decoded.width, decoded.height);
    const scale = Math.min(1, CDN_MAX_IMAGE_EDGE / longestEdge);
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

    const outputType = preferredOutputType(asset, sourceType);
    const encoded = await canvasBlob(canvas, outputType, outputType === "image/jpeg" ? 0.86 : 0.84);
    const encodedType = encoded.type || outputType;
    const resized = width !== decoded.width || height !== decoded.height;
    const useEncoded = encoded.size < blob.size && (resized || encoded.size <= blob.size * 0.94);
    return {
      blob: useEncoded ? encoded : blob,
      contentType: useEncoded ? encodedType : sourceType,
      width: useEncoded ? width : decoded.width,
      height: useEncoded ? height : decoded.height,
      optimized: useEncoded,
    };
  } finally {
    decoded.close();
  }
}
