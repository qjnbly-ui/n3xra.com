import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filesSource = await readFile(new URL("../../account/admin/files/files.js", import.meta.url), "utf8");
const workspaceFilesSource = await readFile(new URL("../../n3xra-admin/websites/websites-admin.js", import.meta.url), "utf8");
const workspaceFilesPage = await readFile(new URL("../../n3xra-admin/assets/index.html", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../../account/admin/admin-navigation.js", import.meta.url), "utf8");

test("Internal Files remains the central admin library", () => {
  assert.match(navigationSource, /\["\/account\/admin\/files\/", "Internal Files"\]/);
});

test("website libraries retain website and category folders", () => {
  assert.match(filesSource, /`Websites\/\$\{websiteFolderSegment\(website\.name\)\}`/);
  assert.match(filesSource, /websiteCategoryFolder\(asset\.category\)/);
  assert.match(filesSource, /currentFolderPath\.startsWith\(`\$\{website\.folder_path\}\/`\)/);
});

test("website library changes refresh the central view live", () => {
  assert.match(filesSource, /table: "website_assets"/);
  assert.match(filesSource, /table: "website_asset_versions"/);
  assert.match(filesSource, /subscribeToWebsiteLibraries\(\)/);
});

test("central website libraries expose the full admin asset workflow", () => {
  assert.match(filesSource, /data-website-file-approve/);
  assert.match(filesSource, /data-website-file-reject/);
  assert.match(filesSource, /data-website-file-publish/);
  assert.match(filesSource, /data-website-file-publish-original/);
  assert.match(filesSource, /data-website-file-rename/);
  assert.match(filesSource, /data-website-file-optimize/);
  assert.match(filesSource, /data-website-file-original/);
  assert.match(filesSource, /approveSelectedWebsiteFiles/);
  assert.match(filesSource, /rejectSelectedWebsiteFiles/);
  assert.match(filesSource, /refreshSelectedWebsiteCdnFiles/);
});

test("central admin uploads are approved immediately", () => {
  assert.match(filesSource, /status: "approved"/);
  assert.match(filesSource, /approved_by_user_id: fileUserId/);
});

test("central website libraries show live usage states", () => {
  assert.match(filesSource, /website-asset-usage/);
  assert.match(filesSource, /In use/);
  assert.match(filesSource, /Available/);
  assert.match(filesSource, /New/);
});

test("organization workspace files show and filter live usage states", () => {
  assert.match(workspaceFilesPage, /id="admin-asset-status-filter"/);
  assert.match(workspaceFilesSource, /website-asset-usage/);
  assert.match(workspaceFilesSource, /Authorization: `Bearer \$\{currentSession\?\.access_token/);
  assert.match(workspaceFilesSource, /In use · \$\{locations\.length\}/);
  assert.match(workspaceFilesSource, /Used on:/);
  assert.match(workspaceFilesSource, /label: "Available"/);
  assert.match(workspaceFilesSource, /label: "New"/);
  assert.match(workspaceFilesSource, /label: "Ready to publish"/);
});
