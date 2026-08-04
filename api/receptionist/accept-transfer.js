const twilio = require("twilio");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  const response = new twilio.twiml.VoiceResponse();
  let accepted = false;
  try {
    accepted = JSON.parse(String(req.body?.HandoffData || "{}"))?.reasonCode === "screen-accepted";
  } catch {
    accepted = false;
  }
  if (!accepted) response.hangup();
  return sendTwiML(res, response);
};
