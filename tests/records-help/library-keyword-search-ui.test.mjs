import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
