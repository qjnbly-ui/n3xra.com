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
const RECORDS_HELP_MAX_TOKENS = 650;
const HELP_KNOWLEDGE_PATH = path.join(__dirname, "records-help-knowledge.md");
let cachedHelpKnowledge = "";

const RECORDS_HELP_ACTIONS = Object.freeze({
  "library.search": "Show Library search",
  "library.ai_search": "Show AI Search",
  "library.upload": "Show document upload",
  "meeting.new": "Show new meeting note",
  "documents.new": "Show Document Builder",
  "messages.compose": "Show Communication",
  "account.profile": "Open Profile",
  "account.library": "Open Library settings",
  "account.templates": "Open Templates",
  "account.phone": "Open Phone Meetings",
  "account.ai": "Open AI settings",
  "account.users": "Open Users",
  "account.contacts": "Open Contacts",
  "account.access": "Open Invites & access",
  "account.storage": "Open Storage",
  "account.billing": "Open Billing",
  "account.activity": "Open Audit activity",
  "account.support": "Open support access",
});

function extractHelpActions(rawAnswer) {
  const requested = [];
  const answer = String(rawAnswer || "")
    .replace(/\[\[action:([a-z0-9._-]+)\]\]/gi, (_token, rawId) => {
      const id = String(rawId || "").toLowerCase();
      if (RECORDS_HELP_ACTIONS[id] && !requested.includes(id) && requested.length < 2) requested.push(id);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    answer,
    actions: requested.map((id) => ({ id, label: RECORDS_HELP_ACTIONS[id] })),
  };
}

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

function formatVerifiedRole(access) {
  const role = String(access?.membershipRole || "").trim().toLowerCase();
  if (role === "account_owner" || role === "account_admin") return "Account Admin";
  if (role === "editor") return "Editor";
  if (role === "viewer") return "Viewer";
  if (access?.isPlatformAdmin) return "N3XRA support";
  return "unknown";
}

function buildSystemPrompt(user, appContext) {
  const role = String(appContext?.role || "").trim() || "unknown";
  const plan = String(appContext?.plan || "").trim() || "unknown";
  const libraryName = String(appContext?.libraryName || "").trim() || "current library";
  const currentPath = String(appContext?.currentPath || "").trim() || "unknown";
  const requestedDisplayMode = String(appContext?.displayMode || "").trim().toLowerCase();
  const displayMode =
    requestedDisplayMode === "desktop" || requestedDisplayMode === "mobile"
      ? requestedDisplayMode
      : "unknown";
  const viewportWidthValue = Number(appContext?.viewportWidth);
  const viewportWidth =
    Number.isFinite(viewportWidthValue) && viewportWidthValue >= 0 && viewportWidthValue <= 10000
      ? Math.round(viewportWidthValue)
      : "unknown";
  const viewportHeightValue = Number(appContext?.viewportHeight);
  const viewportHeight =
    Number.isFinite(viewportHeightValue) && viewportHeightValue >= 0 && viewportHeightValue <= 10000
      ? Math.round(viewportHeightValue)
      : "unknown";
  const navigationPattern =
    displayMode === "desktop"
      ? "persistent left navigation"
      : displayMode === "mobile"
        ? "header menu drawer"
        : "unknown";
  const helpKnowledge = loadHelpKnowledge();

  return [
    "You are the N3XRA Records help assistant inside the Records app.",
    "Answer only questions about N3XRA Records product functionality, account setup, roles, invite codes, billing plans, document uploads, recordings, search, public records, embedded views, and basic troubleshooting.",
    "If the user asks what you can do or how you can help, explain your product-help role clearly instead of talking about the user's library files.",
    "If the user asks a question about what their documents say, explain that the Library Search area has AI Search for file-content questions.",
    "The user's current role is an app permission label only. Do not turn it into real-world responsibilities or activities.",
    "Use a calm, practical, friendly tone. Be direct and specific. Avoid hype.",
    "Accuracy is more important than sounding complete. Use only facts, navigation names, control labels, plan rules, and permissions stated in the supplied product knowledge.",
    "Never invent a button, menu, tab, field, page location, role rule, plan name, limit, feature toggle, or workflow step because it sounds plausible.",
    "When the supplied knowledge does not verify an exact label or step, say that you do not have a verified label for it and give only the nearest verified destination. Do not guess.",
    "Treat quoted interface labels in the product knowledge as exact. Do not replace them with plausible synonyms.",
    "Do not claim that drag and drop, progress bars, user-created tags, per-library feature switches, or automatic dialog behavior exists unless the supplied knowledge explicitly says so.",
    "Do not infer access from a role name alone. Apply both the documented membership-role rules and any documented plan requirement.",
    "Keep neighboring interface areas distinct. In particular, the Files section filters are All, Uploaded files, Agendas, and Supporting documents. Year and Reset belong to Keyword search and must never be described as Files section filters.",
    "Keyword and AI Search are modes in the Library Search section, not controls in the Files section. Keyword results update as the user types; there is no Keyword search icon or submit button. The Year dropdown filters saved document-year metadata, not the date a file was added.",
    "For an Individual file upload, File is the only required selection. Document title, Year, and Month are optional metadata. Never group those optional fields under required fields.",
    "Do not send an Editor or Viewer to Manage library > Users because that destination requires Account Admin. They can check the Library field labeled Your access or ask an Account Admin to confirm their role.",
    "Do not recommend a named browser unless the supplied product knowledge verifies it. For MediaRecorder troubleshooting, say to use a browser that supports recording and to allow microphone access.",
    "Account Admin does not automatically mean billing Owner. Never say an Account Admin can manage billing unless Current user context or the user confirms they are the billing Owner.",
    "On desktop, Profile is in the left navigation Account group. Never call it a header-right Profile link; the header-right actions are Ask Records AI, Dashboard, and Sign out.",
    "Keep every answer concise and easy to scan. The default maximum is 140 words; never exceed 180 words unless the user explicitly asks for more detail.",
    "Start with the answer in one or two short sentences. Do not restate the user's question and do not add a generic introduction or conclusion.",
    "For a workflow, follow the answer with a short numbered list of no more than 5 steps. Put exact page, tab, and control labels in bold.",
    "For a simple location or yes/no question, answer in one short paragraph and add at most one next step.",
    "Use a short **Note:** only for a permission, prerequisite, uncertainty, or likely blocker. Omit it otherwise.",
    "Use Markdown headings only when the answer truly needs more than one section. Never output dense walls of text.",
    "Do not use tables unless the user asks for a comparison or the information has at least 3 items with the same fields.",
    "Use the current page context when it helps explain the shortest path forward.",
    "Tailor navigation directions to the current display layout in Current user context.",
    "On desktop, direct the user to the persistent left navigation and the expandable **Manage library** section. Do not tell a desktop user to open the mobile menu.",
    "On mobile, direct the user to open the menu button in the header first, then choose the destination. Do not tell a mobile user to use a left sidebar.",
    "Give directions for the current display first. Mention the other layout only if the user asks how desktop and mobile differ.",
    "You cannot make data changes, submit forms, upload files, send messages, or change settings.",
    "You can offer safe navigation and page-highlighting buttons. When one would help, append one or at most two action tokens at the very end of the answer, each on its own line. The app removes these tokens and renders buttons.",
    "Only use an action token from this exact allowlist: [[action:library.search]], [[action:library.ai_search]], [[action:library.upload]], [[action:meeting.new]], [[action:documents.new]], [[action:messages.compose]], [[action:account.profile]], [[action:account.library]], [[action:account.templates]], [[action:account.phone]], [[action:account.ai]], [[action:account.users]], [[action:account.contacts]], [[action:account.access]], [[action:account.storage]], [[action:account.billing]], [[action:account.activity]], [[action:account.support]].",
    "Use an action only when it directly advances the user's request and their verified role/plan allows the destination. Do not describe an action token or invent another one.",
    "Say that the user can use the offered button; never claim that you already opened, clicked, highlighted, or completed anything.",
    "When a user wants an action completed, offer the nearest safe navigation/highlight action when available, then explain any remaining control labels they must use themselves.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "If asked about document AI search or summarizing records, explain that Library has Keyword and AI Search modes. Keyword matches saved extracted text. AI Search ranks accessible active-library documents and reviews selected extracted-text excerpts; it is not limited to file rows currently visible in the interface.",
    "If the question is unrelated to Records, briefly say you can help with Records app questions.",
    "",
    "Current user context:",
    `Email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Current plan: ${plan}`,
    `Current page: ${currentPath}`,
    `Current display: ${displayMode}`,
    `Viewport: ${viewportWidth} x ${viewportHeight}`,
    `Navigation pattern: ${navigationPattern}`,
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
    const verifiedContext = {
      ...appContext,
      libraryName: usageContext.organization?.name || appContext.libraryName,
      role: formatVerifiedRole(usageContext.access),
      plan: usageContext.usage?.planName || appContext.plan,
    };
    const systemPrompt = buildSystemPrompt(user, verifiedContext);
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
        temperature: 0,
        max_tokens: RECORDS_HELP_MAX_TOKENS,
        messages,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI.") });
    }

    const rawAnswer = String(data?.choices?.[0]?.message?.content || "").trim();
    const { answer, actions } = extractHelpActions(rawAnswer);
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

    return res.status(200).json({ answer, actions, usage: getClientUsageSummary(recorded?.usage || usageContext.usage) });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Records AI usage check failed.")) return;
    return res.status(500).json({ error: "Server error." });
  }
};

module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.formatVerifiedRole = formatVerifiedRole;
module.exports.loadHelpKnowledge = loadHelpKnowledge;
module.exports.RECORDS_HELP_MAX_TOKENS = RECORDS_HELP_MAX_TOKENS;
module.exports.RECORDS_HELP_ACTIONS = RECORDS_HELP_ACTIONS;
module.exports.extractHelpActions = extractHelpActions;
