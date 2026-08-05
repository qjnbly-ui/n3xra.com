import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildPrompt, plainTextToTiptapDoc } = require("../../api/finalize-recording-notes.js")._test;
const pdfGeneratorPath = new URL(
  "../../supabase/functions/generate-app-document-pdf/index.ts",
  import.meta.url,
);
const meetingNotesPages = [
  new URL("../../n3xra-records/meeting-notes/index.html", import.meta.url),
  new URL("../../n3xra-records/recordings.html", import.meta.url),
  new URL("../../n3xra-records/all-recordings.html", import.meta.url),
  new URL("../../n3xra-records/all-meeting-notes/index.html", import.meta.url),
];
const recordingClients = [
  new URL("../../n3xra-records/recordings.js", import.meta.url),
  new URL("../../n3xra-records/all-recordings.js", import.meta.url),
];

function nodeText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  return Array.isArray(node.content) ? node.content.map(nodeText).join("") : "";
}

test("AI draft conversion repairs repeated one-item agenda numbering into semantic sections", () => {
  const document = plainTextToTiptapDoc(`Bonanza City Council Meeting
Date: August 4, 2026

Agenda Items:

1. Opening Motions
- The council approved the opening motion.

2. Presentation Adjustments
- The council adjusted the presentation order.

3. Administrative Reports
- Staff delivered the administrative reports.`);

  const headings = document.content
    .filter((node) => node.type === "heading")
    .map((node) => ({ level: node.attrs.level, text: nodeText(node) }));

  assert.deepEqual(headings, [
    { level: 1, text: "Bonanza City Council Meeting" },
    { level: 2, text: "Agenda Items" },
    { level: 2, text: "1. Opening Motions" },
    { level: 2, text: "2. Presentation Adjustments" },
    { level: 2, text: "3. Administrative Reports" },
  ]);
  assert.equal(document.content.some((node) => node.type === "orderedList"), false);
  assert.equal(document.content.filter((node) => node.type === "bulletList").length, 3);
});

test("AI draft conversion keeps a genuine continuous numbered list intact", () => {
  const document = plainTextToTiptapDoc(`Next steps:

1. Confirm the date
2. Notify attendees
3. Publish the agenda`);
  const orderedLists = document.content.filter((node) => node.type === "orderedList");

  assert.equal(orderedLists.length, 1);
  assert.deepEqual(orderedLists[0].content.map(nodeText), [
    "Confirm the date",
    "Notify attendees",
    "Publish the agenda",
  ]);
});

test("meeting draft prompt requires section continuity and flags uncertain transcript wording", () => {
  const prompt = buildPrompt({
    recording: { title: "Council meeting" },
    organization: { name: "Bonanza" },
    template: null,
    notesText: "Date: August 4, 2026",
    transcriptText: "unclear phrase",
  });

  assert.match(prompt, /never restart every section at 1/i);
  assert.match(prompt, /unclear or implausible transcript wording/i);
  assert.match(prompt, /Never leave a section title with an empty bullet/i);
});

test("meeting draft prompt applies brief, standard, and detailed minutes guidance", () => {
  const baseInput = {
    recording: { title: "Council meeting" },
    organization: { name: "Bonanza", records_default_minutes_style: "standard" },
    template: null,
    notesText: "The council discussed the project.",
    transcriptText: "Discussion transcript",
  };

  const briefPrompt = buildPrompt({ ...baseInput, minutesStyle: "brief" });
  const standardPrompt = buildPrompt(baseInput);
  const detailedPrompt = buildPrompt({ ...baseInput, minutesStyle: "detailed" });

  assert.match(briefPrompt, /Selected minutes style: brief/);
  assert.match(briefPrompt, /compact official record/);
  assert.match(standardPrompt, /Selected minutes style: standard/);
  assert.match(standardPrompt, /balanced record/);
  assert.match(detailedPrompt, /Selected minutes style: detailed/);
  assert.match(detailedPrompt, /differing viewpoints/);
});

test("current meeting notes UI exposes a minutes style selector", async () => {
  const html = await readFile(new URL("../../n3xra-records/meeting-notes/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../../n3xra-records/recordings.js", import.meta.url), "utf8");

  assert.match(html, /name="recording-minutes-style" value="brief"/);
  assert.match(html, /name="recording-minutes-style" value="standard"/);
  assert.match(html, /name="recording-minutes-style" value="detailed"/);
  assert.match(source, /JSON\.stringify\(\{ recordingId, minutesStyle:/);
});

test("PDF export keeps headings and list markers with their following content", async () => {
  const source = await readFile(pdfGeneratorPath, "utf8");

  assert.match(source, /function keepHeadingWithNext/);
  assert.match(source, /keepHeadingWithNext\(state, node, content\.content\[index \+ 1\]\)/);
  assert.match(source, /estimateFirstBlockHeight\(state, firstChild\)/);
  assert.match(source, /Long paragraphs may split, but never begin with a single orphaned line/);
});

test("AI drafts are editable and save before suggestions or finalization", async () => {
  for (const pagePath of meetingNotesPages) {
    const html = await readFile(pagePath, "utf8");
    assert.match(html, /<textarea[^>]+id="recording-detail-ai-draft-preview"/);
    assert.match(html, /id="recording-detail-ai-draft-save"[^>]*>Save draft changes</);
    assert.match(html, /Edit wording here before applying suggestions/);
  }

  for (const clientPath of recordingClients) {
    const source = await readFile(clientPath, "utf8");
    assert.match(source, /editedDraftText/);
    assert.match(source, /Saving your draft edits before updating suggestions/);
    assert.match(source, /if \(!aiDraftHasUnsavedChanges\(\)\) return;/);
    assert.match(source, /window\.location\.href = destination/);
  }
});

test("AI reviews can be cleared without removing the saved AI draft", async () => {
  for (const pagePath of meetingNotesPages) {
    const html = await readFile(pagePath, "utf8");
    assert.match(html, /data-review-action="clear"[^>]*>Clear review</);
  }

  for (const clientPath of recordingClients) {
    const source = await readFile(clientPath, "utf8");
    assert.match(source, /clearRecordingReview\(\{ supabase, recording \}\)/);
    assert.match(source, /Your AI draft was preserved/);
  }
});

test("manual AI draft saves update the review and Document Builder draft without an AI call", async () => {
  const source = await readFile(new URL("../../api/finalize-recording-notes.js", import.meta.url), "utf8");
  const manualSaveIndex = source.indexOf("if (hasEditedDraftText)");
  const aiUsageIndex = source.indexOf("const usageContext = await prepareRecordsAiUsage", manualSaveIndex);

  assert.ok(manualSaveIndex > 0);
  assert.ok(aiUsageIndex > manualSaveIndex);
  assert.match(source.slice(manualSaveIndex, aiUsageIndex), /final_document_text: editedDraftText/);
  assert.match(source.slice(manualSaveIndex, aiUsageIndex), /updateTargetDocument/);
  assert.match(source.slice(manualSaveIndex, aiUsageIndex), /manually_edited_at/);
});
