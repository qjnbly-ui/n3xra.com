import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("the client Support view is a request and work tracker", async () => {
  const [html, source, styles] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("src/client-portal/support-workspace.ts"),
    projectFile("client-portal/support-workspace.css"),
  ]);

  assert.match(html, /What should we work on\?/);
  assert.match(html, /id="client-support-form"/);
  assert.match(html, /Site analytics/);
  assert.match(html, /Communications/);
  assert.match(html, /data-client-support-filter="active"/);
  assert.match(html, /data-client-support-filter="past"/);
  assert.match(source, /platform_support_requests/);
  assert.match(source, /platform_support_request_updates/);
  assert.match(source, /Started by N3XRA/);
  assert.match(source, /day\$\{days === 1 \? "" : "s"\} remaining/);
  assert.doesNotMatch(source, /internal_notes/);
  assert.match(styles, /client-support-update/);
  assert.match(styles, /\.client-support-form\{[^}]*background:#fff/);
  assert.doesNotMatch(styles, /\.client-support-form\{[^}]*background:var\(--portal-deep\)/);
});

test("client-visible support records are tenant-scoped and keep internal notes private", async () => {
  const migration = await projectFile("supabase/migrations/20260816044014_client_visible_support_work.sql");

  assert.match(migration, /platform_support_requests_client_select/);
  assert.match(migration, /public\.can_view_client_website\(website_id\)/);
  assert.match(migration, /requester_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /client_visible = true/);
  assert.match(migration, /source = 'client_portal'/);
  assert.doesNotMatch(migration, /grant select on public\.platform_support_requests to authenticated/);
  assert.match(migration, /grant select \([\s\S]*estimated_completion_at[\s\S]*\) on public\.platform_support_requests to authenticated/);
  assert.match(migration, /grant insert \([\s\S]*requester_user_id[\s\S]*origin[\s\S]*\) on public\.platform_support_requests to authenticated/);
  assert.doesNotMatch(migration.match(/grant insert \([\s\S]*?\) on public\.platform_support_requests to authenticated/)?.[0] || "", /internal_notes/);
  assert.match(migration, /visible_to_client = true/);
});

test("administrators can start work and publish estimates and timeline notes", async () => {
  const [html, controller, edgeFunction] = await Promise.all([
    projectFile("account/admin/support/index.html"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);

  assert.match(html, /Start client work/);
  assert.match(html, /First client-visible update/);
  assert.match(controller, /create-support-work/);
  assert.match(controller, /estimatedCompletionAt/);
  assert.match(controller, /New client-visible update/);
  assert.match(edgeFunction, /action === "create-support-work"/);
  assert.match(edgeFunction, /origin: "n3xra"/);
  assert.match(edgeFunction, /platform_support_request_updates/);
});
