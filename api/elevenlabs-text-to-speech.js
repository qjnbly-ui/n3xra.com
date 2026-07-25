const { createAdminNotification } = require("./_admin-notifications");

const API_KEY = String(process.env.ELEVENLABS_API_KEY || "").trim();
const VOICE_ID = String(process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb").trim();
const MODEL_ID = String(process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5").trim();
const rateMap = new Map();

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
  return entry.count > 10;
}

function cleanSpeechText(value) {
  const spokenRoutes = [
    ["/website-request", "Start a Project"],
    ["/website-onboarding", "Website Onboarding"],
    ["/project-workspace", "Project Workspace"],
    ["/client-portal", "Client Portal"],
    ["/ai-music-generator", "AI Music Generator"],
    ["/proposals", "Proposals"],
    ["/records", "Nexra Records"],
    ["/utilities", "Nexra Utilities"],
    ["/virals", "Nexra Virals"],
    ["/account", "Dashboard"],
    ["/partners", "Partners"],
    ["/services", "Services"],
    ["/projects", "Projects"],
    ["/support", "Support"],
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
  ];

  let text = String(value || "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\[([^\]]+)]\((?:https?:\/\/|\/)[^)]+\)/gi, "$1")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<\/p\s*>|<\/li\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&nbsp;/gi, " ");

  spokenRoutes.forEach(([route, label]) => {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`${escapedRoute}\/?`, "gi"), ` ${label} `);
  });

  return text
    .replace(/\bN3XRA\b/gi, "Nexra")
    .replace(/\$(\d+(?:\.\d{1,2})?)\s*\/\s*(month|year|week|day|hour)\b/gi, "$1 dollars a $2")
    .replace(/\$(\d+(?:\.\d{1,2})?)\s+(one-time|one time)\b/gi, "$1 dollar $2")
    .replace(/\$(\d+(?:\.\d{1,2})?)/g, "$1 dollars")
    .replace(/(\d+(?:\.\d+)?)%/g, "$1 percent")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(^|\s)\/[a-z0-9/_-]+/gi, " ")
    .replace(/[→←]/g, " ")
    .replace(/[•●▪◦]+/g, ". ")
    .replace(/[\*_`#]+/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!API_KEY) return res.status(503).json({ error: "N3XRA voice is not configured yet." });
  if (limited(clientIp(req))) return res.status(429).json({ error: "Please wait before requesting more audio." });
  let textInput = "";
  if (req.method === "GET") {
    textInput = Array.isArray(req.query?.text) ? req.query.text[0] : req.query?.text;
  } else {
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ error: "Invalid request." });
      }
    }
    textInput = body.text;
  }
  const text = cleanSpeechText(textInput);
  if (!text) return res.status(400).json({ error: "There is no answer to read." });

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.12, use_speaker_boost: true, speed: 1.1 },
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(String(data?.detail?.message || data?.detail || data?.message || "ElevenLabs could not create speech."));
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Length", String(audio.length));
    return res.status(200).send(audio);
  } catch (error) {
    await createAdminNotification({
      eventType: "system.elevenlabs_tts_failed",
      product: "system",
      priority: "system",
      title: "Ask N3XRA voice generation failed",
      summary: error instanceof Error ? error.message : "ElevenLabs text-to-speech failed.",
      actionUrl: "/account/admin/inbox/",
      metadata: { provider: "elevenlabs", model: MODEL_ID },
    }).catch(() => null);
    return res.status(502).json({ error: error instanceof Error ? error.message : "N3XRA voice is unavailable." });
  }
}
