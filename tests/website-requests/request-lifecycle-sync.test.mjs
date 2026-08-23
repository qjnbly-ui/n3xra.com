import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requestAdmin = await readFile(new URL("../../n3xra-admin/requests/requests-admin.js", import.meta.url), "utf8");
const platformAdmin = await readFile(new URL("../../supabase/functions/platform-admin/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20260823225052_sync_website_request_project_lifecycle.sql", import.meta.url), "utf8");

test("request admin keeps proposal lifecycle statuses selectable", () => {
  assert.match(requestAdmin, /"proposal_approved"/);
  assert.match(requestAdmin, /"proposal_changes_requested"/);
  assert.match(requestAdmin, /"proposal_declined"/);
  assert.match(requestAdmin, /"converted"/);
});

test("request workspace returns canonical website project state", () => {
  assert.match(platformAdmin, /from\("website_projects"\)\.select\("id,request_id,managed_website_id,status,completed_at"\)/);
  assert.match(platformAdmin, /projects: projectsResult\.data \|\| \[\]/);
  assert.match(requestAdmin, /project\?\.managed_website_id/);
  assert.match(requestAdmin, /"Completed website"/);
  assert.match(requestAdmin, /"Existing website at intake"/);
});

test("database lifecycle converts project-backed requests without rewriting history", () => {
  assert.match(migration, /after insert on public\.website_projects/);
  assert.match(migration, /new\.status = 'proposal_approved'/);
  assert.match(migration, /new\.status := 'converted'/);
  assert.match(migration, /status not in \('declined', 'proposal_declined', 'archived'\)/);
});
