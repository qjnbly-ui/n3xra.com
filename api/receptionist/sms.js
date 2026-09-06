const twilio = require("twilio");
const { recordSmsConsent, latestConsent } = require("../_sms-consent");
const { sendTwiML, validateTwilioWebhook } = require("../_twilio-webhook");
const { maybeReplyWithNex, recordIncomingMessage } = require("../_admin-communications");

const { isTextedPin, issueSmsLink, revokeSmsAccess, smsAccountStatus } = require("../_sms-verification");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");

  const response = new twilio.twiml.MessagingResponse();
  const body = String(req.body?.Body || "").trim().toUpperCase();
  const from = String(req.body?.From || "").trim();
  try {
    const pinText = isTextedPin(String(req.body?.Body || ""));
    const safePayload = pinText ? { ...req.body, Body: "[PIN text omitted]" } : req.body;
    const recordedMessage = await recordIncomingMessage(safePayload).catch((error) => {
      console.error("Receptionist message could not be added to the admin inbox", { messageSid: req.body?.MessageSid, error: error?.message });
      return null;
    });
    if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(body)) {
      await revokeSmsAccess(from);
      await recordSmsConsent({ phone: from, eventType: "opt_out", method: "sms_keyword", sourceUrl: "sms:+15416526840" });
      response.message("N3XRA: You are unsubscribed and will receive no further messages. Reply START to opt in again.");
    } else if (/^(START|UNSTOP|SUBSCRIBE|YES)$/.test(body)) {
      await recordSmsConsent({ phone: from, method: "sms_keyword", sourceUrl: "sms:+15416526840" });
      response.message("N3XRA: You are opted in to requested transactional messages. Frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.");
    } else if (/^(HELP|INFO)$/.test(body)) {
      response.message("N3XRA: For help visit https://www.n3xra.com/support/ or email support@n3xra.com. Reply STOP to opt out.");
    } else if (pinText) {
      response.message("Please do not text your PIN. Text VERIFY for a sign-in link instead. Your PIN was omitted from the N3XRA inbox.");
    } else if (/^(LOCK|LOG OUT|LOGOUT)$/i.test(body)) {
      await revokeSmsAccess(from);
      response.message("Secure text access is now locked. Text VERIFY whenever you want to enable account-status replies again.");
    } else if (/^(VERIFY|SIGN IN|SECURE TEXTING|ACCOUNT STATUS|WHAT IS MY ACCOUNT STATUS\??)$/i.test(body)) {
      if ((await latestConsent(from))?.event_type !== "opt_in") {
        response.message("Text START to enable requested text replies, then text VERIFY for a sign-in link.");
      } else if (!recordedMessage?.thread_id) {
        response.message("Secure texting is temporarily unavailable. Please try again shortly.");
      } else if (/ACCOUNT STATUS/.test(body)) {
        response.message(await smsAccountStatus(recordedMessage.thread_id, from));
      } else {
        response.message(await issueSmsLink(recordedMessage.thread_id, from));
      }
    } else if (recordedMessage) {
      await maybeReplyWithNex({ message: recordedMessage, payload: req.body, req }).catch((error) => {
        console.error("Nex could not reply to the incoming text", { messageSid: req.body?.MessageSid, error: error?.message });
      });
    }
  } catch (error) {
    console.error("Receptionist inbound SMS failed", { messageSid: req.body?.MessageSid, error: error?.message });
    response.message("N3XRA: We could not process that request. Visit https://www.n3xra.com/support/ for help.");
  }
  return sendTwiML(res, response);
};
