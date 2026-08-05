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

test("PDF export keeps headings and list markers with their following content", async () => {
  const source = await readFile(pdfGeneratorPath, "utf8");

  assert.match(source, /function keepHeadingWithNext/);
  assert.match(source, /keepHeadingWithNext\(state, node, content\.content\[index \+ 1\]\)/);
  assert.match(source, /estimateFirstBlockHeight\(state, firstChild\)/);
  assert.match(source, /Long paragraphs may split, but never begin with a single orphaned line/);
});
