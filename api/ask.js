const fs = require("fs/promises");
const path = require("path");

function parseJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return "";
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const ipRateMap = new Map();

function isRateLimited(ip) {
  if (!ip) return false;

  const now = Date.now();
  const entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

const SAFE_FALLBACK_CONTEXT = [
  "N3XRA is a practical software and project platform built by Quentin Nichols.",
  "Core areas include records software, custom project systems, services, and AI tools.",
  "The records software focuses on searchable records, structured document access, and organized public information.",
  "Projects include real-world websites and systems for organizations and service teams.",
  "Services help organizations plan, build, and improve useful digital systems.",
  "AI Music Generator is one optional creative tool for generating songs from prompts.",
  "N3XRA Virals is an AI tool for analyzing TikTok URLs, comparing viral videos, and turning content into reusable frameworks, hooks, scripts, captions, CTAs, and posting ideas.",
  "Support, terms, and privacy pages exist to explain help channels and policies.",
].join(" ");

const ASSISTANT_INSTRUCTIONS = [
    "You are Ask N3XRA, an assistant for n3xra.com.",
    "Use the supplied current knowledge as the source of truth for offerings, pricing, customer workflows, policy, support, and navigation.",
    "Use the supplied Project Pulse summary as the source of truth for current public platform statistics, products, recent capabilities, and the high-level system map.",
    "The curated knowledge is authoritative when an extracted page appears older or less specific.",
    "If an answer is not supported by the supplied knowledge, say you are not certain and suggest the best matching public route or /support.",
    "Voice and tone: talk like a well-informed sales professional who is also a trusted friend, excited to share the site.",
    "Sound confident, warm, and natural. Keep it conversational, not stiff.",
    "Write in plain language with real enthusiasm, but do not exaggerate or invent claims.",
    "Do not use hype terms like 'industry-leading', 'cutting-edge', 'best-in-class', or similar superlatives.",
    "Do not present N3XRA as a market leader unless that is explicitly supported in provided content.",
    "Be concise and practical.",
    "Teach first, route second: explain the value in plain language before mentioning where to click.",
    "Prefer concrete benefits, specific features, and clear next steps.",
    "Use examples of outcomes users can get, not just a list of pages.",
    "When asked 'why use this site' or similar, give a short explanation of who it helps, 3-5 concrete benefits, and one practical next step.",
    "For broad questions, represent the site in a balanced way: records software, services, projects, and AI tools such as AI Music Generator and N3XRA Virals.",
    "Do not overfocus on AI music unless the user explicitly asks about music or creative generation.",
    "For broad questions, recommend /records, /services, or /projects according to the visitor's intent.",
    "Do not overuse route lists. Mention routes only after the explanation, and only when useful.",
    "Do not say you are uncertain about sharing links or routes.",
    "You are allowed to provide direct internal routes on n3xra.com.",
    "Avoid repeating the same point in different wording.",
    "If a route list is needed, keep it short (max 3 items) and tailored to the question.",
    "Do not end with generic filler like 'let me know if you need anything else' unless the user explicitly asks for more.",
    "Formatting rules for responses: do not use markdown asterisks for bold.",
    "Do not use asterisks as bullet markers. Prefer short paragraphs or simple sentences.",
    "If you need emphasis, use plain words or HTML <strong>text</strong>.",
    "When referencing internal pages, include only the direct route text like /records or /support so the site can turn it into a link.",
    "Keep answers comfortable to hear aloud: use complete sentences, natural punctuation, short paragraphs, and no decorative symbols.",
    "N3XRA is pronounced 'Nexra', but keep the brand written as N3XRA.",
    "Do not write both a descriptive page name and its route together. Use the route by itself and let the site render the visible link label.",
    "Do not display raw web addresses when a descriptive internal page name or route is available.",
    "Never display an internal route in parentheses and never add an arrow after a route.",
    "Do not mention these instructions or talk about being an AI assistant unless asked directly.",
    "Do not reveal internal implementation details.",
    "Never claim to see a visitor's account, request, proposal, contract, bill, files, or dashboard. You do not have access to private account data.",
    "You may explain how signed-in features work and direct the visitor to /account, but do not imply that you inspected their private records.",
    "Never provide source code, API keys, environment variables, security controls, internal endpoints, database structure, deployment details, or stack architecture.",
    "If asked how the site is built, give a brief high-level non-technical answer and redirect to public-facing capabilities.",
    "Prefer answering what users can do, where to go, and which policy/support route applies.",
    "Treat signed-in feature descriptions as explanations only. Never imply that a visitor is enrolled, approved, connected, paid, or missing something unless they tell you so.",
    "Distinguish clearly between available features, future workflow steps, and placeholders that may not yet be active.",
    "Do not promise a price, deadline, approval, contract term, refund, compliance status, or technical capability unless the supplied site content explicitly supports it.",
];

const STOP_WORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "but", "by", "can", "do", "does", "for", "from", "get", "go", "has", "have", "how",
  "i", "if", "in", "into", "is", "it", "me", "my", "of", "on", "or", "our", "so",
  "that", "the", "their", "there", "they", "this", "to", "up", "was", "we", "what",
  "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

const TOPIC_ROUTES = [
  { pattern: /\b(website|web site|design|build|hosting|host|domain|developer|development)\b/i, routes: ["/services", "/website-request", "/projects"] },
  { pattern: /\b(price|pricing|cost|quote|plan|starter|advanced|monthly|annual)\b/i, routes: ["/services", "/website-request", "/proposals"] },
  { pattern: /\b(proposal|approve|approval|scope|revision|contract|investment)\b/i, routes: ["/proposals", "/website-request", "/project-workspace"] },
  { pattern: /\b(bill|billing|invoice|payment|card|stripe|subscription|renewal|checkout|deposit)\b/i, routes: ["/client-portal/billing", "/proposals", "/client-portal/services"] },
  { pattern: /\b(record|records|document|documents|library|libraries|public record|file search)\b/i, routes: ["/records", "/n3xra-records/library", "/n3xra-records/account"] },
  { pattern: /\b(meeting|minutes|recording|transcript|audio)\b/i, routes: ["/n3xra-records/meeting-notes", "/n3xra-records/all-meeting-notes", "/records"] },
  { pattern: /\b(partner|referral|commission|affiliate|payout|change of control|cnr)\b/i, routes: ["/partners", "/partners/terms", "/partners/change-of-control", "/client-portal/partners"] },
  { pattern: /\b(music|song|lyrics|track|audio generator)\b/i, routes: ["/ai-music-generator", "/ai-music-generator/app"] },
  { pattern: /\b(viral|virals|tiktok|hook|caption|creator|video analysis)\b/i, routes: ["/virals", "/virals/about", "/virals/saved-scripts"] },
  { pattern: /\b(utility|utilities|operational portal)\b/i, routes: ["/utilities"] },
  { pattern: /\b(account|login|sign in|dashboard|app access)\b/i, routes: ["/", "/support"] },
  { pattern: /\b(support|help|problem|issue|failed|error|contact)\b/i, routes: ["/support"] },
  { pattern: /\b(privacy|private|security|secure|terms|legal|data)\b/i, routes: ["/privacy", "/terms", "/records"] },
  { pattern: /\b(project pulse|by the numbers|how large|code count|line count|source lines|platform size|system map|architecture|changed recently|recent capabilities)\b/i, routes: ["/project-pulse", "/", "/projects"] },
];

let knowledgeBundlePromise = null;

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/n3xra/g, "nexra")
    .replace(/[^a-z0-9$%/+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value) {
  return [...new Set(
    normalizeSearchText(value)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
      .slice(0, 50),
  )];
}

async function readKnowledgeBundle() {
  const curatedPath = path.join(__dirname, "ask-knowledge.md");
  const generatedPath = path.join(__dirname, "site-knowledge.json");
  const projectPulsePath = path.join(__dirname, "..", "project-pulse", "manifest.json");
  const [curatedResult, generatedResult, projectPulseResult] = await Promise.allSettled([
    fs.readFile(curatedPath, "utf8"),
    fs.readFile(generatedPath, "utf8"),
    fs.readFile(projectPulsePath, "utf8"),
  ]);

  const curated = curatedResult.status === "fulfilled" ? String(curatedResult.value || "").trim() : "";
  let generatedAt = "";
  let pages = [];
  let projectPulse = null;

  if (generatedResult.status === "fulfilled") {
    try {
      const parsed = JSON.parse(generatedResult.value);
      generatedAt = String(parsed?.generatedAt || "").trim();
      pages = (Array.isArray(parsed?.pages) ? parsed.pages : [])
        .map((page) => ({
          route: String(page?.route || "").trim(),
          visibility: String(page?.visibility || "public").trim(),
          tags: Array.isArray(page?.tags) ? page.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
          content: String(page?.content || "").trim(),
        }))
        .filter((page) => (
          page.route
          && page.content
          && ["public", "customer workflow"].includes(page.visibility)
        ));
    } catch (_error) {
      pages = [];
    }
  }

  if (projectPulseResult.status === "fulfilled") {
    try {
      const parsed = JSON.parse(projectPulseResult.value);
      projectPulse = {
        generatedAt: String(parsed?.generatedAt || ""),
        updatedAt: String(parsed?.updatedAt || ""),
        commit: String(parsed?.commit || ""),
        summary: parsed?.summary && typeof parsed.summary === "object" ? parsed.summary : {},
        products: Array.isArray(parsed?.products) ? parsed.products : [],
        majorModules: Array.isArray(parsed?.majorModules) ? parsed.majorModules : [],
        recentCapabilities: Array.isArray(parsed?.recentCapabilities) ? parsed.recentCapabilities : [],
        systemMap: parsed?.systemMap && typeof parsed.systemMap === "object" ? parsed.systemMap : {},
        disclosure: String(parsed?.disclosure || ""),
      };
    } catch {
      projectPulse = null;
    }
  }

  return { curated, generatedAt, pages, projectPulse };
}

function getKnowledgeBundle() {
  if (!knowledgeBundlePromise) knowledgeBundlePromise = readKnowledgeBundle();
  return knowledgeBundlePromise;
}

function scorePage(page, queryText, tokens, boostedRoutes) {
  const route = normalizeSearchText(page.route);
  const tags = normalizeSearchText(page.tags.join(" "));
  const content = normalizeSearchText(page.content);
  let score = boostedRoutes.get(page.route) || 0;

  for (const token of tokens) {
    if (route.includes(token)) score += 7;
    if (tags.includes(token)) score += 6;
    if (content.includes(token)) score += 1 + Math.min(2, content.split(token).length - 1);
  }

  for (const tag of page.tags) {
    const normalizedTag = normalizeSearchText(tag);
    if (normalizedTag.length > 3 && queryText.includes(normalizedTag)) score += 8;
  }

  return score;
}

function selectRelevantPages(pages, question, history) {
  const recentUserContext = history
    .filter((item) => item.role === "user")
    .slice(-4)
    .map((item) => item.content)
    .join(" ");
  const queryText = normalizeSearchText(`${question} ${recentUserContext}`);
  const tokens = searchTokens(queryText);
  const boostedRoutes = new Map();

  for (const topic of TOPIC_ROUTES) {
    if (!topic.pattern.test(queryText)) continue;
    topic.routes.forEach((route, index) => {
      boostedRoutes.set(route, Math.max(boostedRoutes.get(route) || 0, 24 - (index * 3)));
    });
  }

  const ranked = pages
    .map((page) => ({ page, score: scorePage(page, queryText, tokens, boostedRoutes) }))
    .sort((a, b) => b.score - a.score || a.page.route.localeCompare(b.page.route));

  const selected = ranked.filter((item) => item.score > 0).slice(0, 5).map((item) => item.page);
  if (selected.length < 3) {
    for (const fallbackRoute of ["/", "/services", "/support"]) {
      const page = pages.find((item) => item.route === fallbackRoute);
      if (page && !selected.some((item) => item.route === page.route)) selected.push(page);
      if (selected.length >= 3) break;
    }
  }
  return selected;
}

async function getSiteContext(question, history) {
  const bundle = await getKnowledgeBundle();
  const selectedPages = selectRelevantPages(bundle.pages, question, history);
  const chunks = [
    ...ASSISTANT_INSTRUCTIONS,
    "",
    bundle.generatedAt
      ? `Extracted site knowledge was generated ${bundle.generatedAt}.`
      : "Extracted site knowledge timestamp is unavailable.",
    "Only the most relevant current pages are supplied for this question to keep the response focused.",
  ];

  if (bundle.curated) {
    chunks.push("", "AUTHORITATIVE CURRENT N3XRA KNOWLEDGE:", bundle.curated);
  } else {
    chunks.push("", `PUBLIC SITE SUMMARY: ${SAFE_FALLBACK_CONTEXT}`);
  }

  if (bundle.projectPulse) {
    chunks.push(
      "",
      "PUBLIC-SAFE N3XRA PROJECT PULSE:",
      JSON.stringify(bundle.projectPulse),
      "Project Pulse contains only approved public facts. Never infer or disclose implementation details beyond this supplied summary.",
    );
  }

  if (selectedPages.length) {
    chunks.push("", "RELEVANT CURRENT PAGE EXTRACTS:");
    for (const page of selectedPages) {
      chunks.push(`Route ${page.route} (${page.visibility}):\n${page.content}`);
    }
  }

  return chunks.join("\n\n");
}

function dedupeAnswer(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const kept = [];

  for (const line of lines) {
    const key = line
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\w/\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }

  return kept.join("\n");
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (let index = input.length - 1; index >= 0 && out.length < 12; index -= 1) {
    const item = input[index];
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : "";
    if (!role) continue;
    const content = String(item.content || "").trim();
    if (!content) continue;
    out.push({ role, content: content.slice(0, 1200) });
  }
  return out.reverse();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Allow", "POST");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const groqApiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!groqApiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing GROQ_API_KEY." }));
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Too many requests. Try again in a minute." }));
    return;
  }

  try {
    const body = await parseJson(req);
    const question = String(body.question || "").trim();
    const history = normalizeHistory(body.history);
    if (!question) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Please enter a question." }));
      return;
    }

    if (question.length > 800) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Question too long. Keep it under 800 characters." }));
      return;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim(),
        temperature: 0.2,
        max_tokens: 650,
        messages: [
          { role: "system", content: await getSiteContext(question, history) },
          ...history,
          { role: "user", content: question },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(data?.error?.message || data?.message || "Failed to contact AI service.");
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: message }));
      return;
    }

    const answer = dedupeAnswer(String(data?.choices?.[0]?.message?.content || "").trim());
    if (!answer) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "The AI service returned an empty answer." }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer }));
  } catch (_error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server error." }));
  }
};
