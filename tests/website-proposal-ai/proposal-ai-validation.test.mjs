import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  normalizeDate, normalizeMoneyToCents, protectedOperation, validateChangeSet,
} = require("../../api/_website-proposal-ai-validation.js");

const baseline = {
  proposal: { id: "proposal-1", title: "Original proposal" },
  version: {
    id: "version-1", introduction: "Hello", project_objective: "Launch a clear site",
    scope_summary: "Five pages", deliverables: ["Home", "About"], exclusions: [],
    timeline: "Four weeks", estimated_start_date: null, estimated_completion_date: null,
    valid_until: null, discount_cents: 0, deposit_cents: 0, payment_schedule: null,
    revision_policy: "One revision", terms: "Original terms",
  },
  line_items: [{
    id: "item-1", version_id: "version-1", category: "website_build", name: "Website build",
    description: null, billing_type: "one_time", quantity: 1, unit_amount_cents: 100000,
    recurring_interval: null, sort_order: 0,
  }],
};

function change(operation) {
  return { summary: "Suggested update", operations: [{
    id: "op-1", rationale: "Admin requested it", risk: "standard", evidence: [], ...operation,
  }] };
}

test("money normalization accepts formatting and unambiguous English phrases", () => {
  assert.equal(normalizeMoneyToCents("$1,500.00"), 150000);
  assert.equal(normalizeMoneyToCents("fifteen hundred dollars"), 150000);
  assert.equal(normalizeMoneyToCents("increase it by $500"), null);
  assert.equal(normalizeMoneyToCents("lower it to $500"), 50000);
  assert.equal(normalizeMoneyToCents("increase to fifteen hundred"), 150000);
  assert.equal(normalizeMoneyToCents("10% less"), null);
});

test("date normalization rejects ambiguity and resolves named dates in Los Angeles", () => {
  const now = new Date("2026-08-08T19:00:00Z");
  assert.equal(normalizeDate("September 1", now), "2026-09-01");
  assert.equal(normalizeDate("January 4", now), "2027-01-04");
  assert.equal(normalizeDate("2026-09-01", now), "2026-09-01");
  assert.equal(normalizeDate("09/01/2026", now), null);
  assert.equal(normalizeDate("next Friday", now), null);
});

test("server reclassifies standard operations and replaces model original values", () => {
  const result = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "scope_summary",
    original: "hallucinated", proposed: "Five focused marketing pages",
  }), baseline, new Map());
  assert.equal(result.operations[0].risk, "standard");
  assert.equal(result.operations[0].original, "Five pages");
  assert.equal(result.operations[0].server_validation.supported, true);
});

test("protected money operation requires verbatim evidence with the normalized final value", () => {
  const evidence = new Map([["admin_instruction:run-1", {
    authority: "admin_instruction", text: "Set the deposit to fifteen hundred dollars.",
  }]]);
  const result = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "deposit_cents",
    original: 0, proposed: 150000,
    evidence: [{ source_type: "admin_instruction", source_id: "run-1", field_path: "instruction", supporting_value: "fifteen hundred dollars" }],
  }), baseline, evidence);
  assert.equal(result.operations[0].risk, "protected");
  assert.equal(result.operations[0].server_validation.supported, true);
});

test("inferred money and contractual rewrites are discarded", () => {
  const evidence = new Map([["admin_instruction:run-1", {
    authority: "admin_instruction", text: "Improve the terms and make the deposit lower.",
  }]]);
  const money = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "deposit_cents",
    original: 0, proposed: 50000,
    evidence: [{ source_type: "admin_instruction", source_id: "run-1", field_path: "instruction", supporting_value: "make the deposit lower" }],
  }), baseline, evidence);
  assert.equal(money.operations.length, 0);

  const terms = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "terms",
    original: "Original terms", proposed: "The client owns all work after final payment.",
    evidence: [{ source_type: "admin_instruction", source_id: "run-1", field_path: "instruction", supporting_value: "Improve the terms" }],
  }), baseline, evidence);
  assert.equal(terms.operations.length, 0);
});

test("explicit administrator contract direction may be polished without changing its protected values", () => {
  const instruction = "If the client transfers the website, they must buy the code for $500 before transfer. N3XRA may reevaluate the plan after the first year.";
  const evidence = new Map([["admin_instruction:run-terms", {
    authority: "admin_instruction", text: instruction,
  }]]);
  const supported = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "terms",
    original: "Original terms",
    proposed: "Before a website transfer, the client must purchase the code for $500. N3XRA may reevaluate the service plan after the first year.",
    evidence: [{ source_type: "admin_instruction", source_id: "run-terms", field_path: "instruction", supporting_value: instruction }],
  }), baseline, evidence);
  assert.equal(supported.operations.length, 1);

  const invented = validateChangeSet(change({
    target: { kind: "version", id: "version-1" }, operation: "replace", field: "terms",
    original: "Original terms",
    proposed: "Before a website transfer, the client must purchase the code for $750.",
    evidence: [{ source_type: "admin_instruction", source_id: "run-terms", field_path: "instruction", supporting_value: instruction }],
  }), baseline, evidence);
  assert.equal(invented.operations.length, 0);
});

test("all line-item mutations are protected", () => {
  assert.equal(protectedOperation({ target: { kind: "line_item" }, field: "description" }), true);
  assert.equal(protectedOperation({ target: { kind: "version" }, field: "scope_summary" }), false);
});

test("complete line-item replacements preserve a canonical original and validate atomically", () => {
  const proposed = {
    category: "maintenance", name: "Managed service", description: "Annual support",
    billing_type: "recurring", quantity: 1, unit_amount_cents: 25000,
    recurring_interval: "yearly", sort_order: 0,
  };
  const evidence = new Map([["admin_instruction:run-2", {
    authority: "admin_instruction", text: "Replace Website build with one Managed service at $250, billed recurring yearly, with the description Annual support.",
  }]]);
  const result = validateChangeSet(change({
    target: { kind: "line_item", id: "item-1" }, operation: "replace", field: "item",
    original: null, proposed,
    evidence: [
      { source_type: "admin_instruction", source_id: "run-2", field_path: "instruction", supporting_value: "$250" },
      { source_type: "admin_instruction", source_id: "run-2", field_path: "quantity", supporting_value: "one" },
    ],
  }), baseline, evidence);
  assert.equal(result.operations[0].original.name, "Website build");
  assert.equal(result.operations[0].server_validation.supported, true);
});

test("unsupported line-item suggestions are discarded after normalization", () => {
  const result = validateChangeSet(change({
    target: { kind: "line_item", id: null }, operation: "add", field: "item",
    original: null,
    proposed: {
      category: "domain", name: "Domain renewal", description: "Annual domain fee",
      billing_type: "one_time", quantity: 1, unit_amount_cents: 3000,
      recurring_interval: "yearly", sort_order: 1,
    },
  }), baseline, new Map());
  assert.equal(result.operations.length, 0);
});
