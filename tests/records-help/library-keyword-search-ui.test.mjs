import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const recordsSearch = require("../../api/records-search.js");
const filesPath = new URL("../../n3xra-records/files.js", import.meta.url);
const stylesPath = new URL("../../n3xra-records/styles.css", import.meta.url);

test("Library keyword search safely highlights the matched phrase", async () => {
  const files = await readFile(filesPath, "utf8");
  const styles = await readFile(stylesPath, "utf8");

  assert.match(files, /function highlightedKeywordSnippet\(text, query = ""\)/);
  assert.match(files, /<mark>\$\{match\}<\/mark>/);
  assert.match(files, /:\s*highlightedKeywordSnippet\(getDocumentSearchText\(doc\), options\.query \|\| ""\)/);
  assert.match(files, /const before = escapeHtml/);
  assert.match(files, /const match = escapeHtml/);
  assert.match(files, /const after = escapeHtml/);
  assert.match(styles, /\.doc-snippet mark \{/);
});

test("Library downloads the displayed editable document as a PDF", async () => {
  const files = await readFile(filesPath, "utf8");

  assert.match(files, /const appDocument = isReferenceFileRow\(row\)[\s\S]*getEditableDocumentForSource\(documentId\)/);
  assert.match(files, /if \(appDocument\) \{\s*await downloadAppDocumentPdf\(appDocument\)/);
  assert.match(files, /\$\{editableDoc \? "Download PDF" : "Download"\}/);
});

test("Library AI Search preserves the previous rich answer and compact evidence presentation", async () => {
  const files = await readFile(filesPath, "utf8");

  assert.match(files, /renderAiAnswerMarkup\(aiSearchAnswer, answer\)/);
  assert.match(files, /function renderAiInlineMarkdown/);
  assert.match(files, /function parseAiTableRow/);
  assert.match(files, /class="ai-rich-table"/);
  assert.match(files, /replace\(\/<br/);
  assert.match(files, /\? \(doc\?\.is_public \? "public" : "private"\)/);
  assert.match(files, /isAiTableDivider\(lines\[index \+ 1\]\)/);
  assert.match(files, /function highlightedAiEvidenceSnippet/);
  assert.match(files, /index \+ 520/);
  assert.match(files, /Highlighted excerpt sent to AI/);
  assert.match(files, /Source files AI Search used/);
  assert.doesNotMatch(files, /aiSearchAnswer\.textContent =/);
});

test("Records AI Search keeps model line breaks required by Markdown", () => {
  const answer = recordsSearch.normalizeAnswerText("## Summary\r\n\r\n| Year | Event |\r\n| --- | --- |\r\n| 2026 | Windows |  ");

  assert.equal(answer, "## Summary\n\n| Year | Event |\n| --- | --- |\n| 2026 | Windows |");
});

test("Records AI Search separates the requested subject from formatting instructions", () => {
  assert.deepEqual(
    recordsSearch.getSearchTerms("Give me a summary of every time we talked about windows in a paragraph"),
    ["windows"]
  );
});

test("Records AI Search extracts evidence around a subject found deep in a file", () => {
  const text = `${"Unrelated meeting business. ".repeat(180)}The board approved replacing the gym windows in February.`;
  const snippet = recordsSearch.buildRelevantSnippet(text, ["windows"]);

  assert.match(snippet, /approved replacing the gym windows/i);
  assert.ok(snippet.length <= 3000);
});

test("exhaustive Records AI searches exclude generic matches and stay chronological", () => {
  const documents = [
    { id: "new", title: "March Minutes", year: "2026", month: "March", extracted_text: "The window grant balance was reassigned." },
    { id: "noise", title: "April Minutes", year: "2018", month: "April", extracted_text: "There was time for a general project summary." },
    { id: "old", title: "October Minutes", year: "2017", month: "October", extracted_text: "Historic windows were requested for the gym." },
    { id: "middle", title: "June Minutes", year: "2019", month: "June", extracted_text: "A loan funded window replacement." },
  ];

  const matches = recordsSearch.rankDocuments(documents, "Tell me every time we talked about windows");

  assert.deepEqual(matches.map((match) => match.id), ["old", "middle", "new"]);
  assert.ok(matches.every((match) => /window/i.test(match.snippet)));
});

test("Records AI creates concise speech for tables instead of reading table markup", () => {
  const answer = [
    "## Window history",
    "| Date | Discussion |",
    "| --- | --- |",
    "| October 2017 | Historic windows were requested. |",
    "| June 2019 | A loan funded window replacement. |",
    "| March 2026 | The grant balance was reassigned. |",
  ].join("\n");
  const speech = recordsSearch.buildRecordsSearchSpeechText(answer);

  assert.match(speech, /table contains 3 entries/i);
  assert.match(speech, /October 2017 through March 2026/i);
  assert.match(speech, /complete table remains available on screen/i);
  assert.doesNotMatch(speech, /\|\s*---/);
});

test("Records AI keeps ordinary prose available for speech playback", () => {
  assert.equal(
    recordsSearch.buildRecordsSearchSpeechText("The project was approved in **June**."),
    "The project was approved in June."
  );
});
