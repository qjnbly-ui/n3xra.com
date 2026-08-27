import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("website billing shows accepted items separately and keeps controls secondary", async () => {
  const [billing, styles, page] = await Promise.all([
    read("client-portal/billing/billing.js"),
    read("client-portal/billing/billing.css"),
    read("n3xra-admin/billing/index.html"),
  ]);

  assert.match(billing, /website_billing_snapshot_items/);
  assert.match(billing, /Plan and recurring items/);
  assert.doesNotMatch(billing, /<span>Recurring service<\/span>/);
  assert.doesNotMatch(billing, /<details open>/);
  assert.match(styles, /\.billing-plan-item-list/);
  assert.match(billing, /What do you want to do\?/);
  assert.match(billing, /They paid the \$\{renewalPeriod\} plan another way/);
  assert.match(billing, /Create paid invoice & activate plan/);
  assert.match(billing, /record_offline_subscription_payment/);
  assert.match(billing, /They want to pay \$\{offer\.interval\}/);
  assert.match(billing, /Pay \$\{money\(offer\.amount\)\} yearly · save 10%/);
  assert.match(billing, /FREEBUILD/);
  assert.match(page, /billing\.css\?v=8/);
  assert.match(page, /billing\.js\?v=17/);
});

test("website Stripe portal uses the selected project's customer and permits administrator testing", async () => {
  const [portal, billing, clientPage] = await Promise.all([
    read("supabase/functions/create-website-portal-session/index.ts"),
    read("client-portal/billing/billing.js"),
    read("client-portal/billing/index.html"),
  ]);

  assert.match(portal, /user\.rpc\("is_platform_admin"\)/);
  assert.match(portal, /if \(isAdmin !== true\) projectQuery = projectQuery\.eq\("client_user_id", authUser\.id\)/);
  assert.match(portal, /eq\("user_id", project\.client_user_id\)/);
  assert.match(portal, /console\.error\("create-website-portal-session failed:"/);
  assert.match(billing, /error\.context\?\.clone\?\.\(\)\.json\(\)/);
  assert.match(clientPage, /billing\.js\?v=17/);
  assert.match(billing, /document\.body\.dataset\.billingRole === "admin"[\s\S]*window\.location\.pathname\.startsWith\("\/n3xra-admin\/"\)/);
});

test("website billing and the organization panel synchronize their selection", async () => {
  const [billing, context, page, workspace] = await Promise.all([
    read("client-portal/billing/billing.js"),
    read("n3xra-admin/website-admin-context.js"),
    read("n3xra-admin/billing/index.html"),
    read("n3xra-admin/website-admin-workspace.js"),
  ]);

  assert.match(billing, /n3xra:workspace-context-change/);
  assert.match(billing, /let pendingWorkspaceKey = ""/);
  assert.match(billing, /const pendingKey = availableWorkspaceKey\(pendingWorkspaceKey\)/);
  assert.doesNotMatch(billing, /!adminMode \|\| !records \|\| event\.detail/);
  assert.match(context, /n3xra:workspace-context-change/);
  assert.match(context, /const changed = website\.id !== selectedId/);
  assert.match(page, /website-admin-workspace\.js\?v=16/);
  assert.match(workspace, /website-admin-context\.js\?v=7/);
});

test("website admin exposes every workspace section from the mobile submenu", async () => {
  const [workspace, styles, navigation] = await Promise.all([
    read("n3xra-admin/website-admin-workspace.js"),
    read("n3xra-admin/website-admin.css"),
    read("account/admin/admin-navigation.js"),
  ]);

  for (const label of ["Overview", "Requests", "Project", "Files", "Build", "Services", "Billing", "Portal"]) {
    assert.match(workspace, new RegExp(`label: "${label}"`));
  }
  assert.match(workspace, /keys: \["progress", "onboarding", "proposals"\]/);
  assert.match(workspace, /website-admin-mobile-navigation/);
  assert.match(workspace, /aria-label", "Website workspace sections"/);
  assert.match(styles, /@media \(max-width:800px\)[\s\S]*\.website-admin-mobile-navigation \{[\s\S]*position:sticky;[\s\S]*display:flex;[\s\S]*overflow-x:auto;/);
  assert.match(styles, /\.website-admin-mobile-navigation a \{[\s\S]*min-height:44px;/);
  assert.match(navigation, /\.website-admin-mobile-navigation a/);
});

test("every website admin page loads the current mobile workspace navigation", async () => {
  const routes = ["websites", "requests", "projects", "onboarding", "proposals", "assets", "services", "billing", "website-portal"];
  const pages = await Promise.all(routes.map((route) => read(`n3xra-admin/${route}/index.html`)));

  pages.forEach((page, index) => {
    assert.match(page, /website-admin\.css\?v=20/, `${routes[index]} must load the mobile navigation styles`);
    assert.match(page, /website-admin-workspace\.js\?v=16/, `${routes[index]} must load the mobile navigation controller`);
  });
});
