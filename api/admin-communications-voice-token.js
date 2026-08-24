const twilio = require("twilio");
const { requirePlatformAdmin } = require("./_admin-communications");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const { user } = await requirePlatformAdmin(req);
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
    const keySid = String(process.env.TWILIO_API_KEY_SID || "").trim();
    const keySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();
    const appSid = String(process.env.TWILIO_TWIML_APP_SID || "").trim();
    if (!accountSid || !keySid || !keySecret || !appSid) return res.status(503).json({ success: false, error: "Calling needs its one-time Twilio Voice configuration." });
    const token = new twilio.jwt.AccessToken(accountSid, keySid, keySecret, { identity: `n3xra-admin-${user.id}`, ttl: 900 });
    token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: false }));
    return res.status(200).json({ success: true, token: token.toJwt(), expiresIn: 900 });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "Calling is unavailable." });
  }
};
