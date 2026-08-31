import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Communications checkout uses selectable organization plans with a Roots-specific setup override", async () => {
  const [billing, migration, planMigration, onboardingMigration, portalBilling] = await Promise.all([
    read("supabase/functions/communications-billing/index.ts"),
    read("supabase/migrations/20260826151643_communications_product_billing.sql"),
    read("supabase/migrations/20260831232545_communications_plan_catalog.sql"),
    read("supabase/migrations/20260826170812_communications_twilio_onboarding.sql"),
    read("client-portal/billing/billing.js"),
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
  assert.match(onboardingMigration, /setup_fee_cents = 4900/);
  assert.match(onboardingMigration, /74b2226c-6d7d-4267-9f70-5fbe106a6816/);
  assert.match(onboardingMigration, /Roots & Relics founding-customer setup price/);
  assert.match(billing, /organization_product_price_overrides/);
  assert.match(billing, /effectiveProduct/);
  assert.match(billing, /communications\/onboarding/);
  assert.match(billing, /communications_plan_catalog/);
  assert.match(billing, /selectedPlan\.stripe_price_id/);
  assert.match(billing, /plan_key: selectedPlan\.plan_key/);
  assert.match(planMigration, /'basic'[\s\S]*3900[\s\S]*500[\s\S]*3000/);
  assert.match(planMigration, /price_1UAeYJ4fYoWkBJCDbL4gSRqa/);
  assert.match(planMigration, /'plus'[\s\S]*6900[\s\S]*2000[\s\S]*10000/);
  assert.match(planMigration, /price_1UAeYY4fYoWkBJCDImuMhtvW/);
  assert.match(portalBilling, /data-plan-key/);
  assert.match(portalBilling, /included_email_deliveries/);
});

test("the verified Stripe webhook activates the Communications entitlement", async () => {
  const webhook = await read("supabase/functions/website-stripe-webhook/index.ts");

  assert.match(webhook, /syncCommunicationsSubscription/);
  assert.match(webhook, /source: "subscription"/);
  assert.match(webhook, /portal_enabled: activePortal/);
  assert.match(webhook, /setup_fee_paid: true/);
  assert.match(webhook, /communications_plan_catalog/);
  assert.match(webhook, /included_email_deliveries/);
  assert.match(webhook, /plan_key: planKey/);
});

test("the client sees Communications and website plans in one billing workspace", async () => {
  const [page, app] = await Promise.all([
    read("client-portal/billing/index.html"),
    read("client-portal/billing/billing.js"),
  ]);

  assert.match(page, /Payments &amp; Billing/);
  assert.match(page, /product-billing-content/);
  assert.match(app, /Choose \$\{escape\(plan\.name/);
  assert.match(app, /data-plan-key/);
  assert.match(app, /Manage all payments in Stripe/);
  assert.match(app, /Finish texting onboarding/);
  assert.match(app, /action: "status"/);
  assert.match(app, /client_websites/);
  assert.match(app, /organization_id: organizationId \|\| undefined/);
  assert.match(app, /action: checkout \? "checkout" : "portal"/);
});
