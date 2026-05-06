const {
  encodeFilter,
  fetchJson,
  getBearerToken,
  hasSupabaseAdminConfig,
  serviceHeaders,
  verifySupabaseUser,
} = require("./_music-supabase");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";

function sendJson(res, status, body) {
  res.status(status).json(body);
}

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
    const body = readBody(req);
    const generationId = String(body.generation_id || "").trim();
    if (!generationId) {
      return sendJson(res, 400, { error: "Missing generation_id." });
    }

    await fetchJson(
      `${SUPABASE_URL}/rest/v1/music_generations?id=eq.${encodeFilter(generationId)}&user_id=eq.${encodeFilter(user.id)}`,
      {
        method: "DELETE",
        headers: serviceHeaders(),
      }
    );

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, Number(error?.status || 500), {
      error: error instanceof Error ? error.message : "Unable to delete song.",
    });
  }
};
