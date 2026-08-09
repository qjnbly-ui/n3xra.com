import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../../supabase/migrations/20260808213831_website_proposal_copilot.sql", import.meta.url), "utf8");
const deletionRepair = fs.readFileSync(new URL("../../supabase/migrations/20260809053401_preserve_proposal_ai_history_on_draft_delete.sql", import.meta.url), "utf8");
const retention = fs.readFileSync(new URL("../../supabase/migrations/20260809060052_proposal_ai_run_retention.sql", import.meta.url), "utf8");
const adminReview = fs.readFileSync(new URL("../../supabase/migrations/20260809062321_allow_admin_reviewed_proposal_ai_changes.sql", import.meta.url), "utf8");

test("migration keeps AI runs server-managed and RPCs guarded", () => {
  assert.match(migration, /alter table public\.website_proposal_ai_runs enable row level security/i);
  assert.match(migration, /revoke all on public\.website_proposal_ai_runs from authenticated/i);
  assert.match(migration, /grant all on public\.website_proposal_ai_runs to service_role/i);
  assert.match(migration, /if auth\.uid\(\) is null or not public\.is_platform_admin\(\)/i);
  assert.match(migration, /security definer[\s\S]+set search_path = pg_catalog, public, extensions/i);
});

test("revision token covers proposal, full version, and deterministically ordered line items", () => {
  assert.match(migration, /'title', proposal\.title[\s\S]+'status', proposal\.status[\s\S]+'current_version_id', proposal\.current_version_id/);
  assert.match(migration, /'proposal', proposal_value/);
  assert.match(migration, /'version', version_value/);
  assert.match(migration, /'line_items', line_item_values/);
  assert.match(migration, /order by item\.sort_order, item\.created_at, item\.id/i);
  assert.match(migration, /extensions\.digest[\s\S]+sha256/i);
});

test("manual and AI revision paths share the private atomic copy helper", () => {
  assert.match(migration, /private\.copy_website_proposal_version_to_draft\(target_version_id, auth\.uid\(\)\)/i);
  assert.match(migration, /private\.copy_website_proposal_version_to_draft\(base_version\.id, auth\.uid\(\)\)/i);
});

test("AI audit identifiers do not block guarded draft-version deletion", () => {
  assert.match(deletionRepair, /drop constraint if exists website_proposal_ai_runs_base_version_id_fkey/i);
  assert.match(deletionRepair, /drop constraint if exists website_proposal_ai_runs_applied_version_id_fkey/i);
  assert.doesNotMatch(deletionRepair, /delete from public\.website_proposal_ai_runs/i);
});

test("retention keeps applied changes while cleaning disposable draft attempts", () => {
  assert.match(retention, /delete from public\.website_proposal_ai_runs[\s\S]+base_version_id = target_version\.id[\s\S]+status <> 'applied' or accepted_count = 0/i);
  assert.match(retention, /if old\.status = 'applied'[\s\S]+old\.accepted_count > 0[\s\S]+pg_trigger_depth\(\) <= 1/i);
  assert.match(retention, /Applied Proposal AI history cannot be removed independently/i);
});

test("deleting the proposal cascades all of its AI history", () => {
  assert.match(retention, /foreign key \(proposal_id\)[\s\S]+references public\.website_proposals \(id\)[\s\S]+on delete cascade/i);
});

test("the revised draft deletion RPC remains admin-only", () => {
  assert.match(retention, /auth\.uid\(\) is null or not public\.is_platform_admin\(\)/i);
  assert.match(retention, /security definer[\s\S]+set search_path = pg_catalog, public/i);
  assert.match(retention, /revoke all on function public\.delete_website_proposal_draft_version\(uuid\) from anon/i);
  assert.match(retention, /grant execute on function public\.delete_website_proposal_draft_version\(uuid\) to authenticated/i);
});

test("admin approval, not evidence matching, controls protected suggestions", () => {
  assert.match(adminReview, /create or replace function private\.website_proposal_ai_operation_is_protected/i);
  assert.match(adminReview, /select false/i);
  assert.match(adminReview, /source evidence is advisory rather than a database veto/i);
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_platform_admin\(\)/i);
  assert.match(migration, /resulting discount and deposit must be non-negative/i);
  assert.match(migration, /deposit exceeds the recalculated proposal total/i);
});
