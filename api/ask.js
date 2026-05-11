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
  { route: "/software", file: "software/index.html" },
  { route: "/services", file: "services/index.html" },
  { route: "/projects", file: "projects/index.html" },
  { route: "/ai-music-generator", file: "ai-music-generator/index.html" },
  { route: "/support", file: "support/index.html" },
  { route: "/terms", file: "terms/index.html" },
  { route: "/privacy", file: "privacy/index.html" },
];

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let siteContextPromise = null;

async function buildSiteContext() {
  const chunks = [
    "You are Ask N3XRA, an assistant for n3xra.com.",
    "Use the site content below as the source of truth for offerings, policy, support, and navigation.",
    "If something is not in this content, say you are not certain and suggest the best matching route.",
    "Write in a direct, human tone. Avoid generic filler and vague marketing language.",
    "Be concise and practical.",
    "Prefer concrete benefits, specific features, and clear next steps with route references like /software or /support.",
    "When asked 'why use this site' or similar, answer with 3-5 specific reasons and one recommended next action.",
    "Do not reveal internal implementation details.",
    "Never provide source code, API keys, environment variables, security controls, internal endpoints, database structure, deployment details, or stack architecture.",
    "If asked how the site is built, give a brief high-level non-technical answer and redirect to public-facing capabilities.",
    "Prefer answering what users can do, where to go, and which policy/support route applies.",
  ];

  const root = process.cwd();
  for (const page of CONTEXT_PAGES) {
    try {
      const fullPath = path.join(root, page.file);
      const html = await fs.readFile(fullPath, "utf8");
      const text = htmlToText(html).slice(0, 5000);
      chunks.push(`Route ${page.route}: ${text}`);
    } catch (_error) {
      chunks.push(`Route ${page.route}: [Content unavailable at runtime]`);
    }
  }

  return chunks.join("\n\n");
}

async function getSiteContext() {
  if (!siteContextPromise) {
    siteContextPromise = buildSiteContext();
  }
  return siteContextPromise;
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

    const answer = String(data?.choices?.[0]?.message?.content || "").trim();
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
