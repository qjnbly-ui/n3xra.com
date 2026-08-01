import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { cleanSpeechText } = require("../../api/_speech-text.js");

test("speech text pronounces the brand and recurring limits naturally", () => {
  const spoken = cleanSpeechText(
    "N3XRA Records includes 1,500 AI requests/month and costs $12/month."
  );

  assert.equal(
    spoken,
    "Nexra Records includes 1,500 AI requests a month and costs 12 dollars a month."
  );
});

test("speech text normalizes spaced thousands and navigation arrows", () => {
  const spoken = cleanSpeechText(
    "10\u202f000 private documents. Open **Manage library** → **Billing**."
  );

  assert.equal(spoken, "10,000 private documents. Open Manage library. Then Billing.");
});

test("speech text makes hyphenated interface positions easier to hear", () => {
  assert.equal(cleanSpeechText("Use the header-right Profile link."), "Use the header right Profile link.");
});
