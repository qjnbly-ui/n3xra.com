const twilio = require("twilio");
const { recordSmsConsent } = require("../_sms-consent");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");
const { recordIncomingMessage } = require("../_admin-communications");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");

  const response = new twilio.twiml.MessagingResponse();
  const body = String(req.body?.Body || "").trim().toUpperCase();
  const from = String(req.body?.From || "").trim();
  try {
    await recordIncomingMessage(req.body).catch((error) => {
      console.error("Receptionist message could not be added to the admin inbox", { messageSid: req.body?.MessageSid, error: error?.message });
    });
    if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(body)) {
      await recordSmsConsent({ phone: from, eventType: "opt_out", method: "sms_keyword", sourceUrl: "sms:+15416526840" });
      response.message("N3XRA: You are unsubscribed and will receive no further messages. Reply START to opt in again.");
    } else if (/^(START|UNSTOP|SUBSCRIBE|YES)$/.test(body)) {
      await recordSmsConsent({ phone: from, method: "sms_keyword", sourceUrl: "sms:+15416526840" });
      response.message("N3XRA: You are opted in to requested transactional messages. Frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.");
    } else if (/^(HELP|INFO)$/.test(body)) {
      response.message("N3XRA: For help visit https://www.n3xra.com/support/ or email support@n3xra.com. Reply STOP to opt out.");
    }
  } catch (error) {
    console.error("Receptionist inbound SMS failed", { messageSid: req.body?.MessageSid, error: error?.message });
    response.message("N3XRA: We could not process that request. Visit https://www.n3xra.com/support/ for help.");
  }
  return sendTwiML(res, response);
};
