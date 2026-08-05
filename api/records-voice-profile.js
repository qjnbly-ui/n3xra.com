const { randomUUID } = require("crypto");
const { getRecordsAccessContext } = require("./_records-support-access");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const PYANNOTE_API_KEY = String(process.env.PYANNOTE_API_KEY || "").trim();
const PYANNOTE_API_URL = "https://api.pyannote.ai/v1";
const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
const MIN_AUDIO_BYTES = 4 * 1024;
const CONSENT_VERSION = "records-voice-profile-v1";
const ALLOWED_AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"],
]);

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body || "{}"));
    } catch (_error) {
      return Promise.resolve({});
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES * 1.5) {
        reject(new Error("Enrollment request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readJsonResponse(response, fallback) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || data?.msg || fallback || `Request failed (${response.status}).`));
  }
  return data;
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase authentication configuration.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await readJsonResponse(response, "Invalid session.");
  if (!user?.id) throw new Error("Invalid session.");
  return user;
}

async function serviceRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service configuration.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(options.headers || {}),
  });
  return readJsonResponse(response, "Unable to update the voice profile.");
}

async function loadOrganization(organizationId) {
  const rows = await serviceRequest(
    `organizations?select=id,owner_user_id,subscription_tier&id=eq.${encodeFilter(organizationId)}&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function requireOrganizationAccess(organizationId, user) {
  const organization = await loadOrganization(organizationId);
  if (!organization) throw new Error("Library not found.");
  const access = await getRecordsAccessContext(organization, user);
  if (!access.isMember) throw new Error("You do not have access to this library.");
  return { organization, access };
}

async function pyannoteRequest(path, options = {}) {
  if (!PYANNOTE_API_KEY) throw new Error("Voice enrollment is not configured yet.");
  const response = await fetch(`${PYANNOTE_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PYANNOTE_API_KEY}`,
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return readJsonResponse(response, "pyannoteAI could not process the voice sample.");
}

async function updateVoiceProfile(userId, patch) {
  const rows = await serviceRequest(`records_voice_profiles?user_id=eq.${encodeFilter(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getVoiceProfile(userId) {
  const rows = await serviceRequest(
    `records_voice_profiles?select=user_id,status,provider_job_id,consented_at,enrolled_at,revoked_at,last_error&user_id=eq.${encodeFilter(userId)}&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function refreshOwnProcessingProfile(userId) {
  const profile = await getVoiceProfile(userId);
  if (profile?.status !== "processing" || !profile.provider_job_id || !PYANNOTE_API_KEY) return profile;

  try {
    const job = await pyannoteRequest(`/jobs/${encodeURIComponent(profile.provider_job_id)}`);
    if (job?.status === "succeeded" && job?.output?.voiceprint) {
      return updateVoiceProfile(userId, {
        status: "enrolled",
        voiceprint: String(job.output.voiceprint),
        enrolled_at: new Date().toISOString(),
        revoked_at: null,
        last_error: null,
      });
    }
    if (["failed", "canceled"].includes(String(job?.status || ""))) {
      return updateVoiceProfile(userId, {
        status: "failed",
        voiceprint: null,
        last_error: String(job?.output?.error || "Voiceprint creation failed.").slice(0, 500),
      });
    }
  } catch (_error) {
    // Keep processing. A later status request can retry before pyannote removes the job output.
  }
  return profile;
}

async function listOrganizationVoiceStatuses(organization, currentUserId) {
  const memberships = await serviceRequest(
    `organization_memberships?select=user_id&organization_id=eq.${encodeFilter(organization.id)}`
  );
  const memberIds = Array.from(new Set([
    organization.owner_user_id,
    ...(Array.isArray(memberships) ? memberships.map((row) => row.user_id) : []),
  ].filter(Boolean)));
  if (!memberIds.length) return [];

  await refreshOwnProcessingProfile(currentUserId);
  const rows = await serviceRequest(
    `records_voice_profiles?select=user_id,status,consented_at,enrolled_at,revoked_at,last_error&user_id=in.(${memberIds.join(",")})`
  );
  const statusMap = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.user_id, row]));
  return memberIds.map((userId) => ({
    userId,
    status: statusMap.get(userId)?.status || "not_enrolled",
    consentedAt: statusMap.get(userId)?.consented_at || null,
    enrolledAt: statusMap.get(userId)?.enrolled_at || null,
    revokedAt: statusMap.get(userId)?.revoked_at || null,
    error: userId === currentUserId ? statusMap.get(userId)?.last_error || null : null,
  }));
}

function decodeAudio(body) {
  const mimeType = String(body.audioType || "").split(";")[0].trim().toLowerCase();
  const extension = ALLOWED_AUDIO_TYPES.get(mimeType);
  if (!extension) throw new Error("Use a WebM, M4A, MP3, WAV, or OGG voice recording.");
  const base64 = String(body.audioBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("The voice recording is invalid.");
  const audio = Buffer.from(base64, "base64");
  if (audio.length < MIN_AUDIO_BYTES) throw new Error("The voice recording is too short. Please record the complete script.");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("The voice recording is too large. Please record a shorter sample.");
  return { audio, mimeType, extension };
}

async function beginEnrollment(user, body) {
  if (body.consent !== true) throw new Error("Voice-profile consent is required.");
  const { audio, mimeType, extension } = decodeAudio(body);
  const now = new Date().toISOString();
  const objectKey = `records-voice-profiles/${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
  const mediaKey = `media://${objectKey}`;

  await serviceRequest("records_voice_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_id: user.id,
      provider: "pyannote",
      provider_model: "precision-2",
      status: "processing",
      voiceprint: null,
      provider_job_id: null,
      consent_version: CONSENT_VERSION,
      consented_at: now,
      enrolled_at: null,
      revoked_at: null,
      last_error: null,
    }),
  });

  try {
    const upload = await pyannoteRequest("/media/input", {
      method: "POST",
      body: JSON.stringify({ url: mediaKey }),
    });
    if (!upload?.url) throw new Error("pyannoteAI did not provide an upload location.");
    const uploadResponse = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: audio,
    });
    if (!uploadResponse.ok) throw new Error("The temporary voice sample upload failed.");
    const job = await pyannoteRequest("/voiceprint", {
      method: "POST",
      body: JSON.stringify({ url: mediaKey, model: "precision-2" }),
    });
    if (!job?.jobId) throw new Error("pyannoteAI did not start the voiceprint job.");
    await updateVoiceProfile(user.id, { provider_job_id: String(job.jobId), last_error: null });
    return { status: "processing" };
  } catch (error) {
    await updateVoiceProfile(user.id, {
      status: "failed",
      voiceprint: null,
      last_error: String(error?.message || "Voice enrollment failed.").slice(0, 500),
    }).catch(() => null);
    throw error;
  }
}

async function handler(req, res) {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const token = bearerToken(req);
    const user = await verifyUser(token);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const organizationId = String(req.query?.organizationId || body.organizationId || "").trim();
    if (!organizationId) return sendJson(res, 400, { error: "organizationId is required." });

    if (req.method === "GET") {
      const { organization } = await requireOrganizationAccess(organizationId, user);
      const profiles = await listOrganizationVoiceStatuses(organization, user.id);
      return sendJson(res, 200, { ok: true, profiles });
    }

    await requireOrganizationAccess(organizationId, user);
    if (req.method === "DELETE") {
      const existing = await getVoiceProfile(user.id);
      if (existing) {
        await updateVoiceProfile(user.id, {
          status: "revoked",
          voiceprint: null,
          provider_job_id: null,
          revoked_at: new Date().toISOString(),
          last_error: null,
        });
      }
      return sendJson(res, 200, { ok: true, status: "revoked" });
    }

    const result = await beginEnrollment(user, body);
    return sendJson(res, 202, { ok: true, ...result });
  } catch (error) {
    const message = String(error?.message || "Voice-profile request failed.");
    const status = /Authentication|required|Invalid session/i.test(message)
      ? 401
      : /do not have access|administrators/i.test(message)
        ? 403
        : /not configured|Missing Supabase/i.test(message)
          ? 503
          : 400;
    return sendJson(res, status, { error: message });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
module.exports._test = { decodeAudio, CONSENT_VERSION, MAX_AUDIO_BYTES, MIN_AUDIO_BYTES };
