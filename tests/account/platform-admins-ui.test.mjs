import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../../account/admin/platform-admins/index.html", import.meta.url);
const cssPath = new URL("../../account/admin/admin.css", import.meta.url);
const controllerPath = new URL("../../account/admin/controllers/platform-admins.js", import.meta.url);
const adminScriptPath = new URL("../../account/admin/admin.js", import.meta.url);
const platformAdminFunctionPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);

test("administrator invitations open from the roster instead of occupying the detail pane", async () => {
  const [html, css, controller, adminScript, platformAdminFunction] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(controllerPath, "utf8"),
    readFile(adminScriptPath, "utf8"),
    readFile(platformAdminFunctionPath, "utf8"),
  ]);

  const detailPane = html.match(/<section class="platform-admin-detail-pane">([\s\S]*?)<\/section>\s*<\/div>/)?.[1] || "";
  assert.match(html, /id="platform-admin-add"[^>]*>[\s\S]*Add new<\/button>/);
  assert.equal(detailPane.trim(), '<section id="platform-admin-detail"></section>');
  assert.match(html, /<dialog class="platform-admin-invite-dialog" id="platform-admin-invite-dialog"/);
  assert.match(html, /id="platform-admin-invite-form"/);
  assert.match(html, /id="platform-admin-invite-account"/);
  assert.doesNotMatch(html, /id="platform-admin-invite-email"/);
  assert.match(html, /tied to that exact account/);
  assert.match(html, /id="platform-admin-invite-link"/);
  assert.match(css, /\.platform-admin-add-button\s*{/);
  assert.match(css, /\.platform-admin-invite-dialog::backdrop\s*{/);
  assert.match(controller, /function openPlatformAdminInviteDialog\(\)/);
  assert.match(controller, /list-platform-admin-candidates/);
  assert.match(controller, /create-platform-admin-invite", \{ accountUserId, role \}/);
  assert.match(controller, /platform-admin-add["']\)\?\.addEventListener\("click", openPlatformAdminInviteDialog\)/);
  assert.match(controller, /event\.target === event\.currentTarget/);
  assert.match(adminScript, /controllers\/platform-admins\.js\?v=4/);
  assert.match(platformAdminFunction, /action === "list-platform-admin-candidates"/);
  assert.match(platformAdminFunction, /auth\.admin\.getUserById\(accountUserId\)/);
  assert.match(platformAdminFunction, /Owner admin access required/);
});
