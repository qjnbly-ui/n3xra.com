import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSchedule,
  comparePlans,
  rebuildPayments,
  summarizeSchedule,
  toCents,
} from "../../account/loan-tracker/loan-engine.mjs";

const base = {
  balanceCents: 2_702_400,
  aprBasisPoints: 926,
  firstPaymentDate: "2026-08-03",
};

test("$500 plan pays off sooner than the required payment", () => {
  const comparison = comparePlans({ ...base, paymentCents: 50_000 }, 34_351);
  assert.ok(comparison.selected.payments < comparison.minimum.payments);
  assert.ok(comparison.interestSavedCents > 0);
  assert.ok(comparison.monthsSaved > 0);
});

test("schedule creates an exact smaller final payment", () => {
  const rows = buildSchedule({ ...base, paymentCents: 50_000 });
  const summary = summarizeSchedule(rows);
  assert.equal(rows.at(-1).endingBalanceCents, 0);
  assert.ok(summary.finalPaymentCents > 0);
  assert.ok(summary.finalPaymentCents < 50_000);
});

test("money parsing is cent-safe", () => {
  assert.equal(toCents("$27,024.00"), 2_702_400);
  assert.equal(toCents("343.51"), 34_351);
  assert.throws(() => toCents("1.005"));
});

test("official balance correction overrides the estimate", () => {
  const account = { original_balance: "27024.00", annual_interest_rate: "9.2600" };
  const rows = rebuildPayments(account, [{
    id: "one", payment_date: "2026-08-03", created_at: "2026-08-03T12:00:00Z",
    amount: "500.00", official_balance_after_payment: "26400.00",
    applied_to_loan: true, status: "completed",
  }]);
  assert.equal(rows[0].ending_balance, "26400.00");
});

test("voided payments do not change the balance", () => {
  const account = { original_balance: "27024.00", annual_interest_rate: "9.2600" };
  const rows = rebuildPayments(account, [{
    id: "one", payment_date: "2026-08-03", created_at: "2026-08-03T12:00:00Z",
    amount: "500.00", official_balance_after_payment: null,
    applied_to_loan: true, status: "voided",
  }]);
  assert.equal(rows[0].ending_balance, null);
});
