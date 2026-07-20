const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const fs = require("fs");
const path = require("path");
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ""
).trim();
const {
  getClientUsageSummary,
  normalizeGroqUsage,
  prepareRecordsAiUsage,
  recordRecordsAiUsage,
  sendRecordsAiUsageError,
} = require("./_records-ai-usage");

const RECORDS_HELP_MODEL = "openai/gpt-oss-120b";
const HELP_KNOWLEDGE_PATH = path.join(__dirname, "records-help-knowledge.md");
let cachedHelpKnowledge = "";

function loadHelpKnowledge() {
  if (cachedHelpKnowledge) return cachedHelpKnowledge;
  try {
    cachedHelpKnowledge = fs.readFileSync(HELP_KNOWLEDGE_PATH, "utf8").trim();
  } catch (_error) {
    cachedHelpKnowledge = "";
  }
  return cachedHelpKnowledge;
}

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

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase auth config.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error("Invalid session.");
  return data;
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").trim().slice(0, 1000),
    }));
}

function buildSystemPrompt(user, appContext) {
  const role = String(appContext?.role || "").trim() || "unknown";
  const plan = String(appContext?.plan || "").trim() || "unknown";
  const libraryName = String(appContext?.libraryName || "").trim() || "current library";
  const helpKnowledge = loadHelpKnowledge();

  return [
    "You are the N3XRA Records help assistant inside the Records app.",
    "Answer only questions about N3XRA Records product functionality, account setup, roles, invite codes, billing plans, document uploads, recordings, search, public records, embedded views, and basic troubleshooting.",
    "If the user asks what you can do or how you can help, explain your product-help role clearly instead of talking about the user's library files.",
    "If the user asks a question about what their documents say, explain that the Library Search area has AI Search for file-content questions.",
    "The user's current role is an app permission label only. Do not turn it into real-world responsibilities or activities.",
    "Use a calm, practical, friendly tone. Be direct and specific. Avoid hype.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "If asked about document AI search or summarizing records, explain that the Library Search area has Keyword mode and AI Search mode. Keyword mode matches exact saved extracted text. AI Search reviews visible file excerpts for the active library and returns a short summary with suggested files.",
    "If the question is unrelated to Records, briefly say you can help with Records app questions.",
    "",
    "Current user context:",
    `Email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Current plan: ${plan}`,
    "",
    "Use this current Records product knowledge as the source of truth for navigation names, workflow advice, and button labels:",
    helpKnowledge || "No external product knowledge file was loaded. Answer from the general Records instructions above.",
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const groqApiKey = String(process.env.GROQ_RECORDS_API_KEY || "").trim();
  if (!groqApiKey) {
    return res.status(500).json({ error: "Missing GROQ_RECORDS_API_KEY." });
  }

  let user = null;
  try {
    user = await verifyUser(getBearerToken(req));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  try {
    const body = await parseJson(req);
    const question = String(body.question || "").trim();
    const appContext = body.context && typeof body.context === "object" ? body.context : {};
    const history = normalizeHistory(body.history);
    const organizationId = String(appContext.organizationId || body.organizationId || "").trim();

    if (!question) return res.status(400).json({ error: "Enter a question." });
    if (question.length > 900) return res.status(400).json({ error: "Keep the question under 900 characters." });
    if (!organizationId) return res.status(400).json({ error: "Choose an active library first." });

    const usageContext = await prepareRecordsAiUsage({ organizationId, user });
    const systemPrompt = buildSystemPrompt(user, appContext);
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: question },
    ];
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECORDS_HELP_MODEL,
        temperature: 0.25,
        max_tokens: 420,
        messages,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI.") });
    }

    const answer = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!answer) return res.status(502).json({ error: "Records AI returned an empty answer." });
    const fallbackPrompt = messages.map((item) => item.content).join("\n\n");
    const usage = normalizeGroqUsage(data, fallbackPrompt, answer);
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "help",
      model: RECORDS_HELP_MODEL,
      usage,
    });

    return res.status(200).json({ answer, usage: getClientUsageSummary(recorded?.usage || usageContext.usage) });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Records AI usage check failed.")) return;
    return res.status(500).json({ error: "Server error." });
  }
};
