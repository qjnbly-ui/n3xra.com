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
  assert.match(editor, /No paid billing starts without written approval/);
  assert.match(clientProposal, /No paid subscription or invoice will begin without your written approval/);
});

test("billing snapshots preserve the review requirement and checkout fails closed", async () => {
  const [prepare, checkout, billing] = await Promise.all([
    read("supabase/functions/prepare-billing/index.ts"),
    read("supabase/functions/create-website-checkout-session/index.ts"),
    read("client-portal/billing/billing.js"),
  ]);

  assert.match(prepare, /recurring_start_policy: version\.recurring_start_policy/);
  assert.match(prepare, /version\.recurring_start_policy !== "review_required"/);
  assert.match(checkout, /snapshot\.recurring_start_policy === "review_required"/);
  assert.match(billing, /Complimentary service period/);
});
