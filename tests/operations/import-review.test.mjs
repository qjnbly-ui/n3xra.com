import assert from "node:assert/strict";
import test from "node:test";

import {
  isResolvedExpenseCategory,
  normalizeImportRecords,
  parseCsv,
  parseImportDate,
  parseMoneyCents,
  rowsToObjects,
  suggestClassification,
} from "../../lib/operations/import-review.mjs";

test("requires a specific category before an expense can be approved", () => {
  assert.equal(isResolvedExpenseCategory("Software"), true);
  assert.equal(isResolvedExpenseCategory("Needs review"), false);
  assert.equal(isResolvedExpenseCategory("Uncategorized"), false);
  assert.equal(isResolvedExpenseCategory(""), false);
});

test("parses quoted CSV records without losing commas", () => {
  const rows = parseCsv('Date,Description,Amount,Type\r\n7/2/2026,"Adobe, Inc.",-22.99,Debit\r\n');
  assert.deepEqual(rows[1], ["7/2/2026", "Adobe, Inc.", "-22.99", "Debit"]);
  assert.equal(rowsToObjects(rows)[0].description, "Adobe, Inc.");
});

test("normalizes common dates and exact currency values", () => {
  assert.equal(parseImportDate("7/2/2026"), "2026-07-02");
  assert.equal(parseImportDate("2026-07-03"), "2026-07-03");
  assert.equal(parseMoneyCents("($1,249.99)"), -124999);
  assert.equal(parseMoneyCents(22.99), 2299);
});

test("uses conservative classification rules", () => {
  assert.equal(suggestClassification("Adobe Creative Cloud", "debit").classification, "business");
  assert.equal(suggestClassification("APPLE.COM/BILL", "debit").classification, "needs_review");
  assert.equal(suggestClassification("Online Transfer to Savings", "debit").classification, "transfer");
  assert.equal(suggestClassification("Unknown credit", "credit").classification, "needs_review");
});

test("respects an imported review workbook classification", () => {
  const result = normalizeImportRecords([{
    date: "7/2/2026",
    description: "Custom vendor",
    amount: "100.00",
    type: "Debit",
    classification: "Mixed",
    "business use %": "75%",
    reason: "Documented allocation",
  }]);
  assert.equal(result.records[0].flow, "debit");
  assert.equal(result.records[0].classification, "mixed");
  assert.equal(result.records[0].businessUsePercent, 75);
  assert.equal(result.records[0].suggestionReason, "Documented allocation");
});
