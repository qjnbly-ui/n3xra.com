const {
  allowedWebOrigin,
  consentHash,
  optionalAuthenticatedUser,
  recentWebConsentCount,
  recordSmsConsent,
  requestIp,
} = require("./_sms-consent");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!allowedWebOrigin(req)) return res.status(403).json({ error: "Invalid request origin." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (String(body.company || "").trim()) return res.status(200).json({ ok: true });
  if (body.consent !== true) return res.status(400).json({ error: "You must actively select the SMS consent checkbox." });
  try {
    const ipHash = consentHash(requestIp(req));
    if (await recentWebConsentCount(ipHash) >= 20) return res.status(429).json({ error: "Too many requests. Please try again later." });
    const user = await optionalAuthenticatedUser(req);
    await recordSmsConsent({
      phone: body.phone,
      method: "web_form",
      userId: user?.id || null,
      sourceUrl: String(body.sourceUrl || "https://www.n3xra.com/sms-consent/").slice(0, 500),
      ipHash,
      userAgent: req.headers["user-agent"],
    });
    return res.status(200).json({ ok: true, message: "Your N3XRA SMS preference has been saved." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to save SMS consent." });
  }
};
