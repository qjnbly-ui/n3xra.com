const twilio = require("twilio");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  const response = new twilio.twiml.VoiceResponse();
  if (String(req.body?.Digits || "") === "1") response.say("Connecting you now.");
  else response.hangup();
  return sendTwiML(res, response);
};
