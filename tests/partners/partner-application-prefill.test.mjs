import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = new URL("../../partners/partners.js", import.meta.url);
const pagePath = new URL("../../partners/index.html", import.meta.url);

test("signed-in partner applications prefill known account details without overwriting entries", async () => {
  const [script, page] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert.match(page, /type="module" src="\/partners\/partners\.js\?v=5"/);
  assert.match(script, /getSessionOrNull\(supabase\)/);
  assert.match(script, /from\("profiles"\)/);
  assert.match(script, /from\("website_service_requests"\)/);
  assert.match(script, /if \(!input \|\| input\.value\.trim\(\) \|\| !cleanValue\) return false/);
  assert.match(script, /fillBlankField\("full_name"/);
  assert.match(script, /fillBlankField\("email"/);
  assert.match(script, /fillBlankField\("phone"/);
  assert.match(script, /fillBlankField\("organization"/);
  assert.match(script, /fillBlankField\("website"/);
});
