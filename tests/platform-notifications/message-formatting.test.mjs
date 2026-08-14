import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  notificationMessageToPlainText,
  renderNotificationMessageHtml,
} from "../../account/notifications/notification-message-format.js";

const composerHtmlPath = new URL("../../account/notifications/index.html", import.meta.url);
const composerJsPath = new URL("../../account/notifications/notifications.js", import.meta.url);
const platformAdminPath = new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url);

test("notification messages render the supported structure and escape raw HTML", () => {
  const html = renderNotificationMessageHtml([
    "## Client portal update",
    "",
    "This is **important** and _ready_ for review.",
    "",
    "- Upload files",
    "- Request changes",
    "",
    "[Open your portal](https://n3xra.com/account)",
    "<script>alert('unsafe')</script>",
  ].join("\n"));

  assert.match(html, /<h2[^>]*>Client portal update<\/h2>/);
  assert.match(html, /<strong>important<\/strong>/);
  assert.match(html, /<em>ready<\/em>/);
  assert.match(html, /<ul[^>]*>[\s\S]*<li[^>]*>Upload files<\/li>/);
  assert.match(html, /href="https:\/\/n3xra\.com\/account"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("notification formatting becomes readable plain text for SMS and email fallbacks", () => {
  const text = notificationMessageToPlainText([
    "## Update",
    "**Important** details",
    "- Upload files",
    "[Open portal](https://n3xra.com/account)",
  ].join("\n"));

  assert.equal(text, [
    "Update",
    "Important details",
    "• Upload files",
    "Open portal (https://n3xra.com/account)",
  ].join("\n"));
});

test("the admin composer exposes structure tools and the sender uses the shared safe formatter", async () => {
  const [html, composerJs, platformAdmin] = await Promise.all([
    readFile(composerHtmlPath, "utf8"),
    readFile(composerJsPath, "utf8"),
    readFile(platformAdminPath, "utf8"),
  ]);

  for (const format of ["heading", "bold", "italic", "bulleted-list", "numbered-list", "quote", "link"]) {
    assert.match(html, new RegExp(`data-notification-format="${format}"`));
  }
  assert.match(composerJs, /renderNotificationMessageHtml\(payload\.message\)/);
  assert.match(platformAdmin, /renderNotificationMessageHtml\(options\.message\)/);
  assert.match(platformAdmin, /notificationMessageToPlainText\(options\.message\)/);
});
