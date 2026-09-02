import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../../account/admin/platform-admins/index.html", import.meta.url);
const cssPath = new URL("../../account/admin/admin.css", import.meta.url);
const controllerPath = new URL("../../account/admin/controllers/platform-admins.js", import.meta.url);
const adminScriptPath = new URL("../../account/admin/admin.js", import.meta.url);
const platformAdminFunctionPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);

test("existing accounts receive administrator access immediately without an invitation", async () => {
  const [html, css, controller, adminScript, platformAdminFunction] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(controllerPath, "utf8"),
    readFile(adminScriptPath, "utf8"),
    readFile(platformAdminFunctionPath, "utf8"),
  ]);

  const detailPane = html.match(/<section class="platform-admin-detail-pane">([\s\S]*?)<\/section>\s*<\/div>/)?.[1] || "";
  const directGrantAction = platformAdminFunction.match(/if \(action === "grant-platform-admin-access"\) \{([\s\S]*?)\n    \}\n\n    if \(action === "revoke-platform-admin-invite"\)/)?.[1] || "";
  assert.match(html, /id="platform-admin-add"[^>]*>[\s\S]*Add new<\/button>/);
  assert.equal(detailPane.trim(), '<section id="platform-admin-detail"></section>');
  assert.match(html, /<dialog class="platform-admin-invite-dialog" id="platform-admin-invite-dialog"/);
  assert.match(html, /id="platform-admin-invite-form"/);
  assert.match(html, /id="platform-admin-invite-account"/);
  assert.doesNotMatch(html, /id="platform-admin-invite-email"/);
  assert.match(html, /grant its administrator access immediately/);
  assert.match(html, /Grant access now/);
  assert.doesNotMatch(html, /id="platform-admin-invite-link"/);
  assert.match(css, /\.platform-admin-add-button\s*{/);
  assert.match(css, /\.platform-admin-invite-dialog::backdrop\s*{/);
  assert.match(controller, /function openPlatformAdminInviteDialog\(\)/);
  assert.match(controller, /list-platform-admin-candidates/);
  assert.match(controller, /grant-platform-admin-access", \{ accountUserId, role \}/);
  assert.doesNotMatch(controller, /create-platform-admin-invite/);
  assert.match(controller, /platform-admin-add["']\)\?\.addEventListener\("click", openPlatformAdminInviteDialog\)/);
  assert.match(controller, /event\.target === event\.currentTarget/);
  assert.match(adminScript, /controllers\/platform-admins\.js\?v=6/);
  assert.match(platformAdminFunction, /action === "list-platform-admin-candidates"/);
  assert.match(platformAdminFunction, /auth\.admin\.getUserById\(accountUserId\)/);
  assert.match(platformAdminFunction, /action === "grant-platform-admin-access"/);
  assert.match(platformAdminFunction, /Owner admin access required/);
  assert.match(html, /id="platform-dashboard-preview-dialog"/);
  assert.match(controller, /data-platform-admin-action="preview-dashboard"/);
  assert.match(controller, /get-platform-admin-structure-preview/);
  assert.match(controller, /no impersonation · no personal product records loaded/);
  assert.match(controller, /admin_preview=\$\{encodeURIComponent\(data\.partner_application_id\)\}/);
  assert.match(controller, /href: "\/account\/admin\/prospects\/"/);
  assert.match(platformAdminFunction, /action === "get-platform-admin-structure-preview"/);
  assert.match(platformAdminFunction, /\.eq\("account_user_id", accountUserId\)/);
  assert.match(directGrantAction, /from\("platform_admins"\)[\s\S]*\.upsert\(/);
  assert.match(directGrantAction, /from\("platform_app_reviewers"\)[\s\S]*\.upsert\(/);
  assert.match(directGrantAction, /status: "revoked", revoked_by_user_id: user\.id/);
  assert.doesNotMatch(directGrantAction, /token_hash|inviteUrl|\.insert\(/);
});
