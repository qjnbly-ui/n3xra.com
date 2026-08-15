const { getBearerToken, getPromoCodeStatus, hasViralsBusinessConfig, verifySupabaseUser } = require("./_virals-supabase");
const { normalizePromoCode } = require("./_virals-billing");
const { sendJson } = require("./_virals-http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }


  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Administrator sign-in is required." });
    await verifySupabaseUser(token);
  } catch (error) {
    return sendJson(res, error.status || 403, { error: error instanceof Error ? error.message : "Administrator access is required." });
  }

  if (!hasViralsBusinessConfig()) return sendJson(res, 503, { error: "Main Supabase billing is not configured." });

  try {
    const code = normalizePromoCode(new URL(req.url, "http://localhost").searchParams.get("code"));
    const result = await getPromoCodeStatus(code);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to check promo code." });
  }
};
