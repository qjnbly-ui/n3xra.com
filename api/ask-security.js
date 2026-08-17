const { AssistantError } = require("./_ai-core/contracts");
const { publicAiSecurity } = require("./_ai-core/public-ai-security");

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method === "GET") {
      const verified = publicAiSecurity.hasGrant(req);
      return res.status(verified ? 200 : 401).json({ verified });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed." }); }
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, "utf8") > 8 * 1024) return res.status(413).json({ error: "Request body is too large." });
    const grant = await publicAiSecurity.verifyChallenge(String(body(req).captchaToken || "").trim().slice(0, 4096), req);
    res.setHeader("Set-Cookie", publicAiSecurity.cookie(grant));
    return res.status(200).json({ verified: true });
  } catch (error) {
    const known = error instanceof AssistantError ? error : new AssistantError("internal_error", "The security check could not be completed.", 500);
    return res.status(known.status).json({ error: known.message, code: known.code });
  }
};
