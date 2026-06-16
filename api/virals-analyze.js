function parseJson(req) {
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
    req.on("data", (chunk) => chunks.push(chunk));
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

const { fetchTikTokTranscript } = require("./_virals-tiktok");
const { resolveProductIntelligence } = require("./_virals-product-resolver");
const {
  assertViralsCreditsAvailable,
  consumeViralsCredits,
  getAnonymousViralsUser,
  getBearerToken,
  hasViralsSupabaseConfig,
  saveViralsAnalysis,
  verifySupabaseUser,
} = require("./_virals-supabase");

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return req.socket?.remoteAddress || "";
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const ipRateMap = globalThis.__n3xraViralsRateMap || new Map();
globalThis.__n3xraViralsRateMap = ipRateMap;

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

function normalizeArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
}

function normalizeScripts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      title: String(item?.title || `Script ${index + 1}`).trim().slice(0, 80),
      text: String(item?.text || "").trim().slice(0, 1400),
    }))
    .filter((item) => item.text)
    .slice(0, 5);
}

function normalizeTranscriptBreakdown(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    cleanedTranscript: String(source.cleanedTranscript || "").trim().slice(0, 9000),
    hook: String(source.hook || "").trim().slice(0, 700),
    bodyStructure: String(source.bodyStructure || "").trim().slice(0, 900),
    cta: String(source.cta || "").trim().slice(0, 500),
    sellingBeats: normalizeArray(source.sellingBeats).slice(0, 8),
  };
}

function normalizeProductIntelligence(value, input) {
  const source = value && typeof value === "object" ? value : {};
  return {
    name: String(source.name || input.product || "Detected product").trim().slice(0, 140),
    category: String(source.category || input.niche || "TikTok Shop").trim().slice(0, 90),
    offer: String(source.offer || input.goal || "").trim().slice(0, 220),
    confidence: String(source.confidence || "Inferred").trim().slice(0, 40),
    source: String(source.source || "AI resolver").trim().slice(0, 80),
    shopProductId: String(source.shopProductId || "").trim().slice(0, 120),
    productUrl: String(source.productUrl || "").trim().slice(0, 600),
    claims: normalizeArray(source.claims).slice(0, 8),
    objections: normalizeArray(source.objections).slice(0, 8),
    proofPoints: normalizeArray(source.proofPoints).slice(0, 8),
    ctaPath: String(source.ctaPath || "").trim().slice(0, 700),
    apiReadiness: String(source.apiReadiness || "Ready for TikTok Shop API enrichment when official product data is available.").trim().slice(0, 700),
  };
}

function normalizeAnalysis(parsed, input) {
  const product = String(parsed.product || input.product || input.niche || "this product").trim().slice(0, 120);
  const niche = String(parsed.niche || input.niche || "TikTok Shop").trim().slice(0, 80);
  const goal = String(parsed.goal || input.goal || "TikTok Shop affiliate sale").trim().slice(0, 120);

  return {
    id: parsed.id || "",
    createdAt: parsed.createdAt || "",
    url: String(input.url || "").trim(),
    product,
    niche,
    goal,
    hookType: String(parsed.hookType || "Framework Hook").trim().slice(0, 120),
    formula: String(parsed.formula || "").trim().slice(0, 700),
    body: String(parsed.body || "").trim().slice(0, 700),
    triggers: normalizeArray(parsed.triggers, ["Curiosity", "Proof", "Specificity"]),
    conversionPattern: String(parsed.conversionPattern || "").trim().slice(0, 900),
    keep: String(parsed.keep || "").trim().slice(0, 700),
    change: String(parsed.change || "").trim().slice(0, 700),
    hooks: normalizeArray(parsed.hooks).slice(0, 12),
    scripts: normalizeScripts(parsed.scripts),
    captions: normalizeArray(parsed.captions).slice(0, 6),
    shotList: normalizeArray(parsed.shotList).slice(0, 10),
    transcriptBreakdown: normalizeTranscriptBreakdown(parsed.transcriptBreakdown),
    productIntelligence: normalizeProductIntelligence(parsed.productIntelligence, input),
  };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty model response.");
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function buildPrompt(input) {
  return [
    "Analyze this TikTok/TikTok Shop/Daily Virals reference as a viral content framework system, not as a generic script rewrite.",
    "",
    "Return only valid JSON with this exact shape:",
    JSON.stringify(
      {
        product: "string",
        niche: "string",
        goal: "string",
        hookType: "string",
        formula: "string",
        body: "string",
        triggers: ["string"],
        conversionPattern: "string",
        keep: "string",
        change: "string",
        hooks: ["string"],
        scripts: [{ title: "string", text: "string" }],
        captions: ["string"],
        shotList: ["string"],
        transcriptBreakdown: {
          cleanedTranscript: "string",
          hook: "string",
          bodyStructure: "string",
          cta: "string",
          sellingBeats: ["string"],
        },
        productIntelligence: {
          name: "string",
          category: "string",
          offer: "string",
          confidence: "High | Medium | Low",
          source: "TikTok Shop API | page metadata | transcript inference | user input | AI resolver",
          shopProductId: "string",
          productUrl: "string",
          claims: ["string"],
          objections: ["string"],
          proofPoints: ["string"],
          ctaPath: "string",
          apiReadiness: "string",
        },
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Be specific to TikTok Shop creators and short-form conversion content.",
    "- Focus on frameworks: hook structure, body structure, psychology, CTA logic, what to keep, what to remix.",
    "- If a transcript is available, clean it into readable paragraph form without timestamps or subtitle artifacts.",
    "- In transcriptBreakdown, identify the exact hook, body structure, CTA, and key selling beats shown in the transcript.",
    "- In productIntelligence, automatically resolve the likely product without asking for confirmation.",
    "- If no official product ID or URL is present, leave shopProductId/productUrl empty and set source to transcript inference or page metadata.",
    "- Product intelligence must separate claims, objections, proof points, offer language, and CTA path.",
    "- Generate 8-10 hooks, 3 scripts, 3 captions, and 5-7 shot list items.",
    "- Do not claim you fetched TikTok metrics or transcripts. Use only the user-provided context.",
    "- If transcript/notes are thin, infer conservatively and say what framework to test.",
    "",
    "User input:",
    `URL: ${input.url}`,
    `Product: ${input.product || "Not provided"}`,
    `Niche: ${input.niche || "TikTok Shop"}`,
    `Goal: ${input.goal || "TikTok Shop affiliate sale"}`,
    `Notes/transcript/caption: ${input.notes || "Not provided"}`,
    input.tiktokContext ? `TikTok extracted context: ${input.tiktokContext}` : "",
    input.productContext ? `Product resolver context: ${input.productContext}` : "",
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const groqApiKey = String(process.env.GROQ_VIRALS_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_RECORDS_API_KEY || "").trim();
  if (!groqApiKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY." });

  if (isRateLimited(getClientIp(req))) {
    return sendJson(res, 429, { error: "Too many requests. Try again in a minute." });
  }

  try {
    const body = await parseJson(req);
    const input = {
      url: String(body.url || "").trim().slice(0, 600),
      product: String(body.product || "").trim().slice(0, 160),
      niche: String(body.niche || "TikTok Shop").trim().slice(0, 100),
      goal: String(body.goal || "TikTok Shop affiliate sale").trim().slice(0, 140),
      notes: String(body.notes || "").trim().slice(0, 7000),
      tiktokContext: "",
      productContext: "",
    };

    if (!input.url) return sendJson(res, 400, { error: "Paste a TikTok or Daily Virals reference URL." });
    const token = getBearerToken(req);
    let requestUser = getAnonymousViralsUser();
    if (token) {
      requestUser = await verifySupabaseUser(token);
      await assertViralsCreditsAvailable(requestUser, 1);
    }

    let extractedVideo = null;
    let resolvedProduct = null;
    if (/tiktok\.com/i.test(input.url)) {
      try {
        extractedVideo = await fetchTikTokTranscript(input.url);
        resolvedProduct = await resolveProductIntelligence(extractedVideo, input);
        input.tiktokContext = [
          extractedVideo.caption ? `Caption: ${extractedVideo.caption}` : "",
          extractedVideo.author?.uniqueId ? `Creator: @${extractedVideo.author.uniqueId}` : "",
          extractedVideo.stats ? `Stats: ${JSON.stringify(extractedVideo.stats)}` : "",
          extractedVideo.stickers?.length ? `On-screen text: ${extractedVideo.stickers.join(" | ")}` : "",
          extractedVideo.hashtags?.length ? `Hashtags: ${extractedVideo.hashtags.join(", ")}` : "",
          extractedVideo.transcript ? `Transcript: ${extractedVideo.transcript.slice(0, 9000)}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        input.productContext = resolvedProduct ? JSON.stringify(resolvedProduct) : "";
      } catch (_error) {
        extractedVideo = null;
      }
    }

    const model = String(process.env.GROQ_VIRALS_MODEL || process.env.GROQ_RECORDS_MODEL || "llama-3.3-70b-versatile").trim();
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are N3XRA Virals, a TikTok Shop viral framework analyst. Return valid JSON only. Do not include markdown.",
          },
          { role: "user", content: buildPrompt(input) },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return sendJson(res, 502, { error: String(data?.error?.message || data?.message || "Unable to reach Groq.") });
    }

    const content = String(data?.choices?.[0]?.message?.content || "").trim();
    const analysis = normalizeAnalysis(extractJson(content), input);
    if (token) await consumeViralsCredits(requestUser, 1);
    let saved = null;
    if (!hasViralsSupabaseConfig()) {
      saved = { status: "not_configured" };
    } else {
      try {
        saved = await saveViralsAnalysis({
          user: requestUser,
          input,
          video: extractedVideo,
          analysis,
          model,
          usage: data?.usage || null,
        });
      } catch (_error) {
        saved = {
          status: "failed",
          message: _error instanceof Error ? _error.message : "Unable to save Virals analysis.",
        };
      }
    }

    return sendJson(res, 200, { analysis, model, video: extractedVideo, saved });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Server error." });
  }
};
