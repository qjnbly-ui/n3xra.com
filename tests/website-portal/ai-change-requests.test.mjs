import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("the client portal reviews AI-assisted website changes before submission", async () => {
  const [html, source, styles] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("src/client-portal/support-workspace.ts"),
    projectFile("client-portal/support-workspace.css"),
  ]);
  assert.match(html, /Website Change Assistant/);
  assert.match(html, /Nothing changes yet\./);
  assert.match(html, /Send for review/);
  assert.match(source, /\/api\/website-change-intake/);
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(source, /action: "analyze" \| "submit"/);
  assert.match(styles, /client-change-review/);
});

test("AI-assisted change requests use server authorization and a fixed review state", async () => {
  const endpoint = await projectFile("api/website-change-intake.js");
  assert.match(endpoint, /IdentityResolver/);
  assert.match(endpoint, /website_members\?select=website_id/);
  assert.match(endpoint, /status=eq\.active/);
  assert.match(endpoint, /automation_status: "awaiting_review"/);
  assert.match(endpoint, /intake_mode: "ai_assisted"/);
  assert.doesNotMatch(endpoint, /github|vercel|publish/i);
});

test("AI request metadata is tenant-scoped by existing RLS and not client-writable", async () => {
  const migration = await projectFile("supabase/migrations/20260824051218_ai_website_change_requests.sql");
  assert.match(migration, /automation_status.*awaiting_review/s);
  assert.match(migration, /grant select \(/);
  assert.doesNotMatch(migration, /grant insert \(/);
  assert.doesNotMatch(migration, /create policy/);
  assert.match(migration, /where intake_mode = 'ai_assisted'/);
});

test("the admin queue displays assistant classification without offering execution", async () => {
  const [controller, edgeFunction] = await Promise.all([
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);
  assert.match(controller, /Organized for review/);
  assert.match(controller, /did not edit code or publish anything/);
  assert.match(controller, /request\.automation_status/);
  assert.match(edgeFunction, /assistant_summary/);
});
