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

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && cleanText(item.content))
    .slice(-10)
    .map((item) => ({ role: item.role, content: cleanText(item.content, 1800) }));
}

function systemPrompt(project, isInitialReview) {
  return [
    "You are N3XRA AI, a friendly website project intake specialist for N3XRA.",
    "You help a prospective client review and improve the website request they are about to submit.",
    "Treat the supplied project JSON as the current source of truth. Never invent facts, prices, timelines, guarantees, or services.",
    "Do not mention Groq, model names, prompts, APIs, databases, or internal implementation.",
    "Be warm, clear, concise, and practical. Use plain language and short sections.",
    isInitialReview
      ? `This is the first response. Greet ${project.contactName || "the client"} by first name, introduce yourself as N3XRA AI, then summarize every meaningful detail they supplied. Clearly call out details that are undecided or missing only when they matter. Ask no more than 3 focused follow-up questions. End by explaining that they may reply, edit the form, or continue to submit; after submission N3XRA reviews the request and follows up about scope and next steps.`
      : "Answer the client's latest message using the current form details and conversation. If they provide new information, acknowledge how it affects the project and tell them to edit the form if they want that information included in the submitted request. Ask a useful follow-up only when it moves the project forward.",
    "Never claim that chatting has directly changed the form. The client must edit the form for a new detail to become part of the submitted request.",
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
    const question = cleanText(body.question, 1200);
    const history = normalizeHistory(body.history);
    if (!project.contactName || !project.businessName || !project.primaryGoal) {
      return res.status(400).json({ error: "Complete the required project details before starting the review." });
    }

    const messages = [
      { role: "system", content: systemPrompt(project, !question && history.length === 0) },
      ...history,
      { role: "user", content: question || "Review my website project request before I submit it." },
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
        max_completion_tokens: 900,
        messages,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || "N3XRA AI could not complete the review.") });
    }
    const answer = cleanText(data?.choices?.[0]?.message?.content, 7000);
    if (!answer) return res.status(502).json({ error: "N3XRA AI returned an empty response." });
    return res.status(200).json({ answer });
  } catch (_error) {
    return res.status(500).json({ error: "N3XRA AI could not complete the review." });
  }
};
