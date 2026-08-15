import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminNavigationPath = new URL("../../account/admin/admin-navigation.js", import.meta.url);
const platformAdminPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);

test("the admin menu exposes Internal Records separately from Records oversight", async () => {
  const navigation = await readFile(adminNavigationPath, "utf8");

  assert.match(navigation, /data-open-internal-records/);
  assert.match(navigation, /open-admin-records-workspace/);
  assert.match(navigation, /setStoredActiveOrganizationId\(organizationId\)/);
  assert.match(navigation, /window\.location\.assign\("\/n3xra-records\/library"\)/);
  assert.match(navigation, /key: "records"[\s\S]*label: "Records"/);
});

test("the platform-admin service provisions one shared workspace for every active admin", async () => {
  const source = await readFile(platformAdminPath, "utf8");

  assert.match(source, /ADMIN_RECORDS_WORKSPACE_SLUG = "n3xra-administration"/);
  assert.match(source, /async function ensureAdminRecordsWorkspace/);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.match(source, /\.upsert\(memberships, \{ onConflict: "organization_id,user_id" \}\)/);
  assert.match(source, /action === "open-admin-records-workspace"/);
  assert.match(source, /\.delete\(\)[\s\S]+ADMIN_RECORDS_WORKSPACE_SLUG/);
});

test("platform owners can enter Records without being forced back to the oversight dashboard", async () => {
  const paths = [
    "../../n3xra-records/router.js",
    "../../n3xra-records/login.js",
    "../../n3xra-records/dashboard.js",
    "../../n3xra-records/files.js",
    "../../n3xra-records/documents.js",
    "../../n3xra-records/messages.js",
    "../../n3xra-records/storage.js",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  sources.forEach((source) => {
    assert.doesNotMatch(source, /window\.location\.(?:replace|assign)\("\/n3xra-admin\/records"\)/);
  });
});
