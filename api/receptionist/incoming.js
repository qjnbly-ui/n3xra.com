const twilio = require("twilio");
const {
  DEFAULT_GREETING,
  buildTwiML,
  publicHttpUrl,
  publicWebSocketUrl,
} = require("../_receptionist");

function validateTwilioRequest(req) {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = String(req.headers["x-twilio-signature"] || "").trim();
  if (!authToken || !signature) return false;
  const params = req.body && typeof req.body === "object" ? req.body : {};
  return twilio.validateRequest(authToken, signature, publicHttpUrl(req), params);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method not allowed.");
  }

  if (!validateTwilioRequest(req)) {
    return res.status(403).send("Invalid Twilio signature.");
  }

  const voice = String(process.env.TWILIO_RECEPTIONIST_VOICE || "").trim();
  const greeting = String(process.env.TWILIO_RECEPTIONIST_GREETING || DEFAULT_GREETING).trim();
  const xml = buildTwiML({ websocketUrl: publicWebSocketUrl(req), greeting, voice });
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(xml);
};

module.exports.validateTwilioRequest = validateTwilioRequest;
