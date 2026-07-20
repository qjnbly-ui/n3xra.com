const { fetchTikTokTranscript } = require("./_virals-tiktok");
const {
  assertViralsCreditsAvailable,
  consumeViralsCredits,
  getAnonymousViralsUser,
  getBearerToken,
  hasViralsSupabaseConfig,
  saveUsageEvent,
  saveViralsVideoReference,
  verifySupabaseUser,
} = require("./_virals-supabase");

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const compareRateMap = globalThis.__n3xraViralsCompareRateMap || new Map();
globalThis.__n3xraViralsCompareRateMap = compareRateMap;

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = compareRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    compareRateMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
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

function normalizeArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function normalizeScripts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      title: String(item?.title || `Remix ${index + 1}`).trim().slice(0, 80),
      text: String(item?.text || "").trim().slice(0, 1400),
    }))
    .filter((item) => item.text)
    .slice(0, 5);
}

function normalizeCompare(parsed, input) {
  return {
    product: String(parsed.product || input.product || "selected product").trim().slice(0, 120),
    niche: String(parsed.niche || input.niche || "TikTok Shop").trim().slice(0, 80),
    sharedHookPattern: String(parsed.sharedHookPattern || "").trim().slice(0, 900),
    sharedBodyFramework: String(parsed.sharedBodyFramework || "").trim().slice(0, 900),
    sharedPsychology: normalizeArray(parsed.sharedPsychology, 10),
    commonCtaPattern: String(parsed.commonCtaPattern || "").trim().slice(0, 900),
    differences: normalizeArray(parsed.differences, 10),
    winningFramework: String(parsed.winningFramework || "").trim().slice(0, 1200),
    remixRules: normalizeArray(parsed.remixRules, 10),
    hooks: normalizeArray(parsed.hooks, 12),
    scripts: normalizeScripts(parsed.scripts),
    postingPlan: normalizeArray(parsed.postingPlan, 10),
  };
}

function buildComparePrompt({ input, videos }) {
  const videoBlocks = videos
    .map((video, index) =>
      [
        `Video ${index + 1}:`,
        `URL: ${video.url}`,
        `Creator: ${video.author?.uniqueId ? `@${video.author.uniqueId}` : "unknown"}`,
        `Caption: ${video.caption || "none"}`,
        `Stats: ${JSON.stringify(video.stats || {})}`,
        video.stickers?.length ? `On-screen text: ${video.stickers.join(" | ")}` : "",
        video.hashtags?.length ? `Hashtags: ${video.hashtags.join(", ")}` : "",
        `Transcript: ${video.transcript ? video.transcript.slice(0, 5000) : "none available"}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  return [
    "Compare these TikTok videos as a viral framework system. Find the reusable pattern across the set.",
    "",
    "Return only valid JSON with this exact shape:",
    JSON.stringify(
      {
        product: "string",
        niche: "string",
        sharedHookPattern: "string",
        sharedBodyFramework: "string",
        sharedPsychology: ["string"],
        commonCtaPattern: "string",
        differences: ["string"],
        winningFramework: "string",
        remixRules: ["string"],
        hooks: ["string"],
        scripts: [{ title: "string", text: "string" }],
        postingPlan: ["string"],
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Be specific to TikTok Shop creators.",
    "- Explain what repeats across videos and what should be remixed.",
    "- Generate 8-10 hooks, 3 scripts, and a practical 5-day posting plan.",
    "- Do not claim access to anything beyond the provided extracted context.",
    "",
    `Product: ${input.product || "Not provided"}`,
    `Niche: ${input.niche || "TikTok Shop"}`,
    `Goal: ${input.goal || "TikTok Shop affiliate sale"}`,
    `User notes: ${input.notes || "none"}`,
    "",
    videoBlocks,
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const groqApiKey = String(process.env.GROQ_VIRALS_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_RECORDS_API_KEY || "").trim();
  if (!groqApiKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY." });
  if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: "Too many batch requests. Try again in a minute." });

  try {
    const body = await parseJson(req);
    const urls = Array.isArray(body.urls)
      ? body.urls
      : String(body.urls || "")
          .split(/\s+/)
          .filter(Boolean);
    const uniqueUrls = urls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 10);
    if (uniqueUrls.length < 2) return sendJson(res, 400, { error: "Paste at least 2 TikTok URLs to compare." });

    const input = {
      product: String(body.product || "").trim().slice(0, 160),
      niche: String(body.niche || "TikTok Shop").trim().slice(0, 100),
      goal: String(body.goal || "TikTok Shop affiliate sale").trim().slice(0, 140),
      notes: String(body.notes || "").trim().slice(0, 3000),
    };

    const settled = await Promise.allSettled(uniqueUrls.map((url) => fetchTikTokTranscript(url)));
    const videos = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
    const failed = settled
      .map((item, index) => (item.status === "rejected" ? { url: uniqueUrls[index], error: item.reason?.message || "Failed" } : null))
      .filter(Boolean);

    if (videos.length < 2) return sendJson(res, 502, { error: "Could not extract enough TikTok videos to compare.", failed });
    const token = getBearerToken(req);
    let requestUser = getAnonymousViralsUser();
    if (token) {
      requestUser = await verifySupabaseUser(token);
      await assertViralsCreditsAvailable(requestUser, videos.length);
    }

    const model = String(process.env.GROQ_VIRALS_MODEL || process.env.GROQ_RECORDS_MODEL || "openai/gpt-oss-120b").trim();
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 2200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are N3XRA Virals, a TikTok Shop batch framework analyst. Return valid JSON only. Do not include markdown.",
          },
          { role: "user", content: buildComparePrompt({ input, videos }) },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) return sendJson(res, 502, { error: String(data?.error?.message || data?.message || "Unable to reach Groq.") });

    const content = String(data?.choices?.[0]?.message?.content || "").trim();
    const comparison = normalizeCompare(extractJson(content), input);
    if (token) await consumeViralsCredits(requestUser, videos.length);
    let saved = null;
    if (hasViralsSupabaseConfig()) {
      try {
        const savedVideos = await Promise.all(
          videos.map((video) =>
            saveViralsVideoReference({
              user: requestUser,
              input: { ...input, url: video.url },
              video,
              analysis: {
                hookType: comparison.sharedHookPattern,
                formula: comparison.winningFramework,
                body: comparison.sharedBodyFramework,
                product: comparison.product,
                niche: comparison.niche,
              },
            }).catch(() => null)
          )
        );
        const usage = await saveUsageEvent(requestUser, {
          event_type: "compare_analysis",
          input_count: videos.length,
          model,
          prompt_tokens: data?.usage?.prompt_tokens,
          completion_tokens: data?.usage?.completion_tokens,
          total_tokens: data?.usage?.total_tokens,
        });
        saved = {
          status: "saved",
          owner: requestUser.isAnonymousViralsUser ? "anonymous" : "account",
          savedVideos: savedVideos.filter(Boolean).length,
          usageId: usage?.id || null,
        };
      } catch (_error) {
        saved = {
          status: "failed",
          message: _error instanceof Error ? _error.message : "Unable to save Virals comparison.",
        };
      }
    }
    return sendJson(res, 200, { comparison, videos, failed, model, saved });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Server error." });
  }
};
