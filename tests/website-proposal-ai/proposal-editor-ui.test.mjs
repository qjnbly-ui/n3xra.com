import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const html = await readFile(new URL("n3xra-admin/proposals/index.html", root), "utf8");
const script = await readFile(new URL("n3xra-admin/proposals/proposals-admin.js", root), "utf8");
const api = await readFile(new URL("api/website-proposal-ai.js", root), "utf8");
const clientHtml = await readFile(new URL("proposals/index.html", root), "utf8");
const clientScript = await readFile(new URL("proposals/proposals.js", root), "utf8");

test("Proposal AI opens before the editor sections and exposes one action per section", () => {
  assert.ok(html.indexOf('id="proposal-copilot"') < html.indexOf('data-proposal-section="overview"'));
  for (const section of ["overview", "scope", "schedule", "investment", "terms"]) {
    assert.match(html, new RegExp(`data-ai-section="${section}"`));
    assert.match(html, new RegExp(`data-ai-result-slot="${section}"`));
  }
  assert.doesNotMatch(html, /id="proposal-ai-sections"/);
});

test("section actions share the saved-baseline and targeted generation workflow", () => {
  assert.match(script, /async function ensureCopilotBaseline\(\)/);
  assert.match(script, /await saveDraft\(null, true\)/);
  assert.match(script, /const targetSections = section \? \[section\] : \[\.\.\.copilotSections\]/);
  assert.match(script, /target_sections: targetSections/);
  assert.match(script, /approved onboarding, current project information, and approved asset list/);
});

test("project context is automatic and the technical source picker is not shown", () => {
  assert.doesNotMatch(html, /Sources and files/);
  assert.doesNotMatch(html, /proposal-ai-source-list|proposal-ai-file-list/);
  assert.match(html, /Included automatically:/);
  assert.doesNotMatch(script, /source_keys:|file_keys:/);
});

test("the model is explicitly instructed to fill incomplete targeted sections", () => {
  assert.match(api, /blank or incomplete standard fields/);
  assert.match(api, /draft client-ready values from the included authoritative sources/);
});

test("failed and unused history can be removed without exposing applied history removal", () => {
  assert.match(script, /data-ai-run-remove/);
  assert.match(script, /run\.status !== "applied" \|\| Number\(run\.accepted_count \|\| 0\) === 0/);
  assert.match(script, /action: "remove"/);
  assert.match(api, /Applied Proposal AI history stays with the proposal and cannot be removed independently/);
});

test("every AI suggestion is reviewed beside its affected field", () => {
  assert.match(script, /function operationAnchor\(operation\)/);
  assert.match(script, /proposal-ai-inline-host/);
  assert.match(script, /AI suggests/);
  assert.match(script, /> Approve</);
  assert.match(script, /> Deny</);
  assert.doesNotMatch(script, /data-ai-forced-reject/);
  assert.doesNotMatch(script, /!readonly && !hasSavedReview/);
});

test("Proposal AI may suggest billing and contractual values for admin review", () => {
  assert.match(api, /including pricing, discounts, deposits, recurring charges, dates, terms, and billing line items/);
  assert.doesNotMatch(api, /Unsupported protected suggestion cannot be applied/);
  assert.match(script, /You may propose pricing, billing items, dates, scope/);
});

test("the editor is a professional Proposal & Agreement workspace, not a step wizard", () => {
  for (const label of ["Project summary", "Scope", "Timeline", "Investment &amp; payment", "Agreement terms"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /proposal-agreement-steps|Exact version preserved|Changes create a revision|Billing uses approved totals/);
  assert.doesNotMatch(html, />0[1-6] ·/);
  assert.match(html, /id="proposal-introduction" type="hidden"/);
  assert.match(script, /introduction: null/);
  assert.match(script, /values\.introduction, values\.project_objective/);
});

test("the client accepts the same agreement version used for billing", () => {
  assert.match(clientHtml, /Proposal &amp; Agreement/);
  assert.match(clientHtml, /Accept agreement/);
  assert.match(clientScript, /Proposal & Agreement version/);
  assert.match(clientScript, /billing from the investment and payment schedule shown in this exact version/);
  assert.doesNotMatch(clientScript, /applicable contract and billing steps will be prepared separately/);
});
