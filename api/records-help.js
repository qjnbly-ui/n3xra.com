const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ""
).trim();

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

  return [
    "You are the N3XRA Records help assistant inside the Records app.",
    "Answer only questions about N3XRA Records product functionality, account setup, roles, invite codes, billing plans, uploads, search, public records, embedded views, and basic troubleshooting.",
    "Use a calm, practical, friendly tone. Be direct and specific. Avoid hype.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "If asked about document AI search or summarizing records, explain that the current app uses keyword/year search and file preview, and AI document search is a separate upcoming mode.",
    "If the question is unrelated to Records, briefly say you can help with Records app questions.",
    "",
    "Current user context:",
    `Email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Current plan: ${plan}`,
    "",
    "Core Records facts:",
    "N3XRA Records stores, searches, previews, downloads, and shares records, meeting packets, agendas, and documents.",
    "Supported uploads include DOCX and text-based files such as TXT, MD, CSV, JSON, and HTML.",
    "Search currently supports keyword matching and year filters.",
    "Public records can be exposed through public URLs and embedded records views when enabled and when files are marked public.",
    "Invite codes can be created with a role, maximum uses, and optional expiration. Users redeem invite codes to join shared libraries.",
    "Roles: Owner controls billing, plan changes, and ownership decisions. Account Admin manages library settings, invite codes, and day-to-day administration without owning billing. Editor uploads, edits, deletes, downloads, and shares files. Viewer has read-only file access with download and share access.",
    "Plans scale by document count, storage, users, and shared-library needs.",
    "If you mention next steps, point users to the relevant visible area in the app, such as Library access, Invite codes, Billing, Upload, Search, or Embed settings.",
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

    if (!question) return res.status(400).json({ error: "Enter a question." });
    if (question.length > 900) return res.status(400).json({ error: "Keep the question under 900 characters." });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.25,
        max_tokens: 420,
        messages: [
          { role: "system", content: buildSystemPrompt(user, appContext) },
          ...history,
          { role: "user", content: question },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI.") });
    }

    const answer = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!answer) return res.status(502).json({ error: "Records AI returned an empty answer." });
    return res.status(200).json({ answer });
  } catch (_error) {
    return res.status(500).json({ error: "Server error." });
  }
};
