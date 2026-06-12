const {
  getClientUsageSummary,
  normalizeGroqUsage,
  prepareRecordsAiUsage,
  recordRecordsAiUsage,
  sendRecordsAiUsageError,
} = require("./_records-ai-usage");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const GROQ_RECORDS_API_KEY = String(process.env.GROQ_RECORDS_API_KEY || process.env.GROQ_API_KEY || "").trim();
const GROQ_RECORDING_NOTES_MODEL = String(process.env.GROQ_RECORDS_NOTES_MODEL || "openai/gpt-oss-120b").trim();

const MAX_TEMPLATE_CHARS = 20000;
const MAX_NOTES_CHARS = 30000;
const MAX_TRANSCRIPT_CHARS = 70000;
const MAX_CURRENT_DRAFT_CHARS = 45000;
const MAX_REVIEW_DECISION_CHARS = 14000;

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

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

async function fetchSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || data?.msg || `Supabase request failed with status ${response.status}.`);
    const error = new Error(message);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
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

async function loadRecording(recordingId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/meeting_recordings?select=*&id=eq.${encodeFilter(recordingId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadOrganization(organizationId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,owner_user_id,subscription_tier&id=eq.${encodeFilter(organizationId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadTemplate(templateId, organizationId) {
  if (!templateId) return null;
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/app_documents?select=id,title,content_json,plain_text&organization_id=eq.${encodeFilter(organizationId)}&id=eq.${encodeFilter(templateId)}&document_kind=eq.template&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function userCanReviewRecording(organization, user) {
  if (!organization?.id || !user?.id) return false;

  const [membershipRows, adminRows] = await Promise.all([
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/organization_memberships?select=role&organization_id=eq.${encodeFilter(organization.id)}&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/platform_admins?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
  ]);

  const isPlatformAdmin = Array.isArray(adminRows) && adminRows.length > 0;
  if (isPlatformAdmin) return true;

  const role = String(Array.isArray(membershipRows) ? membershipRows[0]?.role || "" : "").trim();
  const canManage = ["account_owner", "account_admin", "editor"].includes(role) || organization.owner_user_id === user.id;
  return canManage && organization.subscription_tier === "organization";
}

async function updateRecording(recordingId, patch) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/meeting_recordings?id=eq.${encodeFilter(recordingId)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function stripMarkdownArtifacts(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  );
}

function clipText(value, maxChars) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = maxChars - headChars;
  return [
    text.slice(0, headChars).trim(),
    `\n\n[Middle removed because the source exceeded ${maxChars.toLocaleString()} characters. Keep uncertainty in the review if needed.]\n\n`,
    text.slice(-tailChars).trim(),
  ].join("");
}

function textFromTiptapNode(node, parts = []) {
  if (!node || typeof node !== "object") return parts;
  if (node.type === "text" && node.text) parts.push(node.text);
  if (node.type === "hardBreak") parts.push("\n");
  if (Array.isArray(node.content)) node.content.forEach((child) => textFromTiptapNode(child, parts));
  if (["paragraph", "heading", "listItem", "tableRow"].includes(node.type)) parts.push("\n");
  if (["tableCell", "tableHeader"].includes(node.type)) parts.push("\t");
  return parts;
}

function plainTextFromContentJson(contentJson) {
  return normalizeWhitespace(textFromTiptapNode(contentJson || {}, []).join(""));
}

function inlineTextFromTiptapNode(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return Array.isArray(node.content) ? node.content.map(inlineTextFromTiptapNode).join("") : "";
}

function htmlToPlainText(html) {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function appendNotesLine(lines, value = "") {
  const line = String(value || "").replace(/[ \t]+$/g, "");
  if (!line && lines[lines.length - 1] === "") return;
  lines.push(line);
}

function normalizeTemplateNotesLines(lines) {
  const normalized = [];
  lines.forEach((line) => {
    const nextLine = String(line || "").replace(/[ \t]+$/g, "");
    if (!nextLine && normalized[normalized.length - 1] === "") return;
    normalized.push(nextLine);
  });
  while (normalized[0] === "") normalized.shift();
  while (normalized[normalized.length - 1] === "") normalized.pop();
  return normalized.join("\n");
}

function appendListNodeToTemplateNotes(node, lines, depth = 0) {
  const items = Array.isArray(node?.content) ? node.content.filter((child) => child?.type === "listItem") : [];
  const start = Number(node?.attrs?.start) || 1;
  items.forEach((item, index) => {
    const textNodes = (Array.isArray(item.content) ? item.content : []).filter((child) => {
      return child?.type !== "bulletList" && child?.type !== "orderedList";
    });
    const text = normalizeTemplateNotesLines(textNodes.map(templateNotesTextFromNode).join("\n").split("\n")).trim();
    const marker = node.type === "orderedList" ? `${start + index}.` : "-";
    const indent = "  ".repeat(depth);
    appendNotesLine(lines, `${indent}${marker} ${text}`.trimEnd());
    (Array.isArray(item.content) ? item.content : [])
      .filter((child) => child?.type === "bulletList" || child?.type === "orderedList")
      .forEach((child) => appendListNodeToTemplateNotes(child, lines, depth + 1));
  });
}

function appendTemplateNotesNode(node, lines) {
  if (!node || typeof node !== "object") return;
  if (node.type === "doc") {
    (Array.isArray(node.content) ? node.content : []).forEach((child) => appendTemplateNotesNode(child, lines));
    return;
  }

  if (node.type === "paragraph" || node.type === "heading") {
    const text = inlineTextFromTiptapNode(node).trim();
    if (text) appendNotesLine(lines, text);
    appendNotesLine(lines);
    return;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    appendListNodeToTemplateNotes(node, lines);
    appendNotesLine(lines);
    return;
  }

  if (node.type === "table") {
    (Array.isArray(node.content) ? node.content : [])
      .filter((row) => row?.type === "tableRow")
      .forEach((row) => {
        const cells = (Array.isArray(row.content) ? row.content : [])
          .filter((cell) => cell?.type === "tableCell" || cell?.type === "tableHeader")
          .map((cell) => templateNotesTextFromNode(cell).replace(/\s*\n\s*/g, " ").trim());
        if (cells.length) appendNotesLine(lines, cells.join("\t"));
      });
    appendNotesLine(lines);
    return;
  }

  (Array.isArray(node.content) ? node.content : []).forEach((child) => appendTemplateNotesNode(child, lines));
}

function templateNotesTextFromNode(node) {
  const lines = [];
  appendTemplateNotesNode(node, lines);
  return normalizeTemplateNotesLines(lines);
}

function templateNotesTextFromBlocks(contentJson) {
  const lines = [];
  (Array.isArray(contentJson?.blocks) ? contentJson.blocks : []).forEach((block) => {
    if (block?.type === "list") {
      (Array.isArray(block.items) ? block.items : []).forEach((item) => appendNotesLine(lines, `- ${String(item || "").trim()}`));
      appendNotesLine(lines);
      return;
    }
    if (typeof block?.text === "string") {
      appendNotesLine(lines, block.text.trim());
      appendNotesLine(lines);
      return;
    }
    if (typeof block?.html === "string") {
      appendNotesLine(lines, htmlToPlainText(block.html));
      appendNotesLine(lines);
    }
  });
  return normalizeTemplateNotesLines(lines);
}

function templateNotesTextFromContentJson(contentJson) {
  if (contentJson?.type === "doc") return templateNotesTextFromNode(contentJson);
  if (Array.isArray(contentJson?.blocks)) return templateNotesTextFromBlocks(contentJson);
  if (typeof contentJson?.html === "string") return htmlToPlainText(contentJson.html);
  return "";
}

function normalizeTemplateLineKey(value) {
  return stripMarkdownArtifacts(value)
    .toLowerCase()
    .replace(/[^\w\s:.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTemplateLineStyles(node, styles = []) {
  if (!node || typeof node !== "object") return styles;
  if (node.type === "heading" || node.type === "paragraph") {
    const text = inlineTextFromTiptapNode(node).trim();
    const key = normalizeTemplateLineKey(text);
    if (key) {
      styles.push({
        key,
        text,
        type: node.type,
        level: Number(node?.attrs?.level) || 2,
      });
    }
    return styles;
  }
  (Array.isArray(node.content) ? node.content : []).forEach((child) => collectTemplateLineStyles(child, styles));
  return styles;
}

function buildTemplateStyleIndex(contentJson) {
  const styles = collectTemplateLineStyles(contentJson || {});
  return {
    exact: new Map(styles.map((style) => [style.key, style])),
    labels: styles.filter((style) => style.key.endsWith(":")),
  };
}

function findTemplateLineStyle(styleIndex, line) {
  if (!styleIndex) return null;
  const key = normalizeTemplateLineKey(line);
  if (!key) return null;
  const exact = styleIndex.exact.get(key);
  if (exact) return exact;
  return styleIndex.labels.find((style) => key.startsWith(`${style.key} `)) || null;
}

function inlineContentFromText(text) {
  const parts = String(text || "").split("\n");
  const content = [];
  parts.forEach((part, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (part) content.push({ type: "text", text: part });
  });
  return content.length ? content : undefined;
}

function paragraphNode(text) {
  const content = inlineContentFromText(text);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

function headingNode(text, level = 2) {
  return {
    type: "heading",
    attrs: { level: Math.min(Math.max(Number(level) || 2, 1), 3) },
    content: [{ type: "text", text: String(text || "").trim() || "Section" }],
  };
}

function listNode(type, items) {
  return {
    type,
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraphNode(item)],
    })),
  };
}

function plainTextToTiptapDoc(text, templateContentJson = null) {
  const lines = normalizeWhitespace(text).split("\n");
  const content = [];
  let paragraphLines = [];
  let bulletItems = [];
  let orderedItems = [];
  const templateStyleIndex = buildTemplateStyleIndex(templateContentJson);

  function flushParagraph() {
    if (!paragraphLines.length) return;
    content.push(paragraphNode(paragraphLines.join("\n").trim()));
    paragraphLines = [];
  }

  function flushBullets() {
    if (!bulletItems.length) return;
    content.push(listNode("bulletList", bulletItems));
    bulletItems = [];
  }

  function flushOrdered() {
    if (!orderedItems.length) return;
    content.push(listNode("orderedList", orderedItems));
    orderedItems = [];
  }

  function flushLists() {
    flushBullets();
    flushOrdered();
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushLists();
      return;
    }

    const templateStyle = findTemplateLineStyle(templateStyleIndex, trimmed);
    if (templateStyle?.type === "heading") {
      flushParagraph();
      flushLists();
      content.push(headingNode(trimmed, templateStyle.level));
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushLists();
      content.push(headingNode(headingMatch[2], headingMatch[1].length));
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      flushOrdered();
      bulletItems.push(bulletMatch[1].trim());
      return;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushBullets();
      orderedItems.push(orderedMatch[1].trim());
      return;
    }

    flushLists();
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushLists();

  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

function cleanTitle(value, fallback) {
  return String(value || fallback || "Meeting notes")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Meeting notes";
}

function buildPrompt({ recording, organization, template, notesText, transcriptText, previousReview = null, currentDraftText = "" }) {
  const templateText = template
    ? normalizeWhitespace(templateNotesTextFromContentJson(template.content_json) || template.plain_text || plainTextFromContentJson(template.content_json))
    : "";
  const reviewDecisionContext = previousReview
    ? buildReviewDecisionContext(previousReview, currentDraftText)
    : "";
  return [
    "Finalize an organizational meeting document from these sources.",
    "",
    "Rules:",
    "- The document template and notetaker notes are the primary source of truth for structure, section order, labels, and intentional content.",
    "- Treat the template as a form to fill, not as a topic suggestion.",
    "- Keep the same top-level headings, labels, and section order from the template/notetaker notes whenever they exist.",
    "- Do not replace the opening template lines with the recording title.",
    "- final_document_text should begin with the first meaningful line from the notetaker notes when notes exist; do not prepend document_title.",
    "- Do not rename the template, invent a new title, or add new high-level sections unless that section already exists in the template or notetaker notes.",
    "- The transcript is supporting evidence. Use it to fill obvious missing detail, names, dates, decisions, and action items only when it does not conflict with notes.",
    "- Do not invent motions, votes, attendance, dates, dollar amounts, decisions, or action owners.",
    "- If transcript details conflict with notes, keep the notes in the draft and list the conflict.",
    "- Preserve the notetaker's meaning. Improve clarity and organization, not facts.",
    "- Keep the final document close to the template/notes layout. Do not reorganize short notes into new sections unless those sections already exist in the template or notes.",
    "- Return final_document_text as plain editable document text. Do not use Markdown markers such as #, **, __, or backticks.",
    "- Keep labels as normal text, for example Date: June 12, 2026. Do not wrap labels in formatting characters.",
    "- Use simple bullet lists only when the template or notes already use a list, or when the notes clearly describe multiple action items.",
    "- suggested_additions are details that appear useful from the transcript but should be accepted by a human.",
    "- conflicts are places where the transcript and notes do not agree or where confidence is low.",
    "",
    `Library: ${organization?.name || "Current library"}`,
    `Recording title: ${recording.title || "Untitled recording"}`,
    template ? `Template title: ${template.title || "Untitled template"}` : "Template title: No template selected",
    "",
    "Template text:",
    clipText(templateText || "No template text.", MAX_TEMPLATE_CHARS),
    "",
    "Notetaker notes:",
    clipText(notesText || "No notetaker notes were saved.", MAX_NOTES_CHARS),
    "",
    "Transcript:",
    clipText(transcriptText, MAX_TRANSCRIPT_CHARS),
    reviewDecisionContext,
  ].join("\n");
}

function getReviewResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "recording_notes_review",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["document_title", "final_document_text", "suggested_additions", "conflicts", "confidence_notes"],
        properties: {
          document_title: { type: "string" },
          final_document_text: { type: "string" },
          suggested_additions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "reason", "source"],
              properties: {
                text: { type: "string" },
                reason: { type: "string" },
                source: { type: "string" },
              },
            },
          },
          conflicts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "reason", "source"],
              properties: {
                text: { type: "string" },
                reason: { type: "string" },
                source: { type: "string" },
              },
            },
          },
          confidence_notes: { type: "string" },
        },
      },
    },
  };
}

function parseGroqJsonContent(content) {
  const raw = String(content || "").trim();
  if (!raw) throw new Error("Records AI returned an empty review.");
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match) return JSON.parse(match[1]);
    throw new Error("Records AI returned a review that could not be parsed.");
  }
}

function getGroqError(data, response) {
  return String(data?.error?.message || data?.message || response.statusText || "Unable to review recording notes.").trim();
}

function isStructuredOutputError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("response_format") ||
    message.includes("json_schema") ||
    message.includes("structured output") ||
    message.includes("schema")
  );
}

async function sendGroqReviewRequest(prompt, responseFormat) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_RECORDS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_RECORDING_NOTES_MODEL,
      temperature: 0.1,
      max_tokens: 7000,
      response_format: responseFormat,
      messages: [
        {
          role: "system",
          content: "You finalize N3XRA Records meeting notes for organizations. Return only the requested JSON.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(getGroqError(data, response));
    error.statusCode = response.status;
    throw error;
  }

  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  const review = parseGroqJsonContent(content);
  return {
    review,
    usage: normalizeGroqUsage(data, prompt, content),
  };
}

async function reviewRecordingNotes(prompt) {
  try {
    return await sendGroqReviewRequest(prompt, getReviewResponseFormat());
  } catch (error) {
    if (!isStructuredOutputError(error)) throw error;
    return sendGroqReviewRequest(
      `${prompt}\n\nReturn valid JSON only with document_title, final_document_text, suggested_additions, conflicts, and confidence_notes.`,
      { type: "json_object" }
    );
  }
}

function normalizeReview(value, fallbackTitle) {
  const review = value && typeof value === "object" ? value : {};
  const finalText = stripMarkdownArtifacts(review.final_document_text);
  if (!finalText) throw new Error("Records AI did not return a draft document.");

  const normalizeItems = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      text: stripMarkdownArtifacts(item?.text || item?.note || item?.issue),
      reason: stripMarkdownArtifacts(item?.reason),
      source: stripMarkdownArtifacts(item?.source),
    }))
    .filter((item) => item.text);

  return {
    document_title: cleanTitle(review.document_title, fallbackTitle),
    final_document_text: finalText,
    suggested_additions: normalizeItems(review.suggested_additions),
    conflicts: normalizeItems(review.conflicts),
    confidence_notes: normalizeWhitespace(review.confidence_notes),
  };
}

function getSuggestionText(item) {
  return stripMarkdownArtifacts(item?.text || item?.note || item?.issue);
}

function getSuggestionStatus(item) {
  return String(item?.status || "").trim().toLowerCase();
}

function isSuggestionResolved(item) {
  return ["applied", "dismissed"].includes(getSuggestionStatus(item));
}

function suggestionKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function cloneReview(review) {
  return JSON.parse(JSON.stringify(review && typeof review === "object" ? review : {}));
}

function getReviewSuggestions(review) {
  return Array.isArray(review?.suggested_additions) ? review.suggested_additions : [];
}

function getActionableSuggestionIndexes(review, indexes) {
  const items = getReviewSuggestions(review);
  return Array.from(new Set((Array.isArray(indexes) ? indexes : [])
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0)))
    .filter((index) => items[index] && getSuggestionText(items[index]) && !isSuggestionResolved(items[index]));
}

function getResolvedSuggestionItems(review, status = "") {
  const targetStatus = String(status || "").trim().toLowerCase();
  return getReviewSuggestions(review)
    .filter((item) => getSuggestionText(item) && (!targetStatus || getSuggestionStatus(item) === targetStatus))
    .map((item) => ({ ...item, text: getSuggestionText(item) }));
}

function formatSuggestionList(items, fallback = "None") {
  const lines = (Array.isArray(items) ? items : [])
    .map((item) => getSuggestionText(item))
    .filter(Boolean)
    .map((text) => `- ${text}`);
  return lines.length ? clipText(lines.join("\n"), MAX_REVIEW_DECISION_CHARS) : fallback;
}

function markSuggestions(review, indexes, status) {
  const nextReview = cloneReview(review);
  const items = getReviewSuggestions(nextReview);
  const now = new Date().toISOString();
  indexes.forEach((index) => {
    if (!items[index]) return;
    items[index] = {
      ...items[index],
      status,
      resolved_at: now,
    };
    if (status === "applied") items[index].applied_at = now;
    if (status === "dismissed") items[index].dismissed_at = now;
  });
  nextReview.suggested_additions = items;
  return nextReview;
}

function mergeResolvedSuggestionStatuses(nextReview, previousReview) {
  const merged = cloneReview(nextReview);
  const nextItems = getReviewSuggestions(merged);
  const seenKeys = new Set(nextItems.map((item) => suggestionKey(getSuggestionText(item))).filter(Boolean));

  getResolvedSuggestionItems(previousReview).forEach((previousItem) => {
    const key = suggestionKey(getSuggestionText(previousItem));
    if (!key) return;
    const existing = nextItems.find((item) => suggestionKey(getSuggestionText(item)) === key);
    if (existing) {
      existing.status = previousItem.status;
      existing.resolved_at = previousItem.resolved_at;
      if (previousItem.applied_at) existing.applied_at = previousItem.applied_at;
      if (previousItem.dismissed_at) existing.dismissed_at = previousItem.dismissed_at;
      return;
    }
    if (!seenKeys.has(key)) {
      nextItems.push(previousItem);
      seenKeys.add(key);
    }
  });

  merged.suggested_additions = nextItems;
  return merged;
}

async function loadTargetDocument(recording) {
  const documentId = recording.final_document_id || recording.ai_draft_document_id || "";
  if (!documentId) return null;
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/app_documents?select=id,title,content_json,plain_text,status&organization_id=eq.${encodeFilter(recording.organization_id)}&id=eq.${encodeFilter(documentId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function buildReviewDecisionContext(previousReview, currentDraftText = "") {
  const appliedItems = getResolvedSuggestionItems(previousReview, "applied");
  const dismissedItems = getResolvedSuggestionItems(previousReview, "dismissed");
  return [
    "",
    "Existing AI review decisions:",
    "Already accepted additions:",
    formatSuggestionList(appliedItems),
    "",
    "Dismissed additions:",
    formatSuggestionList(dismissedItems),
    "",
    "Current AI draft text:",
    clipText(currentDraftText || "No current AI draft exists yet.", MAX_CURRENT_DRAFT_CHARS),
    "",
    "Decision preservation rules:",
    "- Already accepted additions are human-approved and must remain in final_document_text.",
    "- Integrate accepted additions into the appropriate existing section, paragraph, or list.",
    "- Do not create an 'Accepted additions', 'Suggested additions', or 'AI review' section in the final document.",
    "- Dismissed additions should not be added or suggested again unless the notes directly require them.",
  ].join("\n");
}

function buildMergePrompt({ recording, organization, template, notesText, transcriptText, currentDraftText, acceptedItems, dismissedItems }) {
  const templateText = template
    ? normalizeWhitespace(templateNotesTextFromContentJson(template.content_json) || template.plain_text || plainTextFromContentJson(template.content_json))
    : "";
  return [
    "Rewrite the current organizational meeting document after human approval of AI suggestions.",
    "",
    "Rules:",
    "- The notetaker notes and template remain the source of truth for structure, section order, labels, and intentional content.",
    "- The current AI draft is the starting document to improve, not a disposable scratchpad.",
    "- Accepted additions are human-approved and MUST be integrated into final_document_text.",
    "- Integrate accepted additions naturally into the most relevant existing section, paragraph, or list.",
    "- Do not append accepted additions at the bottom.",
    "- Do not create a section named Accepted additions, Suggested additions, AI review, Transcript details, or similar.",
    "- Preserve all existing useful draft content unless it conflicts with the notes or accepted additions.",
    "- Keep the same plain-text template style. Do not use Markdown markers such as #, **, __, or backticks.",
    "- Do not invent motions, votes, attendance, dates, dollar amounts, decisions, or action owners.",
    "- Use the transcript only as supporting evidence for the accepted additions and obvious missing details.",
    "- Keep labels as normal text, for example Date: June 12, 2026.",
    "",
    `Library: ${organization?.name || "Current library"}`,
    `Recording title: ${recording.title || "Untitled recording"}`,
    template ? `Template title: ${template.title || "Untitled template"}` : "Template title: No template selected",
    "",
    "Template text:",
    clipText(templateText || "No template text.", MAX_TEMPLATE_CHARS),
    "",
    "Notetaker notes:",
    clipText(notesText || "No notetaker notes were saved.", MAX_NOTES_CHARS),
    "",
    "Current draft:",
    clipText(currentDraftText || "No current draft text.", MAX_CURRENT_DRAFT_CHARS),
    "",
    "Accepted additions to integrate:",
    formatSuggestionList(acceptedItems),
    "",
    "Dismissed additions to avoid:",
    formatSuggestionList(dismissedItems),
    "",
    "Transcript:",
    clipText(transcriptText, MAX_TRANSCRIPT_CHARS),
    "",
    "Return valid JSON only with document_title, final_document_text, and confidence_notes.",
  ].join("\n");
}

function getRewriteResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "recording_notes_rewrite",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["document_title", "final_document_text", "confidence_notes"],
        properties: {
          document_title: { type: "string" },
          final_document_text: { type: "string" },
          confidence_notes: { type: "string" },
        },
      },
    },
  };
}

async function rewriteRecordingDocument(prompt) {
  try {
    return await sendGroqReviewRequest(prompt, getRewriteResponseFormat());
  } catch (error) {
    if (!isStructuredOutputError(error)) throw error;
    return sendGroqReviewRequest(
      `${prompt}\n\nReturn valid JSON only with document_title, final_document_text, and confidence_notes.`,
      { type: "json_object" }
    );
  }
}

function normalizeRewrite(value, fallbackTitle) {
  const rewrite = value && typeof value === "object" ? value : {};
  const finalText = stripMarkdownArtifacts(rewrite.final_document_text);
  if (!finalText) throw new Error("Records AI did not return a rewritten document.");
  return {
    document_title: cleanTitle(rewrite.document_title, fallbackTitle),
    final_document_text: finalText,
    confidence_notes: normalizeWhitespace(rewrite.confidence_notes),
  };
}

async function updateTargetDocument(document, recording, rewrite, template = null) {
  const contentJson = plainTextToTiptapDoc(rewrite.final_document_text, template?.content_json || null);
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/app_documents?id=eq.${encodeFilter(document.id)}&organization_id=eq.${encodeFilter(recording.organization_id)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        title: rewrite.document_title,
        content_json: contentJson,
        plain_text: rewrite.final_document_text,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertAiDraftDocument(recording, user, review, template = null) {
  const title = cleanTitle(review.document_title, `${recording.title || "Untitled recording"} Notes`);
  const contentJson = plainTextToTiptapDoc(review.final_document_text, template?.content_json || null);
  const payload = {
    organization_id: recording.organization_id,
    source_document_id: recording.document_id || null,
    title,
    content_json: contentJson,
    plain_text: review.final_document_text,
    document_kind: "document",
    status: "draft",
  };

  if (recording.ai_draft_document_id) {
    const rows = await fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/app_documents?id=eq.${encodeFilter(recording.ai_draft_document_id)}&organization_id=eq.${encodeFilter(recording.organization_id)}`,
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(payload),
      }
    );
    const updated = Array.isArray(rows) ? rows[0] || null : null;
    if (updated) return updated;
  }

  const rows = await fetchSupabaseJson(`${SUPABASE_URL}/rest/v1/app_documents`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      ...payload,
      created_by_user_id: user.id,
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing Supabase service config." });
  }
  if (!GROQ_RECORDS_API_KEY) {
    return res.status(500).json({ error: "Missing GROQ_RECORDS_API_KEY." });
  }

  let user = null;
  try {
    user = await verifyUser(getBearerToken(req));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  let recording = null;
  let reviewStarted = false;
  try {
    const body = await parseJson(req);
    const recordingId = String(body.recordingId || "").trim();
    const acceptedSuggestionIndexes = Array.isArray(body.acceptedSuggestionIndexes) ? body.acceptedSuggestionIndexes : [];
    if (!recordingId) return res.status(400).json({ error: "recordingId is required." });

    recording = await loadRecording(recordingId);
    if (!recording) return res.status(404).json({ error: "Recording not found." });

    const organization = await loadOrganization(recording.organization_id);
    if (!organization) return res.status(404).json({ error: "Recording library not found." });
    if (!(await userCanReviewRecording(organization, user))) {
      return res.status(403).json({ error: "You do not have access to review this recording." });
    }
    if (recording.transcript_status !== "ready" || !normalizeWhitespace(recording.transcript_text)) {
      return res.status(400).json({ error: "The transcript must be ready before AI can review this recording." });
    }

    const usageContext = await prepareRecordsAiUsage({ organizationId: recording.organization_id, user });
    reviewStarted = true;
    await updateRecording(recording.id, {
      ai_review_status: "processing",
      processing_error: null,
    });

    const template = await loadTemplate(recording.selected_template_id, recording.organization_id);
    const notesText = normalizeWhitespace(recording.notes_plain_text || plainTextFromContentJson(recording.notes_content_json));
    const previousReview = recording.ai_review_json && typeof recording.ai_review_json === "object" ? recording.ai_review_json : null;
    const currentDraftDocument = await loadTargetDocument(recording).catch(() => null);
    const currentDraftText = normalizeWhitespace(
      currentDraftDocument?.plain_text || plainTextFromContentJson(currentDraftDocument?.content_json)
    );

    if (acceptedSuggestionIndexes.length) {
      if (!previousReview) {
        const error = new Error("Run AI review before applying suggestions.");
        error.statusCode = 400;
        throw error;
      }
      if (!currentDraftDocument?.id) {
        const error = new Error("Create an AI draft before applying suggestions.");
        error.statusCode = 400;
        throw error;
      }

      const actionableIndexes = getActionableSuggestionIndexes(previousReview, acceptedSuggestionIndexes);
      if (!actionableIndexes.length) {
        const updatedRecording = await updateRecording(recording.id, {
          ai_review_status: "ready",
          processing_error: null,
        });
        return res.status(200).json({
          recording: updatedRecording,
          draftDocument: currentDraftDocument,
          review: previousReview,
          appliedCount: 0,
          usage: getClientUsageSummary(usageContext.usage),
        });
      }

      const selectedItems = actionableIndexes.map((index) => getReviewSuggestions(previousReview)[index]).filter(Boolean);
      const acceptedItems = [
        ...getResolvedSuggestionItems(previousReview, "applied"),
        ...selectedItems,
      ];
      const dismissedItems = getResolvedSuggestionItems(previousReview, "dismissed");
      const prompt = buildMergePrompt({
        recording,
        organization,
        template,
        notesText,
        transcriptText: recording.transcript_text,
        currentDraftText,
        acceptedItems,
        dismissedItems,
      });

      const rewriteResult = await rewriteRecordingDocument(prompt);
      const rewrite = normalizeRewrite(rewriteResult.review, previousReview.document_title || `${recording.title || "Untitled recording"} Notes`);
      const updatedDocument = await updateTargetDocument(currentDraftDocument, recording, rewrite, template);
      const markedReview = markSuggestions(previousReview, actionableIndexes, "applied");
      const reviewJson = {
        ...markedReview,
        document_title: rewrite.document_title,
        final_document_text: rewrite.final_document_text,
        confidence_notes: rewrite.confidence_notes || markedReview.confidence_notes || "",
        model: GROQ_RECORDING_NOTES_MODEL,
        template_id: template?.id || markedReview.template_id || null,
        transcript_document_id: recording.document_id || markedReview.transcript_document_id || null,
        draft_document_id: updatedDocument?.id || currentDraftDocument.id,
        merged_at: new Date().toISOString(),
      };
      const recorded = await recordRecordsAiUsage({
        usageContext,
        user,
        feature: "recording_notes",
        model: GROQ_RECORDING_NOTES_MODEL,
        usage: rewriteResult.usage,
      });
      const updatedRecording = await updateRecording(recording.id, {
        ai_review_status: "ready",
        ai_review_json: reviewJson,
        ai_reviewed_at: new Date().toISOString(),
        ai_draft_document_id: updatedDocument?.id || recording.ai_draft_document_id || null,
        processing_error: null,
      });

      return res.status(200).json({
        recording: updatedRecording,
        draftDocument: updatedDocument,
        review: reviewJson,
        appliedCount: actionableIndexes.length,
        usage: getClientUsageSummary(recorded?.usage || usageContext.usage),
      });
    }

    const prompt = buildPrompt({
      recording,
      organization,
      template,
      notesText,
      transcriptText: recording.transcript_text,
      previousReview,
      currentDraftText,
    });

    const reviewResult = await reviewRecordingNotes(prompt);
    const normalizedReview = normalizeReview(reviewResult.review, `${recording.title || "Untitled recording"} Notes`);
    const review = previousReview ? mergeResolvedSuggestionStatuses(normalizedReview, previousReview) : normalizedReview;
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "recording_notes",
      model: GROQ_RECORDING_NOTES_MODEL,
      usage: reviewResult.usage,
    });

    const draftDocument = await upsertAiDraftDocument(recording, user, review, template);
    const reviewJson = {
      ...review,
      model: GROQ_RECORDING_NOTES_MODEL,
      template_id: template?.id || null,
      transcript_document_id: recording.document_id || null,
      draft_document_id: draftDocument?.id || null,
      generated_at: new Date().toISOString(),
    };
    const updatedRecording = await updateRecording(recording.id, {
      ai_review_status: "ready",
      ai_review_json: reviewJson,
      ai_reviewed_at: new Date().toISOString(),
      ai_draft_document_id: draftDocument?.id || recording.ai_draft_document_id || null,
      processing_error: null,
    });

    return res.status(200).json({
      recording: updatedRecording,
      draftDocument,
      review: reviewJson,
      usage: getClientUsageSummary(recorded?.usage || usageContext.usage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review recording notes.";
    if (recording?.id && reviewStarted) {
      await updateRecording(recording.id, {
        ai_review_status: "failed",
        processing_error: message,
      }).catch(() => null);
    }
    if (sendRecordsAiUsageError(res, error, "Recording notes usage check failed.")) return;
    return res.status(Number(error?.statusCode || 500)).json({ error: message });
  }
}

module.exports = handler;
module.exports.config = {
  maxDuration: 60,
};
