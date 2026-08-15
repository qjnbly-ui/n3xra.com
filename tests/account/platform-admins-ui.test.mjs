import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../../account/admin/platform-admins/index.html", import.meta.url);
const cssPath = new URL("../../account/admin/admin.css", import.meta.url);
const controllerPath = new URL("../../account/admin/controllers/platform-admins.js", import.meta.url);
const adminScriptPath = new URL("../../account/admin/admin.js", import.meta.url);

test("administrator invitations open from the roster instead of occupying the detail pane", async () => {
  const [html, css, controller, adminScript] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(controllerPath, "utf8"),
    readFile(adminScriptPath, "utf8"),
  ]);

  const detailPane = html.match(/<section class="platform-admin-detail-pane">([\s\S]*?)<\/section>\s*<\/div>/)?.[1] || "";
  assert.match(html, /id="platform-admin-add"[^>]*>[\s\S]*Add new<\/button>/);
  assert.equal(detailPane.trim(), '<section id="platform-admin-detail"></section>');
  assert.match(html, /<dialog class="platform-admin-invite-dialog" id="platform-admin-invite-dialog"/);
  assert.match(html, /id="platform-admin-invite-form"/);
  assert.match(html, /id="platform-admin-invite-link"/);
  assert.match(css, /\.platform-admin-add-button\s*{/);
  assert.match(css, /\.platform-admin-invite-dialog::backdrop\s*{/);
  assert.match(controller, /function openPlatformAdminInviteDialog\(\)/);
  assert.match(controller, /platform-admin-add["']\)\?\.addEventListener\("click", openPlatformAdminInviteDialog\)/);
  assert.match(controller, /event\.target === event\.currentTarget/);
  assert.match(adminScript, /controllers\/platform-admins\.js\?v=2/);
});
