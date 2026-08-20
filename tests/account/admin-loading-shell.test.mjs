import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(target);
    return entry.isFile() && entry.name === "index.html" ? [target] : [];
  }));
  return files.flat();
}

test("admin content stays hidden until its controller is ready", async () => {
  const css = await readFile(path.join(projectRoot, "account/admin/admin.css"), "utf8");
  assert.match(
    css,
    /body:not\(\.admin-ready\):not\(\.portal-loading\):not\(\.product-native-admin\) main\.account-admin-page\s*\{\s*visibility:\s*hidden;/,
  );
});

test("every admin document uses the single shared shell instead of copied header markup", async () => {
  const candidates = [
    ...(await htmlFiles(path.join(projectRoot, "account/admin"))),
    ...(await htmlFiles(path.join(projectRoot, "n3xra-admin"))),
    path.join(projectRoot, "account/notifications/index.html"),
  ];
  const failures = [];

  for (const file of candidates) {
    const html = await readFile(file, "utf8");
    if (!html.includes("/account/admin/admin.css")) continue;
    if (!html.includes('/account/admin/admin-shell.js?v=2')) failures.push(path.relative(projectRoot, file));
    assert.doesNotMatch(html, /<header class="site-topbar admin-topbar"/);
    assert.ok(html.indexOf("/account/admin/admin-shell.js?v=2") < html.indexOf("/assets/site-nav.js?v=5"));
    assert.match(html, /\/account\/admin\/admin\.css\?v=31/);
  }

  assert.deepEqual(failures, []);

  const shell = await readFile(path.join(projectRoot, "account/admin/admin-shell.js"), "utf8");
  assert.match(shell, /dataset\.adminShellHeader = "true"/);
  assert.match(shell, /data-admin-sign-out/);
  assert.match(shell, /data-site-menu-toggle/);
  assert.match(shell, /data-site-assistant-open/);
});

test("the shared navigator covers every admin menu route without hiding the persistent shell", async () => {
  const navigation = await readFile(path.join(projectRoot, "account/admin/admin-navigation.js"), "utf8");
  for (const route of [
    "/account/admin/inbox/",
    "/n3xra-admin/records/organizations/",
    "/n3xra-admin/records/usage/",
    "/n3xra-admin/partners/",
    "/n3xra-admin/communications/",
  ]) {
    assert.match(navigation, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(navigation, /const websiteWorkspacePaths = new Set/);
  assert.match(navigation, /const nativeProductWorkspacePaths = new Set/);
  assert.doesNotMatch(navigation, /document\.body\.classList\.remove\("admin-ready"\)/);
  assert.match(navigation, /importedNavigation\.replaceWith\(currentNavigation\)/);
});

test("soft admin navigation preserves the shared enhanced-select stylesheet", async () => {
  const navigation = await readFile(path.join(projectRoot, "account/admin/admin-navigation.js"), "utf8");
  assert.match(
    navigation,
    /const persistentStylesheets = new Set\(\[[\s\S]*"\/account\/admin\/admin-select\.css"/,
  );
});

test("enhanced admin select menus use the top layer so dialogs cannot cover them", async () => {
  const [source, css] = await Promise.all([
    readFile(path.join(projectRoot, "account/admin/admin-select.js"), "utf8"),
    readFile(path.join(projectRoot, "account/admin/admin-select.css"), "utf8"),
  ]);
  assert.match(source, /menu\.setAttribute\("popover", "manual"\)/);
  assert.match(source, /select\.closest\("dialog"\)/);
  assert.match(source, /\(owningDialog \|\| document\.body\)\.append\(menu\)/);
  assert.match(source, /menu\.showPopover\(\)/);
  assert.match(source, /menu\.hidePopover\(\)/);
  assert.match(source, /const preferredHeight = 360/);
  assert.match(source, /menu\.addEventListener\("wheel"/);
  assert.match(css, /\.admin-select-menu\s*{[^}]*overscroll-behavior:contain/);
});

test("admin navigation preserves the clicked position across soft and fallback page loads", async () => {
  const navigation = await readFile(path.join(projectRoot, "account/admin/admin-navigation.js"), "utf8");
  assert.match(navigation, /function captureAdminScrollState\(link = null\)/);
  assert.match(navigation, /pageScrollTop: window\.scrollY/);
  assert.match(navigation, /desktopScrollTop: desktopNavigation\?\.scrollTop/);
  assert.match(navigation, /anchorOffset: link\.getBoundingClientRect\(\)\.top - nav\.getBoundingClientRect\(\)\.top/);
  assert.match(navigation, /window\.sessionStorage\.setItem\(ADMIN_NAVIGATION_SCROLL_KEY/);
  assert.match(navigation, /restoreAdminScrollState\(preservedScroll\)/);
  assert.match(navigation, /navigateAdminWorkspace\(window\.location\.href, \{ history: "none", scrollState, force: true \}\)/);
});

test("admin product entry points reuse the shared admin session gate", async () => {
  const [inbox, notifications, records, partners] = await Promise.all([
    readFile(path.join(projectRoot, "account/admin/inbox/inbox.js"), "utf8"),
    readFile(path.join(projectRoot, "account/notifications/notifications.js"), "utf8"),
    readFile(path.join(projectRoot, "n3xra-records/admin.js"), "utf8"),
    readFile(path.join(projectRoot, "n3xra-admin/partners/partners-admin.js"), "utf8"),
  ]);
  for (const source of [inbox, notifications, records, partners]) {
    assert.match(source, /getAdminSession/);
    assert.doesNotMatch(source, /verifyPlatformAdmin/);
  }
});

test("Account Announcements participates in the shared admin readiness lifecycle", async () => {
  const controller = await readFile(path.join(projectRoot, "account/notifications/notifications.js"), "utf8");
  assert.match(controller, /document\.body\.classList\.add\("admin-ready"\)/);
  assert.match(controller, /startNotifications\(\)\.catch/);
});

test("core admin documents do not ship headings that the controller immediately removes", async () => {
  const files = await htmlFiles(path.join(projectRoot, "account/admin"));
  const obsoleteHeadings = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    if (html.includes('class="portal-heading"')) obsoleteHeadings.push(path.relative(projectRoot, file));
  }
  assert.deepEqual(obsoleteHeadings, []);
});
