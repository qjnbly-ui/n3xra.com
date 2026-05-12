const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ""
).trim();

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
  const scored = docs.map((doc) => ({
    doc,
    score: scoreDocument(doc, terms),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.doc.created_at || 0).getTime() - new Date(a.doc.created_at || 0).getTime();
  });

  const strongMatches = scored.filter((item) => item.score > 0).slice(0, 10);
  const fallback = scored.slice(0, 8);
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
    snippet: makeSnippet(item.doc.extracted_text || "", terms),
  }));
}

async function fetchDocuments(token, organizationId, year) {
  const params = new URLSearchParams({
    select: "id,title,original_filename,status,extracted_text,year,month,is_public,created_at",
    organization_id: `eq.${organizationId}`,
    order: "created_at.desc",
    limit: "80",
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
        `Excerpt: ${doc.snippet.slice(0, 1400)}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  return [
    "You are N3XRA Records AI Search inside the Records app.",
    "Use only the provided file excerpts and metadata. Do not invent file contents.",
    "Do not reveal implementation details, database schema, internal APIs, env vars, security controls, source code, or vendor internals.",
    "Answer like a practical records assistant: friendly, concise, and useful.",
    "Start with a direct answer or summary. Then mention the most relevant files by title.",
    "If the excerpts are weak or no exact match appears, say that clearly and suggest a keyword refinement.",
    "Do not use markdown tables.",
    "",
    "Current context:",
    `User email: ${user?.email || "unknown"}`,
    `Active library: ${libraryName}`,
    `Current role: ${role}`,
    `Year filter: ${year}`,
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

    const documents = await fetchDocuments(token, organizationId, year);
    const matches = rankDocuments(documents, question);

    if (!documents.length) {
      return res.status(200).json({
        answer: "I do not see any files in this library for that search yet. Upload documents first, then AI Search can summarize likely matches.",
        matches: [],
      });
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
        max_tokens: 650,
        messages: [
          { role: "system", content: "You are N3XRA Records AI Search. Follow the user's instructions using only the provided Records file context." },
          { role: "user", content: buildPrompt(user, question, { ...context, year }, matches, documents.length) },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: String(data?.error?.message || data?.message || "Unable to reach Records AI Search.") });
    }

    const answer = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!answer) return res.status(502).json({ error: "Records AI Search returned an empty answer." });

    return res.status(200).json({ answer, matches });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
};
