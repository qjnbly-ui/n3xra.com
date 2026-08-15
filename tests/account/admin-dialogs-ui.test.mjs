import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialogScriptPath = new URL("../../account/admin/admin-dialogs.js", import.meta.url);

test("admin confirmations use the browser top layer above an existing modal dialog", async () => {
  const script = await readFile(dialogScriptPath, "utf8");

  assert.match(script, /document\.createElement\("dialog"\)/);
  assert.match(script, /modal\.showModal\(\)/);
  assert.match(script, /modal\.close\(\)/);
  assert.match(script, /\.n3xra-admin-dialog\[open\]\{display:grid;place-items:center\}/);
  assert.doesNotMatch(script, /document\.createElement\("div"\)/);
});
