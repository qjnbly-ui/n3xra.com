import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Vercel preview state extends the existing retry-safe provisioning record", async () => {
  const migration = await read("supabase/migrations/20260824024105_website_vercel_preview_provisioning.sql");
  assert.match(migration, /alter table public\.website_provisioning_runs/);
  assert.match(migration, /vercel_project_id text/);
  assert.match(migration, /preview_url text/);
  assert.match(migration, /status in \([\s\S]*'vercel_creating'[\s\S]*'vercel_ready'[\s\S]*'vercel_failed'/);
  assert.match(migration, /create or replace function public\.claim_website_vercel_provisioning/);
  assert.match(migration, /run_record\.repository_full_name is null/);
  assert.match(migration, /vercel_lease_expires_at > now\(\)/);
  assert.match(migration, /create or replace function public\.finish_website_vercel_provisioning/);
  assert.match(migration, /service_type, name, provider, status, ownership/);
  assert.match(migration, /without attaching a production domain/);
  assert.match(migration, /revoke all on function public\.claim_website_vercel_provisioning[\s\S]*from public, anon, authenticated/);
});

test("trusted admin action creates one linked Vercel project and an explicit preview deployment", async () => {
  const edge = await read("supabase/functions/website-project-admin/index.ts");
  const action = edge.match(/if \(action === "provision-website-vercel"\)[\s\S]*?(?=\n    if \(\["complete-website-project")/)?.[0] || "";
  assert.match(edge, /VERCEL_ACCESS_TOKEN/);
  assert.match(edge, /VERCEL_TEAM_ID/);
  assert.match(action, /claim_website_vercel_provisioning/);
  assert.match(action, /\/v11\/projects/);
  assert.match(action, /gitRepository/);
  assert.match(edge, /website_portal_branding/);
  assert.match(edge, /website-assets-public/);
  assert.match(edge, /PUBLIC_N3XRA_SITE_NAME/);
  assert.match(edge, /PUBLIC_N3XRA_LOGO_URL/);
  assert.match(edge, /PUBLIC_N3XRA_PORTAL_URL/);
  assert.match(edge, /\/v10\/projects\/\$\{encodeURIComponent\(projectId\)\}\/env\?upsert=true/);
  assert.match(edge, /target: \["preview"\]/);
  assert.match(edge, /customEnvironmentIds: \[customEnvironmentId\]/);
  assert.match(edge, /ensureVercelStagingEnvironment/);
  assert.match(edge, /copyEnvVarsFrom: "preview"/);
  assert.match(action, /\/v13\/deployments\?forceNew=1/);
  assert.match(action, /target: "staging"/);
  assert.match(action, /projectSettings:[\s\S]*framework: "astro"[\s\S]*outputDirectory: "dist"/);
  assert.match(action, /finish_website_vercel_provisioning/);
  assert.doesNotMatch(action, /domains|productionBranch|target: "production"/i);
  assert.ok(
    action.indexOf("configureVercelPreviewEnvironment") < action.indexOf('vercelRequest(configuration, "/v13/deployments?forceNew=1"'),
    "personalized preview settings must be applied before deployment",
  );
});

test("admin and client portals show preview setup without exposing a production action", async () => {
  const [adminHtml, adminJs, clientJs] = await Promise.all([
    read("n3xra-admin/projects/index.html"),
    read("n3xra-admin/projects/projects-admin.js"),
    read("project-workspace/project-workspace.js"),
  ]);
  assert.match(adminHtml, /id="provision-project-vercel"/);
  assert.match(adminHtml, /Production publishing and domains remain separate approvals/);
  assert.match(adminJs, /action: "provision-website-vercel"/);
  assert.match(adminJs, /No production domain will be attached/);
  assert.match(clientJs, /Website preview/);
  assert.match(clientJs, /run\.preview_url/);
});

test("the standard client website template is deployable and safely personalized", async () => {
  const [packageJson, config, page, styles] = await Promise.all([
    read("templates/client-website/package.json"),
    read("templates/client-website/astro.config.mjs"),
    read("templates/client-website/src/pages/index.astro"),
    read("templates/client-website/src/styles/global.css"),
  ]);
  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.private, true);
  assert.equal(manifest.scripts.build, "astro build");
  assert.match(config, /output: "static"/);
  assert.match(page, /PUBLIC_N3XRA_SITE_NAME/);
  assert.match(page, /PUBLIC_N3XRA_LOGO_URL/);
  assert.match(page, /PUBLIC_N3XRA_PORTAL_URL/);
  assert.match(page, /noindex, nofollow, noarchive, nosnippet/);
  assert.match(page, /logoUrl &&/);
  assert.match(page, /portalUrl &&/);
  assert.match(styles, /--brand-primary/);
});
