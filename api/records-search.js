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
  "who",
  "with",
  "you",
]);

const ROLE_LIST_TERMS = [
  "account administrators",
  "account admins",
  "administrators",
  "admins",
  "board members",
  "board member",
  "committee members",
  "committee member",
  "directors",
  "director",
  "members",
  "member",
  "officers",
  "officer",
  "owners",
  "owner",
  "president",
  "secretary",
  "treasurer",
  "trustees",
  "trustee",
  "vice president",
];

const NAME_PREFIX_BLOCKLIST = new Set([
  "A",
  "Active",
  "AI",
  "All",
  "Candidate",
  "Current",
  "File",
  "For",
  "Good",
  "I",
  "If",
  "More",
  "N3XRA",
  "No",
  "Question",
  "Records",
  "Source",
  "The",
  "This",
  "Use",
  "User",
  "Visible",
  "What",
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

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: normalizeText(item.content).slice(0, 1000),
    }));
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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termRegExp(term) {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
}

function containsTerm(value, term) {
  return termRegExp(term).test(String(value || ""));
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
  const matcher = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "gi");
  let count = 0;
  while (matcher.exec(haystack) && count < 10) {
    count += 1;
  }
  return count;
}

function scoreDocument(doc, terms) {
  const title = `${doc.title || ""} ${doc.original_filename || ""}`.toLowerCase();
  const body = String(doc.extracted_text || "").toLowerCase();
  return terms.reduce((score, term) => {
    const titleScore = containsTerm(title, term) ? 8 : 0;
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

function isRoleListQuestion(question) {
  const normalized = normalizeText(question).toLowerCase();
  return /\b(who|which|list|name|identify)\b/.test(normalized) &&
    ROLE_LIST_TERMS.some((term) => containsTerm(normalized, term));
}

function getFactQuestionType(question) {
  const normalized = normalizeText(question).toLowerCase();
  if (isRoleListQuestion(normalized)) return "role_list";
  if (/\b(who|which|list|name|identify)\b/.test(normalized)) return "identity";
  if (/\b(when|date|month|year|timeline|deadline)\b/.test(normalized)) return "date";
  if (/\b(how many|how much|amount|cost|price|budget|total|percent|percentage|number)\b/.test(normalized)) return "quantity";
  if (/\b(approved|denied|decided|decision|vote|voted|passed|motion|status|outcome)\b/.test(normalized)) return "decision";
  return "general";
}

function getRequestedRoleTerms(question) {
  const normalized = normalizeText(question).toLowerCase();
  return ROLE_LIST_TERMS
    .filter((term) => containsTerm(normalized, term))
    .sort((a, b) => b.length - a.length);
}

function expandRoleEvidenceTerms(terms) {
  const expanded = new Set(terms);
  terms.forEach((term) => {
    if (term.endsWith("s")) expanded.add(term.slice(0, -1));
    if (!term.endsWith("s")) expanded.add(`${term}s`);
  });
  return Array.from(expanded);
}

function hasExplicitRoleEvidence(question, matches, context) {
  if (!isRoleListQuestion(question)) return true;
  const requestedTerms = getRequestedRoleTerms(question);
  if (!requestedTerms.length) return false;
  const specificRequestedTerms = requestedTerms.filter((term) => term.includes(" "));
  const evidenceTerms = expandRoleEvidenceTerms(specificRequestedTerms.length ? specificRequestedTerms : requestedTerms);
  const evidence = buildEvidenceText(matches, context);
  return evidenceTerms.some((term) => containsTerm(evidence, term));
}

function getQuestionGuidance(question) {
  const questionType = getFactQuestionType(question);
  const baseGuidance = [
    `Question type: ${questionType}.`,
    "Evidence standard: answer only with facts that are directly supported by the candidate file text or metadata.",
    "Do not use outside knowledge, likely assumptions, memory, or plausible completions.",
  ];

  if (questionType !== "role_list") return baseGuidance;

  return [
    ...baseGuidance,
    "For role/list questions, only list a person or organization when an excerpt explicitly connects them to the requested role, title, group, or membership.",
    "Do not infer someone is a board member, officer, director, owner, admin, or member just because they attended, spoke, voted, made a motion, was thanked, volunteered, donated, or appeared near a related word.",
    "Copy names exactly as written in the excerpts. Never correct, approximate, rename, or substitute a person's name.",
    "Separate confirmed people from ambiguous mentions when needed.",
    "If the excerpts only show attendance or participation, say the excerpts do not explicitly identify the requested role list.",
  ];
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

function buildRetrievalQuestion(question, history) {
  const recentUserQuestions = history
    .filter((item) => item.role === "user")
    .slice(-2)
    .map((item) => item.content);
  return normalizeText([...recentUserQuestions, question].join(" "));
}

function makeSnippet(text, terms) {
  const clean = normalizeText(text);
  if (!clean) return "No extracted text is available for this file yet.";
  const lower = clean.toLowerCase();
  const match = terms.find((term) => containsTerm(lower, term));
  if (!match) return `${clean.slice(0, 260)}${clean.length > 260 ? "..." : ""}`;
  const matchResult = termRegExp(match).exec(lower);
  const index = matchResult?.index ?? lower.indexOf(match);
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

function buildConversationContext(history) {
  if (!history.length) return ["None."];
  return history.map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`);
}

function buildPrompt(user, question, context, matches, documentCount, history = []) {
  const libraryName = normalizeText(context.libraryName) || "current library";
  const role = normalizeText(context.role) || "unknown";
  const year = normalizeText(context.year) || "all years";
  const docs = matches
    .map((doc) => {
      return [
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
    "Every person name in the answer must appear exactly in the candidate files below.",
    "Never change the spelling of a name from the excerpts.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "Avoid weak phrasing like 'appears to be' unless the evidence is genuinely uncertain.",
    "Keep the answer clear and useful.",
    "Do not mention sources, source files, file cards, filenames, document titles, excerpts, citations, or where the answer came from.",
    "Answer as a helpful person would after researching the records: provide the answer or summary only.",
    "Do not use markdown tables.",
    "",
    "Current context:",
    `User email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Year filter: ${year}`,
    `Ordering preference: ${getRequestedOrder(question)}`,
    `Visible documents considered: ${documentCount}`,
    "",
    "Recent Library Search conversation:",
    "Use this only to understand follow-up wording. Do not treat prior answers as evidence.",
    ...buildConversationContext(history),
    "",
    "Question guidance:",
    ...getQuestionGuidance(question),
    "",
    `User question: ${question}`,
    "",
    "Candidate files:",
    docs || "No files were available for this search.",
  ].join("\n");
}

function buildEvidenceText(matches, context = {}) {
  const evidence = matches
    .map((doc) => [
      doc.title,
      doc.original_filename,
      doc.year,
      doc.month,
      doc.snippet,
    ].filter(Boolean).join(" "))
    .join("\n");

  return [
    context.libraryName,
    context.role,
    context.year,
    evidence,
  ].filter(Boolean).join("\n");
}

function extractNameCandidates(text) {
  const matches = String(text || "").match(/\b[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]\.)){1,3}\b/g) || [];
  return Array.from(new Set(matches.map((name) => normalizeText(name)).filter((name) => {
    const first = name.split(/\s+/)[0];
    return !NAME_PREFIX_BLOCKLIST.has(first);
  })));
}

function extractYearCandidates(text) {
  return Array.from(new Set(String(text || "").match(/\b(?:19|20)\d{2}\b/g) || []));
}

function extractMoneyAndPercentCandidates(text) {
  return Array.from(new Set(String(text || "").match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%/g) || []));
}

function valuesNotInEvidence(values, evidenceText) {
  const evidence = ` ${normalizeText(evidenceText).toLowerCase()} `;
  return values.filter((value) => {
    const normalizedValue = normalizeText(value).toLowerCase();
    return normalizedValue && !evidence.includes(normalizedValue);
  });
}

function getUnsupportedFacts(answer, evidenceText) {
  return {
    names: valuesNotInEvidence(extractNameCandidates(answer), evidenceText),
    years: valuesNotInEvidence(extractYearCandidates(answer), evidenceText),
    amounts: valuesNotInEvidence(extractMoneyAndPercentCandidates(answer), evidenceText),
  };
}

function hasUnsupportedFacts(result) {
  return Boolean(result?.names?.length || result?.years?.length || result?.amounts?.length);
}

function formatUnsupportedFacts(result) {
  return [
    result.names?.length ? `names: ${result.names.join(", ")}` : "",
    result.years?.length ? `years: ${result.years.join(", ")}` : "",
    result.amounts?.length ? `amounts: ${result.amounts.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

function mergeUsage(a, b) {
  return {
    promptTokens: Math.max(0, Number(a?.promptTokens || 0)) + Math.max(0, Number(b?.promptTokens || 0)),
    completionTokens: Math.max(0, Number(a?.completionTokens || 0)) + Math.max(0, Number(b?.completionTokens || 0)),
    totalTokens: Math.max(0, Number(a?.totalTokens || 0)) + Math.max(0, Number(b?.totalTokens || 0)),
  };
}

function buildUnsupportedFactFallback(question) {
  if (isRoleListQuestion(question)) {
    return [
      "I cannot confirm a complete role list from the provided excerpts without risking an incorrect name.",
      "",
      "For this kind of question, I need the records to explicitly label people with the requested role, such as board member, officer, president, secretary, treasurer, director, or committee member.",
      "",
      "Try a narrower search such as \"board members\", \"officers\", \"president\", \"secretary\", or \"treasurer\" so the source files can be reviewed more directly.",
    ].join("\n");
  }

  return "I found potentially relevant files, but I cannot safely answer without risking unsupported facts. Try a more specific search using the exact name, role, date, amount, or topic you want confirmed.";
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
    const retrievalQuestion = buildRetrievalQuestion(question, history);
    const matches = rankDocuments(documents, retrievalQuestion);

    if (!documents.length) {
      return res.status(200).json({
        answer: "I do not see any files in this library for that search yet. Upload documents first, then AI Search can summarize likely matches.",
        matches: [],
        showSources: false,
      });
    }

    if (!hasExplicitRoleEvidence(question, matches, { ...context, year })) {
      return res.status(200).json({
        answer: buildUnsupportedFactFallback(question),
        matches: [],
        showSources: false,
      });
    }

    const usageContext = await prepareRecordsAiUsage({ organizationId, user });
    const prompt = buildPrompt(user, question, { ...context, year }, matches, documents.length, history);
    const evidenceText = buildEvidenceText(matches, { ...context, year });
    const messages = [
      { role: "system", content: "You are N3XRA Records AI Search. Follow the user's instructions using only the provided Records file context." },
      { role: "user", content: prompt },
    ];
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
        messages,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI Search.") });
    }

    let answer = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!answer) return res.status(502).json({ error: "Records AI Search returned an empty answer." });
    let usage = normalizeGroqUsage(data, prompt, answer);
    let unsupportedFacts = getUnsupportedFacts(answer, evidenceText);

    if (hasUnsupportedFacts(unsupportedFacts)) {
      const correctionPrompt = [
        "Rewrite the previous answer.",
        `The previous answer included facts that do not appear exactly in the provided excerpts or metadata: ${formatUnsupportedFacts(unsupportedFacts)}.`,
        "Remove unsupported names, years, dates, amounts, percentages, and role claims.",
        "Use only facts that appear directly in the excerpts or metadata.",
        "If the excerpts do not explicitly support the requested answer, say that clearly instead of guessing.",
      ].join("\n");
      const correctionMessages = [
        ...messages,
        { role: "assistant", content: answer },
        { role: "user", content: correctionPrompt },
      ];
      const correctionResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: RECORDS_SEARCH_MODEL,
          temperature: 0,
          max_tokens: 520,
          messages: correctionMessages,
        }),
      });
      const correctionData = await correctionResponse.json().catch(() => ({}));
      if (correctionResponse.ok) {
        const correctedAnswer = String(correctionData?.choices?.[0]?.message?.content || "").trim();
        if (correctedAnswer) {
          answer = correctedAnswer;
          usage = mergeUsage(usage, normalizeGroqUsage(correctionData, correctionMessages.map((item) => item.content).join("\n\n"), answer));
        }
      }

      unsupportedFacts = getUnsupportedFacts(answer, evidenceText);
      if (hasUnsupportedFacts(unsupportedFacts)) {
        answer = buildUnsupportedFactFallback(question);
      }
    }

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
