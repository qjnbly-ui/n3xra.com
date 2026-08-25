import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");
const livePreview = require("../../api/_website-live-preview.js");
const previewHandler = require("../../api/website-change-live-preview.js");

test("live preview bearer tokens are expiring and usable only after the preview is ready", () => {
  const token = "a-secure-preview-token";
  const run = {
    preview_mode: "n3xra_live",
    state: "preview_ready",
    preview_token_hash: livePreview.digest(token),
    preview_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(livePreview.validRunToken(run, token, "view"), true);
  assert.equal(livePreview.validRunToken({ ...run, state: "coding" }, token, "view"), false);
  assert.equal(livePreview.validRunToken({ ...run, preview_expires_at: new Date(Date.now() - 1).toISOString() }, token, "view"), false);
  assert.equal(livePreview.validRunToken(run, "wrong-token", "view"), false);
});

test("live preview storage rejects traversal and rewrites root assets into the isolated preview path", () => {
  assert.equal(livePreview.safeRelativePath("assets/site.css"), "assets/site.css");
  assert.equal(livePreview.safeRelativePath("../secret"), "");
  assert.equal(livePreview.safeRelativePath("assets//site.css"), "");
  const html = previewHandler._internal.rewriteText(Buffer.from('<html><head></head><body><img src="/logo.png"></body></html>'), "text/html; charset=utf-8", "/website-preview/run/token/").toString();
  assert.match(html, /<base href="\/website-preview\/run\/token\/">/);
  assert.match(html, /src="\/website-preview\/run\/token\/logo[.]png"/);
  assert.equal(livePreview.safeLiveOrigin("https://www.ruthobenchainrc.com/path"), "https://www.ruthobenchainrc.com");
  assert.equal(livePreview.safeLiveOrigin("http://127.0.0.1/private"), "");
  assert.equal(previewHandler._internal.deletedByManifest(Buffer.from('{"changes":[{"status":"D","path":"old.html"}]}'), "old.html"), true);
});

test("Fast Live Preview auto-starts per website and preserves the Vercel fallback", async () => {
  const [migration, autoStartMigration, adminRetryMigration, workflow, edge, intake, callback, admin, settings] = await Promise.all([
    projectFile("supabase/migrations/20260825025020_add_n3xra_live_website_previews.sql"),
    projectFile("supabase/migrations/20260825040000_auto_start_client_fast_previews.sql"),
    projectFile("supabase/migrations/20260825041500_allow_admin_immediate_failed_preview_retry.sql"),
    projectFile(".github/workflows/website-change-preview.yml"),
    projectFile("supabase/functions/website-change-automation/index.ts"),
    projectFile("api/website-change-intake.js"),
    projectFile("api/website-change-run-callback.js"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("n3xra-admin/website-portal/website-portal-admin.js"),
  ]);
  assert.match(migration, /live_preview_enabled boolean not null default false/);
  assert.match(migration, /website-change-previews[\s\S]*false/);
  assert.match(workflow, /preview\.mode == 'vercel'[\s\S]*git push origin/);
  assert.match(workflow, /Build N3XRA Live Preview/);
  assert.match(workflow, /liveAssetFallback/);
  assert.doesNotMatch(workflow, /rsync -a [.][/] [^\n]*n3xra-static-site/);
  assert.match(workflow, /client_payload\.preview\.mode/);
  assert.match(edge, /createLivePreviewCommit/);
  assert.match(edge, /baseCommitData[.]tree[.]sha/);
  assert.match(edge, /previewMode === "n3xra_live"/);
  assert.match(edge, /clientMembership/);
  assert.match(edge, /client_payload: \{ run_id:[\s\S]*preview: \{ mode:/);
  assert.match(intake, /startFastPreview/);
  assert.match(intake, /website\.live_preview_enabled/);
  assert.match(autoStartMigration, /input_preview_mode text/);
  assert.match(adminRetryMigration, /failure_stage = ''queued'' or actor_is_admin/);
  assert.match(callback, /validLivePreviewUrl/);
  assert.match(callback, /preview_token_hash/);
  assert.match(admin, /Fast Live Preview/);
  assert.match(admin, /value="vercel"/);
  assert.match(settings, /portal-live-preview-enabled/);
});
