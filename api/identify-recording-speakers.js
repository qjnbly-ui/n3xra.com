const transcriptionApi = require("./transcribe-recording");
const { refreshIdentification } = require("./_records-speaker-identification");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
).trim();

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) throw new Error("Invalid session.");
  return user;
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_error) {
      return {};
    }
  }
  return {};
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const user = await verifyUser(bearerToken(req));
    const recordingId = String(requestBody(req).recordingId || "").trim();
    if (!recordingId) return res.status(400).json({ error: "recordingId is required." });
    const recording = await transcriptionApi._internal.loadRecording(recordingId);
    if (!recording) return res.status(404).json({ error: "Recording not found." });
    const organization = await transcriptionApi._internal.loadOrganization(recording.organization_id);
    if (!organization) return res.status(404).json({ error: "Recording library not found." });
    if (!(await transcriptionApi._internal.userCanTranscribeRecording(organization, user))) {
      return res.status(403).json({ error: "You do not have access to update this recording." });
    }

    const updated = await refreshIdentification(recording, { maxWaitMs: 20000 });
    if (updated?.speaker_identification_status === "ready" && updated.speaker_transcript_text) {
      await transcriptionApi._internal.uploadTranscriptDocument(updated, user, updated.speaker_transcript_text);
    }
    return res.status(200).json({ recording: updated });
  } catch (error) {
    const message = String(error?.message || "Unable to refresh speaker identification.");
    return res.status(/Authentication|required|Invalid session/i.test(message) ? 401 : 500).json({ error: message });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
