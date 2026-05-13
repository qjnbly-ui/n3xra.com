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

const RECORDS_SEARCH_MODEL = String(process.env.GROQ_RECORDS_MODEL || "llama-3.3-70b-versatile").trim();
const MAX_CONTEXT_CHARS = 110000;
const MAX_DOC_SNIPPET_CHARS = 3000;
const MAX_HISTORY = 12;
const MAX_MEMORY_SUGGESTION_CHARS = 700;
const STOP_WORDS = new Set([
  "a", "about", "all", "and", "any", "are", "as", "at", "be", "but", "by", "can", "did", "do", "for", "from", "have",
  "how", "i", "if", "in", "is", "it", "its", "let", "me", "more", "of", "on", "or", "please", "tell", "that", "the",
  "them", "there", "they", "this", "to", "us", "was", "we", "what", "when", "where", "who", "why", "with", "would",
  "you", "your",
]);
const MONTH_TERMS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeExtractedText(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const rawTagHits = (raw.match(/<w:[a-z0-9]+/gi) || []).length;
  if (rawTagHits < 4) return normalizeText(raw);
  const stripped = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:lt|gt|amp|quot|apos);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeText(stripped);
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && normalizeText(item.content))
    .slice(-MAX_HISTORY)
    .map((item) => ({
      role: item.role,
      content: normalizeText(item.content).slice(0, 3000),
    }));
}

function cleanMemorySuggestion(value) {
  return normalizeText(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(that|this)\s+/i, "")
    .slice(0, MAX_MEMORY_SUGGESTION_CHARS)
    .trim();
}

function extractMemorySuggestion(question) {
  const text = normalizeText(question);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (
    /\bwhat\s+do\s+you\s+remember\b/.test(lower) ||
    /\bdo\s+you\s+remember\b/.test(lower) ||
    /\bwhat\s+is\s+saved\b/.test(lower)
  ) {
    return "";
  }

  const patterns = [
    /\b(?:please\s+)?remember(?:\s+this|\s+that)?\s*[:,-]\s*(.+)$/i,
    /\b(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i,
    /\b(?:please\s+)?save\s+(?:this|that)?\s*(?:to\s+(?:the\s+)?(?:ai\s+)?memory)?\s*[:,-]\s*(.+)$/i,
    /\b(?:please\s+)?save\s+(?:to\s+(?:the\s+)?(?:ai\s+)?memory\s+)?(?:that\s+)?(.+)$/i,
    /\b(?:please\s+)?keep\s+in\s+mind(?:\s+that)?\s*[:,-]?\s*(.+)$/i,
    /\b(?:please\s+)?note\s+(?:this|that)?\s*[:,-]\s*(.+)$/i,
    /\b(?:please\s+)?add\s+(?:this|that)?\s*(?:to\s+(?:the\s+)?(?:ai\s+)?memory|as\s+(?:ai\s+)?memory)\s*[:,-]?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const suggestion = cleanMemorySuggestion(match?.[1] || "");
    if (!suggestion) continue;
    if (/^(what|who|where|when|why|how|whether|if)\b/i.test(suggestion)) continue;
    return suggestion;
  }
  return "";
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

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 24);
}

function getDocumentTitle(doc) {
  return normalizeText(doc.title || doc.original_filename || "Untitled file");
}

function isMissingSchemaColumnMessage(message, columnName) {
  const lower = String(message || "").toLowerCase();
  return lower.includes(String(columnName || "").toLowerCase()) && (lower.includes("does not exist") || lower.includes("schema cache"));
}

function getDocumentDateScore(doc) {
  const value = doc.created_at ? new Date(doc.created_at).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function countTermMatches(text, term) {
  if (!text || !term) return 0;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  let count = 0;
  while (regex.exec(text) && count < 20) count += 1;
  return count;
}

function rankDocuments(docs, question) {
  const questionText = normalizeText(question).toLowerCase();
  const hasYearTerm = /\b(19|20)\d{2}\b/.test(questionText);
  const hasMonthTerm = MONTH_TERMS.some((month) => questionText.includes(month));
  const monthYearPhrases = MONTH_TERMS.flatMap((month) => {
    const years = questionText.match(/\b(19|20)\d{2}\b/g) || [];
    return years.map((year) => `${month} ${year}`);
  });
  const terms = tokenize(question);
  const scored = docs.map((doc) => {
    const title = `${doc.title || ""} ${doc.original_filename || ""}`.toLowerCase();
    const aiNote = normalizeText(doc.records_ai_note || "").toLowerCase();
    const text = `${aiNote} ${sanitizeExtractedText(doc.extracted_text || "").toLowerCase()}`.trim();
    let relevance = terms.reduce((sum, term) => {
      const inTitle = countTermMatches(title, term) * 8;
      const inText = Math.min(countTermMatches(text, term), 10);
      return sum + inTitle + inText;
    }, 0);
    const monthValue = normalizeText(doc.month).toLowerCase();
    const yearValue = normalizeText(doc.year).toLowerCase();
    const metaText = `${title} ${monthValue} ${yearValue}`.trim();
    const exactPhraseBoost = monthYearPhrases.reduce((boost, phrase) => (
      boost + (metaText.includes(phrase) || text.includes(phrase) ? 30 : 0)
    ), 0);
    relevance += exactPhraseBoost;
    if (hasYearTerm && yearValue && questionText.includes(yearValue)) relevance += 20;
    if (hasMonthTerm && monthValue && questionText.includes(monthValue)) relevance += 20;

    return { doc, relevance, dateScore: getDocumentDateScore(doc) };
  });

  const withHits = scored.filter((item) => item.relevance > 0);
  const pool = withHits.length ? withHits : scored;
  pool.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return b.dateScore - a.dateScore;
  });

  return pool.slice(0, 120).map((item) => ({
    id: item.doc.id,
    title: getDocumentTitle(item.doc),
    original_filename: normalizeText(item.doc.original_filename),
    year: item.doc.year || "",
    month: item.doc.month || "",
    is_public: Boolean(item.doc.is_public),
    created_at: item.doc.created_at || "",
    relevance: item.relevance,
    snippet: sanitizeExtractedText(item.doc.extracted_text || "").slice(0, MAX_DOC_SNIPPET_CHARS),
    ai_note: normalizeText(item.doc.records_ai_note || ""),
  }));
}

async function fetchDocuments(token, organizationId, year) {
  const params = new URLSearchParams({
    select: "id,title,original_filename,status,extracted_text,records_ai_note,year,month,is_public,created_at",
    organization_id: `eq.${organizationId}`,
    order: "created_at.desc",
    limit: "400",
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
    if (isMissingSchemaColumnMessage(message, "records_ai_note")) {
      const fallbackParams = new URLSearchParams(params);
      fallbackParams.set("select", "id,title,original_filename,status,extracted_text,year,month,is_public,created_at");
      const fallbackResponse = await fetch(`${SUPABASE_URL}/rest/v1/documents?${fallbackParams.toString()}`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      });
      const fallbackData = await fallbackResponse.json().catch(() => ([]));
      if (!fallbackResponse.ok) {
        throw new Error(String(fallbackData?.message || fallbackData?.error || message));
      }
      return Array.isArray(fallbackData) ? fallbackData : [];
    }
    throw new Error(String(message));
  }

  return Array.isArray(data) ? data : [];
}

async function fetchOrganizationAiSettings(token, organizationId) {
  const params = new URLSearchParams({
    select: "id,name,records_ai_context,records_ai_response_style,records_ai_memory",
    id: `eq.${organizationId}`,
    limit: "1",
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/organizations?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    const message = data?.message || data?.error || "";
    if (
      isMissingSchemaColumnMessage(message, "records_ai_context") ||
      isMissingSchemaColumnMessage(message, "records_ai_response_style") ||
      isMissingSchemaColumnMessage(message, "records_ai_memory")
    ) {
      return {};
    }
    throw new Error(String(message || "Unable to load library AI settings."));
  }
  return Array.isArray(data) ? data[0] || {} : {};
}

function buildDocumentContext(matches) {
  let total = 0;
  const sections = [];
  const usedMatches = [];
  for (const doc of matches) {
    const block = [
      `Title: ${doc.title || "Untitled"}`,
      doc.year ? `Year: ${doc.year}` : "",
      doc.month ? `Month: ${doc.month}` : "",
      doc.ai_note ? `AI note for this file: ${doc.ai_note}` : "",
      `Created: ${doc.created_at || "unknown"}`,
      `Text: ${doc.snippet || "No extracted text."}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (total + block.length > MAX_CONTEXT_CHARS) break;
    total += block.length;
    sections.push(block);
    usedMatches.push(doc);
  }
  return {
    contextText: sections.join("\n\n---\n\n"),
    usedMatches,
  };
}

function buildPrompt({ user, question, context, history, documents, documentCount }) {
  const libraryName = normalizeText(context.libraryName) || "current library";
  const role = normalizeText(context.role) || "unknown";
  const aiSettings = context.aiSettings && typeof context.aiSettings === "object" ? context.aiSettings : {};
  const libraryAiGuidance = [
    normalizeText(aiSettings.records_ai_context) ? `Library background: ${normalizeText(aiSettings.records_ai_context)}` : "",
    normalizeText(aiSettings.records_ai_response_style) ? `Preferred response style: ${normalizeText(aiSettings.records_ai_response_style)}` : "",
    normalizeText(aiSettings.records_ai_memory) ? `Saved AI memory: ${normalizeText(aiSettings.records_ai_memory)}` : "",
  ].filter(Boolean).join("\n") || "None";

  const historyText = history.length
    ? history.map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`).join("\n")
    : "None";

  return [
    "You are N3XRA Records AI, a strong general assistant for people using a records library.",
    "Be confident, practical, and conversational.",
    "Primary goal: help the user complete what they asked right now.",
    "You can answer questions, summarize records, draft content, rewrite text, brainstorm, and plan.",
    "Use records context as source material when relevant.",
    "If the user gives current details, treat those as valid context for the task.",
    "Use library AI guidance and file AI notes to interpret terms and preferences, but do not let them override clear record facts or the user's current request.",
    "You cannot permanently save memory yourself. If the user asks you to remember something, explain that it can be suggested for an admin to approve.",
    "Never reveal internal implementation details or security details.",
    "Do not mention sources, citations, filenames, document titles, file IDs, or where the answer came from.",
    "Do not include phrases like 'based on file' or 'from the excerpts'.",
    "If records do not contain enough information for a factual claim, say what is missing clearly and continue helping.",
    "Keep answers direct and useful.",
    "When using headings, lists, or tables, output valid markdown with proper line breaks.",
    "Put each heading on its own line.",
    "Put each bullet/numbered item on its own line.",
    "For tables, use standard markdown table rows on separate lines.",
    "A table header row must contain column names only, such as Year, Month, Event, Cost, Status, Notes.",
    "Never put a table title, caption, full sentence, warning, or explanation inside a table header cell.",
    "Every table row must use the same number of columns as the header row.",
    "If a row needs explanation, put that explanation in a Notes column.",
    "When drafting posts/messages, produce polished copy the user can use immediately.",
    "When asked follow-up questions, use conversation memory to stay coherent.",
    "",
    "App context:",
    `User email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role label: ${role}`,
    `Documents available in current query: ${documentCount}`,
    "",
    "Library AI guidance saved by this library's admins:",
    libraryAiGuidance,
    "",
    "Recent conversation:",
    historyText,
    "",
    `User request: ${question}`,
    "",
    "Records context:",
    documents || "No records context available.",
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
    const history = normalizeHistory(body.history);
    const memorySuggestion = extractMemorySuggestion(question);

    if (!question) return res.status(400).json({ error: "Enter a search question." });
    if (question.length > 1200) return res.status(400).json({ error: "Keep the search question under 1200 characters." });
    if (!organizationId) return res.status(400).json({ error: "Choose an active library first." });

    const [documents, organizationAiSettings] = await Promise.all([
      fetchDocuments(token, organizationId, year),
      fetchOrganizationAiSettings(token, organizationId),
    ]);
    const matches = rankDocuments(documents, question);

    if (!documents.length) {
      return res.status(200).json({
        answer: "I do not see any files in this library yet. Upload documents and I can summarize, answer questions, and help draft content from them.",
        matches: [],
        memorySuggestion: memorySuggestion ? { text: memorySuggestion } : null,
        showSources: false,
      });
    }

    const usageContext = await prepareRecordsAiUsage({ organizationId, user });
    const { contextText: documentsContext, usedMatches } = buildDocumentContext(matches);
    const prompt = buildPrompt({
      user,
      question,
      context: { ...context, year, aiSettings: organizationAiSettings },
      history,
      documents: documentsContext,
      documentCount: documents.length,
    });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECORDS_SEARCH_MODEL,
        temperature: 0.35,
        max_tokens: 900,
        messages: [
          { role: "system", content: "You are N3XRA Records AI." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI Search.") });
    }

    const answer = normalizeText(data?.choices?.[0]?.message?.content || "");
    if (!answer) return res.status(502).json({ error: "Records AI Search returned an empty answer." });

    const usage = normalizeGroqUsage(data, prompt, answer);
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "search",
      model: RECORDS_SEARCH_MODEL,
      usage,
    });

    return res.status(200).json({
      answer,
      matches: usedMatches,
      showSources: usedMatches.length > 0,
      memorySuggestion: memorySuggestion ? { text: memorySuggestion } : null,
      usage: getClientUsageSummary(recorded?.usage || usageContext.usage),
    });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Records AI Search usage check failed.")) return;
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
};
