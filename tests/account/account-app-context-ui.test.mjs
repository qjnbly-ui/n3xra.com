import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountScriptPath = new URL("../../account/account.js", import.meta.url);
const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountControllerPath = new URL("../../account/admin/controllers/accounts.js", import.meta.url);
const adminAccountsHtmlPath = new URL("../../account/admin/accounts/index.html", import.meta.url);
const adminScriptPath = new URL("../../account/admin/admin.js", import.meta.url);

test("My apps queries stay scoped to the signed-in account even for platform admins", async () => {
  const [script, html] = await Promise.all([
    readFile(accountScriptPath, "utf8"),
    readFile(accountHtmlPath, "utf8"),
  ]);

  for (const table of ["organization_memberships", "music_profiles", "virals_profiles", "website_service_requests", "loan_accounts"]) {
    const query = script.match(new RegExp(`\\.from\\("${table}"\\)[\\s\\S]*?(?=\\n}\\n|\\nasync function)`))?.[0] || "";
    assert.match(query, /\.eq\("user_id", currentSession\.user\.id\)/, `${table} must be scoped to the current user`);
  }
  assert.match(html, /account\.js\?v=20260815-records-setup/);
});

test("Accounts provides client-view previews without changing the signed-in identity", async () => {
  const [controller, adminHtml, adminScript] = await Promise.all([
    readFile(accountControllerPath, "utf8"),
    readFile(adminAccountsHtmlPath, "utf8"),
    readFile(adminScriptPath, "utf8"),
  ]);

  assert.match(controller, /function productClientPreviewLink\(item\)/);
  assert.match(controller, /\/n3xra-records\/library\/\?support_org=/);
  assert.match(controller, /\/project-workspace\/\?website=/);
  assert.match(controller, /Preview client view/);
  assert.match(adminHtml, /admin\.js\?v=34/);
  assert.match(adminScript, /controllers\/accounts\.js\?v=4/);
});
