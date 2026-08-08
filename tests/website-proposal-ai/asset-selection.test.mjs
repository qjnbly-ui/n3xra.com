import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { selectAssetVersions } = require("../../api/_website-proposal-context.js");

test("asset defaults prefer a published current version, otherwise newest approved", () => {
  const assets = [
    { id: "asset-a", label: "Logo", category: "logo", status: "active", current_version_id: "a-1" },
    { id: "asset-b", label: "Photo", category: "image", status: "active", current_version_id: "b-draft" },
  ];
  const versions = [
    { id: "a-1", asset_id: "asset-a", version_number: 1, status: "published", mime_type: "image/png" },
    { id: "a-2", asset_id: "asset-a", version_number: 2, status: "approved", mime_type: "image/png" },
    { id: "b-1", asset_id: "asset-b", version_number: 1, status: "approved", mime_type: "image/jpeg" },
    { id: "b-2", asset_id: "asset-b", version_number: 2, status: "approved", mime_type: "image/jpeg" },
    { id: "b-draft", asset_id: "asset-b", version_number: 3, status: "pending_review", mime_type: "image/jpeg" },
  ];
  const selected = selectAssetVersions(assets, versions);
  assert.equal(selected.find((row) => row.id === "a-1").default_included, true);
  assert.equal(selected.find((row) => row.id === "a-2").default_included, false);
  assert.equal(selected.find((row) => row.id === "b-2").default_included, true);
  assert.equal(selected.find((row) => row.id === "b-draft").default_included, false);
});

test("rejected, archived, and archived-asset versions are excluded", () => {
  const assets = [
    { id: "active", label: "Active", category: "image", status: "active" },
    { id: "archived", label: "Archived", category: "image", status: "archived" },
  ];
  const versions = [
    { id: "rejected", asset_id: "active", version_number: 1, status: "rejected" },
    { id: "old", asset_id: "active", version_number: 2, status: "archived" },
    { id: "hidden", asset_id: "archived", version_number: 1, status: "published" },
  ];
  assert.deepEqual(selectAssetVersions(assets, versions), []);
});
