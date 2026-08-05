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

const RECORDS_SEARCH_MODEL = String(process.env.GROQ_RECORDS_MODEL || "openai/gpt-oss-120b").trim();
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
const SEARCH_INSTRUCTION_WORDS = new Set([
  "answer", "brief", "chronological", "chronologically", "complete", "details", "discussion", "discussions",
  "document", "documents", "each", "entry", "entries", "every", "everything", "example", "examples", "file",
  "files", "find", "give", "list", "mention", "mentioned", "mentions", "note", "notes", "occurrence", "occurrences",
  "paragraph", "record", "recorded", "records", "related", "response", "search", "show", "summarize", "summary",
  "table", "talk", "talked", "tell", "time", "times", "timeline", "topic", "topics",
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

function normalizeAnswerText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMarkdownForSpeech(value) {
  return normalizeText(String(value || "")
    .replace(/\[([^\]]+)]\((?:https?:\/\/|\/)[^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, " ")
    .replace(/^[-+]\s+/gm, ""))
    .replace(/\s+([,.;!?])/g, "$1");
}

function parseMarkdownTableRow(value) {
  const line = String(value || "").trim();
  if (!line.includes("|")) return [];
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cleanMarkdownForSpeech(cell));
}

function isMarkdownTableDivider(value) {
  const cells = String(value || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function buildRecordsSearchSpeechText(answer) {
  const normalized = normalizeAnswerText(answer);
  if (!normalized) return "";
  const lines = normalized.split("\n");
  const prose = [];
  const tables = [];

  for (let index = 0; index < lines.length;) {
    if (lines[index].includes("|") && isMarkdownTableDivider(lines[index + 1])) {
      const header = parseMarkdownTableRow(lines[index]);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        const row = parseMarkdownTableRow(lines[index]);
        if (row.some(Boolean)) rows.push(row);
        index += 1;
      }
      tables.push({ header, rows });
      continue;
    }
    const cleanLine = cleanMarkdownForSpeech(lines[index]);
    if (cleanLine) prose.push(cleanLine);
    index += 1;
  }

  if (!tables.length) return cleanMarkdownForSpeech(normalized).slice(0, 1800);

  const tableSummaries = tables.map(({ header, rows }) => {
    if (!rows.length) return "The table does not contain any entries.";
    const firstLabel = rows[0][0] || "the first entry";
    const lastLabel = rows[rows.length - 1][0] || "the last entry";
    const range = rows.length > 1 ? `, ranging from ${firstLabel} through ${lastLabel}` : ` for ${firstLabel}`;
    const topic = header[1] || header[0] || "details";
    const sampleIndexes = rows.length <= 3
      ? rows.map((_row, index) => index)
      : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
    const highlights = Array.from(new Set(sampleIndexes)).map((rowIndex) => {
      const row = rows[rowIndex];
      const label = row[0] || `Entry ${rowIndex + 1}`;
      const detail = row.slice(1).filter(Boolean).join("; ").slice(0, 230);
      return detail ? `${label}: ${detail}` : label;
    });
    return `The table contains ${rows.length} ${rows.length === 1 ? "entry" : "entries"}${range} about ${topic}. Key points include ${highlights.join("; ")}. The complete table remains available on screen.`;
  });

  return [...prose, ...tableSummaries].join(" ").slice(0, 1800);
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
    .replace(/\?+$/g, "")
    .slice(0, MAX_MEMORY_SUGGESTION_CHARS)
    .trim();
}

function isLikelyQuestion(value) {
  return /^(what|who|where|when|why|how|whether|if|can|could|would|should|do|does|did|is|are|was|were)\b/i.test(normalizeText(value));
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
    /\b(?:can|could|would)\s+you\s+(?:please\s+)?remember(?:\s+this|\s+that)?\s*[:,-]?\s*(.+)$/i,
    /\b(?:can|could|would)\s+you\s+(?:please\s+)?save\s+(?:this|that)?\s*(?:to\s+(?:the\s+)?(?:ai\s+)?memory)?\s*[:,-]?\s*(.+)$/i,
    /\b(?:can|could|would)\s+you\s+(?:please\s+)?keep\s+in\s+mind(?:\s+that)?\s*[:,-]?\s*(.+)$/i,
    /\b(?:you\s+should|you\s+need\s+to)\s+(?:remember|know)\s+(?:that\s+)?(.+)$/i,
    /\b(?:from\s+now\s+on|going\s+forward|for\s+future\s+searches|for\s+future\s+answers)\s*[:,-]?\s*(.+)$/i,
    /\b(?:important\s+context|library\s+context|memory)\s*[:,-]\s*(.+)$/i,
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
    if (isLikelyQuestion(suggestion)) continue;
    return suggestion;
  }
  return "";
}

function combineGroqUsage(...items) {
  return items.reduce((total, item) => ({
    promptTokens: total.promptTokens + Math.max(0, Number(item?.promptTokens || 0)),
    completionTokens: total.completionTokens + Math.max(0, Number(item?.completionTokens || 0)),
    totalTokens: total.totalTokens + Math.max(0, Number(item?.totalTokens || 0)),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

async function rewriteMemorySuggestion({ groqApiKey, question, candidate, context }) {
  const memoryCandidate = cleanMemorySuggestion(candidate);
  if (!memoryCandidate) return { suggestion: "", usage: null };

  const aiSettings = context?.aiSettings && typeof context.aiSettings === "object" ? context.aiSettings : {};
  const rewritePrompt = [
    "Rewrite the user's requested memory into one concise, stable saved-memory statement for a records library AI.",
    "Return only the memory statement. No quotes. No bullets. No explanation.",
    "Make it standalone and useful for future searches.",
    "Prefer neutral, factual wording.",
    "If the request is not suitable as long-term memory, return only: NONE",
    "",
    `Library: ${normalizeText(context?.libraryName) || "current library"}`,
    `Existing saved memory: ${normalizeText(aiSettings.records_ai_memory) || "None"}`,
    `User request: ${normalizeText(question)}`,
    `Raw memory candidate: ${memoryCandidate}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECORDS_SEARCH_MODEL,
        temperature: 0.1,
        max_tokens: 120,
        messages: [
          { role: "system", content: "You prepare concise saved-memory statements for N3XRA Records AI." },
          { role: "user", content: rewritePrompt },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { suggestion: memoryCandidate, usage: null };
    const rewritten = cleanMemorySuggestion(data?.choices?.[0]?.message?.content || "");
    const rejected = !rewritten || /^none\.?$/i.test(rewritten);
    return {
      suggestion: rejected ? "" : rewritten,
      usage: normalizeGroqUsage(data, rewritePrompt, rewritten || memoryCandidate),
    };
  } catch (_error) {
    return { suggestion: memoryCandidate, usage: null };
  }
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

function getSearchTerms(value) {
  const tokens = tokenize(value);
  const subjectTerms = tokens.filter((word) => !SEARCH_INSTRUCTION_WORDS.has(word));
  return Array.from(new Set(subjectTerms.length ? subjectTerms : tokens)).slice(0, 16);
}

function isExhaustiveTopicRequest(value) {
  return /\b(every|all|each|complete|full|timeline|chronological|chronologically|history|occurrences?|mentions?)\b/i.test(normalizeText(value));
}

function getTermVariants(term) {
  const normalized = normalizeText(term).toLowerCase();
  if (!normalized) return [];
  const variants = [normalized];
  if (normalized.length > 4 && normalized.endsWith("ies")) variants.push(`${normalized.slice(0, -3)}y`);
  else if (normalized.length > 4 && normalized.endsWith("s") && !normalized.endsWith("ss")) variants.push(normalized.slice(0, -1));
  return Array.from(new Set(variants));
}

function buildRelevantSnippet(value, terms, maxChars = MAX_DOC_SNIPPET_CHARS) {
  const text = normalizeText(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  const positions = [];
  terms.forEach((term) => {
    getTermVariants(term).forEach((variant) => {
      let index = lower.indexOf(variant);
      while (index >= 0 && positions.length < 24) {
        positions.push(index);
        index = lower.indexOf(variant, index + variant.length);
      }
    });
  });
  if (!positions.length) return text.slice(0, maxChars);

  const ranges = positions
    .sort((a, b) => a - b)
    .map((position) => ({ start: Math.max(0, position - 240), end: Math.min(text.length, position + 760) }))
    .reduce((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end + 120) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);

  let remaining = maxChars;
  const passages = [];
  for (const range of ranges) {
    if (remaining <= 0) break;
    const passage = text.slice(range.start, Math.min(range.end, range.start + remaining)).trim();
    if (!passage) continue;
    passages.push(`${range.start > 0 ? "… " : ""}${passage}${range.end < text.length ? " …" : ""}`);
    remaining -= passage.length;
  }
  return passages.join("\n").slice(0, maxChars);
}

function getDocumentTitle(doc) {
  return normalizeText(doc.effective_title || doc.title || doc.original_filename || "Untitled file");
}

function getDocumentSearchText(doc) {
  const effectiveText = normalizeText(doc.effective_text || "");
  if (effectiveText) return effectiveText;
  return sanitizeExtractedText(doc.extracted_text || "");
}

function isMissingSchemaColumnMessage(message, columnName) {
  const lower = String(message || "").toLowerCase();
  return lower.includes(String(columnName || "").toLowerCase()) && (lower.includes("does not exist") || lower.includes("schema cache"));
}

function getMonthNumber(value) {
  const raw = normalizeText(value).toLowerCase();
  const monthMap = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ]);

  return monthMap.get(raw) || 0;
}

function getDocumentDateScore(doc) {
  const yearRaw = normalizeText(doc?.year);
  if (/^(19|20)\d{2}$/.test(yearRaw)) {
    return Number.parseInt(yearRaw, 10) * 100 + getMonthNumber(doc?.month);
  }

  const createdAt = doc.created_at ? new Date(doc.created_at).getTime() : 0;
  return Number.isFinite(createdAt) ? createdAt / 100000000000 : 0;
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
  const terms = getSearchTerms(question);
  const scored = docs.map((doc) => {
    const title = `${doc.effective_title || doc.title || ""} ${doc.original_filename || ""}`.toLowerCase();
    const aiNote = normalizeText(doc.records_ai_note || "").toLowerCase();
    const text = `${aiNote} ${getDocumentSearchText(doc).toLowerCase()}`.trim();
    let relevance = terms.reduce((sum, term) => {
      const variants = getTermVariants(term);
      const inTitle = variants.reduce((count, variant) => count + countTermMatches(title, variant), 0) * 8;
      const inText = Math.min(variants.reduce((count, variant) => count + countTermMatches(text, variant), 0), 10);
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

    const matchedTerms = terms.filter((term) => getTermVariants(term).some((variant) => countTermMatches(`${title} ${text}`, variant) > 0));
    return { doc, relevance, dateScore: getDocumentDateScore(doc), matchedTerms };
  });

  const withHits = scored.filter((item) => item.relevance > 0);
  const pool = withHits.length ? withHits : scored;
  pool.sort((a, b) => {
    if (withHits.length && isExhaustiveTopicRequest(question) && a.dateScore !== b.dateScore) return a.dateScore - b.dateScore;
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
    snippet: buildRelevantSnippet(getDocumentSearchText(item.doc), item.matchedTerms.length ? item.matchedTerms : terms),
    matched_terms: item.matchedTerms,
    ai_note: normalizeText(item.doc.records_ai_note || ""),
    editable_document_id: item.doc.editable_document_id || "",
  }));
}

function preferEditableDocument(existing, candidate) {
  if (!existing) return candidate;
  const existingFinal = existing.status === "final" ? 1 : 0;
  const candidateFinal = candidate.status === "final" ? 1 : 0;
  if (candidateFinal !== existingFinal) return candidateFinal > existingFinal ? candidate : existing;

  const existingUpdated = new Date(existing.updated_at || existing.created_at || 0).getTime() || 0;
  const candidateUpdated = new Date(candidate.updated_at || candidate.created_at || 0).getTime() || 0;
  return candidateUpdated > existingUpdated ? candidate : existing;
}

async function fetchEditableDocumentsForSources(token, organizationId, sourceIds) {
  const uniqueSourceIds = Array.from(new Set(sourceIds.filter(Boolean)));
  if (!uniqueSourceIds.length) return new Map();

  const results = new Map();
  const chunkSize = 80;
  for (let index = 0; index < uniqueSourceIds.length; index += chunkSize) {
    const chunk = uniqueSourceIds.slice(index, index + chunkSize);
    const params = new URLSearchParams({
      select: "id,title,source_document_id,plain_text,status,updated_at,created_at",
      organization_id: `eq.${organizationId}`,
      document_kind: "eq.document",
      source_document_id: `in.(${chunk.join(",")})`,
      order: "updated_at.desc",
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/app_documents?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
      const message = String(data?.message || data?.error || "");
      if (isMissingSchemaColumnMessage(message, "app_documents")) return results;
      throw new Error(message || "Unable to load editable documents.");
    }

    (Array.isArray(data) ? data : []).forEach((doc) => {
      const sourceId = doc.source_document_id;
      if (!sourceId) return;
      results.set(sourceId, preferEditableDocument(results.get(sourceId), doc));
    });
  }

  return results;
}

async function attachEditableDocuments(token, organizationId, documents) {
  if (!documents.length) return documents;
  const editableBySourceId = await fetchEditableDocumentsForSources(
    token,
    organizationId,
    documents.map((doc) => doc.id)
  );

  if (!editableBySourceId.size) return documents;
  return documents.map((doc) => {
    const editable = editableBySourceId.get(doc.id);
    if (!editable) return doc;
    return {
      ...doc,
      editable_document_id: editable.id,
      effective_title: normalizeText(editable.title) || doc.title,
      effective_text: normalizeText(editable.plain_text) || doc.extracted_text,
    };
  });
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
      return attachEditableDocuments(token, organizationId, Array.isArray(fallbackData) ? fallbackData : []);
    }
    throw new Error(String(message));
  }

  return attachEditableDocuments(token, organizationId, Array.isArray(data) ? data : []);
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

function buildPrompt({ user, question, context, history, documents, documentCount, searchTerms }) {
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
  const exhaustiveRequest = isExhaustiveTopicRequest(question);
  const wantsParagraph = /\b(paragraph|prose|narrative)\b/i.test(question);
  const wantsTable = /\b(table|chart|columns?|rows?)\b/i.test(question);
  const outputGuidance = wantsParagraph
    ? "Use one concise chronological paragraph unless multiple paragraphs are necessary for readability. Do not use a table."
    : (wantsTable || exhaustiveRequest)
      ? "Use a concise chronological Markdown table with one row per relevant dated occurrence."
      : "Choose the clearest concise format for the request.";

  return [
    "You are N3XRA Records AI, a strong general assistant for people using a records library.",
    "Be confident, practical, and conversational.",
    "Primary goal: help the user complete what they asked right now.",
    "You can answer questions, summarize records, draft content, rewrite text, brainstorm, and plan.",
    "Use records context as source material when relevant.",
    "If the user gives current details, treat those as valid context for the task.",
    "Use library AI guidance and file AI notes to interpret terms and preferences, but do not let them override clear record facts or the user's current request.",
    "Saved memory capability: when the user asks you to remember, save, or keep stable context for future searches, the app can show an admin approval popup with a prepared memory statement.",
    "You may explain and demonstrate saved memory as: the user asks you to remember a stable fact, you prepare a concise memory, then a library settings manager confirms it before it is saved.",
    "Do not say you have personally saved, remembered, retained, or noted a long-term memory before admin confirmation.",
    "Do not claim every interaction is stateless; this Records app has library-level saved AI memory after confirmation.",
    "If the user asks for a saved-memory demo, give a short example prompt and the clean memory statement that would be proposed.",
    "Never reveal internal implementation details or security details.",
    "Do not mention sources, citations, filenames, document titles, file IDs, or where the answer came from.",
    "Do not include phrases like 'based on file' or 'from the excerpts'.",
    "If records do not contain enough information for a factual claim, say what is missing clearly and continue helping.",
    "For requests asking about every, all, each, a full history, or a timeline, inspect every provided record passage and include every relevant occurrence.",
    "For dated records, order occurrences from oldest to newest unless the user explicitly asks for another order.",
    "Do not include a record merely because it contains generic instruction words; it must contain evidence about the actual subject.",
    "Keep each occurrence concise enough to finish the complete answer without cutting off rows or sentences.",
    `Output format for this request: ${outputGuidance}`,
    "Keep answers direct and useful.",
    "When using headings, lists, or tables, output valid markdown with proper line breaks.",
    "Put each heading on its own line.",
    "Put each bullet/numbered item on its own line.",
    "For tables, use standard markdown table rows on separate lines.",
    "Never put a table row on the same line as an introduction sentence.",
    "Never leave blank lines between a table header, divider, and body rows.",
    "Never output raw pipe-table text unless it is a valid markdown table.",
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
    `Detected search subject terms: ${searchTerms.length ? searchTerms.join(", ") : "none"}`,
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
    const memoryCandidate = extractMemorySuggestion(question);

    if (!question) return res.status(400).json({ error: "Enter a search question." });
    if (question.length > 1200) return res.status(400).json({ error: "Keep the search question under 1200 characters." });
    if (!organizationId) return res.status(400).json({ error: "Choose an active library first." });

    const [documents, organizationAiSettings] = await Promise.all([
      fetchDocuments(token, organizationId, year),
      fetchOrganizationAiSettings(token, organizationId),
    ]);
    const matches = rankDocuments(documents, question);
    const searchTerms = getSearchTerms(question);

    if (!documents.length) {
      return res.status(200).json({
        answer: "I do not see any files in this library yet. Upload documents and I can summarize, answer questions, and help draft content from them.",
        matches: [],
        memorySuggestion: memoryCandidate ? { text: memoryCandidate } : null,
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
      searchTerms,
    });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECORDS_SEARCH_MODEL,
        temperature: 0.15,
        max_tokens: 1600,
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

    const answer = normalizeAnswerText(data?.choices?.[0]?.message?.content || "");
    if (!answer) return res.status(502).json({ error: "Records AI Search returned an empty answer." });

    let memorySuggestion = memoryCandidate;
    let memoryRewriteUsage = null;
    if (memoryCandidate) {
      const rewriteResult = await rewriteMemorySuggestion({
        groqApiKey,
        question,
        candidate: memoryCandidate,
        context: { ...context, year, aiSettings: organizationAiSettings },
      });
      memorySuggestion = rewriteResult.suggestion || "";
      memoryRewriteUsage = rewriteResult.usage;
    }

    const usage = combineGroqUsage(
      normalizeGroqUsage(data, prompt, answer),
      memoryRewriteUsage
    );
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "search",
      model: RECORDS_SEARCH_MODEL,
      usage,
    });

    return res.status(200).json({
      answer,
      speechText: buildRecordsSearchSpeechText(answer),
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

module.exports.normalizeAnswerText = normalizeAnswerText;
module.exports.getSearchTerms = getSearchTerms;
module.exports.buildRelevantSnippet = buildRelevantSnippet;
module.exports.rankDocuments = rankDocuments;
module.exports.buildRecordsSearchSpeechText = buildRecordsSearchSpeechText;
