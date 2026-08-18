import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminNavigationPath = new URL("../../account/admin/admin-navigation.js", import.meta.url);
const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountScriptPath = new URL("../../account/account.js", import.meta.url);
const platformAdminPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);
const recordsOrganizationsPath = new URL("../../n3xra-admin/records/organizations/index.html", import.meta.url);
const recordsUsagePath = new URL("../../n3xra-admin/records/usage/index.html", import.meta.url);
const recordsAdminScriptPath = new URL("../../n3xra-records/admin.js", import.meta.url);
const recordsAdminStylesPath = new URL("../../n3xra-admin/records/records-admin.css", import.meta.url);

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

test("Records Organizations and Usage share a searchable client-list and detail workbench", async () => {
  const [organizationsHtml, usageHtml, script, styles] = await Promise.all([
    readFile(recordsOrganizationsPath, "utf8"),
    readFile(recordsUsagePath, "utf8"),
    readFile(recordsAdminScriptPath, "utf8"),
    readFile(recordsAdminStylesPath, "utf8"),
  ]);

  for (const html of [organizationsHtml, usageHtml]) {
    assert.match(html, /class="records-directory-workbench"/);
    assert.match(html, /class="records-directory-list-pane"/);
    assert.match(html, /class="records-directory-detail-pane"/);
  }
  assert.match(organizationsHtml, /id="organization-search"/);
  assert.match(organizationsHtml, /id="selected-organization-facts"/);
  assert.match(usageHtml, /id="usage-search"/);
  assert.match(usageHtml, /id="admin-usage-detail"/);
  assert.doesNotMatch(usageHtml, /admin-usage-table/);
  assert.match(script, /function renderAdminUsageDetail\(\)/);
  assert.match(script, /organizationSearchTerm/);
  assert.match(script, /usageSearchTerm/);
  assert.match(styles, /\.records-directory-workbench\s*\{/);
  assert.match(styles, /grid-template-columns:340px minmax\(0,1fr\)/);
});
