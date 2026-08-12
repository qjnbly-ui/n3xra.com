import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("site navigation loads the context-aware assistant outside Records", () => {
  const nav = fs.readFileSync(new URL("../../assets/site-nav.js", import.meta.url), "utf8");
  const assistant = fs.readFileSync(new URL("../../src/site-assistant/main.mts", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../../assets/site-assistant.css", import.meta.url), "utf8");
  assert.match(nav, /!location\.pathname\.startsWith\("\/n3xra-records"\)/);
  assert.match(nav, /site-assistant\/main\.mjs/);
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
  const assistant = fs.readFileSync(new URL("../../src/site-assistant/main.mts", import.meta.url), "utf8");
  const endpoint = fs.readFileSync(new URL("../../api/codebase-ai.js", import.meta.url), "utf8");
  assert.match(assistant, /audience === "admin"/);
  assert.match(assistant, /Turn on Codebase AI/);
  assert.match(assistant, /fetch\("\/api\/codebase-ai"/);
  assert.match(assistant, /if \(!button \|\| audience !== "admin"\) return/);
  assert.match(endpoint, /requireActivePlatformAdmin/);
  assert.match(endpoint, /SUPABASE_SECRET_KEY/);
  assert.match(endpoint, /startsWith\("sb_secret_"\)/);
});

test("the shared drawer owns voice and the homepage opens that one assistant", () => {
  const assistant = fs.readFileSync(new URL("../../src/site-assistant/main.mts", import.meta.url), "utf8");
  const voice = fs.readFileSync(new URL("../../src/site-assistant/voice.mts", import.meta.url), "utf8");
  const home = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const homeScript = fs.readFileSync(new URL("../../assets/home.js", import.meta.url), "utf8");
  assert.match(assistant, /AssistantVoiceController/);
  assert.match(assistant, /data-assistant-voice/);
  assert.match(voice, /elevenlabs-speech-to-text/);
  assert.match(voice, /elevenlabs-text-to-speech/);
  assert.match(home, /data-site-assistant-open/);
  assert.match(home, /Open Ask N3XRA/);
  assert.doesNotMatch(home, /id="ask-form"|id="ask-voice"|id="ask-input"/);
  assert.doesNotMatch(homeScript, /elevenlabs-speech-to-text|fetch\("\/api\/ask"/);
});

test("the shared assistant submits with Enter and preserves Shift+Enter for a new line", () => {
  const assistant = fs.readFileSync(new URL("../../src/site-assistant/main.mts", import.meta.url), "utf8");
  assert.match(assistant, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(assistant, /if \(!submit\.disabled\) form\.requestSubmit\(\)/);
});

test("browser assistant source is strict TypeScript with a dedicated production build", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../../tsconfig.site-assistant.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noUncheckedIndexedAccess, true);
  assert.match(pkg.scripts.build, /build:site-assistant/);
  assert.match(pkg.scripts.typecheck, /tsconfig\.site-assistant\.json/);
});

test("legacy ask endpoint is a tiny compatibility adapter", () => {
  const adapter = fs.readFileSync(new URL("../../api/ask.js", import.meta.url), "utf8");
  assert.ok(adapter.split("\n").length <= 6);
  assert.match(adapter, /_ai-core\/orchestrator/);
  assert.doesNotMatch(adapter, /api\.groq\.com|SUPABASE_SERVICE_ROLE_KEY/);
});
