const twilio = require("twilio");
const { publicHttpUrl } = require("../_receptionist");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  const baseUrl = publicHttpUrl(req).replace(/\/api\/receptionist\/screen-transfer(?:\?.*)?$/, "");
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    action: `${baseUrl}/api/receptionist/accept-transfer`,
    method: "POST",
    numDigits: 1,
    timeout: 8,
  });
  gather.say("NEXRA AI has screened an important business caller. Press 1 to accept the call.");
  response.hangup();
  return sendTwiML(res, response);
};
