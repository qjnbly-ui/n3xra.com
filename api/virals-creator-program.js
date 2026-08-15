const { CREATOR_PROGRAMS } = require("./_virals-billing");
const { countApprovedFoundingCreators, getBearerToken, hasViralsBusinessConfig, verifySupabaseUser } = require("./_virals-supabase");
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

  const limit = CREATOR_PROGRAMS.founding.maxApproved;
  if (!hasViralsBusinessConfig()) {
    return sendJson(res, 200, {
      founding: {
        approved: 0,
        limit,
        remaining: limit,
      },
    });
  }

  try {
    const approved = await countApprovedFoundingCreators();
    return sendJson(res, 200, {
      founding: {
        approved,
        limit,
        remaining: Math.max(0, limit - approved),
      },
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to load creator program." });
  }
};
