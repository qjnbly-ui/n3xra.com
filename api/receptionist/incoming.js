const twilio = require("twilio");
const {
  DEFAULT_GREETING,
  buildTwiML,
  publicHttpUrl,
  publicWebSocketUrl,
} = require("../_receptionist");
const { getCallerAccount } = require("../_account-phone");

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
  const callerNumber = String(req.body?.From || req.query?.From || "").trim();
  const caller = await getCallerAccount(callerNumber).catch(() => null);
  const recognizedGreeting = caller?.firstName
    ? `Welcome back, ${caller.firstName}. You're speaking with our NEXRA AI receptionist, a live demonstration of the intelligent systems we build. How can I help you today?`
    : "";
  const greeting = recognizedGreeting || String(process.env.TWILIO_RECEPTIONIST_GREETING || DEFAULT_GREETING).trim();
  const xml = buildTwiML({ websocketUrl: publicWebSocketUrl(req), greeting, voice });
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(xml);
};

module.exports.validateTwilioRequest = validateTwilioRequest;
