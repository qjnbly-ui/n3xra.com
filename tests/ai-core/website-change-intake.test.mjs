import assert from "node:assert/strict";
import test from "node:test";

const { analyzeWebsiteChange, fallbackWebsiteChangeAnalysis } = await import("../../api/_ai-core/websiteChangeIntake.js");

test("local website change intake recognizes business-hour changes and never auto-applies", () => {
  const analysis = fallbackWebsiteChangeAnalysis("Update our Friday hours to 9 AM through 3 PM.");
  assert.equal(analysis.changeKind, "business_hours");
  assert.equal(analysis.changeScope, "content");
  assert.equal(analysis.requiresN3xraReview, true);
  assert.equal(analysis.canAutoApply, false);
});

test("AI intake validates provider output and enforces the review boundary", async () => {
  const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    title: "Friday hours update",
    summary: "Change Friday hours to 9 AM–3 PM.",
    change_kind: "business_hours",
    change_scope: "content",
    needs_clarification: false,
    clarification_question: null,
    can_auto_apply: true
  }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const analysis = await analyzeWebsiteChange("Update our Friday hours to 9 AM through 3 PM.", { env: { GROQ_API_KEY: "test" }, fetcher });
  assert.equal(analysis.requiresN3xraReview, true);
  assert.equal(analysis.canAutoApply, false);
});

test("invalid provider classifications fall back to the safe local organizer", async () => {
  const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"change_kind":"publish_now"}' } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const analysis = await analyzeWebsiteChange("Please update the phone number on our contact page.", { env: { GROQ_API_KEY: "test" }, fetcher });
  assert.equal(analysis.source, "local");
  assert.equal(analysis.changeKind, "contact_information");
  assert.equal(analysis.canAutoApply, false);
});
