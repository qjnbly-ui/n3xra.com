import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const twilio = require("twilio");
const incomingHandler = require("../../api/receptionist/incoming");
const conversationServer = require("../../api/receptionist/conversation");
const {
  hashPin,
  matchesPin,
  normalizePhone,
  validPin,
} = require("../../api/_account-phone");
const {
  DEFAULT_GREETING,
  buildTwiML,
  publicHttpUrl,
  publicWebSocketUrl,
  toSpeechText,
} = require("../../api/_receptionist");

test("receptionist TwiML uses ConversationRelay and the ElevenLabs provider", () => {
  const xml = buildTwiML({ websocketUrl: "wss://www.n3xra.com/api/receptionist/conversation" });
  assert.match(xml, /<ConversationRelay/);
  assert.match(xml, /ttsProvider="ElevenLabs"/);
  assert.match(xml, /transcriptionProvider="Deepgram"/);
  assert.match(xml, /dtmfDetection="true"/);
  assert.match(xml, /wss:\/\/www\.n3xra\.com\/api\/receptionist\/conversation/);
  assert.match(xml, /Thanks for calling NEXRA\. You&apos;re speaking with our AI receptionist/);
});

test("account overview requests are separated from general receptionist questions", () => {
  assert.equal(conversationServer.isAccountOverviewRequest("Can you give me my account overview?"), true);
  assert.equal(conversationServer.isAccountOverviewRequest("How much usage is left on my plan?"), true);
  assert.equal(conversationServer.isAccountOverviewRequest("What does N3XRA Records do?"), false);
});

test("account phone numbers normalize to E.164 and PINs stay four digits", async () => {
  assert.equal(normalizePhone("(541) 652-6840"), "+15416526840");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("123"), "");
  assert.equal(validPin("1234"), true);
  assert.equal(validPin("12345"), false);
  const stored = await hashPin("4826", "0123456789abcdef0123456789abcdef");
  assert.equal(await matchesPin("4826", stored.salt, stored.hash), true);
  assert.equal(await matchesPin("4827", stored.salt, stored.hash), false);
});

test("receptionist output consistently pronounces the brand as NEXRA", () => {
  assert.equal(toSpeechText("Welcome to N3XRA. **How can I help?**"), "Welcome to NEXRA. How can I help?");
});

test("public Twilio URLs honor the forwarded production host", () => {
  const req = {
    url: "/api/receptionist/incoming",
    headers: { host: "internal.local", "x-forwarded-host": "www.n3xra.com" },
  };
  assert.equal(publicHttpUrl(req), "https://www.n3xra.com/api/receptionist/incoming");
  assert.equal(publicWebSocketUrl(req), "wss://www.n3xra.com/api/receptionist/conversation");
});

test("incoming voice requests require a valid Twilio signature", () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  const req = {
    url: "/api/receptionist/incoming",
    body: { CallSid: "CAtest", From: "+15415550100", To: "+15416526840" },
    headers: { host: "www.n3xra.com" },
  };
  req.headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN,
    publicHttpUrl(req),
    req.body,
  );
  assert.equal(incomingHandler.validateTwilioRequest(req), true);
  req.headers["x-twilio-signature"] = "invalid";
  assert.equal(incomingHandler.validateTwilioRequest(req), false);
  if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = previousToken;
});

test("the ConversationRelay WebSocket handshake requires a valid Twilio signature", () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  const req = {
    url: "/api/receptionist/conversation",
    headers: { host: "www.n3xra.com" },
  };
  req.headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN,
    conversationServer.publicWebSocketRequestUrl(req),
    {},
  );
  let accepted = false;
  conversationServer.verifyTwilioWebSocket({ req }, (valid) => { accepted = valid; });
  assert.equal(accepted, true);
  req.headers["x-twilio-signature"] = "invalid";
  conversationServer.verifyTwilioWebSocket({ req }, (valid) => { accepted = valid; });
  assert.equal(accepted, false);
  if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = previousToken;
});
