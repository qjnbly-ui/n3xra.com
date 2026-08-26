import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Communications checkout uses the cataloged setup and monthly Stripe prices", async () => {
  const [billing, migration] = await Promise.all([
    read("supabase/functions/communications-billing/index.ts"),
    read("supabase/migrations/20260826151257_communications_product_billing.sql"),
  ]);

  assert.match(billing, /mode: "subscription"/);
  assert.match(billing, /product\.stripe_monthly_price_id/);
  assert.match(billing, /product\.stripe_setup_price_id/);
  assert.match(billing, /customerForOrganization/);
  assert.match(billing, /website_billing_customers/);
  assert.match(migration, /setup_fee_cents = 2900/);
  assert.match(migration, /monthly_price_cents = 1900/);
  assert.match(migration, /price_1U8iNG4fYoWkBJCDueCP9iAe/);
  assert.match(migration, /price_1U8iTw4fYoWkBJCDBMrndlhW/);
});

test("the verified Stripe webhook activates the Communications entitlement", async () => {
  const webhook = await read("supabase/functions/website-stripe-webhook/index.ts");

  assert.match(webhook, /syncCommunicationsSubscription/);
  assert.match(webhook, /source: "subscription"/);
  assert.match(webhook, /portal_enabled: activePortal/);
  assert.match(webhook, /setup_fee_paid: true/);
});

test("the client sees Communications and website plans in one billing workspace", async () => {
  const [page, app] = await Promise.all([
    read("client-portal/billing/index.html"),
    read("client-portal/billing/billing.js"),
  ]);

  assert.match(page, /Payments &amp; Billing/);
  assert.match(page, /product-billing-content/);
  assert.match(app, /Activate Communications/);
  assert.match(app, /Manage all payments in Stripe/);
  assert.match(app, /action: "status"/);
  assert.match(app, /client_websites/);
  assert.match(app, /organization_id: organizationId \|\| undefined/);
  assert.match(app, /action: checkout \? "checkout" : "portal"/);
});
