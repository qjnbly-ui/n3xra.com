import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("preview runs are tenant-visible, service-controlled, and quota limited", async () => {
  const [migration, indexes] = await Promise.all([
    projectFile("supabase/migrations/20260824052756_client_preview_review.sql"),
    projectFile("supabase/migrations/20260824055116_website_change_run_actor_indexes.sql"),
  ]);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant select \(/);
  assert.match(migration, /grant all on public\.website_change_runs to service_role/);
  assert.match(migration, /attempt_count >= 3/);
  assert.match(migration, /monthly_count >= 10/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /website_change_runs_one_active_idx/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*authenticated/i);
  assert.match(indexes, /requested_by_user_id/);
  assert.match(indexes, /approved_by_user_id/);
});

test("Codex works only on a request branch and reports the Vercel preview", async () => {
  const workflow = await projectFile(".github/workflows/website-change-preview.yml");
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Verify GitHub App repository access/);
  assert.match(workflow, /Verify restricted OpenAI key/);
  assert.match(workflow, /openai\/codex-action@v1/);
  assert.match(workflow, /git switch -c "\$TARGET_BRANCH"/);
  assert.match(workflow, /git push origin "\$TARGET_BRANCH"/);
  assert.doesNotMatch(workflow, /git push origin main/);
  assert.match(workflow, /Do not modify \.github, vercel\.json/);
  assert.match(workflow, /environment_url/);
  assert.match(workflow, /Report an unsuccessful preview workflow/);
});

test("the automation edge separates client preview creation from admin merge approval", async () => {
  const edge = await projectFile("supabase/functions/website-change-automation/index.ts");
  assert.match(edge, /action === "approve-merge"/);
  assert.match(edge, /platform_admins/);
  assert.match(edge, /eq\("status", "active"\)/);
  assert.match(edge, /branches\/\$\{encodeURIComponent\(run\.branch_name\)\}/);
  assert.match(edge, /branchData\?\.commit\?\.sha !== run\.head_sha/);
  assert.match(edge, /repos\/\$\{encodeURIComponent\(owner\)\}\/\$\{encodeURIComponent\(repo\)\}\/merges/);
  assert.match(edge, /action !== "start-preview"/);
});

test("client preview links and the admin-only approval are present in their respective portals", async () => {
  const [client, admin, adminLoader] = await Promise.all([
    projectFile("src/client-portal/support-workspace.ts"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);
  assert.match(client, /Open private preview/);
  assert.match(client, /Nothing is live until N3XRA approves it/);
  assert.match(client, /action: "start-preview"/);
  assert.match(client, /Try preview again/);
  assert.doesNotMatch(client, /approve-merge/);
  assert.match(admin, /Approve and merge to main/);
  assert.match(admin, /confirmAdminAction/);
  assert.match(adminLoader, /changeRuns:/);
});

test("the preview callback is one-time and accepts only Vercel preview URLs", async () => {
  const callback = await projectFile("api/website-change-run-callback.js");
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /callback_expires_at/);
  assert.match(callback, /vercel\[\.\]app/);
  assert.match(callback, /callback_token_hash: "0"\.repeat\(64\)/);
});
