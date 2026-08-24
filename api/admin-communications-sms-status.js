const { validateTwilioWebhook } = require("./_twilio-webhook");
const { updateMessageStatus } = require("./_admin-communications");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed.");
  if (!validateTwilioWebhook(req)) return res.status(403).send("Invalid Twilio signature.");
  await updateMessageStatus(req.body?.MessageSid, req.body?.MessageStatus, req.body?.ErrorCode).catch((error) => console.error("N3XRA SMS status save failed", error));
  return res.status(204).send("");
};
