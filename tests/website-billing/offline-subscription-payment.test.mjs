import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("an offline annual payment creates a real Stripe invoice and subscription without charging a card", async () => {
  const [operations, webhook, billing] = await Promise.all([
    read("supabase/functions/website-billing-operations/index.ts"),
    read("supabase/functions/website-stripe-webhook/index.ts"),
    read("client-portal/billing/billing.js"),
  ]);

  assert.match(operations, /action === "record_offline_subscription_payment"/);
  assert.match(operations, /snapshotItemPriceEnvironment/);
  assert.match(operations, /collection_method: "send_invoice"/);
  assert.match(operations, /paid_out_of_band: true/);
  assert.match(operations, /website-offline-subscription-/);
  assert.match(webhook, /invoice\.paid/);
  assert.match(webhook, /invoice\.paid_out_of_band/);
  assert.match(webhook, /offline_payment_method/);
  assert.match(webhook, /if \(subscription\) await syncSubscription\(admin, subscription\)/);
  assert.match(billing, /No card will be charged and no payment request will be sent/);
  assert.doesNotMatch(billing, /create: "payment"/);
});

test("the removed bookkeeping-only website payment shortcut cannot be opened", async () => {
  const [operations, styles] = await Promise.all([
    read("account/admin/operations/operations.js"),
    read("account/admin/operations/operations.css"),
  ]);

  assert.doesNotMatch(operations, /websitePaymentFields/);
  assert.doesNotMatch(operations, /params\.get\("create"\) === "payment"/);
  assert.doesNotMatch(operations, /dataset\.websitePayment/);
  assert.doesNotMatch(styles, /operations-payment-help/);
});
