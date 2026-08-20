import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("proposal editor keeps the recurring price visible while deferring paid billing", async () => {
  const [page, editor, clientProposal] = await Promise.all([
    read("n3xra-admin/proposals/index.html"),
    read("n3xra-admin/proposals/proposals-admin.js"),
    read("proposals/proposals.js"),
  ]);

  assert.match(page, /First year free — review before paid billing/);
  assert.match(editor, /recurring_start_policy/);
  assert.match(editor, /isBoulderCreekRequest/);
  assert.match(editor, /complimentary first-year exception is reserved for Boulder Creek Plumbing/);
  assert.match(editor, /FREEBUILD requires one full year of website service paid upfront/);
  assert.match(editor, /No paid website service starts without written approval/);
  assert.match(editor, /!\["maintenance", "hosting"\]\.includes\(item\.category\)/);
  assert.match(editor, /The \$\{formatMoney[\s\S]*yearly domain renewal is billed separately/);
  assert.match(clientProposal, /Paid Starter\+ billing will not begin without your written approval/);
  assert.match(clientProposal, /domain renewals and outside costs follow their own billing schedules/);
});

test("billing snapshots defer paid service while allowing a separate yearly domain renewal", async () => {
  const [prepare, checkout, webhook, billing, migration] = await Promise.all([
    read("supabase/functions/prepare-billing/index.ts"),
    read("supabase/functions/create-website-checkout-session/index.ts"),
    read("supabase/functions/website-stripe-webhook/index.ts"),
    read("client-portal/billing/billing.js"),
    read("supabase/migrations/20260817032752_support_separate_domain_subscriptions.sql"),
  ]);

  assert.match(prepare, /recurring_start_policy: version\.recurring_start_policy/);
  assert.match(prepare, /String\(item\.category\) === "domain" \|\| version\.recurring_start_policy !== "review_required"/);
  assert.match(checkout, /snapshot\.recurring_start_policy === "review_required"/);
  assert.match(checkout, /subscription_type: subscriptionType/);
  assert.match(checkout, /Only an approved domain renewal can be set up now/);
  assert.match(webhook, /project_id,subscription_type/);
  assert.match(migration, /subscription_type in \('service', 'domain'\)/);
  assert.match(billing, /Set up the yearly domain renewal/);
  assert.match(billing, /This does not activate paid Starter\+ service/);
});
