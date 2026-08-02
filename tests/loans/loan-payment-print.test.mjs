import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../../account/loan-tracker/index.html", import.meta.url);
const scriptPath = new URL("../../account/loan-tracker/loan-tracker.js", import.meta.url);

test("payment history offers the same Print / PDF workflow as the schedule", async () => {
  const [page, script] = await Promise.all([readFile(pagePath, "utf8"), readFile(scriptPath, "utf8")]);

  assert.match(page, /data-export="payment-pdf"[^>]*>Print \/ PDF</);
  assert.match(script, /function printPaymentHistory\(\)/);
  assert.match(script, /const year = \$\("#payment-year"\)\.value/);
  assert.match(script, /const centsOrZero = \(value\) => value === null/);
  assert.match(script, /payment\.status === "voided"/);
  assert.match(script, /button\.dataset\.export === "payment-pdf" \? printPaymentHistory\(\)/);
  assert.match(script, /function createPrintReportWindow\(\)/);
  assert.match(script, /function printReport\(/);
});
