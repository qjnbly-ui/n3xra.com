import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("site navigation loads the context-aware assistant outside Records", () => {
  const nav = fs.readFileSync(new URL("../../assets/site-nav.js", import.meta.url), "utf8");
  const assistant = fs.readFileSync(new URL("../../assets/site-assistant.js", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../../assets/site-assistant.css", import.meta.url), "utf8");
  assert.match(nav, /!location\.pathname\.startsWith\("\/n3xra-records"\)/);
  assert.match(nav, /site-assistant\.js/);
  assert.match(assistant, /site-assistant-nav-trigger/);
  assert.match(assistant, /site-assistant-drawer/);
  assert.match(assistant, /container\.prepend\(trigger\)/);
  assert.match(styles, /\.site-assistant-layer/);
  assert.doesNotMatch(styles, /bottom:22px/);
  assert.match(assistant, /Authorization: `Bearer \$\{session\.token\}`/);
  assert.match(assistant, /conversationId/);
  assert.match(assistant, /adminView/);
  assert.match(assistant, /HISTORY_KEY}:\$\{session\.scope/);
});

test("verified admins can explicitly switch the nav assistant to private Codebase AI", () => {
  const assistant = fs.readFileSync(new URL("../../assets/site-assistant.js", import.meta.url), "utf8");
  const endpoint = fs.readFileSync(new URL("../../api/codebase-ai.js", import.meta.url), "utf8");
  assert.match(assistant, /audience === "admin"/);
  assert.match(assistant, /Turn on Codebase AI/);
  assert.match(assistant, /fetch\("\/api\/codebase-ai"/);
  assert.match(assistant, /if \(!button \|\| audience !== "admin"\) return/);
  assert.match(endpoint, /requireActivePlatformAdmin/);
  assert.match(endpoint, /SUPABASE_SECRET_KEY/);
  assert.match(endpoint, /startsWith\("sb_secret_"\)/);
});

test("legacy ask endpoint is a tiny compatibility adapter", () => {
  const adapter = fs.readFileSync(new URL("../../api/ask.js", import.meta.url), "utf8");
  assert.ok(adapter.split("\n").length <= 6);
  assert.match(adapter, /_ai-core\/orchestrator/);
  assert.doesNotMatch(adapter, /api\.groq\.com|SUPABASE_SERVICE_ROLE_KEY/);
});
