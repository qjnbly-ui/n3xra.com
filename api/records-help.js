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
    "Answer only questions about N3XRA Records product functionality, account setup, roles, invite codes, billing plans, document uploads, recordings, search, public records, embedded views, and basic troubleshooting.",
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
    "N3XRA Records stores, searches, previews, downloads, and shares records, meeting packets, agendas, documents, and meeting recordings.",
    "Account features include sign in, account creation, email confirmation, password reset, profile name editing, selected-library switching, plan/status viewing, and account deletion options.",
    "Library features include creating or joining libraries, switching the active library, shared libraries, library settings, public page branding colors, and library name updates when the user's role allows it.",
    "Access features include invite-code redemption, invite-code creation with role, maximum uses, and optional expiration, member lists, role display, and role-based permissions.",
    "Roles: Owner controls billing, plan changes, and ownership decisions. Account Admin manages library settings, invite codes, and day-to-day administration without owning billing. Editor uploads, edits, deletes, downloads, and shares files. Viewer has read-only file access with download and share access.",
    "Billing features include current plan display, monthly/yearly plan selection, plan changes, billing management when available, document limits, storage limits, user limits, and shared-library needs.",
    "Document upload features include individual file uploads, batch import, optional folder labels, year/month metadata, public/private visibility, extracted searchable text, and upload progress/status messages.",
    "Supported document uploads include DOCX and text-based files such as TXT, MD, CSV, JSON, and HTML.",
    "File management features include newest files, All Files, file preview/opening, download, share/public toggle, edit file details, delete files, and source-file access according to role.",
    "Search currently supports keyword or phrase matching across saved extracted text plus year filters and reset controls.",
    "Public records features include public URLs and embedded records views when public access is enabled and files are marked public.",
    "Embed features include a public page URL, iframe embed code, copy buttons, open public page, and a read-only embedded records view with search and files.",
    "Recording features include a Recordings area, active-library context, live browser audio recording, meeting title entry, pause/resume when supported, stop/save, audio file upload, upload progress, newest recordings, and All Recordings.",
    "All Recordings features include browsing saved recordings, playback, recording details, status, transcript status, start/end time, duration, file size, retry for failed recordings, and delete when the user's role allows it.",
    "Recording access depends on the user's role and active library. If a user cannot see or use recording controls, they may need editor/admin-level access or an active library that supports recordings.",
    "If you mention next steps, point users to the relevant visible area in the app, such as Profile, Selected Library, Library access, Invite codes, Shared access, Billing, Upload, Search, All files, Embed settings, Recordings, or All Recordings.",
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
