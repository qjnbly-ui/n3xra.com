import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("website overview sends creation and editing to the dedicated page", async () => {
  const [html, controller] = await Promise.all([
    read("n3xra-admin/websites/index.html"),
    read("n3xra-admin/websites/websites-admin.js"),
  ]);

  assert.match(html, /href="\/n3xra-admin\/websites\/new\/"[^>]*>Add website<\/a>/);
  assert.doesNotMatch(html, /id="site-form"|New managed site|Create website record/);
  assert.match(controller, /editSiteButton\.href = `\/n3xra-admin\/websites\/new\/\?website=/);
  assert.doesNotMatch(controller, /from\("client_websites"\)\.insert/);
});

test("manual website creation supplies tenant identity and opens one flexible build workflow", async () => {
  const [html, controller] = await Promise.all([
    read("n3xra-admin/websites/new/index.html"),
    read("n3xra-admin/websites/new/new-website.js"),
  ]);

  assert.match(html, /id="portal-slug"/);
  assert.match(html, /id="organization-id"/);
  assert.match(html, /<option value="draft" selected>Draft — recommended<\/option>/);
  assert.match(html, /Start now and add business steps later/);
  assert.match(html, /id="provision-github"/);
  assert.match(html, /id="provision-vercel"/);
  assert.match(controller, /portal_slug: portalSlug/);
  assert.match(controller, /organization_id: organizationInput\.value \|\| null/);
  assert.match(controller, /created_by_user_id: currentUser\.id/);
  assert.match(controller, /from\("client_websites"\)\.insert/);
  assert.match(controller, /action: "create-direct-website-project"/);
  assert.match(controller, /action: "provision-website-github"/);
  assert.match(controller, /action: "provision-website-vercel"/);
  assert.match(controller, /await error\.context\.json\(\)/);
  assert.match(controller, /data\?\.error \|\| functionError \|\| error\?\.message/);
  assert.match(controller, /if \(pageTitle\) pageTitle\.textContent = "Edit website"/);
  assert.match(controller, /if \(workspaceTitle\) workspaceTitle\.textContent = `Edit \$\{website\.name\}`/);
  assert.match(html, /Add proposal, onboarding, or client access later/);
  assert.match(html, /new-website\.js\?v=4/);
});

test("direct builds remain attachable to later client work without bypassing trusted provisioning", async () => {
  const [migration, edgeFunction, projectController, ownerClaimMigration] = await Promise.all([
    read("supabase/migrations/20260826011524_direct_website_build_provisioning.sql"),
    read("supabase/functions/website-project-admin/index.ts"),
    read("n3xra-admin/projects/projects-admin.js"),
    read("supabase/migrations/20260901165615_allow_direct_website_project_owner_claim.sql"),
  ]);

  assert.match(migration, /alter column client_user_id drop not null/);
  assert.match(migration, /alter table public\.website_provisioning_runs[\s\S]*alter column organization_id drop not null/);
  assert.match(migration, /if project_record\.source = 'proposal'/);
  assert.match(migration, /elsif project_record\.source <> 'existing_website'/);
  assert.match(migration, /website_record\.organization_id is null and project_record\.source = 'proposal'/);
  assert.match(migration, /request_claims[\s\S]*service_role/);
  assert.match(migration, /revoke all on function public\.claim_website_github_provisioning[\s\S]*authenticated/);
  assert.match(edgeFunction, /action === "create-direct-website-project"/);
  assert.match(edgeFunction, /source: "existing_website"/);
  assert.match(edgeFunction, /current_stage: "production"/);
  assert.match(edgeFunction, /Connect a client account before creating a proposal/);
  assert.match(projectController, /const directBuild = selectedProject\?\.source === "existing_website"/);
});

test("the dedicated page remains available to website operations administrators", async () => {
  const [session, workspace] = await Promise.all([
    read("account/admin/admin-session.js"),
    read("n3xra-admin/website-admin-workspace.js"),
  ]);

  assert.match(session, /"\/n3xra-admin\/websites\/new\/"/);
  assert.match(workspace, /"\/n3xra-admin\/websites\/new\/": \{ key: "new"/);
});
