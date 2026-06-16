const { getBearerToken, hasViralsBusinessConfig, submitCreatorApplication, verifySupabaseUser } = require("./_virals-supabase");
const { normalizePromoCode } = require("./_virals-billing");
const { parseJson, sendJson } = require("./_virals-http");

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : [];
}

function fallbackEvaluation(payload) {
  return {
    score: 50,
    recommendation: "manual_review",
    summary: "AI evaluation was not available. Review the TikTok profile, audience fit, and code request manually.",
    strengths: [],
    risks: ["No automated creator evaluation was completed."],
    fit: "unknown",
    generatedAt: new Date().toISOString(),
  };
}

function normalizeEvaluation(value, payload) {
  const source = value && typeof value === "object" ? value : {};
  return {
    score: Math.max(0, Math.min(100, Number(source.score || 50))),
    recommendation: String(source.recommendation || "manual_review").trim().slice(0, 60),
    summary: String(source.summary || "").trim().slice(0, 1200) || fallbackEvaluation(payload).summary,
    strengths: normalizeArray(source.strengths),
    risks: normalizeArray(source.risks),
    fit: String(source.fit || "unknown").trim().slice(0, 80),
    generatedAt: new Date().toISOString(),
  };
}

async function evaluateCreator(payload) {
  const apiKey = String(process.env.GROQ_VIRALS_API_KEY || process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) return fallbackEvaluation(payload);
  const model = String(process.env.GROQ_VIRALS_MODEL || "llama-3.3-70b-versatile").trim();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You evaluate creator affiliate applications for N3XRA Virals. Return valid JSON only.",
          },
          {
            role: "user",
            content: [
              "Evaluate this creator application for a TikTok Shop analytics/viral framework SaaS.",
              "Score 0-100. Recommendation must be approve, maybe, or reject. Be practical and conservative.",
              "Return JSON: { score, recommendation, summary, strengths: [], risks: [], fit }",
              "",
              `TikTok username: ${payload.tiktokUsername}`,
              `Requested promo code: ${normalizePromoCode(payload.requestedCode)}`,
              `Program interest: ${payload.requestedProgram}`,
              `Creator notes: ${payload.notes || "none"}`,
            ].join("\n"),
          },
        ],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return fallbackEvaluation(payload);
    return normalizeEvaluation(JSON.parse(String(data?.choices?.[0]?.message?.content || "{}")), payload);
  } catch {
    return fallbackEvaluation(payload);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!hasViralsBusinessConfig()) return sendJson(res, 503, { error: "Main Supabase billing is not configured." });

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);
    const payload = await parseJson(req);
    if (!String(payload.tiktokUsername || "").trim()) return sendJson(res, 400, { error: "TikTok username is required." });
    if (!normalizePromoCode(payload.requestedCode)) return sendJson(res, 400, { error: "Promo code is required." });
    const aiEvaluation = await evaluateCreator(payload);
    const application = await submitCreatorApplication(user, payload, aiEvaluation);
    return sendJson(res, 200, { application });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to submit creator application." });
  }
};
