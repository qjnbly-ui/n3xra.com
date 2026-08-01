const { spawn } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  PLAYBACK_AUDIO_SETTINGS,
  buildInterruptionMetadata,
  buildPlaybackTranscodeArgs,
  extensionForMimeType,
  parseFfmpegDurationSeconds,
  validateAndGroupChunks,
} = require("./_recording-chunk-core");
const { contextAllows, getRecordsAccessContext } = require("./_records-support-access");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const RECORDINGS_BUCKET = "meeting-recordings";
const MAX_AUDIO_BYTES = Math.max(1, Number(process.env.RECORDS_MAX_TRANSCRIPTION_AUDIO_BYTES || 250 * 1024 * 1024));

function serviceHeaders(extra = {}) {
  return { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function parseJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.message || data?.error || `Request failed with ${response.status}.`));
  return data;
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) throw new Error("Invalid session.");
  return user;
}

async function loadOne(table, query) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: serviceHeaders() });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function encodeStoragePath(storagePath) {
  return `${encodeURIComponent(RECORDINGS_BUCKET)}/${String(storagePath).split("/").map(encodeURIComponent).join("/")}`;
}

async function downloadChunk(chunk) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(chunk.storage_path)}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) throw new Error(`Unable to download audio chunk ${chunk.sequence_number}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== Number(chunk.file_size)) throw new Error(`Audio chunk ${chunk.sequence_number} failed its size check.`);
  if (chunk.checksum_sha256) {
    const checksum = createHash("sha256").update(buffer).digest("hex");
    if (checksum !== chunk.checksum_sha256) throw new Error(`Audio chunk ${chunk.sequence_number} failed its checksum check.`);
  }
  return buffer;
}

function runFfmpeg(args) {
  const ffmpegPath = require("ffmpeg-static");
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-5000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(`Unable to assemble recording. ${stderr.trim()}`)));
  });
}

function inspectAudioDurationSeconds(filePath) {
  const ffmpegPath = require("ffmpeg-static");
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", reject);
    child.on("close", () => {
      const durationSeconds = parseFfmpegDurationSeconds(stderr);
      if (!durationSeconds) reject(new Error("Unable to read the assembled recording duration."));
      else resolve(durationSeconds);
    });
  });
}

async function updateRecording(recordingId, patch) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/meeting_recordings?id=eq.${encodeURIComponent(recordingId)}`, {
    method: "PATCH", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function assembleRecording(recording, chunks, interruptions, expectedLastSequence) {
  const { ordered, groups } = validateAndGroupChunks(chunks, expectedLastSequence);
  const totalChunkBytes = ordered.reduce((sum, chunk) => sum + Number(chunk.file_size || 0), 0);
  if (totalChunkBytes > MAX_AUDIO_BYTES) throw new Error("This recording exceeds the active audio size limit.");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "n3xra-recording-finalize-"));
  try {
    const normalizedPaths = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const extension = extensionForMimeType(group.chunks[0]?.mime_type);
      const rawPath = path.join(tempDir, `capture-${String(groupIndex).padStart(3, "0")}.${extension}`);
      const normalizedPath = path.join(tempDir, `capture-${String(groupIndex).padStart(3, "0")}.mp3`);
      const buffers = [];
      for (const chunk of group.chunks) buffers.push(await downloadChunk(chunk));
      await fs.writeFile(rawPath, Buffer.concat(buffers));
      await runFfmpeg(buildPlaybackTranscodeArgs(rawPath, normalizedPath));
      normalizedPaths.push(normalizedPath);
    }

    const listPath = path.join(tempDir, "captures.txt");
    const outputPath = path.join(tempDir, "recording.mp3");
    await fs.writeFile(listPath, normalizedPaths.map((item) => `file '${item}'`).join("\n"));
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
    const durationSeconds = await inspectAudioDurationSeconds(outputPath);
    const audio = await fs.readFile(outputPath);
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error("The assembled recording has an invalid size.");

    const storagePath = `${recording.organization_id}/${recording.id}/meeting-recording.mp3`;
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(storagePath)}`, {
      method: "POST",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": PLAYBACK_AUDIO_SETTINGS.mimeType, "x-upsert": "true" },
      body: audio,
    });
    if (!upload.ok) throw new Error((await upload.text().catch(() => "")) || "Unable to store assembled recording.");

    const metadata = {
      ...(recording.metadata || {}),
      capture_mode: "resumable_chunks",
      chunk_count: ordered.length,
      capture_session_count: groups.length,
      playback_audio: {
        codec: "mp3",
        sample_rate_hz: PLAYBACK_AUDIO_SETTINGS.sampleRate,
        channels: PLAYBACK_AUDIO_SETTINGS.channels,
        bitrate_bps: 96000,
      },
      interruptions: buildInterruptionMetadata(interruptions),
    };
    const updated = await updateRecording(recording.id, {
      status: "uploaded", storage_bucket: RECORDINGS_BUCKET, storage_path: storagePath,
      audio_mime_type: PLAYBACK_AUDIO_SETTINGS.mimeType, duration_seconds: durationSeconds,
      file_size: audio.length, metadata, processing_error: null,
    });
    await fetchJson(`${SUPABASE_URL}/rest/v1/meeting_recording_chunks?meeting_recording_id=eq.${encodeURIComponent(recording.id)}`, {
      method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ status: "assembled", expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }),
    });
    return updated;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  let recording = null;
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service config.");
    const user = await verifyUser(getBearerToken(req));
    const body = await parseJson(req);
    const recordingId = String(body.recordingId || "");
    const expectedLastSequence = Number(body.expectedLastSequence);
    recording = await loadOne("meeting_recordings", `select=*&id=eq.${encodeURIComponent(recordingId)}&limit=1`);
    if (!recording) return res.status(404).json({ error: "Meeting recording not found." });
    const organization = await loadOne("organizations", `select=id,name,owner_user_id,subscription_tier&id=eq.${encodeURIComponent(recording.organization_id)}&limit=1`);
    const access = await getRecordsAccessContext(organization, user);
    if (!contextAllows(access, "can_change_content")) return res.status(403).json({ error: "You do not have access to finalize this recording." });

    await updateRecording(recording.id, { status: "finalizing", processing_error: null });
    const chunks = await fetchJson(`${SUPABASE_URL}/rest/v1/meeting_recording_chunks?select=*&meeting_recording_id=eq.${encodeURIComponent(recording.id)}&order=sequence_number.asc`, { headers: serviceHeaders() });
    const interruptions = await fetchJson(`${SUPABASE_URL}/rest/v1/meeting_recording_interruptions?select=*&meeting_recording_id=eq.${encodeURIComponent(recording.id)}&order=interruption_number.asc`, { headers: serviceHeaders() });
    const updated = await assembleRecording(recording, chunks, interruptions, expectedLastSequence);
    return res.status(200).json({ recording: updated });
  } catch (error) {
    const status = error?.code === "MISSING_CHUNKS" ? 409 : 500;
    if (recording?.id) await updateRecording(recording.id, { status: "recorded", processing_error: String(error?.message || error) }).catch(() => null);
    return res.status(status).json({ error: String(error?.message || "Unable to finalize recording."), missingSequences: error?.missingSequences || [] });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
