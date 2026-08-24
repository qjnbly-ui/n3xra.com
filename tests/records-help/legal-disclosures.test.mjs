import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const privacyPath = new URL("../../privacy/index.html", import.meta.url);
const termsPath = new URL("../../terms/index.html", import.meta.url);
const projectPulseBuilderPath = new URL("../../scripts/build-project-pulse.js", import.meta.url);
const siteKnowledgePath = new URL("../../api/site-knowledge.json", import.meta.url);

test("privacy policy covers current Records data flows and privacy controls", async () => {
  const privacy = await readFile(privacyPath, "utf8");

  assert.match(privacy, /Effective date:<\/strong> August 5, 2026/);
  assert.match(privacy, /voiceprint is biometric data and is treated as sensitive personal information/);
  assert.match(privacy, /Speaker detection can separate a meeting.*without any voice profile/s);
  assert.match(privacy, /Groq for transcription/);
  assert.match(privacy, /pyannoteAI for speaker detection/);
  assert.match(privacy, /play a short section from the existing meeting recording/);
  assert.match(privacy, /record packet containing a meeting recording, transcript, notes, references, and generated documents/);
  assert.match(privacy, /scoped, temporary support access/);
  assert.match(privacy, /subject “Privacy Appeal.”/);
});

test("terms cover speaker review, meeting consent, transfers, and processing limits", async () => {
  const terms = await readFile(termsPath, "utf8");

  assert.match(terms, /Effective date:<\/strong> August 5, 2026/);
  assert.match(terms, /<h2>9\. Partner Programs<\/h2>/);
  assert.match(terms, /href="\/partners\/terms\/">Partner Program Terms<\/a>/);
  assert.match(terms, /supplement these Terms of Service and control for partner-program matters/);
  assert.match(terms, /AI drafts are not an official or verified record/);
  assert.match(terms, /Voice-profile enrollment is optional/);
  assert.match(terms, /biometric voice signature/);
  assert.match(terms, /Speaker labels, matches, and confidence scores may be incorrect/);
  assert.match(terms, /Acceptance changes ownership to the recipient organization/);
  assert.match(terms, /voice-profile limits, meeting or phone minutes, speaker-processing limits/);
});

test("Project Pulse reports the complete current meeting workflow", async () => {
  const builder = await readFile(projectPulseBuilderPath, "utf8");

  assert.match(builder, /Human-reviewed speaker identification/);
  assert.match(builder, /Configurable, editable meeting minutes/);
  assert.match(builder, /Secure record-packet transfers/);
});

test("Ask N3XRA receives the complete current legal disclosures", async () => {
  const knowledge = JSON.parse(await readFile(siteKnowledgePath, "utf8"));
  const privacy = knowledge.pages.find((page) => page.route === "/privacy")?.content || "";
  const terms = knowledge.pages.find((page) => page.route === "/terms")?.content || "";

  assert.match(privacy, /pyannoteAI/);
  assert.match(privacy, /Privacy Appeal/);
  assert.match(privacy, /scoped, temporary support access/);
  assert.match(terms, /speaker-processing limits/);
});
