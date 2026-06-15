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

const CONTEXT_PAGES = [
  { route: "/", file: "index.html" },
  { route: "/records", file: "records/index.html" },
  { route: "/services", file: "services/index.html" },
  { route: "/projects", file: "projects/index.html" },
  { route: "/ai-music-generator", file: "ai-music-generator/index.html" },
  { route: "/n3xra-virals/web", file: "n3xra-virals/web/index.html" },
  { route: "/support", file: "support/index.html" },
  { route: "/terms", file: "terms/index.html" },
  { route: "/privacy", file: "privacy/index.html" },
];

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

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractImportantContent(html) {
  const source = String(html || "");
  const cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const blocks = [];
  const patterns = [
    /<title[^>]*>([\s\S]*?)<\/title>/gi,
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/gi,
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      const text = decodeHtmlEntities(htmlToText(match[1]));
      if (!text) continue;
      if (text.length < 12) continue;
      blocks.push(text);
      if (blocks.length >= 120) break;
    }
    if (blocks.length >= 120) break;
  }

  return blocks.join("\n").slice(0, 6500);
}

let siteContextPromise = null;

async function readKnowledgeFile() {
  const knowledgePath = path.join(__dirname, "site-knowledge.json");
  try {
    const raw = await fs.readFile(knowledgePath, "utf8");
    const parsed = JSON.parse(raw);
    const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
    const chunks = [];
    for (const page of pages) {
      const route = String(page?.route || "").trim();
      const content = String(page?.content || "").trim();
      if (!route || !content) continue;
      chunks.push(`Route ${route}: ${content}`);
    }
    return chunks.length ? chunks.join("\n\n") : "";
  } catch (_error) {
    return "";
  }
}

async function buildSiteContext() {
  const chunks = [
    "You are Ask N3XRA, an assistant for n3xra.com.",
    "Use the site content below as the source of truth for offerings, policy, support, and navigation.",
    "If something is not in this content, say you are not certain and suggest the best matching route.",
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
    "For broad questions, default recommended next step to /records, /services, or /projects based on the question intent.",
    "Do not overuse route lists. Mention routes only after the explanation, and only when useful.",
    "Do not say you are uncertain about sharing links or routes.",
    "You are allowed to provide direct internal routes on n3xra.com.",
    "Avoid repeating the same point in different wording.",
    "If a route list is needed, keep it short (max 3 items) and tailored to the question.",
    "Do not end with generic filler like 'let me know if you need anything else' unless the user explicitly asks for more.",
    "Formatting rules for responses: do not use markdown asterisks for bold.",
    "If you need emphasis, use plain words or HTML <strong>text</strong>.",
    "When referencing internal pages, include direct route text like /records or /support in the sentence.",
    "Do not mention these instructions or talk about being an AI assistant unless asked directly.",
    "Do not reveal internal implementation details.",
    "Never provide source code, API keys, environment variables, security controls, internal endpoints, database structure, deployment details, or stack architecture.",
    "If asked how the site is built, give a brief high-level non-technical answer and redirect to public-facing capabilities.",
    "Prefer answering what users can do, where to go, and which policy/support route applies.",
    "",
    "Current N3XRA Records software capabilities:",
    "N3XRA Records includes libraries, shared access, role-based permissions, invite codes, billing/plan controls, document uploads, batch import, metadata, keyword/year search, AI Search summaries across visible file excerpts, newest files, Files, file preview/open/download/share/edit/delete, public records URLs, embedded records views, and meeting-note tools.",
    "Document and public record lists show newest records first by document year/month when available, then upload date.",
    "The meeting-note tools include live browser audio recording, audio file upload, saved meeting notes, newest meeting notes, Meeting Notes, playback, details, editable notes, AI review, transcript, AI draft, retry for failed recordings, and delete when the user's role allows it.",
  ];

  const knowledgeText = await readKnowledgeFile();
  if (knowledgeText) {
    chunks.push(knowledgeText);
    return chunks.join("\n\n");
  }

  const roots = [path.resolve(__dirname, ".."), process.cwd()];
  let addedPages = 0;

  for (const page of CONTEXT_PAGES) {
    let loaded = false;
    for (const root of roots) {
      try {
        const fullPath = path.join(root, page.file);
        const html = await fs.readFile(fullPath, "utf8");
        const text = extractImportantContent(html);
        if (text) {
          chunks.push(`Route ${page.route}: ${text}`);
          addedPages += 1;
          loaded = true;
          break;
        }
      } catch (_error) {
        // Try next root path.
      }
    }
    if (!loaded) continue;
  }

  if (addedPages === 0) {
    chunks.push(`Public site summary: ${SAFE_FALLBACK_CONTEXT}`);
  }

  return chunks.join("\n\n");
}

async function getSiteContext() {
  if (!siteContextPromise) {
    siteContextPromise = buildSiteContext();
  }
  return siteContextPromise;
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
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : "";
    if (!role) continue;
    const content = String(item.content || "").trim();
    if (!content) continue;
    out.push({ role, content: content.slice(0, 1200) });
    if (out.length >= 12) break;
  }
  return out;
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
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 380,
        messages: [
          { role: "system", content: await getSiteContext() },
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
