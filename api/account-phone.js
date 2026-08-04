const {
  authenticatedUser,
  getCredentialByUser,
  saveCredential,
  validPin,
} = require("./_account-phone");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const user = await authenticatedUser(req);
    if (!user?.id) return res.status(401).json({ error: "Sign in to manage phone access." });
    if (req.method === "GET") {
      const credential = await getCredentialByUser(user.id);
      return res.status(200).json({
        configured: Boolean(credential),
        phone: credential?.phone_e164 || "",
        lastAuthenticatedAt: credential?.last_authenticated_at || null,
      });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!validPin(body.pin)) return res.status(400).json({ error: "Use a four-digit phone PIN." });
    if (String(body.pin) !== String(body.pinConfirm || "")) return res.status(400).json({ error: "Phone PINs do not match." });
    const credential = await saveCredential(user.id, body.phone, body.pin);
    return res.status(200).json({ configured: true, phone: credential?.phone_e164 || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to manage phone access.";
    const status = message.includes("already connected") ? 409 : 500;
    return res.status(status).json({ error: message });
  }
};
