const transcriptionApi = require("./transcribe-recording");
const { speakerTranscriptFromUtterances } = require("./_records-speaker-identification");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch (_error) {
    return {};
  }
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

async function updateRecording(recordingId, patch) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/meeting_recordings?id=eq.${encodeURIComponent(recordingId)}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Unable to save the speaker correction."));
  return Array.isArray(data) ? data[0] || null : null;
}

async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const user = await verifyUser(bearerToken(req));
    const body = bodyOf(req);
    const recordingId = String(body.recordingId || "").trim();
    const speakerKey = String(body.speakerKey || "").trim();
    const displayName = String(body.displayName || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!recordingId || !speakerKey || !displayName) {
      return res.status(400).json({ error: "recordingId, speakerKey, and displayName are required." });
    }
    const recording = await transcriptionApi._internal.loadRecording(recordingId);
    if (!recording) return res.status(404).json({ error: "Recording not found." });
    const organization = await transcriptionApi._internal.loadOrganization(recording.organization_id);
    if (!organization || !(await transcriptionApi._internal.userCanTranscribeRecording(organization, user))) {
      return res.status(403).json({ error: "You do not have access to correct this transcript." });
    }

    const identification = recording.speaker_identification_json || {};
    const speakers = Array.isArray(identification.speakers) ? identification.speakers : [];
    const utterances = Array.isArray(identification.utterances) ? identification.utterances : [];
    if (!speakers.some((speaker) => speaker.speakerKey === speakerKey)) {
      return res.status(400).json({ error: "That speaker is not part of this transcript." });
    }
    const correctedSpeakers = speakers.map((speaker) => speaker.speakerKey === speakerKey
      ? { ...speaker, displayName, userId: null, corrected: true }
      : speaker);
    const correctedUtterances = utterances.map((utterance) => utterance.speakerKey === speakerKey
      ? { ...utterance, displayName, userId: null, corrected: true }
      : utterance);
    const speakerTranscriptText = speakerTranscriptFromUtterances(correctedUtterances);
    const updated = await updateRecording(recording.id, {
      speaker_transcript_text: speakerTranscriptText,
      speaker_identification_json: {
        ...identification,
        speakers: correctedSpeakers,
        utterances: correctedUtterances,
        correctedAt: new Date().toISOString(),
        correctedByUserId: user.id,
      },
      speaker_identification_updated_at: new Date().toISOString(),
    });
    await transcriptionApi._internal.uploadTranscriptDocument(updated, user, speakerTranscriptText);
    return res.status(200).json({ recording: updated });
  } catch (error) {
    const message = String(error?.message || "Unable to save the speaker correction.");
    return res.status(/Authentication|required|Invalid session/i.test(message) ? 401 : 500).json({ error: message });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
