import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sharedSource = await readFile(new URL("../../supabase/functions/_shared/website-billing.ts", import.meta.url), "utf8");
const prepareSource = await readFile(new URL("../../supabase/functions/prepare-billing/index.ts", import.meta.url), "utf8");
const checkoutSource = await readFile(new URL("../../supabase/functions/create-website-checkout-session/index.ts", import.meta.url), "utf8");

test("website catalog includes standard, negotiated, advanced, and domain prices", () => {
  for (const secret of [
    "STRIPE_PRICE_WEBSITE_STARTER_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_YEARLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_YEARLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_YEARLY",
    "STRIPE_PRICE_WEBSITE_ADVANCED_MONTHLY",
    "STRIPE_PRICE_WEBSITE_ADVANCED_YEARLY",
    "STRIPE_PRICE_WEBSITE_DOMAIN_YEARLY",
  ]) {
    assert.match(sharedSource, new RegExp(secret));
  }
});

test("Roots and Relics has negotiated monthly and discounted yearly prices", () => {
  assert.match(sharedSource, /amountCents === 3500 && interval === "monthly"/);
  assert.match(sharedSource, /amountCents === 37800 && interval === "yearly"/);
  assert.match(sharedSource, /\[3500, 37800\]\.includes\(acceptedAmountCents\)/);
});

test("billing plan is derived from the service line rather than the recurring total", () => {
  assert.match(prepareSource, /const serviceItem = recurringItems\.find/);
  assert.match(prepareSource, /const serviceAmount = Math\.round/);
  assert.doesNotMatch(prepareSource, /recurring === 27000/);
  assert.match(prepareSource, /serviceAmount === 27000/);
});

test("checkout sends stored proposal lines to Stripe and never invents catalog products", () => {
  assert.match(checkoutSource, /website_billing_snapshot_items/);
  assert.match(checkoutSource, /snapshotItemPriceEnvironment/);
  assert.doesNotMatch(checkoutSource, /stripe\.prices\.create/);
  assert.match(checkoutSource, /lineItems\.push\(\{ price: priceId/);
});

test("checkout accepts a validated billing choice and forces FREEBUILD to yearly", () => {
  assert.match(checkoutSource, /requestedBillingInterval/);
  assert.match(checkoutSource, /founderOffer[\s\S]*requestedBillingInterval === "monthly"/);
  assert.match(checkoutSource, /websiteServiceAmount/);
  assert.match(checkoutSource, /selectedBillingInterval/);
});
