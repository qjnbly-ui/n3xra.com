import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  liveUsageReportUrl,
  normalizedUsageReport,
  publicAssetVersion,
  websiteSlug,
} = require("../../api/_website-asset-bridge.js");

test("accepts only canonical website slugs", () => {
  assert.equal(websiteSlug("Roots-And-Relics"), "roots-and-relics");
  assert.throws(() => websiteSlug("roots/relics"), /valid website slug/);
});

test("exports only published website CDN versions", () => {
  const url = "https://example.supabase.co/storage/v1/object/public/website-assets-public/site/asset/v1-photo.jpg";
  assert.equal(publicAssetVersion({ status: "published", public_url: url }), url);
  assert.equal(publicAssetVersion({ status: "approved", public_url: url }), null);
  assert.equal(publicAssetVersion({ status: "published", public_url: "https://example.com/private.jpg" }), null);
});

test("builds a fixed well-known usage report URL", () => {
  assert.equal(
    liveUsageReportUrl("https://roots.example.com/some/path?x=1").href,
    "https://roots.example.com/.well-known/n3xra-asset-usage.json",
  );
  assert.throws(() => liveUsageReportUrl("http://localhost:4321"), /safe public HTTPS URL/);
});

test("normalizes the live report and rejects cross-site data", () => {
  const report = normalizedUsageReport({
    schemaVersion: 1,
    websiteSlug: "roots-and-relics",
    assets: [{ assetKey: "hero", filename: "hero.jpg", locations: [{ route: "/", sourceFile: "src/pages/index.astro", occurrences: 2 }] }],
  }, "roots-and-relics");
  assert.equal(report.assets[0].occurrenceCount, 2);
  assert.throws(() => normalizedUsageReport({ schemaVersion: 1, websiteSlug: "other", assets: [] }, "roots-and-relics"), /invalid asset usage report/);
});
