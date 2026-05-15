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

function isActivePaidMusicProfile(profile) {
  if (!profile) return false;
  const plan = String(profile.plan || "free").trim().toLowerCase();
  const status = String(profile.account_status || "active").trim().toLowerCase();
  const cancelAtPeriodEnd = Boolean(profile.cancel_at_period_end);
  return ["creator", "studio"].includes(plan) && !["canceled", "suspended"].includes(status) && !cancelAtPeriodEnd;
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
    const rawBody = typeof req.body === "string"
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return {};
          }
        })()
      : (req.body && typeof req.body === "object" ? req.body : {});
    const scope = String(rawBody.scope || "app").trim().toLowerCase();
    if (scope !== "app") {
      return sendJson(res, 400, { error: "Unsupported delete scope." });
    }

    const musicProfileRows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/music_profiles?select=user_id,plan,account_status,cancel_at_period_end&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    );
    const musicProfile = Array.isArray(musicProfileRows) ? musicProfileRows[0] || null : null;

    if (isActivePaidMusicProfile(musicProfile)) {
      return sendJson(res, 400, { error: "Cancel your paid AI Music plan before deleting this profile." });
    }

    await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations?user_id=eq.${encodeFilter(user.id)}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    });

    await fetchJson(
      `${SUPABASE_URL}/rest/v1/reviews?app=eq.ai_music&review_target_type=eq.profile&review_target_id=eq.${encodeFilter(user.id)}`,
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ user_id: null }),
      }
    ).catch((error) => {
      const message = String(error?.message || "").toLowerCase();
      if (!message.includes("reviews")) throw error;
    });

    await fetchJson(`${SUPABASE_URL}/rest/v1/music_profiles?user_id=eq.${encodeFilter(user.id)}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    });

    return sendJson(res, 200, { ok: true, scope: "app" });
  } catch (error) {
    const status = Number(error?.status || 500);
    return sendJson(res, status, {
      error: error instanceof Error ? error.message : "Unable to delete AI Music profile.",
    });
  }
};
