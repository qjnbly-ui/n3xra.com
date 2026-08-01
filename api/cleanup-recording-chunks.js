const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const RECORDINGS_BUCKET = "meeting-recordings";

function headers(extra = {}) {
  return { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}

function storagePath(path) {
  return `${encodeURIComponent(RECORDINGS_BUCKET)}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const cronSecret = String(process.env.CRON_SECRET || "");
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: "Unauthorized." });

  try {
    const cutoff = encodeURIComponent(new Date().toISOString());
    const chunkResponse = await fetch(`${SUPABASE_URL}/rest/v1/meeting_recording_chunks?select=id,meeting_recording_id,storage_path&expires_at=lt.${cutoff}&limit=200`, { headers: headers() });
    const chunks = await chunkResponse.json();
    if (!chunkResponse.ok) throw new Error(String(chunks?.message || "Unable to load expired recording chunks."));
    if (!chunks.length) return res.status(200).json({ removed: 0 });

    const recordingIds = [...new Set(chunks.map((chunk) => chunk.meeting_recording_id))];
    const recordingResponse = await fetch(`${SUPABASE_URL}/rest/v1/meeting_recordings?select=id,status&id=in.(${recordingIds.map(encodeURIComponent).join(",")})`, { headers: headers() });
    const recordings = await recordingResponse.json();
    if (!recordingResponse.ok) throw new Error(String(recordings?.message || "Unable to verify recording states."));
    const activeIds = new Set((recordings || []).filter((item) => ["recording", "finalizing"].includes(item.status)).map((item) => item.id));

    let removed = 0;
    for (const chunk of chunks) {
      if (activeIds.has(chunk.meeting_recording_id)) continue;
      const storageResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${storagePath(chunk.storage_path)}`, { method: "DELETE", headers: headers() });
      if (!storageResponse.ok && storageResponse.status !== 404) continue;
      const deleteResponse = await fetch(`${SUPABASE_URL}/rest/v1/meeting_recording_chunks?id=eq.${encodeURIComponent(chunk.id)}`, { method: "DELETE", headers: headers() });
      if (deleteResponse.ok) removed += 1;
    }
    return res.status(200).json({ removed });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || "Unable to clean up recording chunks.") });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
