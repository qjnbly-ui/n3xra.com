const SUPABASE_URL = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
const MUSIC_HISTORY_LIMIT = 30;

class SupabaseApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = "SupabaseApiError";
    this.status = status;
    this.data = data;
  }
}

function hasSupabaseAdminConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function userHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || data?.msg || `Supabase request failed with status ${response.status}.`);
    throw new SupabaseApiError(message, response.status, data);
  }

  return data;
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function getUserDisplayName(user) {
  return String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
}

function normalizeProfile(profile) {
  if (!profile) return null;
  return {
    user_id: profile.user_id,
    display_name: profile.display_name || "",
    plan: profile.plan || "free",
    account_status: profile.account_status || "active",
    monthly_song_limit: Number(profile.monthly_song_limit || 0),
    songs_used: Number(profile.songs_used || 0),
    current_period_start: profile.current_period_start || null,
    current_period_end: profile.current_period_end || null,
    cancel_at_period_end: Boolean(profile.cancel_at_period_end),
    subscription_current_period_end: profile.subscription_current_period_end || null,
    billing_portal_available: Boolean(profile.stripe_subscription_id || profile.stripe_price_id),
  };
}

function normalizeGeneration(row) {
  return {
    id: row.id,
    title: row.title || "Untitled song",
    prompt: row.prompt || "Generated song",
    instrumental: Boolean(row.instrumental),
    task_id: row.task_id || "",
    status: row.status || "",
    audio_url: row.audio_url || "",
    error_message: row.error_message || "",
    created_at: row.created_at || null,
    completed_at: row.completed_at || null,
  };
}

async function verifySupabaseUser(token) {
  if (!token) throw new SupabaseApiError("Authentication required.", 401);
  if (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY) {
    throw new SupabaseApiError("Missing Supabase API key.", 500);
  }

  const data = await fetchJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: userHeaders(token),
  });

  if (!data?.id) throw new SupabaseApiError("Invalid Supabase session.", 401, data);

  const administrators = await fetchJson(
    `${SUPABASE_URL}/rest/v1/platform_admins?select=user_id,role,status&user_id=eq.${encodeFilter(data.id)}&status=eq.active&role=in.(owner,admin)&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!Array.isArray(administrators) || !administrators.length) {
    throw new SupabaseApiError("Active N3XRA administrator access is required.", 403);
  }
  data.platform_admin = administrators[0];
  return data;
}

async function ensureProfileRow(user) {
  const payload = {
    id: user.id,
    email: user.email || null,
  };
  const fullName = getUserDisplayName(user);
  if (fullName) payload.full_name = fullName;

  await fetchJson(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(payload),
  });
}

async function loadMusicProfile(userId) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_profiles?select=*&user_id=eq.${encodeFilter(userId)}&limit=1`, {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listMusicGenerations(userId, limit = MUSIC_HISTORY_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || MUSIC_HISTORY_LIMIT, 50));
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations?select=id,title,prompt,instrumental,task_id,status,audio_url,error_message,created_at,completed_at&user_id=eq.${encodeFilter(userId)}&order=created_at.desc&limit=${safeLimit}`, {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows.map(normalizeGeneration) : [];
}

async function getExistingMusicAccount(user) {
  const profile = await loadMusicProfile(user.id);
  const generations = await listMusicGenerations(user.id);
  if (profile) return { profile: normalizeProfile(profile), generations, retired: true };
  return {
    profile: {
      user_id: user.id,
      display_name: getUserDisplayName(user) || String(user.email || "").trim(),
      plan: "retired_admin",
      account_status: "active",
      monthly_song_limit: 0,
      songs_used: generations.length,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      subscription_current_period_end: null,
      billing_portal_available: false,
      retired_admin_access: true,
    },
    generations,
    retired: true,
  };
}

async function updateMusicProfile(user, updates = {}) {
  const existingProfile = await loadMusicProfile(user.id);
  if (!existingProfile) {
    throw new SupabaseApiError("Profile settings are unavailable for retired administrator access.", 409);
  }
  await ensureProfileRow(user);

  const displayName = String(updates.display_name || "").trim().slice(0, 120);
  const fullName = displayName || null;
  const now = new Date().toISOString();

  await fetchJson(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeFilter(user.id)}`, {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email: user.email || null,
      full_name: fullName,
      updated_at: now,
    }),
  });

  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_profiles?user_id=eq.${encodeFilter(user.id)}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      display_name: fullName,
      updated_at: now,
    }),
  });

  const profile = Array.isArray(rows) ? rows[0] || null : null;
  return normalizeProfile(profile || (await loadMusicProfile(user.id)));
}

async function reserveMusicGeneration(_token, payload, user) {
  if (!user?.id) throw new SupabaseApiError("Authentication required.", 401);
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: user.id,
      title: payload.title || null,
      prompt: payload.prompt || null,
      lyrics: payload.lyrics || null,
      instrumental: Boolean(payload.instrumental),
      status: "reserved",
    }),
  });
  const generation = Array.isArray(rows) ? rows[0] || null : null;
  if (!generation?.id) throw new SupabaseApiError("Unable to reserve AI Music generation.", 500);
  return {
    generation_id: generation.id,
    songs_used: null,
    monthly_song_limit: null,
    current_period_end: null,
    plan: "retired_admin",
    account_status: "active",
    retired_admin_access: true,
  };
}

async function updateMusicGeneration(generationId, updates) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations?id=eq.${encodeFilter(generationId)}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getMusicGenerationByTask(userId, taskId) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations?select=*&user_id=eq.${encodeFilter(userId)}&task_id=eq.${encodeFilter(taskId)}&limit=1`, {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function refundMusicGeneration(userId, generationId, errorMessage) {
  await updateMusicGeneration(generationId, {
    status: "FAILURE",
    error_message: errorMessage || "Generation failed before a task was created.",
  }).catch(() => null);

  const profile = await loadMusicProfile(userId).catch(() => null);
  if (!profile) return;

  const nextCount = Math.max(0, Number(profile.songs_used || 0) - 1);
  await fetchJson(`${SUPABASE_URL}/rest/v1/music_profiles?user_id=eq.${encodeFilter(userId)}`, {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ songs_used: nextCount, updated_at: new Date().toISOString() }),
  }).catch(() => null);
}

async function importMusicGenerations(userId, songs) {
  const safeSongs = (Array.isArray(songs) ? songs : [])
    .slice(0, 20)
    .map((song) => {
      const audioUrl = String(song.url || song.audio_url || "").trim();
      if (!/^https?:\/\//i.test(audioUrl)) return null;
      const savedAt = song.savedAt ? new Date(song.savedAt) : new Date();
      const createdAt = Number.isNaN(savedAt.getTime()) ? new Date() : savedAt;
      return {
        user_id: userId,
        title: String(song.title || "Untitled song").slice(0, 160),
        prompt: String(song.prompt || "Generated song").slice(0, 1200),
        instrumental: Boolean(song.instrumental),
        status: "SUCCESS",
        audio_url: audioUrl,
        completed_at: createdAt.toISOString(),
        created_at: createdAt.toISOString(),
      };
    })
    .filter(Boolean);

  if (!safeSongs.length) return [];

  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/music_generations`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(safeSongs),
  });
  return Array.isArray(rows) ? rows.map(normalizeGeneration) : [];
}

module.exports = {
  SupabaseApiError,
  encodeFilter,
  fetchJson,
  getBearerToken,
  getExistingMusicAccount,
  updateMusicProfile,
  getMusicGenerationByTask,
  hasSupabaseAdminConfig,
  importMusicGenerations,
  loadMusicProfile,
  reserveMusicGeneration,
  serviceHeaders,
  updateMusicGeneration,
  refundMusicGeneration,
  verifySupabaseUser,
};
