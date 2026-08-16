import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("submitted ownership-update requests can be updated or withdrawn from the public form", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("invest/index.html", projectRoot), "utf8"),
    readFile(new URL("invest/interest.js", projectRoot), "utf8"),
  ]);

  assert.match(html, /id="interest-submit"[^>]*>Request ownership updates<\/button>/);
  assert.match(html, /id="interest-withdraw"[^>]*hidden>Withdraw from Ownership Updates<\/button>/);
  assert.match(script, /submitButton\.textContent = data\.status === "withdrawn" \? "Rejoin ownership updates" : "Update my information"/);
  assert.match(script, /withdrawButton\.hidden = data\.status === "withdrawn"/);
  assert.match(script, /status: "withdrawn",[\s\S]*withdrawn_at: new Date\(\)\.toISOString\(\),[\s\S]*email_updates: false/);
  assert.match(script, /withdrawButton\.addEventListener\("click", handleWithdrawal\)/);
});
