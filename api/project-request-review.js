const GROQ_MODEL = String(process.env.GROQ_PROJECT_REQUEST_MODEL || "openai/gpt-oss-120b").trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
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
    servicePlan: cleanText(project.servicePlan, 40).toLowerCase(),
    servicePlanAutoApplied: project.servicePlanAutoApplied === true,
    servicePlanReason: cleanText(project.servicePlanReason, 500),
    budgetRange: cleanText(project.budgetRange, 80),
    preferredLaunchDate: cleanText(project.preferredLaunchDate, 40),
    referralCode: cleanText(project.referralCode, 24).toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    offerCode: cleanText(project.offerCode, 24).toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    additionalNotes: cleanText(project.additionalNotes, 2000),
  };
}

function systemPrompt(project) {
  return [
    "You are N3XRA AI, a warm and perceptive website project intake specialist for N3XRA.",
    "Review the supplied website request and return only the requested JSON structure.",
    "Treat the supplied project JSON as the current source of truth. Never invent facts, prices, timelines, guarantees, or services.",
    "Do not mention Groq, model names, prompts, APIs, databases, or internal implementation.",
    `Write a brief message of 2-3 sentences that greets ${project.contactName || "the client"} by first name, assures them N3XRA has their information, and sounds genuinely excited to help. Speak naturally without introducing yourself or saying "I'm N3XRA AI." Do not repeat the detailed summary because the interface displays it separately.`,
    "Published pricing context: a genuinely basic website with a few straightforward pages starts at $250 to build. The Limited Founding Offer uses offerCode FREEBUILD to waive that one-time website build fee; service plans and domains or third-party costs still apply. Founding Client Starter service is $25 per month or $270 per year paid in advance, with managed hosting, SSL and routine security maintenance, backups, monitoring, normal-business-hours support, and edits at $75 per hour. Starter+ is $40 per month or $432 per year paid in advance and adds up to 30 minutes of routine non-rollover edits monthly, priority handling with requests accepted 24/7, and additional eligible edits at $52.50 per hour after a 30% discount. Advanced websites start at $500 to build and $50 per month or $540 per year for service, with final build and service pricing custom quoted. New pages, redesigns, custom features, integrations, and urgent after-hours work are quoted separately. A valid partner referral code saves 10% on the website build; do not combine that discount with FREEBUILD. Domains, premium software, payment processing, and other third-party costs are separate when applicable. In most cases the client owns the domain and website files.",
    "You may accurately summarize a published starting price or discount when it is directly relevant, but never present starting prices as a custom quote or promise a final total. Exact pricing comes through the proposal.",
    "Respect the client's selected servicePlan. If servicePlanAutoApplied is true, explain that Advanced was applied because the selected scope needs it; do not present that decision as a final quote and do not suggest downgrading it.",
    "Classify the request as basic only when it has no more than 5 straightforward pages and no advanced functionality. Payments, stores, scheduling, accounts, portals, memberships, protected content, multilingual work, CRM or API integrations, file uploads, automation, or comparable custom functionality make it an Advanced project.",
    "If budgetRange is under_1000 and the request is clearly custom or unusually broad, one observation may gently explain that the selected scope and budget may need to be aligned during the proposal process. Do not invent an estimate or disclose any non-public pricing rule.",
    "Add 1-3 brief conversational observations that help the client understand their scope, likely process, ownership, or a useful relationship between their selected pages and features. Be specific to their request, not generic.",
    "Only ask follow-up questions when a missing detail is genuinely important to understanding or scoping this specific request. Zero questions is preferred when the request is already clear. Never ask merely to prolong the interaction.",
    "Return at most 3 questions. Each must map to exactly one allowed form field: existingWebsiteUrl, primaryGoal, primaryAudience, budgetRange, or preferredLaunchDate.",
    "Do not ask for an existing URL or domain merely because it is blank on a new website request. Only ask for existingWebsiteUrl when the project is a redesign or improvement of an existing site.",
    "Do not ask a generic 'anything else' question. Questions must address a concrete ambiguity that materially affects this exact project.",
    "Each question must be easy to answer in one form control. Its reason must be one short, reassuring sentence explaining why it helps.",
    "Return one JSON object with these keys: message, observations, questionsNote, and questions. observations is an array of objects with title and body. questions is an array of objects with field, question, and reason. Use an empty string for questionsNote and an empty array for questions when no follow-up is needed.",
    "",
    "Current project details:",
    JSON.stringify(project, null, 2),
  ].join("\n");
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifiedUserId(req) {
  const token = bearerToken(req);
  if (!token || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await response.json().catch(() => ({}));
  return response.ok && user?.id ? user.id : null;
}

async function saveAuditReview(req, project, review) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/website_request_ai_reviews?select=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: await verifiedUserId(req),
      contact_email: project.email || null,
      project_snapshot: project,
      review_snapshot: review,
      model: GROQ_MODEL,
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(String(rows?.message || "AI review audit could not be saved."));
  return Array.isArray(rows) ? rows[0]?.id || null : rows?.id || null;
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
        response_format: { type: "json_object" },
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
    const clientReview = {
      message: cleanText(review.message, 700),
      observations: Array.isArray(review.observations) ? review.observations.slice(0, 3).map((item) => ({
        title: cleanText(item?.title, 160),
        body: cleanText(item?.body, 700),
      })) : [],
      questionsNote: cleanText(review.questionsNote, 400),
      questions: Array.isArray(review.questions) ? review.questions.slice(0, 3) : [],
    };
    const reviewId = await saveAuditReview(req, project, clientReview);
    return res.status(200).json({ ...clientReview, reviewId });
  } catch (_error) {
    return res.status(500).json({ error: "N3XRA AI could not complete the review." });
  }
};
