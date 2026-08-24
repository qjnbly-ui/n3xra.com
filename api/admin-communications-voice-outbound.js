const twilio = require("twilio");
const { normalizePhone } = require("./_account-phone");
const { sendTwiML, validateTwilioWebhook } = require("./_twilio-webhook");
const { N3XRA_PHONE } = require("./_admin-communications");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  const response = new twilio.twiml.VoiceResponse();
  const recipient = normalizePhone(req.body?.To);
  if (!recipient || !N3XRA_PHONE) {
    response.say("This call could not be completed because the phone number was invalid.");
    response.hangup();
    return sendTwiML(res, response);
  }
  response.dial({ callerId: N3XRA_PHONE, answerOnBridge: true, timeout: 30 }).number(recipient);
  return sendTwiML(res, response);
};
