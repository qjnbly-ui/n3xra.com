const twilio = require("twilio");
const { buildTwiML, publicHttpUrl, publicWebSocketUrl } = require("../_receptionist");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  if (String(req.body?.DialCallStatus || "") === "completed") {
    const response = new twilio.twiml.VoiceResponse();
    response.hangup();
    return sendTwiML(res, response);
  }
  const baseUrl = publicHttpUrl(req).replace(/\/api\/receptionist\/transfer-complete(?:\?.*)?$/, "");
  const xml = buildTwiML({
    websocketUrl: publicWebSocketUrl(req),
    actionUrl: `${baseUrl}/api/receptionist/transfer`,
    greeting: "Quentin is not available right now, but I can still help with NEXRA questions.",
    voice: String(process.env.TWILIO_RECEPTIONIST_VOICE || "").trim(),
  });
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(xml);
};
