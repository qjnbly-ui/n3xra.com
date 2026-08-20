import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Records mobile navigation keeps every primary workflow contextual", async () => {
  const [shell, library, meetings, documents, messages] = await Promise.all([
    read("n3xra-records/lib/desktop-shell.js"),
    read("n3xra-records/library/index.html"),
    read("n3xra-records/meeting-notes/index.html"),
    read("n3xra-records/documents.html"),
    read("n3xra-records/messages.html"),
  ]);

  const mobileLinks = shell.match(/const RECORDS_MOBILE_LINKS = \[[\s\S]*?\n\];/)?.[0] || "";
  assert.match(mobileLinks, /label: "Library"/);
  assert.match(mobileLinks, /label: "Meetings"/);
  assert.match(mobileLinks, /label: "Documents"/);
  assert.match(mobileLinks, /label: "Messages"/);
  assert.match(mobileLinks, /label: "More"/);
  assert.equal((mobileLinks.match(/label:/g) || []).length, 5);
  assert.doesNotMatch(mobileLinks, /label: "Create"/);

  assert.match(library, /id="files-open-upload-modal"/);
  assert.match(meetings, /id="record-panel-toggle"/);
  assert.match(documents, /id="new-document-button"/);
  assert.match(messages, /id="message-submit"/);
});

test("Records More groups every advanced area without exposing unavailable permissions", async () => {
  const [shell, dashboard] = await Promise.all([
    read("n3xra-records/lib/desktop-shell.js"),
    read("n3xra-records/dashboard.js"),
  ]);

  for (const group of ["People & access", "Library setup", "Plan & usage", "Security & support"]) {
    assert.match(shell, new RegExp(`label: "${group.replace(/[&]/g, "&")}"`));
  }
  for (const view of ["users", "access", "contacts", "voice", "library", "templates", "phone", "ai", "billing", "storage", "activity", "support"]) {
    assert.match(shell, new RegExp(`view: "${view}"`));
  }
  assert.match(shell, /class="hidden"[^>]+data-records-mobile-view/);
  assert.match(dashboard, /data-records-mobile-view/);
  assert.doesNotMatch(dashboard, /function setDesktopAccountView\(view = "profile"\) \{\s*if \(!window\.matchMedia/);
});

test("the shared mobile shell stays reachable and clears fixed action docks", async () => {
  const styles = await read("n3xra-records/styles.css");

  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.records-mobile-tabbar \{[\s\S]*position: fixed;[\s\S]*grid-template-columns: repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.records-mobile-tabbar a \{[\s\S]*min-height: 52px;/);
  assert.match(styles, /\.records-mobile-shell-ready \.topbar \{[\s\S]*position: sticky;/);
  assert.match(styles, /\.records-mobile-shell-ready \.topbar-logout,[\s\S]*\.records-mobile-shell-ready \.menu-toggle,[\s\S]*display: none !important;/);
  assert.match(styles, /\.meeting-workspace-actions\.is-revealed:not\(\.is-docked\),[\s\S]*\.document-editor-actions\.is-revealed:not\(\.is-docked\)[\s\S]*bottom: calc\(var\(--records-mobile-tabbar-height\)/);
});

test("every signed-in Records workspace loads the current shared shell and mobile styles", async () => {
  const routes = [
    "account/index.html",
    "library/index.html",
    "meeting-notes/index.html",
    "documents.html",
    "messages.html",
    "storage.html",
    "all-meeting-notes/index.html",
    "all-recordings.html",
    "recordings.html",
    "dashboard.html",
    "files.html",
  ];
  const pages = await Promise.all(routes.map((route) => read(`n3xra-records/${route}`)));

  pages.forEach((page, index) => {
    assert.match(page, /styles\.css\?v=20260820-mobile-shell/, `${routes[index]} must load current mobile styles`);
    assert.match(page, /desktop-shell\.js\?v=20260820-mobile-shell/, `${routes[index]} must load current mobile shell`);
  });
});
