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
  assert.match(billing, /They need to pay online/);
  assert.match(page, /billing\.css\?v=6/);
  assert.match(page, /billing\.js\?v=8/);
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
