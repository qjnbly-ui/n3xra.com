const {
  getBearerToken,
  getMusicAccount,
  hasSupabaseAdminConfig,
  importMusicGenerations,
  verifySupabaseUser,
} = require("./_music-supabase");

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function getErrorStatus(error) {
  return Number(error?.status || 500);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasSupabaseAdminConfig()) {
    return sendJson(res, 500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const token = getBearerToken(req);
    const user = await verifySupabaseUser(token);
    await getMusicAccount(user);

    const body = readBody(req);
    const imported = await importMusicGenerations(user.id, body.songs || []);
    const account = await getMusicAccount(user);

    return sendJson(res, 200, {
      ok: true,
      imported: imported.length,
      ...account,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error instanceof Error ? error.message : "Unable to import songs.",
    });
  }
};
