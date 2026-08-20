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
  assert.match(page, /billing\.css\?v=7/);
  assert.match(page, /billing\.js\?v=12/);
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
  assert.match(clientPage, /billing\.js\?v=12/);
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
  assert.match(page, /website-admin-workspace\.js\?v=13/);
  assert.match(workspace, /website-admin-context\.js\?v=5/);
});
