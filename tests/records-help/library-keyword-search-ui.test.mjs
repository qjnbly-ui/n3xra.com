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
