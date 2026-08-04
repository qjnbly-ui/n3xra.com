import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const twilio = require("twilio");
const incomingHandler = require("../../api/receptionist/incoming");
const conversationServer = require("../../api/receptionist/conversation");
const transferHandler = require("../../api/receptionist/transfer");
const screenTransferHandler = require("../../api/receptionist/screen-transfer");
const inboundSmsHandler = require("../../api/receptionist/sms");
const { allowedWebOrigin } = require("../../api/_sms-consent");
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
  assert.match(xml, /What brings you to NEXRA today\?/);
  assert.match(xml, /welcomeGreetingInterruptible="none"/);
});

test("ConversationRelay can return approved calls to a signed transfer action", () => {
  const xml = buildTwiML({
    websocketUrl: "wss://www.n3xra.com/api/receptionist/conversation",
    actionUrl: "https://www.n3xra.com/api/receptionist/transfer",
  });
  assert.match(xml, /<Connect action="https:\/\/www\.n3xra\.com\/api\/receptionist\/transfer" method="POST">/);
  assert.equal(transferHandler.transferHandoff('{"reasonCode":"approved-live-transfer","summary":"A project inquiry."}').summary, "A project inquiry.");
  assert.equal(transferHandler.transferHandoff('{"reasonCode":"anything-else"}'), null);
});

test("approved transfer callbacks dial a screened private destination", async () => {
  const previousAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const previousTransferNumber = process.env.RECEPTIONIST_TRANSFER_NUMBER;
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  process.env.RECEPTIONIST_TRANSFER_NUMBER = "+15415550199";
  const body = { HandoffData: '{"reasonCode":"approved-live-transfer"}' };
  const req = {
    method: "POST",
    url: "/api/receptionist/transfer",
    body,
    headers: { host: "www.n3xra.com" },
  };
  req.headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN,
    publicHttpUrl(req),
    body,
  );
  let statusCode = 0;
  let xml = "";
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    send(value) { xml = String(value); return this; },
  };
  await transferHandler(req, res);
  assert.equal(statusCode, 200);
  assert.match(xml, /<Dial[^>]+answerOnBridge="true"[^>]+callerId="\+15416526840"/);
  assert.match(xml, /<Number[^>]+screen-transfer[^>]*>\+15415550199<\/Number>/);
  if (previousAuthToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = previousAuthToken;
  if (previousTransferNumber === undefined) delete process.env.RECEPTIONIST_TRANSFER_NUMBER;
  else process.env.RECEPTIONIST_TRANSFER_NUMBER = previousTransferNumber;
});

test("transfer summaries remove contact details and use the same ConversationRelay voice path", () => {
  const handoff = transferHandler.transferHandoff('{"reasonCode":"approved-live-transfer","summary":"Call Pat at pat@example.com or 541-555-0199 about a website."}');
  assert.doesNotMatch(handoff.summary, /pat@example|541/);
  const encoded = Buffer.from("The caller wants a website proposal.", "utf8").toString("base64url");
  assert.equal(screenTransferHandler.transferSummary(encoded), "The caller wants a website proposal.");
});

test("private transfer screening uses ElevenLabs and reads the purpose summary", async () => {
  const previousAuthToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  const encoded = Buffer.from("The caller needs a custom software proposal.", "utf8").toString("base64url");
  const req = {
    method: "POST",
    url: `/api/receptionist/screen-transfer?summary=${encoded}`,
    query: { summary: encoded },
    body: {},
    headers: { host: "www.n3xra.com" },
  };
  req.headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN,
    publicHttpUrl(req),
    req.body,
  );
  let xml = "";
  const res = {
    setHeader() {},
    status() { return this; },
    send(value) { xml = String(value); return this; },
  };
  await screenTransferHandler(req, res);
  assert.match(xml, /ttsProvider="ElevenLabs"/);
  assert.match(xml, /screen-conversation/);
  assert.match(xml, /The caller needs a custom software proposal\./);
  assert.match(xml, /reportInputDuringAgentSpeech="dtmf"/);
  if (previousAuthToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = previousAuthToken;
});

test("account overview requests are separated from general receptionist questions", () => {
  assert.equal(conversationServer.isAccountOverviewRequest("Can you give me my account overview?"), true);
  assert.equal(conversationServer.isAccountOverviewRequest("How much usage is left on my plan?"), true);
  assert.equal(conversationServer.isAccountOverviewRequest("What does N3XRA Records do?"), false);
});

test("password reset requests are routed to the secured account action", () => {
  assert.equal(conversationServer.isPasswordResetRequest("I forgot my password"), true);
  assert.equal(conversationServer.isPasswordResetRequest("Please send me a reset link"), true);
  assert.equal(conversationServer.isPasswordResetRequest("I can't sign in to my account"), true);
  assert.equal(conversationServer.isPasswordResetRequest("Can you email a project estimate?"), false);
});

test("live transfer confirmation and emergency language are recognized", () => {
  assert.equal(conversationServer.isAffirmativeTransferResponse("Yes, please"), true);
  assert.equal(conversationServer.isNegativeTransferResponse("No thanks"), true);
  assert.equal(conversationServer.isEmergencyRequest("Someone is in immediate danger"), true);
});

test("confirmed transfers announce the connection before ending ConversationRelay", async () => {
  const sent = [];
  const ws = {
    readyState: 1,
    transferStarting: false,
    transferSummary: "The caller is exploring an investment in NEXRA.",
    send(value) { sent.push(JSON.parse(value)); },
  };
  conversationServer.announceAndTransfer(ws, 0);
  assert.equal(sent[0].type, "text");
  assert.match(sent[0].token, /connect you with Quentin/i);
  assert.equal(sent[0].interruptible, false);
  assert.equal(ws.transferStarting, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent[1].type, "end");
  assert.match(sent[1].handoffData, /approved-live-transfer/);
});

test("receptionist recognizes requested texts and only returns approved N3XRA links", () => {
  assert.equal(conversationServer.isSmsRequest("Can you text me the pricing link?"), true);
  assert.equal(conversationServer.isSmsRequest("Tell me about pricing."), false);
  assert.deepEqual(
    conversationServer.smsResourceFor("Text me pricing information"),
    { label: "N3XRA services", url: "https://www.n3xra.com/services/" },
  );
  assert.deepEqual(
    conversationServer.smsResourceFor("Please send a link", [{ role: "user", content: "I need help signing into my account" }]),
    { label: "N3XRA account page", url: "https://www.n3xra.com/account/" },
  );
});

test("public SMS consent accepts only N3XRA and local browser origins", () => {
  assert.equal(allowedWebOrigin({ headers: { origin: "https://www.n3xra.com" } }), true);
  assert.equal(allowedWebOrigin({ headers: { origin: "https://preview.vercel.app" } }), true);
  assert.equal(allowedWebOrigin({ headers: { origin: "https://example.com" } }), false);
});

test("inbound HELP messages use a signed Twilio messaging webhook", async () => {
  const previousAuthToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  const body = { Body: "HELP", From: "+15415550199", MessageSid: "SM123" };
  const req = { method: "POST", url: "/api/receptionist/sms", body, headers: { host: "www.n3xra.com" } };
  req.headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN,
    publicHttpUrl(req),
    body,
  );
  let statusCode = 0;
  let xml = "";
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    send(value) { xml = String(value); return this; },
  };
  await inboundSmsHandler(req, res);
  assert.equal(statusCode, 200);
  assert.match(xml, /For help visit https:\/\/www\.n3xra\.com\/support\//);
  assert.match(xml, /Reply STOP to opt out/);
  if (previousAuthToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = previousAuthToken;
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
