import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const optimizerSource = await readFile(new URL("../../shared/lib/cdn-image-optimizer.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../../n3xra-admin/websites/websites-admin.js", import.meta.url), "utf8");
const { CDN_BROWSER_CACHE_SECONDS, CDN_MAX_IMAGE_EDGE, CDN_MAX_OBJECT_BYTES, canOptimizeCdnImage, prepareCdnImage, shouldOptimizeCdnImage } = await import(
  `data:text/javascript;base64,${Buffer.from(optimizerSource).toString("base64")}`
);

test("uses long-lived caching for versioned CDN objects", () => {
  assert.equal(CDN_BROWSER_CACHE_SECONDS, "31536000");
  assert.equal(CDN_MAX_IMAGE_EDGE, 2400);
  assert.equal(CDN_MAX_OBJECT_BYTES, 10 * 1024 * 1024);
});

test("optimizes ordinary website photos", () => {
  assert.equal(canOptimizeCdnImage(
    { category: "image", replacement_type: "html_src" },
    { mime_type: "image/jpeg", original_filename: "Client Hero.jpg" },
  ), true);
});

test("preserves logos and vector or animated assets", () => {
  assert.equal(canOptimizeCdnImage(
    { category: "logo", replacement_type: "html_src" },
    { mime_type: "image/png", original_filename: "Brand.png" },
  ), false);
  assert.equal(canOptimizeCdnImage(
    { category: "image", replacement_type: "html_src" },
    { mime_type: "image/png", original_filename: "Company Logo.png" },
  ), false);
  assert.equal(canOptimizeCdnImage(
    { category: "image", replacement_type: "html_src" },
    { mime_type: "image/svg+xml", original_filename: "Artwork.svg" },
  ), false);
  assert.equal(canOptimizeCdnImage(
    { category: "image", replacement_type: "html_src" },
    { mime_type: "image/gif", original_filename: "Animation.gif" },
  ), false);
});

test("optimizes an oversized raster logo while preserving ordinary logos", () => {
  const asset = { category: "logo", replacement_type: "html_src" };
  const version = { mime_type: "image/png", original_filename: "Brand.png" };
  assert.equal(shouldOptimizeCdnImage(asset, version, CDN_MAX_OBJECT_BYTES), false);
  assert.equal(shouldOptimizeCdnImage(asset, version, CDN_MAX_OBJECT_BYTES + 1), true);
});

test("does not attempt lossy conversion of oversized vector or animated assets", () => {
  const asset = { category: "logo", replacement_type: "html_src" };
  assert.equal(shouldOptimizeCdnImage(asset, { mime_type: "image/svg+xml", original_filename: "Brand.svg" }, CDN_MAX_OBJECT_BYTES + 1), false);
  assert.equal(shouldOptimizeCdnImage(asset, { mime_type: "image/gif", original_filename: "Brand.gif" }, CDN_MAX_OBJECT_BYTES + 1), false);
});

test("creates a publishable web copy of an oversized raster logo", async () => {
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 5000, height: 4000, close() {} });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {}, imageSmoothingEnabled: false, imageSmoothingQuality: "low" }),
      toBlob(callback, type) {
        const outputSize = this.width > 2000 ? CDN_MAX_OBJECT_BYTES + 1 : 5 * 1024 * 1024;
        callback(new Blob([new Uint8Array(outputSize)], { type }));
      },
    }),
  };

  try {
    const source = new Blob([new Uint8Array(CDN_MAX_OBJECT_BYTES + 1)], { type: "image/png" });
    const prepared = await prepareCdnImage(
      source,
      { category: "logo", replacement_type: "html_src" },
      { mime_type: "image/png", original_filename: "Brand.png" },
    );
    assert.equal(prepared.optimized, true);
    assert.equal(prepared.contentType, "image/webp");
    assert.equal(prepared.blob.size, 5 * 1024 * 1024);
    assert.equal(prepared.width, 1920);
    assert.equal(prepared.height, 1536);
  } finally {
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.document = previousDocument;
  }
});

test("refreshes CDN bytes in place while retaining private-original downloads", () => {
  assert.match(adminSource, /upload\(publicPath, prepared\.blob,[\s\S]*upsert: true/);
  assert.match(adminSource, /createSignedUrl\(version\.storage_path, 600, \{ download: version\.original_filename \}\)/);
  assert.match(adminSource, /data-version-action="restore-original"/);
  assert.match(adminSource, /data-version-action="refresh-cdn"/);
});

test("continues batch publishing after an individual file fails and identifies failures", () => {
  assert.match(adminSource, /failures\.push\(\{ filename: version\.original_filename/);
  assert.match(adminSource, /Could not publish:.*failures\.map/);
});
