const {
  allowedWebOrigin,
  consentHash,
  optionalAuthenticatedUser,
  recentWebConsentCount,
  recordSmsConsent,
  requestIp,
} = require("./_sms-consent");
const { getCredentialByUser, normalizePhone } = require("./_account-phone");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!allowedWebOrigin(req)) return res.status(403).json({ error: "Invalid request origin." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (String(body.company || "").trim()) return res.status(200).json({ ok: true });
  try {
    const user = await optionalAuthenticatedUser(req);
    const optingIn = body.consent === true;
    if (!optingIn) {
      if (!user?.id) return res.status(400).json({ error: "You must actively select the SMS consent checkbox." });
      const credential = await getCredentialByUser(user.id);
      if (!credential?.phone_e164 || credential.phone_e164 !== normalizePhone(body.phone)) {
        return res.status(403).json({ error: "That phone number is not connected to your account." });
      }
    }
    const ipHash = consentHash(requestIp(req));
    if (await recentWebConsentCount(ipHash) >= 20) return res.status(429).json({ error: "Too many requests. Please try again later." });
    await recordSmsConsent({
      phone: body.phone,
      eventType: optingIn ? "opt_in" : "opt_out",
      method: "web_form",
      userId: user?.id || null,
      sourceUrl: String(body.sourceUrl || "https://www.n3xra.com/sms-consent/").slice(0, 500),
      ipHash,
      userAgent: req.headers["user-agent"],
    });
    return res.status(200).json({
      ok: true,
      active: optingIn,
      message: optingIn ? "Your N3XRA SMS preference has been saved." : "N3XRA SMS messages have been turned off.",
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to save SMS consent." });
  }
};
