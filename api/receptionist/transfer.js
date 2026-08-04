const twilio = require("twilio");
const { normalizePhone } = require("../_account-phone");
const { publicHttpUrl } = require("../_receptionist");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

function transferApproved(value) {
  try {
    return JSON.parse(String(value || "{}"))?.reasonCode === "approved-live-transfer";
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");

  const response = new twilio.twiml.VoiceResponse();
  if (!transferApproved(req.body?.HandoffData)) return sendTwiML(res, response);

  const transferNumber = normalizePhone(process.env.RECEPTIONIST_TRANSFER_NUMBER);
  const callerId = normalizePhone(process.env.TWILIO_RECEPTIONIST_NUMBER || "+15416526840");
  if (!transferNumber || !callerId) {
    response.say("I am sorry, live transfer is not available right now.");
    return sendTwiML(res, response);
  }

  const baseUrl = publicHttpUrl(req).replace(/\/api\/receptionist\/transfer(?:\?.*)?$/, "");
  response.say("One moment while I try to connect you.");
  const dial = response.dial({
    action: `${baseUrl}/api/receptionist/transfer-complete`,
    answerOnBridge: true,
    callerId,
    method: "POST",
    timeout: 25,
  });
  dial.number({ method: "POST", url: `${baseUrl}/api/receptionist/screen-transfer` }, transferNumber);
  return sendTwiML(res, response);
};

module.exports.transferApproved = transferApproved;
