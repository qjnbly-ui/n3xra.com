const twilio = require("twilio");
const { publicHttpUrl } = require("./_receptionist");

function validateTwilioWebhook(req) {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = String(req.headers["x-twilio-signature"] || "").trim();
  if (!authToken || !signature) return false;
  const params = req.body && typeof req.body === "object" ? req.body : {};
  return twilio.validateRequest(authToken, signature, publicHttpUrl(req), params);
}

function sendTwiML(res, response) {
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(response.toString());
}

module.exports = { sendTwiML, validateTwilioWebhook };
