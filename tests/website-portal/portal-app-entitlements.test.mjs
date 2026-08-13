import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the branded portal root is the business dashboard instead of the project workspace", async () => {
  const [html, shell, portal] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/portal.js"),
  ]);

  assert.match(html, /id="portal-view-dashboard"/);
  assert.match(html, /id="portal-app-grid"/);
  assert.match(html, /portal-apps\.js\?v=2/);
  assert.match(shell, /key: "dashboard"[\s\S]*href: "\/client-portal\/"/);
  assert.doesNotMatch(shell, /window\.location\.replace\(`\/project-workspace/);
  assert.match(portal, /activePortalView = "dashboard"/);
  assert.match(portal, /else showPortalView\("dashboard"\)/);
});

test("portal apps are loaded from the tenant website's linked organization", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /resolvePortalTenant/);
  assert.match(apps, /\.from\("client_websites"\)/);
  assert.match(apps, /\.eq\("id", tenant\.website_id\)/);
  assert.match(apps, /\.from\("organization_product_entitlements"\)/);
  assert.match(apps, /\.eq\("organization_id", organizationId\)/);
  assert.match(apps, /setStoredActiveOrganizationId/);
  assert.match(apps, /safePortalPath/);
  assert.doesNotMatch(apps, /target\s*=|window\.open\s*\(/);
});

test("website-only portals skip the app dashboard after subscriptions load", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /function routeOrRenderApps\(apps\)/);
  assert.match(apps, /if \(apps\.length === 1 && onlyApp\)/);
  assert.match(apps, /window\.location\.replace\(app\.href\)/);
  assert.match(apps, /routeOrRenderApps\(apps\)/);
  assert.match(apps, /catch\(\(error\) => \{[\s\S]*renderApps\(\[websiteApp\(\)\]\)/);
});

test("the N3XRA website portal opens Website Management without the branded app chooser", async () => {
  const [apps, shell, workspaceContext, brandShell] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/brand-shell.js"),
  ]);

  assert.match(apps, /tenant\.mode === "unbound"[\s\S]*window\.location\.replace\(websiteApp\(\)\.href\)/);
  assert.match(shell, /isBrandedPortalHostname\(\)[\s\S]*Dashboard/);
  assert.match(workspaceContext, /isBrandedPortalHostname\(\)[\s\S]*Dashboard/);
  assert.match(brandShell, /showN3xraPortalIdentity/);
  assert.match(brandShell, /N3XRA \| Website Management/);
});

test("organization app entitlements are RLS protected and synchronized from subscriptions", async () => {
  const migration = await projectFile("supabase/migrations/20260813164832_branded_portal_app_entitlements.sql");

  assert.match(migration, /create table public\.organization_product_entitlements/);
  assert.match(migration, /alter table public\.organization_product_entitlements enable row level security/);
  assert.match(migration, /to authenticated[\s\S]*membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /organization_product_entitlements_admin_update[\s\S]*using \(\(select public\.is_platform_admin\(\)\)\)[\s\S]*with check/);
  assert.match(migration, /organizations_sync_records_product_entitlement/);
  assert.match(migration, /client_websites[\s\S]*organization_id = candidate\.organization_id/);
  assert.doesNotMatch(migration, /grant (select|all).*organization_product_entitlements to anon/i);
});

test("Records adopts the client portal brand on a branded hostname", async () => {
  const [recordsShell, desktopShell] = await Promise.all([
    projectFile("client-portal/records-app-shell.js"),
    projectFile("n3xra-records/lib/desktop-shell.js"),
  ]);

  assert.match(desktopShell, /initializeRecordsPortalShell/);
  assert.match(recordsShell, /identity\.websiteName/);
  assert.match(recordsShell, /identity\.logoUrl/);
  assert.match(recordsShell, /Portal home/);
  assert.match(recordsShell, /Back to \$\{identity\.websiteName\} Website/);
  assert.doesNotMatch(recordsShell, /target\s*=|window\.open\s*\(/);
});
