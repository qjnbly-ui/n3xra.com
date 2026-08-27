import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("client organization switching carries an explicit website selection into billing", async () => {
  const [context, billing, statusFunction] = await Promise.all([
    read("client-portal/client-workspace-context.js"),
    read("client-portal/billing/billing.js"),
    read("supabase/functions/get-website-billing-status/index.ts"),
  ]);

  assert.match(context, /url\.searchParams\.set\("website", website\.id\)/);
  assert.doesNotMatch(context, /else if \(changed\) window\.location\.reload\(\)/);
  assert.match(billing, /requestedWebsiteId \? \{ website_id: requestedWebsiteId \}/);
  assert.match(statusFunction, /else if \(websiteId\) projectQuery = projectQuery\.eq\("managed_website_id", websiteId\)/);
});

test("website billing prefers the payment method assigned to the live Stripe subscription", async () => {
  const [billing, statusFunction] = await Promise.all([
    read("client-portal/billing/billing.js"),
    read("supabase/functions/get-website-billing-status/index.ts"),
  ]);

  assert.match(statusFunction, /expand: \["default_payment_method"\]/);
  assert.match(statusFunction, /stripe\.paymentMethods\.retrieve\(defaultMethod\)/);
  assert.match(statusFunction, /subscription_payment_method_last4/);
  assert.match(statusFunction, /Unable to refresh a website subscription payment method/);
  assert.match(billing, /subscription\?\.subscription_payment_method_last4/);
  assert.match(billing, /: customerCardInfo/);
});

test("platform billing includes Communications and reconciles every health state", async () => {
  const [adminFunction, controller, page] = await Promise.all([
    read("supabase/functions/platform-admin/index.ts"),
    read("account/admin/controllers/billing.js"),
    read("account/admin/billing/index.html"),
  ]);

  assert.match(adminFunction, /organization_product_subscriptions/);
  assert.match(adminFunction, /product: "communications"/);
  assert.match(adminFunction, /500 included SMS segments/);
  assert.match(controller, /item\.product === "communications"/);
  assert.match(controller, /billingHealth\(item\)\.key === "connected"/);
  assert.match(controller, /billingHealth\(item\)\.key === "disconnected"/);
  assert.match(controller, /billingHealth\(item\)\.key === "canceled"/);
  assert.match(page, /option value="communications">Communications/);
});
