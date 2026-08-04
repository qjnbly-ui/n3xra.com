const { buildTwiML, publicHttpUrl, publicWebSocketUrl } = require("../_receptionist");
const { validateTwilioWebhook } = require("../_twilio-webhook");

function transferSummary(value) {
  try {
    return Buffer.from(String(value || ""), "base64url").toString("utf8").replace(/\s+/g, " ").trim().slice(0, 180);
  } catch {
    return "";
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  const baseUrl = publicHttpUrl(req).replace(/\/api\/receptionist\/screen-transfer(?:\?.*)?$/, "");
  const summary = transferSummary(req.query?.summary) || "The caller has an important NEXRA business matter to discuss.";
  const xml = buildTwiML({
    websocketUrl: publicWebSocketUrl(req, "/api/receptionist/screen-conversation"),
    actionUrl: `${baseUrl}/api/receptionist/accept-transfer`,
    greeting: `NEXRA AI screened this call. ${summary} Press 1 to accept, or press 2 to decline.`,
    voice: String(process.env.TWILIO_RECEPTIONIST_VOICE || "").trim(),
    welcomeGreetingInterruptible: "dtmf",
    reportInputDuringAgentSpeech: "dtmf",
  });
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(xml);
};

module.exports.transferSummary = transferSummary;
