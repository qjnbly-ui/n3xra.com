import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.TWILIO_RECEPTIONIST_NUMBER = "+15416526840";

const require = createRequire(import.meta.url);
const communications = require("../../api/_admin-communications");
const { generateNexConversationReply } = require("../../api/_nex-conversation");

test("Nex conversation replies inherit shared context and add text-specific safeguards", async () => {
  let request;
  const reply = await generateNexConversationReply({
    body: "Can you help with my website?",
    history: [{ role: "assistant", content: "What would you like to change?" }],
    accountKnown: true,
  }, {
    getContext: async () => "Your name is Nex. Use verified N3XRA knowledge.",
    providers: [{ name: "test", async complete() { throw new Error("unused"); } }],
    complete: async (_providers, value) => {
      request = value;
      return { result: { text: "Yes—I can help organize that request." } };
    },
  });
  assert.equal(reply, "Yes—I can help organize that request.");
  const prompt = request.messages.map((message) => message.content).join("\n");
  assert.match(prompt, /name is Nex/i);
  assert.match(prompt, /Never imply that you are Quentin or another human/i);
  assert.match(prompt, /under 600 characters/i);
});

test("compliance keywords stay in deterministic SMS handling instead of entering Nex", () => {
  for (const keyword of ["STOP", "start", "Help", "unsubscribe"]) {
    assert.equal(communications.isComplianceKeyword(keyword), true);
  }
  assert.equal(communications.isComplianceKeyword("Can Nex help me?"), false);
});

test("incoming receptionist texts are normalized and recorded in the private admin inbox", async () => {
  const previousFetch = global.fetch;
  let payload;
  let notificationPayload;
  global.fetch = async (url, options) => {
    if (/\/rest\/v1\/rpc\/record_admin_communication_message$/.test(url)) {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, async text() { return JSON.stringify([{ message_id: "message-1", thread_id: "thread-1" }]); } };
    }
    if (url.includes("admin_notifications?") && options?.method !== "POST") {
      return { ok: true, status: 200, async text() { return "[]"; } };
    }
    assert.match(url, /\/rest\/v1\/admin_notifications$/);
    notificationPayload = JSON.parse(options.body);
    return { ok: true, status: 201, async json() { return [notificationPayload]; } };
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
    assert.equal(notificationPayload.event_type, "communications.inbound_message");
    assert.equal(notificationPayload.source_id, "thread-1");
    assert.match(notificationPayload.action_url, /\/account\/admin\/communications\/\?thread=thread-1/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("the admin communications feature keeps credentials server-side and consent gated", async () => {
  const [helper, endpoint, migration, nexMigration, page, navigation] = await Promise.all([
    readFile(new URL("../../api/_admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../api/admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260824193739_add_admin_calls_and_messages.sql", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260825132519_add_nex_conversation_handoff.sql", import.meta.url), "utf8"),
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
  assert.match(nexMigration, /nex_mode in \('automatic', 'never'\)/);
  assert.match(nexMigration, /claim_admin_communication_nex_reply/);
  assert.match(nexMigration, /revoke execute on function public\.claim_admin_communication_nex_reply/);
  assert.match(navigation, /Calls & Messages/);
  assert.match(navigation, /data-admin-communications-count/);
  assert.match(navigation, /postgres_changes/);
  assert.match(helper, /communications\.inbound_message/);
  assert.match(helper, /admin_notifications\?event_type=eq\.communications\.inbound_message/);
  assert.match(navigation, /communications\.startCommunications\(\)/);
  assert.match(page, /Mass updates remain in Account Announcements/);
});

test("manual replies pause Nex and the conversation UI exposes automatic and never modes", async () => {
  const [helper, endpoint, browser] = await Promise.all([
    readFile(new URL("../../api/_admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../api/admin-communications.js", import.meta.url), "utf8"),
    readFile(new URL("../../account/admin/communications/communications.js", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /pauseNexForManualReply\(recipient\)/);
  assert.match(helper, /nex_pending_inbound_message_id: null/);
  assert.match(helper, /nexReplyStillAllowed/);
  assert.match(endpoint, /update_nex_settings/);
  assert.match(browser, /Never use Nex/);
  assert.match(browser, /Resume now/);
  assert.match(browser, /resumeAfterMinutes/);
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
  assert.match(browser, /n3xra:admin-notification-change/);
  assert.doesNotMatch(browser, /setInterval/);
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
