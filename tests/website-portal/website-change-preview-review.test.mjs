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
  assert.match(workflow, /allow-bot-users: n3xra-website-provisioner/);
  assert.match(workflow, /git switch -c "\$TARGET_BRANCH"/);
  assert.match(workflow, /git push origin "\$TARGET_BRANCH"/);
  assert.doesNotMatch(workflow, /git push origin main/);
  assert.match(workflow, /Do not modify \.github, vercel\.json/);
  assert.match(workflow, /environment_url/);
  assert.match(workflow, /progressStage/);
  assert.match(workflow, /codex_running/);
  assert.match(workflow, /validating/);
  assert.match(workflow, /deploying/);
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

test("clients submit for review while admins control preview creation and merge approval", async () => {
  const [client, admin, adminLoader] = await Promise.all([
    projectFile("src/client-portal/support-workspace.ts"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);
  assert.match(client, /Open private preview/);
  assert.match(client, /Nothing is live until N3XRA approves it/);
  assert.match(client, /N3XRA will review it before starting a private AI preview/);
  assert.doesNotMatch(client, /action: "start-preview"/);
  assert.doesNotMatch(client, /data-retry-preview/);
  assert.doesNotMatch(client, /approve-merge/);
  assert.match(client, /The work continues securely in GitHub/);
  assert.match(client, /client-change-progress/);
  assert.doesNotMatch(client, /Attempt \$\{escapeHtml\(changeRun\.attempt_number\)\}/);
  assert.match(admin, /Approve &amp; Start AI Preview/);
  assert.match(admin, /invokeWebsiteAutomation\("start-preview"/);
  assert.match(admin, /Approve and merge to main/);
  assert.match(admin, /confirmAdminAction/);
  assert.match(admin, /View GitHub workflow/);
  assert.match(admin, /Progress will update automatically/);
  assert.match(adminLoader, /changeRuns:/);
});

test("only an active platform administrator can start an AI preview", async () => {
  const [edge, migration] = await Promise.all([
    projectFile("supabase/functions/website-change-automation/index.ts"),
    projectFile("supabase/migrations/20260824171623_gate_website_ai_preview_and_use_connected_repository.sql"),
  ]);
  assert.match(edge, /action !== "start-preview"/);
  assert.match(edge, /previewAdmin[\s\S]*platform_admins[\s\S]*eq\("status", "active"\)/);
  assert.match(edge, /Only an active N3XRA platform administrator can start an AI preview/);
  assert.match(migration, /platform_admins administrator[\s\S]*administrator\.status = 'active'/);
  assert.match(migration, /website_repositories repository[\s\S]*repository\.provider = 'github'/);
  assert.match(migration, /coalesce\([\s\S]*website_record\.repository_full_name/);
});

test("the preview callback is one-time and accepts only Vercel preview URLs", async () => {
  const callback = await projectFile("api/website-change-run-callback.js");
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /callback_expires_at/);
  assert.match(callback, /vercel\[\.\]app/);
  assert.match(callback, /callback_token_hash: "0"\.repeat\(64\)/);
  assert.match(callback, /sendWebsiteChangeClientEmail/);
  assert.match(callback, /preview_email_sent_at/);
  assert.match(callback, /Preview-ready email failed/);
  assert.match(callback, /progressStage/);
  assert.match(callback, /progress_updated_at/);
  assert.match(callback, /failure_stage/);
});

test("progress tracking is tenant-readable without querying protected support rows", async () => {
  const migration = await projectFile("supabase/migrations/20260824173413_add_website_change_progress_tracking.sql");
  assert.match(migration, /target_repository/);
  assert.match(migration, /workflow_url/);
  assert.match(migration, /progress_stage/);
  assert.match(migration, /progress_message/);
  assert.match(migration, /callback_expires_at[\s\S]*interval '60 minutes'/);
  assert.match(migration, /using \(public\.can_view_client_website\(website_id\)\)/);
  assert.doesNotMatch(migration, /exists \(select 1 from public\.platform_support_requests/);
});

test("client emails are tracked for preview-ready and published milestones", async () => {
  const [migration, edge] = await Promise.all([
    projectFile("supabase/migrations/20260824172433_track_website_change_client_emails.sql"),
    projectFile("supabase/functions/website-change-automation/index.ts"),
  ]);
  assert.match(migration, /preview_email_sent_at/);
  assert.match(migration, /published_email_sent_at/);
  assert.match(migration, /client_email_delivery_error/);
  assert.match(edge, /Idempotency-Key.*website-change\/\$\{run\.id\}\/published/s);
  assert.match(edge, /sendPublishedEmail/);
  assert.match(edge, /published_email_sent_at/);
  assert.match(edge, /Published website email failed/);
});
