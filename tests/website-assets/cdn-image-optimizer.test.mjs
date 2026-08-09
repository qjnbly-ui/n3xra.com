import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const optimizerSource = await readFile(new URL("../../shared/lib/cdn-image-optimizer.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../../n3xra-admin/websites/websites-admin.js", import.meta.url), "utf8");
const { CDN_BROWSER_CACHE_SECONDS, CDN_MAX_IMAGE_EDGE, canOptimizeCdnImage } = await import(
  `data:text/javascript;base64,${Buffer.from(optimizerSource).toString("base64")}`
);

test("uses long-lived caching for versioned CDN objects", () => {
  assert.equal(CDN_BROWSER_CACHE_SECONDS, "31536000");
  assert.equal(CDN_MAX_IMAGE_EDGE, 2400);
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

test("refreshes CDN bytes in place while retaining private-original downloads", () => {
  assert.match(adminSource, /upload\(publicPath, prepared\.blob,[\s\S]*upsert: true/);
  assert.match(adminSource, /createSignedUrl\(version\.storage_path, 600, \{ download: version\.original_filename \}\)/);
  assert.match(adminSource, /data-version-action="restore-original"/);
});
