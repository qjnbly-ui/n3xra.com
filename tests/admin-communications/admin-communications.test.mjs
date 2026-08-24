import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.TWILIO_RECEPTIONIST_NUMBER = "+15416526840";

const require = createRequire(import.meta.url);
const communications = require("../../api/_admin-communications");

test("incoming receptionist texts are normalized and recorded in the private admin inbox", async () => {
  const previousFetch = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/record_admin_communication_message$/);
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, async text() { return JSON.stringify([{ message_id: "message-1", thread_id: "thread-1" }]); } };
  };
  try {
    const result = await communications.recordIncomingMessage({
      From: "+1 (541) 555-0100",
      To: "+15416526840",
      MessageSid: "SM-INBOUND-1",
      Body: "Can you help me?",
      NumMedia: "0",
    });
    assert.equal(result.thread_id, "thread-1");
    assert.equal(payload.p_phone_e164, "+15415550100");
    assert.equal(payload.p_direction, "inbound");
    assert.equal(payload.p_to_e164, "+15416526840");
  } finally {
    global.fetch = previousFetch;
  }
});

test("the admin communications feature keeps credentials server-side and consent gated", async () => {
  const [helper, endpoint, migration, page, navigation] = await Promise.all([
    readFile(new URL("../../api/_admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../api/admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260824193252_add_admin_calls_and_messages.sql", import.meta.url), "utf8"),
    readFile(new URL("../../account/admin/communications/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../account/admin/admin-navigation.js", import.meta.url), "utf8"),
  ]);
  assert.match(endpoint, /requirePlatformAdmin\(req\)/);
  assert.match(helper, /phoneIsOptedIn\(recipient\)/);
  assert.match(helper, /TWILIO_RECEPTIONIST_NUMBER/);
  assert.doesNotMatch(page, /TWILIO_AUTH_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.admin_communication_threads from public, anon, authenticated/);
  assert.match(migration, /set search_path = ''/);
  assert.match(navigation, /Calls & Messages/);
  assert.match(navigation, /communications\.startCommunications\(\)/);
  assert.match(page, /Mass updates remain in Account Announcements/);
});

test("browser calling obtains a short-lived token from an admin-only Supabase function", async () => {
  const [browser, page, voiceSdk, voiceFunction, migration, config] = await Promise.all([
    readFile(new URL("../../account/admin/communications/communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../account/admin/communications/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../assets/vendor/twilio-voice.min.js", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/functions/admin-voice-token/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260824195612_add_admin_voice_configuration.sql", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  assert.match(browser, /functions\.invoke\("admin-voice-token"/);
  assert.match(browser, /\/assets\/vendor\/twilio-voice\.min\.js\?v=1/);
  assert.doesNotMatch(browser, /sdk\.twilio\.com/);
  assert.doesNotMatch(page, /sdk\.twilio\.com/);
  assert.ok(voiceSdk.length > 100_000, "the locally hosted Twilio Voice SDK is present");
  assert.match(voiceFunction, /\.from\("platform_admins"\)/);
  assert.match(voiceFunction, /\.eq\("status", "active"\)/);
  assert.match(voiceFunction, /exp: now \+ 900/);
  assert.match(voiceFunction, /N3XRA Admin Browser Calling/);
  assert.match(voiceFunction, /admin-communications-voice-outbound/);
  assert.doesNotMatch(browser, /TWILIO_API_KEY_SECRET|twilio_api_key_secret/);
  assert.match(migration, /revoke all on table public\.admin_voice_configuration from public, anon, authenticated/);
  assert.match(config, /\[functions\.admin-voice-token\]\s*verify_jwt = true/);
});
