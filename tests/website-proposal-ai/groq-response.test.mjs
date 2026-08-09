import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { extractGroqOutput, isGroqSchemaError, isRunRemovable, CHANGE_SET_SCHEMA } = require("../../api/website-proposal-ai.js")._test;

test("Groq structured output is extracted from Chat Completions", () => {
  const text = extractGroqOutput({
    choices: [{ message: { content: '{"summary":"ok","operations":[]}' } }],
  });
  assert.equal(text, '{"summary":"ok","operations":[]}');
});

test("Groq refusals and empty output fail closed", () => {
  assert.throws(() => extractGroqOutput({
    choices: [{ message: { refusal: "Cannot comply" } }],
  }), /Cannot comply/);
  assert.throws(() => extractGroqOutput({ choices: [{ message: { content: "" } }] }), /no structured/i);
});

test("the strict schema constrains line-item categories, billing, and intervals", () => {
  const operationValue = CHANGE_SET_SCHEMA.properties.operations.items.properties.proposed;
  const lineItem = operationValue.anyOf.at(-1);
  assert.deepEqual(lineItem.properties.billing_type.enum, ["one_time", "recurring"]);
  assert.deepEqual(lineItem.properties.recurring_interval.enum, [null, "monthly", "quarterly", "yearly"]);
  assert.ok(lineItem.properties.category.enum.includes("domain"));
});

test("only meaningful applied runs are individually retained", () => {
  assert.equal(isRunRemovable({ status: "failed", accepted_count: 0 }), true);
  assert.equal(isRunRemovable({ status: "ready", accepted_count: 0 }), true);
  assert.equal(isRunRemovable({ status: "applied", accepted_count: 0 }), true);
  assert.equal(isRunRemovable({ status: "applied", accepted_count: 2 }), false);
});

test("Groq schema failures are recognized for one safe retry", () => {
  assert.equal(isGroqSchemaError({ error: { message: "Generated JSON does not match the expected schema" } }), true);
  assert.equal(isGroqSchemaError({ error: { failed_generation: "{}" } }), true);
  assert.equal(isGroqSchemaError({ error: { message: "Rate limit exceeded" } }), false);
});
