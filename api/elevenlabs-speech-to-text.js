const { createAdminNotification } = require("./_admin-notifications");

const API_KEY = String(process.env.ELEVENLABS_API_KEY || "").trim();
const MODEL_ID = String(process.env.ELEVENLABS_STT_MODEL || "scribe_v2").trim();
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const rateMap = new Map();

export const config = { api: { bodyParser: false } };

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
}

function limited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.started > 60000) {
    rateMap.set(ip, { started: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

function readAudio(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) {
        reject(Object.assign(new Error("Recording is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!API_KEY) return res.status(503).json({ error: "N3XRA voice is not configured yet." });
  if (limited(clientIp(req))) return res.status(429).json({ error: "Please wait before making another recording." });

  try {
    const audio = await readAudio(req);
    if (audio.length < 1000) return res.status(400).json({ error: "The recording was too short." });
    const mimeType = String(req.headers["content-type"] || "audio/webm").split(";")[0];
    const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mimeType }), `n3xra-question.${extension}`);
    form.append("model_id", MODEL_ID);
    form.append("tag_audio_events", "false");
    form.append("diarize", "false");
    form.append("keyterms", "N3XRA");
    form.append("keyterms", "N3XRA Records");
    form.append("keyterms", "N3XRA Utilities");
    form.append("keyterms", "N3XRA Virals");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": API_KEY },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.detail?.message || data?.detail || data?.message || "ElevenLabs could not transcribe the recording."));
    const text = String(data?.text || "").trim().slice(0, 800);
    if (!text) return res.status(422).json({ error: "I could not hear a question. Please try again." });
    return res.status(200).json({ text, language: data?.language_code || null });
  } catch (error) {
    await createAdminNotification({
      eventType: "system.elevenlabs_stt_failed",
      product: "system",
      priority: "system",
      title: "Ask N3XRA transcription failed",
      summary: error instanceof Error ? error.message : "ElevenLabs speech-to-text failed.",
      actionUrl: "/account/admin/inbox/",
      metadata: { provider: "elevenlabs", model: MODEL_ID },
    }).catch(() => null);
    return res.status(error?.status || 502).json({ error: error instanceof Error ? error.message : "N3XRA could not hear the recording." });
  }
}
