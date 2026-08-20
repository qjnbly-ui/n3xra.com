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
  assert.match(html, /Safety rule:/);
  assert.doesNotMatch(script, /source_keys:|file_keys:/);
});

test("the model is explicitly instructed to fill incomplete targeted sections", () => {
  assert.match(api, /blank or incomplete standard fields/);
  assert.match(api, /draft client-ready values from the included authoritative sources/);
  assert.match(api, /Do not bury commercial or contractual terms in overview or scope/);
  assert.match(api, /Current N3XRA website plans, pricing, and policies/);
  assert.match(api, /additional discount without an exact amount is not an exact discount/);
});

test("failed and unused history can be removed without exposing applied history removal", () => {
  assert.match(script, /data-ai-run-remove/);
  assert.match(script, /run\.status !== "applied" \|\| Number\(run\.accepted_count \|\| 0\) === 0/);
  assert.match(script, /action: "remove"/);
  assert.match(api, /Applied Proposal AI history stays with the proposal and cannot be removed independently/);
});

test("AI suggestions are consolidated into one review instead of interrupting proposal fields", () => {
  assert.match(script, /proposal-ai-review-list/);
  assert.doesNotMatch(script, /operations\.forEach\(\(operation\) => mountOperationReview/);
  assert.match(script, /AI suggests/);
  assert.match(script, /> Approve</);
  assert.match(script, /> Deny</);
  assert.doesNotMatch(script, /data-ai-forced-reject/);
  assert.doesNotMatch(script, /!readonly && !hasSavedReview/);
});

test("Proposal AI cannot invent billing or contractual values", () => {
  assert.match(api, /Never infer or invent a price, discount, deposit/);
  assert.match(api, /only when an authoritative included source states the exact final value/);
  assert.match(script, /Never infer pricing, billing values, dates, deposits/);
});

test("the request is available only as an optional reference inside the proposal", () => {
  assert.ok(html.indexOf('class="proposal-reference"') > html.indexOf('id="proposal-form"'));
  assert.match(html, /Original request and intake details/);
  assert.doesNotMatch(html.slice(0, html.indexOf('id="proposal-form"')), /id="proposal-request-summary"/);
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
  assert.match(html, /Billing arrangement/);
  assert.match(script, /Unit price \(\$\)/);
  assert.doesNotMatch(html, /Annual renewal total/);
});

test("the client accepts the same agreement version used for billing", () => {
  assert.match(clientHtml, /Proposal &amp; Agreement/);
  assert.match(clientHtml, /Accept agreement/);
  assert.match(clientScript, /Proposal & Agreement version/);
  assert.match(clientScript, /billing from the investment and payment schedule shown in this exact version/);
  assert.doesNotMatch(clientScript, /applicable contract and billing steps will be prepared separately/);
});
