const {
  getBearerToken,
  getMusicAccount,
  hasSupabaseAdminConfig,
  verifySupabaseUser,
} = require("./_music-supabase");

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function getErrorStatus(error) {
  return Number(error?.status || 500);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasSupabaseAdminConfig()) {
    return sendJson(res, 500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const token = getBearerToken(req);
    const user = await verifySupabaseUser(token);
    const account = await getMusicAccount(user);
    return sendJson(res, 200, { ok: true, ...account });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error instanceof Error ? error.message : "Unable to load AI Music account.",
    });
  }
};
