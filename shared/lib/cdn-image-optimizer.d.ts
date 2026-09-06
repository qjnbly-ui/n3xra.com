export const CDN_BROWSER_CACHE_SECONDS: string;
export const CDN_MAX_IMAGE_EDGE: number;
export const CDN_MAX_OBJECT_BYTES: number;
export type PreparedCdnFile = { blob: Blob; contentType: string; width: number | null; height: number | null; optimized: boolean };
export function prepareCdnImage(blob: Blob, asset: { category: string; replacement_type: string }, version: { mime_type: string; original_filename: string }): Promise<PreparedCdnFile>;
