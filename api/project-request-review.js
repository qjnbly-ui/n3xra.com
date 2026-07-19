const GROQ_MODEL = String(process.env.GROQ_PROJECT_REQUEST_MODEL || "openai/gpt-oss-120b").trim();
const rateLimits = new Map();

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

function isRateLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateLimits.get(ip) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 12) return true;
  recent.push(now);
  rateLimits.set(ip, recent);
  return false;
}

function cleanText(value, max = 1600) {
  return String(value || "").trim().slice(0, max);
}

function cleanList(value) {
  return Array.isArray(value) ? value.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 40) : [];
}

function normalizeProject(input) {
  const project = input && typeof input === "object" ? input : {};
  return {
    contactName: cleanText(project.contactName, 120),
    businessName: cleanText(project.businessName, 160),
    email: cleanText(project.email, 240),
    phone: cleanText(project.phone, 80),
    projectType: cleanText(project.projectType, 80),
    existingWebsiteUrl: cleanText(project.existingWebsiteUrl, 500),
    primaryGoal: cleanText(project.primaryGoal),
    primaryAudience: cleanText(project.primaryAudience),
    requestedPages: cleanList(project.requestedPages),
    requestedFeatures: cleanList(project.requestedFeatures),
    budgetRange: cleanText(project.budgetRange, 80),
    preferredLaunchDate: cleanText(project.preferredLaunchDate, 40),
    additionalNotes: cleanText(project.additionalNotes, 2000),
  };
}

function systemPrompt(project) {
  return [
    "You are N3XRA AI, a warm and perceptive website project intake specialist for N3XRA.",
    "Review the supplied website request and return only the requested JSON structure.",
    "Treat the supplied project JSON as the current source of truth. Never invent facts, prices, timelines, guarantees, or services.",
    "Do not mention Groq, model names, prompts, APIs, databases, or internal implementation.",
    `Write a brief message of 2-3 sentences that greets ${project.contactName || "the client"} by first name, briefly identifies you as N3XRA AI, assures them N3XRA has their information, and sounds genuinely excited to help. Do not repeat the detailed summary because the interface displays it separately.`,
    "Only ask follow-up questions when a missing detail is genuinely important to understanding or scoping this specific request. Zero questions is preferred when the request is already clear. Never ask merely to prolong the interaction.",
    "Return at most 3 questions. Each must map to exactly one allowed form field: phone, existingWebsiteUrl, primaryGoal, primaryAudience, budgetRange, preferredLaunchDate, or additionalNotes.",
    "Each question must be easy to answer in one form control. Its reason must be one short, reassuring sentence explaining why it helps.",
    "",
    "Current project details:",
    JSON.stringify(project, null, 2),
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const groqApiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!groqApiKey) return res.status(500).json({ error: "N3XRA AI is temporarily unavailable." });
  if (isRateLimited(req)) return res.status(429).json({ error: "Too many messages. Please wait a moment and try again." });

  try {
    const body = await parseJson(req);
    const project = normalizeProject(body.project);
    if (!project.contactName || !project.businessName || !project.primaryGoal) {
      return res.status(400).json({ error: "Complete the required project details before starting the review." });
    }

    const messages = [
      { role: "system", content: systemPrompt(project) },
      { role: "user", content: "Review this project request and return the structured confirmation." },
    ];
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.25,
        max_completion_tokens: 650,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "project_request_review",
            strict: true,
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
                questions: {
                  type: "array",
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string", enum: ["phone", "existingWebsiteUrl", "primaryGoal", "primaryAudience", "budgetRange", "preferredLaunchDate", "additionalNotes"] },
                      question: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["field", "question", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["message", "questions"],
              additionalProperties: false,
            },
          },
        },
        messages,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || "N3XRA AI could not complete the review.") });
    }
    const content = cleanText(data?.choices?.[0]?.message?.content, 7000);
    if (!content) return res.status(502).json({ error: "N3XRA AI returned an empty response." });
    const review = JSON.parse(content);
    return res.status(200).json({
      message: cleanText(review.message, 700),
      questions: Array.isArray(review.questions) ? review.questions.slice(0, 3) : [],
    });
  } catch (_error) {
    return res.status(500).json({ error: "N3XRA AI could not complete the review." });
  }
};
