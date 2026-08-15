import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminNavigationPath = new URL("../../account/admin/admin-navigation.js", import.meta.url);
const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountScriptPath = new URL("../../account/account.js", import.meta.url);
const platformAdminPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);

test("Records remains the only Records entry and no duplicate Internal Records app is exposed", async () => {
  const [navigation, html, script] = await Promise.all([
    readFile(adminNavigationPath, "utf8"),
    readFile(accountHtmlPath, "utf8"),
    readFile(accountScriptPath, "utf8"),
  ]);

  assert.doesNotMatch(navigation, /data-open-internal-records|Internal Records/);
  assert.doesNotMatch(html, /Internal Records|open-admin-records-button/);
  assert.doesNotMatch(script, /get-admin-records-workspace|enroll-admin-records-workspace|openAdminRecords/);
  assert.match(html, /<h3>Records<\/h3>[\s\S]*href="\/n3xra-admin\/records\/organizations\/"/);
  assert.match(navigation, /key: "records"[\s\S]*label: "Records"/);
});

test("the platform-admin service contains no duplicate Internal Records workspace actions", async () => {
  const source = await readFile(platformAdminPath, "utf8");

  assert.doesNotMatch(source, /ADMIN_RECORDS_WORKSPACE|AdminRecordsWorkspace|admin-records-workspace|n3xra-administration/);
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
