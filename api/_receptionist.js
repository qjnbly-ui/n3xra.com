const DEFAULT_GREETING = "Thanks for calling NEXRA. You're speaking with our AI receptionist, a live demonstration of the intelligent systems we build. How can I help you today?";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function publicHost(req) {
  return String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "www.n3xra.com")
    .split(",")[0]
    .trim();
}

function publicHttpUrl(req) {
  const host = publicHost(req);
  const path = String(req?.url || "/api/receptionist/incoming");
  return `https://${host}${path}`;
}

function publicWebSocketUrl(req) {
  return `wss://${publicHost(req)}/api/receptionist/conversation`;
}

function toSpeechText(value) {
  return String(value || "")
    .replace(/\bN3XRA\b/gi, "NEXRA")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTwiML({ websocketUrl, greeting = DEFAULT_GREETING, voice = "" }) {
  const voiceAttribute = voice ? ` voice="${escapeXml(voice)}"` : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "  <Connect>",
    `    <ConversationRelay url="${escapeXml(websocketUrl)}" welcomeGreeting="${escapeXml(greeting)}" welcomeGreetingInterruptible="speech" language="en-US" transcriptionProvider="Deepgram" ttsProvider="ElevenLabs"${voiceAttribute} interruptSensitivity="medium" speechTimeout="auto" />`,
    "  </Connect>",
    "</Response>",
  ].join("\n");
}

module.exports = {
  DEFAULT_GREETING,
  buildTwiML,
  publicHttpUrl,
  publicWebSocketUrl,
  toSpeechText,
};
