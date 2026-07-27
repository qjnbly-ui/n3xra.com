import assert from "node:assert/strict";
import test from "node:test";

import {
  operationsInvoiceStatus,
  stripeCustomerName,
  stripeInvoiceNumber,
  stripePaidDate,
  unixDateOnly,
} from "../../supabase/functions/_shared/operations-stripe.mjs";

test("maps Stripe invoice states into Operations states", () => {
  assert.equal(operationsInvoiceStatus("draft"), "draft");
  assert.equal(operationsInvoiceStatus("open"), "sent");
  assert.equal(operationsInvoiceStatus("paid"), "paid");
  assert.equal(operationsInvoiceStatus("void"), "void");
  assert.equal(operationsInvoiceStatus("uncollectible"), "uncollectible");
});

test("creates stable invoice and customer labels", () => {
  assert.equal(stripeInvoiceNumber({ id: "in_123", number: "N3XRA-0042" }), "N3XRA-0042");
  assert.equal(stripeInvoiceNumber({ id: "in_123", number: null }), "in_123");
  assert.equal(stripeCustomerName({ customer_name: "A Client", customer_email: "client@example.com" }), "A Client");
  assert.equal(stripeCustomerName({ customer_name: null, customer_email: "client@example.com" }), "client@example.com");
});

test("converts Stripe timestamps to ledger dates", () => {
  const fallback = new Date("2026-07-27T15:30:00.000Z");
  assert.equal(unixDateOnly(1785142800, fallback), "2026-07-27");
  assert.equal(stripePaidDate({ status_transitions: { paid_at: 1785142800 } }, fallback), "2026-07-27");
  assert.equal(stripePaidDate({ status_transitions: {} }, fallback), "2026-07-27");
});
