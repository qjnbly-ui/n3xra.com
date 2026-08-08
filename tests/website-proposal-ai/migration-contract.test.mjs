import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../../supabase/migrations/20260808213831_website_proposal_copilot.sql", import.meta.url), "utf8");

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
