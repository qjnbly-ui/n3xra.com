import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("provisioning state is client-readable but service-role mutable", async () => {
  const migration = await read("supabase/migrations/20260824005512_website_github_provisioning_foundation.sql");

  assert.match(migration, /create table public\.website_provisioning_runs/);
  assert.match(migration, /unique \(project_id\)/);
  assert.match(migration, /unique \(website_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.website_provisioning_runs from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.website_provisioning_runs to authenticated/);
  assert.match(migration, /can_view_client_website\(website_id\)/);
  assert.match(migration, /grant all on public\.website_provisioning_runs to service_role/);
});

test("database claim enforces every lifecycle prerequisite and a retry lease", async () => {
  const migration = await read("supabase/migrations/20260824005512_website_github_provisioning_foundation.sql");
  const claim = migration.match(/create or replace function public\.claim_website_github_provisioning[\s\S]*?(?=create or replace function public\.finish_website_github_provisioning)/)?.[0] || "";

  assert.match(claim, /request_claims[\s\S]*service_role/);
  assert.match(claim, /project_record\.source <> 'proposal'/);
  assert.match(claim, /proposal\.status = 'approved'/);
  assert.match(claim, /onboarding\.status = 'approved'/);
  assert.match(claim, /managed_website_id is null/);
  assert.match(claim, /organization_id is null/);
  assert.match(claim, /lease_expires_at > now\(\)/);
  assert.match(claim, /attempt_count = attempt_count \+ 1/);
  assert.match(migration, /revoke all on function public\.claim_website_github_provisioning[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_website_github_provisioning[\s\S]*to service_role/);
});

test("successful completion records repository ownership atomically", async () => {
  const migration = await read("supabase/migrations/20260824005512_website_github_provisioning_foundation.sql");
  const finish = migration.match(/create or replace function public\.finish_website_github_provisioning[\s\S]*/)?.[0] || "";

  assert.match(finish, /run\.lease_token = input_lease_token/);
  assert.match(finish, /insert into public\.website_repositories/);
  assert.match(finish, /'private'/);
  assert.match(finish, /'n3xra_managed'/);
  assert.match(finish, /update public\.client_websites[\s\S]*repository_full_name/);
  assert.match(finish, /input_repository_default_branch/);
  assert.match(finish, /status = 'github_ready'/);
  assert.match(finish, /status = 'failed'/);
  assert.match(migration, /grant execute on function public\.finish_website_github_provisioning[\s\S]*to service_role/);
});

test("trusted project action creates one private repository from the configured template", async () => {
  const edgeFunction = await read("supabase/functions/website-project-admin/index.ts");
  const action = edgeFunction.match(/if \(action === "provision-website-github"\)[\s\S]*?(?=\n    if \(\["complete-website-project")/)?.[0] || "";

  assert.match(edgeFunction, /GITHUB_APP_PRIVATE_KEY/);
  assert.match(edgeFunction, /RSASSA-PKCS1-v1_5/);
  assert.match(edgeFunction, /\/access_tokens/);
  assert.match(action, /claim_website_github_provisioning/);
  assert.match(action, /\/generate/);
  assert.match(action, /private: true/);
  assert.match(action, /include_all_branches: false/);
  assert.match(action, /finish_website_github_provisioning/);
  assert.match(action, /attempt_count/);
  assert.doesNotMatch(action, /vercel|domain|dns/i);
});

test("admin and client workspaces expose the appropriate provisioning controls", async () => {
  const [adminHtml, adminController, clientHtml, clientController] = await Promise.all([
    read("n3xra-admin/projects/index.html"),
    read("n3xra-admin/projects/projects-admin.js"),
    read("project-workspace/index.html"),
    read("project-workspace/project-workspace.js"),
  ]);

  assert.match(adminHtml, /Provision private GitHub repository/);
  assert.match(adminController, /proposal\?\.status === "approved"/);
  assert.match(adminController, /onboarding\?\.status === "approved"/);
  assert.match(adminController, /lease_expires_at/);
  assert.match(adminController, /safe to retry/);
  assert.match(adminController, /action: "provision-website-github"/);
  assert.match(clientHtml, /id="project-provisioning"/);
  assert.match(clientController, /website_provisioning_runs/);
  assert.match(clientController, /client_message/);
});
