import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const html = await readFile(new URL("n3xra-admin/proposals/index.html", root), "utf8");
const script = await readFile(new URL("n3xra-admin/proposals/proposals-admin.js", root), "utf8");
const api = await readFile(new URL("api/website-proposal-ai.js", root), "utf8");

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
  assert.match(script, /approved onboarding, current project information, and selected approved assets/);
});

test("the model is explicitly instructed to fill incomplete targeted sections", () => {
  assert.match(api, /blank or incomplete standard fields/);
  assert.match(api, /draft client-ready values from the included authoritative sources/);
});
