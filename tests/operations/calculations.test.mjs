import assert from "node:assert/strict";
import test from "node:test";

import {
  outstandingInvoiceCents,
  summarizeOperations,
  toCents,
} from "../../lib/operations/calculations.mjs";

test("money parsing stores exact integer cents", () => {
  assert.equal(toCents("$1,249.99"), 124999);
  assert.equal(toCents("-12.50"), -1250);
  assert.throws(() => toCents("1.999"));
});

test("summary separates revenue, expenses, profit, and confirmed balances", () => {
  const summary = summarizeOperations({
    transactions: [
      { transaction_type: "revenue", transaction_date: "2026-07-03", amount_cents: 7500, status: "completed" },
      { transaction_type: "expense", transaction_date: "2026-07-04", amount_cents: 2500, status: "completed" },
      { transaction_type: "revenue", transaction_date: "2026-07-05", amount_cents: 9999, status: "void" },
    ],
    invoices: [],
    parties: [{ party_type: "customer", status: "active" }],
    projects: [{ status: "active" }],
    financialAccounts: [
      { status: "active", account_type: "checking", current_balance_cents: 100000 },
      { status: "active", account_type: "credit", current_balance_cents: 50000 },
    ],
    today: new Date("2026-07-27T12:00:00Z"),
  });

  assert.equal(summary.revenueCents, 7500);
  assert.equal(summary.expenseCents, 2500);
  assert.equal(summary.netProfitCents, 5000);
  assert.equal(summary.bankBalanceCents, 100000);
  assert.equal(summary.activeCustomers, 1);
  assert.equal(summary.activeProjects, 1);
});

test("outstanding invoice uses completed linked revenue only", () => {
  const invoice = { id: "invoice-1", total_cents: 10000, status: "partial" };
  const transactions = [
    { invoice_id: "invoice-1", transaction_type: "revenue", amount_cents: 4000, status: "completed" },
    { invoice_id: "invoice-1", transaction_type: "revenue", amount_cents: 2000, status: "void" },
  ];
  assert.equal(outstandingInvoiceCents(invoice, transactions), 6000);
});
