const { getBearerToken, getExistingViralsAccount, hasViralsBusinessConfig, verifySupabaseUser } = require("./_virals-supabase");
const { VIRALS_PLANS } = require("./_virals-billing");
const { sendJson } = require("./_virals-http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasViralsBusinessConfig()) {
    return sendJson(res, 200, { configured: false, plans: VIRALS_PLANS });
  }

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);
    const account = await getExistingViralsAccount(user);
    return sendJson(res, 200, { configured: true, plans: VIRALS_PLANS, ...account });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to load Virals account." });
  }
};
