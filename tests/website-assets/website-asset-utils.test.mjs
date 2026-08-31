import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const utilitySource = await readFile(new URL("../../shared/lib/website-asset-utils.js", import.meta.url), "utf8");
const {
  humanizeWebsiteAssetFilename,
  onboardingCategoryToWebsiteAsset,
  safeWebsiteAssetFilename,
  uniqueWebsiteAssetKey,
  validateWebsiteAssetRename,
  websiteAssetThumbnailUrl,
  websiteAssetKeyFromLabel,
} = await import(`data:text/javascript;base64,${Buffer.from(utilitySource).toString("base64")}`);

test("creates safe storage names while preserving the extension", () => {
  assert.equal(safeWebsiteAssetFilename("Client Hero FINAL.PNG"), "client-hero-final.png");
});

test("builds readable labels and valid keys from uploaded filenames", () => {
  const label = humanizeWebsiteAssetFilename("2026_campaign-logo.svg");
  assert.equal(label, "2026 Campaign Logo");
  assert.match(websiteAssetKeyFromLabel(label), /^[a-z][a-zA-Z0-9._-]*$/);
});

test("avoids duplicate asset keys in the same website", () => {
  assert.equal(uniqueWebsiteAssetKey("hero", new Set(["hero", "hero2"])), "hero3");
});

test("places onboarding files in the matching website folders", () => {
  assert.deepEqual(onboardingCategoryToWebsiteAsset("photo"), { category: "image", replacementType: "html_src" });
  assert.deepEqual(onboardingCategoryToWebsiteAsset("legal"), { category: "document", replacementType: "download_only" });
  assert.deepEqual(onboardingCategoryToWebsiteAsset("brand"), { category: "brand", replacementType: "html_src" });
});

test("renames the visible file while preserving its file type", () => {
  assert.equal(validateWebsiteAssetRename("New Hero.PNG", "old-hero.png"), "New Hero.PNG");
  assert.throws(() => validateWebsiteAssetRename("new-hero.webp", "old-hero.png"), /Keep the existing \.png/);
  assert.throws(() => validateWebsiteAssetRename("folder/new-hero.png", "old-hero.png"), /without slashes/);
});

test("uses published image URLs directly for website thumbnails", () => {
  const original = "https://example.supabase.co/storage/v1/object/public/website-assets-public/site/file/photo.jpg";
  assert.equal(websiteAssetThumbnailUrl(original), original);
  assert.equal(websiteAssetThumbnailUrl("https://cdn.example.com/photo.jpg"), "https://cdn.example.com/photo.jpg");
});
