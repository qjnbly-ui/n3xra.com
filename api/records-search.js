const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
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

const RECORDS_SEARCH_MODEL = "llama-3.3-70b-versatile";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "did",
  "does",
  "find",
  "for",
  "from",
  "have",
  "how",
  "into",
  "show",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
]);

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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 12);
}

function getDocumentTitle(doc) {
  return normalizeText(doc.title || doc.original_filename || "Untitled file");
}

function countMatches(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 10) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function scoreDocument(doc, terms) {
  const title = `${doc.title || ""} ${doc.original_filename || ""}`.toLowerCase();
  const body = String(doc.extracted_text || "").toLowerCase();
  return terms.reduce((score, term) => {
    const titleScore = title.includes(term) ? 8 : 0;
    const bodyScore = Math.min(countMatches(body, term), 5);
    return score + titleScore + bodyScore;
  }, 0);
}

function getDocumentDateScore(doc) {
  const value = doc.created_at ? new Date(doc.created_at).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function getRequestedOrder(question) {
  const normalized = normalizeText(question).toLowerCase();
  if (/\b(newest|latest|recent|most recent)\b/.test(normalized)) return "newest";
  if (/\b(oldest|earliest|first|chronological|from the beginning)\b/.test(normalized)) return "oldest";
  return "relevance";
}

function getAiSearchIntent(question) {
  const normalized = normalizeText(question)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const assistantHelpPatterns = [
    /^(what|so what) can (you|ai search|this ai|the ai) do( for me| here| in this app)?$/,
    /^what do (you|ai search|this ai|the ai) do$/,
    /^what does (ai search|this ai|the ai) do$/,
    /^how can (you|ai search|this ai|the ai) help( me)?$/,
    /^how does (ai search|this ai|the ai) help( me)?$/,
    /^(what can|what should) i ask( you| ai search| this ai| the ai)?$/,
    /^(show|give me|list) (some )?(examples|sample questions|prompts)$/,
    /^how (does|do) (ai search|you|this ai|the ai|this search) work$/,
    /^what is ai search$/,
    /^help$/,
  ];

  if (assistantHelpPatterns.some((pattern) => pattern.test(normalized))) {
    return "assistant_help";
  }

  const appHelpTerms = [
    "account",
    "account admin",
    "billing",
    "download",
    "embed",
    "invite",
    "library",
    "login",
    "member",
    "password",
    "profile",
    "public record",
    "recording",
    "role",
    "share",
    "sign in",
    "upload",
    "viewer",
  ];
  const asksHowToUseApp = /\b(can i|how do i|how can i|where do i|what is the difference|what does|explain|show me how|help me)\b/.test(normalized);
  const mentionsAppFeature = appHelpTerms.some((term) => normalized.includes(term));

  if (asksHowToUseApp && mentionsAppFeature) {
    return "app_help";
  }

  return "document_question";
}

function buildAiSearchHelpAnswer(context, intent) {
  const libraryName = normalizeText(context.libraryName) || "this active library";
  if (intent === "app_help") {
    return [
      "I can help with that, but this AI Search box is mainly for questions about the contents of your files.",
      "",
      "Use AI Search when you want answers like:",
      "- What do our records say about a person, event, project, policy, invoice, or decision?",
      "- Which files mention a topic?",
      "- Summarize the notes about a subject across the library.",
      "",
      "For app controls like uploads, invite codes, roles, billing, public records, embeds, recordings, or account settings, use the Need help? AI on the Profile page. That assistant is built for product/functionality questions.",
      "",
      "If you want to search the files instead, ask the question as a records question. For example: \"Which files mention invite codes?\" or \"Summarize records about public meetings.\"",
    ].join("\n");
  }

  return [
    `Think of AI Search as a research helper for files in ${libraryName}.`,
    "",
    "What I can do:",
    "- Find files that mention a person, topic, date, event, project, policy, invoice, decision, or issue.",
    "- Summarize what the visible records say about something.",
    "- Compare information across files when there is enough evidence.",
    "- Point you to the most likely source files to open next.",
    "- Tell you when the records do not contain enough information instead of guessing.",
    "",
    "Strong questions to ask:",
    "\"What did these files say about the budget last year?\"",
    "\"Which documents mention Quentin Nichols?\"",
    "\"Summarize the decisions about the building project.\"",
    "\"Find files about insurance, grants, or equipment.\"",
    "",
    "I only use files you can access in the active library. For app questions like uploads, billing, roles, invite codes, or recordings, use the Need help? AI on the Profile page.",
  ].join("\n");
}

function makeSnippet(text, terms) {
  const clean = normalizeText(text);
  if (!clean) return "No extracted text is available for this file yet.";
  const lower = clean.toLowerCase();
  const match = terms.find((term) => lower.includes(term));
  if (!match) return `${clean.slice(0, 260)}${clean.length > 260 ? "..." : ""}`;
  const index = lower.indexOf(match);
  const start = Math.max(0, index - 90);
  const end = Math.min(clean.length, index + match.length + 190);
  return `${start > 0 ? "... " : ""}${clean.slice(start, end)}${end < clean.length ? " ..." : ""}`;
}

function rankDocuments(docs, question) {
  const terms = tokenize(question);
  const requestedOrder = getRequestedOrder(question);
  const scored = docs.map((doc) => ({
    doc,
    score: scoreDocument(doc, terms),
  }));

  const sortNewest = (a, b) => getDocumentDateScore(b.doc) - getDocumentDateScore(a.doc);
  const sortOldest = (a, b) => getDocumentDateScore(a.doc) - getDocumentDateScore(b.doc);
  const sortRelevance = (a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return sortNewest(a, b);
  };

  const matching = scored.filter((item) => item.score > 0);
  const pool = matching.length ? matching : scored;
  const sorter = requestedOrder === "oldest" ? sortOldest : requestedOrder === "relevance" ? sortRelevance : sortNewest;
  const selectedPool = [...pool].sort(sorter);
  const strongMatches = selectedPool.slice(0, 20);
  const fallback = [...scored].sort(sorter).slice(0, 12);
  const selected = strongMatches.length ? strongMatches : fallback;

  return selected.map((item) => ({
    id: item.doc.id,
    title: getDocumentTitle(item.doc),
    original_filename: normalizeText(item.doc.original_filename),
    year: item.doc.year || "",
    month: item.doc.month || "",
    is_public: Boolean(item.doc.is_public),
    created_at: item.doc.created_at || "",
    score: item.score,
    sort_order: requestedOrder,
    snippet: makeSnippet(item.doc.extracted_text || "", terms),
  }));
}

async function fetchDocuments(token, organizationId, year) {
  const params = new URLSearchParams({
    select: "id,title,original_filename,status,extracted_text,year,month,is_public,created_at",
    organization_id: `eq.${organizationId}`,
    order: "created_at.desc",
    limit: "250",
  });

  const normalizedYear = String(year || "").trim();
  if (normalizedYear && normalizedYear !== "all") {
    params.set("year", `eq.${normalizedYear}`);
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/documents?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    const message = data?.message || data?.error || "Unable to search documents.";
    throw new Error(String(message));
  }

  return Array.isArray(data) ? data : [];
}

function buildPrompt(user, question, context, matches, documentCount) {
  const libraryName = normalizeText(context.libraryName) || "current library";
  const role = normalizeText(context.role) || "unknown";
  const year = normalizeText(context.year) || "all years";
  const docs = matches
    .map((doc, index) => {
      return [
        `File ${index + 1}: ${doc.title}`,
        doc.original_filename ? `Filename: ${doc.original_filename}` : "",
        doc.year ? `Year: ${doc.year}` : "",
        doc.month ? `Month: ${doc.month}` : "",
        `Visibility: ${doc.is_public ? "public" : "private"}`,
        `Excerpt: ${doc.snippet.slice(0, 1100)}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  return [
    "You are a document search assistant for the user's active records library.",
    "Decision rule: answer document-content questions from the file excerpts. Do not answer app/tool-help questions from file excerpts.",
    "The user's current role and email are app context only. Do not treat them as facts from the records and do not tell the user what they personally can do based on document excerpts.",
    "Answer the user's document question using only the provided candidate file excerpts and metadata.",
    "Start with the clearest direct answer the excerpts support, then add concise supporting detail.",
    "Synthesize across candidate files when multiple excerpts are relevant. Do not rely on only one excerpt when several excerpts address the same question.",
    "If the provided excerpts do not contain enough evidence to answer, say that directly and suggest a better records search.",
    "Do not invent facts, names, roles, dates, relationships, or conclusions that are not supported by the excerpts.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "Avoid weak phrasing like 'appears to be' unless the evidence is genuinely uncertain.",
    "Keep the answer clear and useful. The interface displays source file cards separately, so do not add a separate citation list or repeat every source filename.",
    "Do not use markdown tables.",
    "",
    "Current context:",
    `User email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Year filter: ${year}`,
    `Source file order: ${getRequestedOrder(question)}`,
    `Visible documents considered: ${documentCount}`,
    "",
    `User question: ${question}`,
    "",
    "Candidate files:",
    docs || "No files were available for this search.",
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

  const token = getBearerToken(req);
  let user = null;
  try {
    user = await verifyUser(token);
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  try {
    const body = await parseJson(req);
    const question = normalizeText(body.question);
    const organizationId = normalizeText(body.organizationId);
    const year = normalizeText(body.year || "all");
    const context = body.context && typeof body.context === "object" ? body.context : {};

    if (!question) return res.status(400).json({ error: "Enter a search question." });
    if (question.length > 900) return res.status(400).json({ error: "Keep the search question under 900 characters." });
    if (!organizationId) return res.status(400).json({ error: "Choose an active library first." });

    const aiSearchIntent = getAiSearchIntent(question);
    if (aiSearchIntent !== "document_question") {
      return res.status(200).json({
        answer: buildAiSearchHelpAnswer(context, aiSearchIntent),
        matches: [],
        showSources: false,
      });
    }

    const documents = await fetchDocuments(token, organizationId, year);
    const matches = rankDocuments(documents, question);

    if (!documents.length) {
      return res.status(200).json({
        answer: "I do not see any files in this library for that search yet. Upload documents first, then AI Search can summarize likely matches.",
        matches: [],
        showSources: false,
      });
    }

    const usageContext = await prepareRecordsAiUsage({ organizationId, user });
    const prompt = buildPrompt(user, question, { ...context, year }, matches, documents.length);
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECORDS_SEARCH_MODEL,
        temperature: 0.2,
        max_tokens: 650,
        messages: [
          { role: "system", content: "You are N3XRA Records AI Search. Follow the user's instructions using only the provided Records file context." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI Search.") });
    }

    const answer = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!answer) return res.status(502).json({ error: "Records AI Search returned an empty answer." });
    const usage = normalizeGroqUsage(data, prompt, answer);
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "search",
      model: RECORDS_SEARCH_MODEL,
      usage,
    });

    return res.status(200).json({ answer, matches, usage: getClientUsageSummary(recorded?.usage || usageContext.usage) });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Records AI Search usage check failed.")) return;
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
};
