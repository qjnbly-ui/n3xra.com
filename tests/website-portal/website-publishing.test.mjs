import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("website publishing is tenant-owned and protected by RLS", async () => {
  const migration = await projectFile("supabase/migrations/20260830203919_website_publishing_foundation.sql");
  for (const table of ["website_publishing_settings", "website_posts", "website_post_media", "website_story_submissions"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon`));
  }
  assert.match(migration, /can_edit_client_website\(website_id\)/);
  assert.match(migration, /public_submissions_auto_publish boolean not null default false/);
  assert.match(migration, /'publishing'/);
  assert.match(migration, /roots-and-relics-be7315/);
});

test("portal publishing offers the shared file library and direct CDN upload", async () => {
  const [page, adminPage, source, navigation, clientContext, adminContext] = await Promise.all([
    projectFile("client-portal/publishing/index.html"),
    projectFile("n3xra-admin/publishing/index.html"),
    projectFile("src/client-portal/publishing.ts"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("n3xra-admin/website-admin-context.js"),
  ]);
  assert.match(page, /Choose from Files/);
  assert.match(page, /Upload New/);
  assert.match(page, /Share Your Find/);
  assert.match(adminPage, /Share Your Find approvals/);
  assert.match(adminPage, /data-publishing-mode="admin"/);
  assert.match(source, /from\("website_assets"\)/);
  assert.match(source, /website_asset_versions/);
  assert.match(source, /\/api\/client-website-publishing/);
  assert.match(source, /website_story_submissions/);
  assert.match(source, /category: "journal"/);
  assert.match(source, /delete_story_submission/);
  assert.match(source, /data-publishing-view/);
  assert.match(page, /Community inbox/);
  assert.match(page, /Add new post/);
  assert.match(page, /id="post-form" hidden/);
  assert.match(navigation, /Website Publishing/);
  assert.match(clientContext, /Website Publishing/);
  assert.match(adminContext, /Website Publishing/);
});

test("automatic CDN publication is limited to authenticated website editors", async () => {
  const endpoint = await projectFile("api/client-website-publishing.js");
  assert.match(endpoint, /verifyAuthenticatedRequest/);
  assert.match(endpoint, /role=in\.\(owner,editor\)/);
  assert.match(endpoint, /feature_key=eq\.publishing/);
  assert.match(endpoint, /client_auto_publish/);
  assert.match(endpoint, /website-assets-private/);
  assert.match(endpoint, /website-assets-public/);
  assert.match(endpoint, /deleteStorageObject/);
  assert.match(endpoint, /Delete the published post before deleting its original submission/);
  assert.equal(require("../../api/client-website-publishing.js").safeFilename(" My Best Photo!!.JPG "), "my-best-photo-.jpg");
  assert.equal(require("../../api/client-website-publishing.js").imageMimeType("visitor-photo.JPG", null), "image/jpeg");
  assert.deepEqual(
    require("../../api/client-website-publishing.js").publicStorageLocation("https://example.supabase.co/storage/v1/object/public/website-assets-public/site/photo.jpg"),
    { bucket: "website-assets-public", path: "site/photo.jpg" },
  );
});

test("storage deletion does not claim to send an empty JSON body", async () => {
  const helper = require("../../api/_website-proposal-ai-supabase.js");
  const originalFetch = globalThis.fetch;
  let requestOptions;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.equal(await helper.deleteStorageObject("website-assets-private", "site/customer-photo.jpg"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requestOptions.method, "DELETE");
  assert.equal(requestOptions.body, undefined);
  assert.equal(requestOptions.headers["Content-Type"], undefined);
});

test("the public feed exposes published CDN media only", () => {
  const { mediaItem } = require("../../api/website-content-feed.js");
  const row = { id: "media", alt_text: "An antique chest", caption: "Found a home" };
  assert.equal(mediaItem(row, { status: "pending_review", public_url: "https://example.com/private.jpg" }), null);
  const item = mediaItem(row, { status: "published", public_url: "https://vdbjlgmbpykjblprqnak.supabase.co/storage/v1/object/public/website-assets-public/site/photo.jpg", mime_type: "image/jpeg" });
  assert.equal(item.url.includes("website-assets-public"), true);
  assert.equal(item.altText, "An antique chest");
});

test("visitor stories use private signed uploads and cannot auto-publish", async () => {
  const [endpoint, page, siteScript] = await Promise.all([
    projectFile("api/website-story-submission.js"),
    projectFile("../Roots and Relics/src/pages/from-the-greenhouse/index.astro").catch(() => ""),
    projectFile("../Roots and Relics/src/scripts/from-the-greenhouse.ts").catch(() => ""),
  ]);
  assert.match(endpoint, /createSignedStorageUpload/);
  assert.match(endpoint, /website-assets-private/);
  assert.match(endpoint, /status: "pending_review"/);
  assert.match(endpoint, /category: "visitor_submission"/);
  assert.equal(require("../../api/website-story-submission.js").imageMimeType("visitor-photo.webp"), "image/webp");
  assert.doesNotMatch(endpoint, /status: "published"/);
  assert.match(endpoint, /permissionToPublish/);
  assert.match(endpoint, /rateLimit/);
  if (page) assert.match(page, /Large photographs are resized automatically before uploading/);
  if (siteScript) {
    assert.match(siteScript, /https:\/\/www\.n3xra\.com/);
    assert.doesNotMatch(siteScript, /https:\/\/n3xra\.com\/api/);
  }
});
