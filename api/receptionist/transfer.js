const twilio = require("twilio");
const { normalizePhone } = require("../_account-phone");
const { publicHttpUrl } = require("../_receptionist");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

function transferHandoff(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (parsed?.reasonCode !== "approved-live-transfer") return null;
    const summary = String(parsed.summary || "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "an email address")
      .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "a private number")
      .replace(/\b\d{4,}\b/g, "a private number")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return { summary: summary || "The caller has an important NEXRA business matter to discuss." };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");

  const response = new twilio.twiml.VoiceResponse();
  const handoff = transferHandoff(req.body?.HandoffData);
  if (!handoff) return sendTwiML(res, response);

  const transferNumber = normalizePhone(process.env.RECEPTIONIST_TRANSFER_NUMBER);
  const callerId = normalizePhone(process.env.TWILIO_RECEPTIONIST_NUMBER || "+15416526840");
  if (!transferNumber || !callerId) {
    response.say("I am sorry, live transfer is not available right now.");
    return sendTwiML(res, response);
  }

  const baseUrl = publicHttpUrl(req).replace(/\/api\/receptionist\/transfer(?:\?.*)?$/, "");
  const dial = response.dial({
    action: `${baseUrl}/api/receptionist/transfer-complete`,
    answerOnBridge: true,
    callerId,
    method: "POST",
    timeout: 25,
  });
  const encodedSummary = Buffer.from(handoff.summary, "utf8").toString("base64url");
  dial.number({ method: "POST", url: `${baseUrl}/api/receptionist/screen-transfer?summary=${encodedSummary}` }, transferNumber);
  return sendTwiML(res, response);
};

module.exports.transferHandoff = transferHandoff;
