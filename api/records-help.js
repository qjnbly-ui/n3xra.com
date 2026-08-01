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
const recordsUiCatalogCache = new Map();

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

const RECORDS_HELP_ACTION_ROUTES = Object.freeze({
  "library.search": "/n3xra-records/library",
  "library.ai_search": "/n3xra-records/library",
  "library.upload": "/n3xra-records/library",
  "meeting.new": "/n3xra-records/meeting-notes",
  "documents.new": "/n3xra-records/documents.html",
  "messages.compose": "/n3xra-records/messages.html",
  "account.profile": "/n3xra-records/account/?view=profile",
  "account.library": "/n3xra-records/account/?view=library",
  "account.templates": "/n3xra-records/account/?view=templates",
  "account.phone": "/n3xra-records/account/?view=phone",
  "account.ai": "/n3xra-records/account/?view=ai",
  "account.users": "/n3xra-records/account/?view=users",
  "account.contacts": "/n3xra-records/account/?view=contacts",
  "account.access": "/n3xra-records/account/?view=access",
  "account.storage": "/n3xra-records/account/?view=storage",
  "account.billing": "/n3xra-records/account/?view=billing",
  "account.activity": "/n3xra-records/account/?view=activity",
  "account.support": "/n3xra-records/account/?view=support",
});

const RECORDS_HELP_ACTION_ALIASES = Object.freeze({
  "library.search": ["keyword search", "search records", "find a file", "find a document"],
  "library.ai_search": ["ai search", "ask my documents", "search file contents"],
  "library.upload": ["upload a pdf", "upload pdf", "upload a file", "upload file", "upload a document"],
  "meeting.new": ["new meeting note", "record a meeting", "record meeting", "phone call meeting", "phone meeting note"],
  "documents.new": ["new document", "create a document", "document builder"],
  "messages.compose": ["send a message", "write a message", "compose a message", "communication"],
  "account.profile": ["my profile", "profile settings"],
  "account.library": ["library settings", "library profile", "library colors", "library logo"],
  "account.templates": ["reusable template", "document template", "manage templates"],
  "account.phone": ["phone meetings settings", "phone meeting settings", "enable phone meetings", "configure phone meetings"],
  "account.ai": ["ai settings", "saved ai memory"],
  "account.users": ["manage users", "account users", "user list"],
  "account.contacts": ["manage contacts", "address book", "contact list"],
  "account.access": ["invite code", "invite codes", "invite a user", "invite staff", "invite member", "shared access", "join code"],
  "account.storage": ["storage usage", "storage limit", "storage plan"],
  "account.billing": ["billing", "subscription", "payment method", "change plan"],
  "account.activity": ["audit activity", "audit log", "activity log"],
  "account.support": ["support access", "temporary support", "grant support access"],
});

const RECORDS_HELP_FALLBACK_GUIDES = Object.freeze({
  "account.access": Object.freeze([
    { target: "Invite codes", narration: "Invite codes is where you create controlled access for a new library member." },
    { target: "Role", narration: "Role determines what the invited person will be allowed to do after joining." },
    { target: "Uses", narration: "Uses limits how many times this invitation code can be accepted." },
    { target: "Expires at", narration: "Expires at is optional and lets you stop the code from working after a chosen time." },
    { target: "Recipient email (optional)", narration: "Add an email only if this invitation is intended for a particular recipient." },
    { target: "Create invite code", narration: "The Create invite code option generates a code without emailing it." },
    { target: "Create code + send email", narration: "Create code plus send email generates the code and emails it to the recipient." },
  ]),
});

function getRecordsHelpFallbackGuideSteps(actionId, answer = "", question = "") {
  if (actionId === "meeting.new") {
    const requestedTopic = normalizeHelpActionText(String(question || "").trim() || answer);
    const setup = [
      { target: "Meeting title", narration: "Meeting title names the note and is required before audio can start." },
      { target: "Document template", narration: "Document template chooses the note structure, including the blank-notes option." },
    ];
    if (/\b(?:all|every|each)\b.*\b(?:option|choice|method|feature)\b|\b(?:tour|overview)\b/.test(requestedTopic)) {
      return [
        ...setup,
        { target: "App recording", narration: "App recording captures audio directly in this browser." },
        { target: "Phone call", narration: "Phone call attaches audio received through the N3XRA phone number." },
        { target: "Both", narration: "Both keeps phone-call audio and browser audio together in one meeting note." },
        { target: "Upload recording", narration: "Upload recording uses an audio file that was recorded somewhere else." },
      ];
    }
    if (/\bphone\b|\bcall\b/.test(requestedTopic)) {
      return [
        ...setup,
        { target: "Phone call", narration: "Phone call attaches audio received through the N3XRA phone number." },
        { target: "Start phone meeting", narration: "Start phone meeting begins the phone workflow after the required details are ready." },
      ];
    }
    if (/\bupload\b|\baudio file\b/.test(requestedTopic)) {
      return [
        ...setup,
        { target: "Upload recording", narration: "Upload recording uses an audio file that was recorded somewhere else." },
      ];
    }
    return [
      ...setup,
      { target: "App recording", narration: "App recording captures audio directly in this browser." },
      { target: "Start app recording", narration: "Start app recording begins microphone capture in this browser." },
    ];
  }
  return RECORDS_HELP_FALLBACK_GUIDES[actionId] || null;
}

const RECORDS_HELP_SAFE_PREVIEW_ANSWERS = Object.freeze({
  "account.access": [
    "I can show you how invite codes work without creating or sending anything.",
    "",
    "1. Open **Manage library** → **Invites & access**.",
    "2. Expand **Invite codes**.",
    "3. Review **Role**, **Uses**, **Expires at**, and the optional recipient fields.",
    "4. Compare **Create invite code** with **Create code + send email**.",
    "",
    "The guide will explain both final choices and stop without pressing either one.",
  ].join("\n"),
});

const RECORDS_HELP_CONSEQUENTIAL_TARGET = /\b(?:create|send|delete|remove|save|submit|upload|start|record|grant|revoke|purchase|pay|checkout|publish)\b/i;
const RECORDS_HELP_NAVIGATION_LABELS = new Set([
  "library", "meeting notes", "document builder", "communication", "manage library", "profile",
  "library settings", "templates", "phone meetings", "ai settings", "users", "contacts",
  "invites & access", "storage", "billing", "audit activity", "n3xra support access",
]);

const RECORDS_GUIDE_ROUTES = new Set([
  "/n3xra-records/library",
  "/n3xra-records/meeting-notes",
  "/n3xra-records/documents.html",
  "/n3xra-records/messages.html",
  "/n3xra-records/account/?view=profile",
  "/n3xra-records/account/?view=library",
  "/n3xra-records/account/?view=templates",
  "/n3xra-records/account/?view=phone",
  "/n3xra-records/account/?view=ai",
  "/n3xra-records/account/?view=users",
  "/n3xra-records/account/?view=contacts",
  "/n3xra-records/account/?view=access",
  "/n3xra-records/account/?view=storage",
  "/n3xra-records/account/?view=billing",
  "/n3xra-records/account/?view=activity",
  "/n3xra-records/account/?view=support",
]);

function parseRecordsGuideToken(rawToken) {
  const [rawButtonLabel, rawRoute, rawSteps] = String(rawToken || "").split("|");
  const buttonLabel = String(rawButtonLabel || "").trim().slice(0, 60);
  const route = String(rawRoute || "").replace(/\s+/g, "").trim();
  if (!buttonLabel || !RECORDS_GUIDE_ROUTES.has(route) || !rawSteps) return null;

  const steps = String(rawSteps)
    .split(">")
    .slice(0, 7)
    .map((rawStep) => {
      const separator = rawStep.indexOf("~");
      const target = String(separator === -1 ? rawStep : rawStep.slice(0, separator)).trim().slice(0, 100);
      const narration = String(separator === -1 ? "" : rawStep.slice(separator + 1)).trim().slice(0, 220);
      return target ? { target, narration } : null;
    })
    .filter(Boolean);
  if (!steps.length) return null;
  return { buttonLabel, route, steps };
}

function extractHelpActions(rawAnswer) {
  const requested = [];
  const guides = [];
  const keepGuide = (rawGuide) => {
    const guide = parseRecordsGuideToken(String(rawGuide || "").replace(/\]+\s*$/, "").trim());
    if (guide && guides.length < 1) guides.push(guide);
  };
  const keepAction = (rawId) => {
    const id = String(rawId || "").toLowerCase();
    if (RECORDS_HELP_ACTIONS[id] && !requested.includes(id) && requested.length < 2) requested.push(id);
  };

  const answer = String(rawAnswer || "")
    .replace(/\[\[guide:([\s\S]*?)\]\]/gi, (_token, rawGuide) => {
      keepGuide(rawGuide);
      return "";
    })
    .replace(/\[\[action:([a-z0-9._-]+)\]\]/gi, (_token, rawId) => {
      keepAction(rawId);
      return "";
    })
    .replace(/\[\[guide:([\s\S]*)$/i, (_token, rawGuide) => {
      keepGuide(rawGuide);
      return "";
    })
    .replace(/\[\[action:([a-z0-9._-]+)[\s\S]*$/i, (_token, rawId) => {
      keepAction(rawId);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    answer,
    actions: [
      ...guides.map((guide) => ({ id: "guided.path", label: guide.buttonLabel, guide })),
      ...requested.map((id) => ({ id, label: RECORDS_HELP_ACTIONS[id] })),
    ].slice(0, 2),
  };
}

function normalizeHelpActionText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHelpMatchText(value) {
  return normalizeHelpActionText(value)
    .split(" ")
    .map((word) => word.length > 3 && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word)
    .join(" ");
}

function isRecordsHelpTaskRequest(question) {
  return /\b(?:how|where|help|show|guide|tour|walk|open|find|create|start|make|upload|send|invite|manage|change|set\s*up|not sure)\b/i
    .test(String(question || ""));
}

function isRecordsNavigationOnlyRequest(question) {
  const text = String(question || "").trim();
  return /^(?:take|bring|navigate)\s+me\s+to\b|^(?:go|open)\s+(?:to\s+)?(?:the\s+)?[^?]+(?:page|settings)?\s*[.!?]*$/i.test(text)
    && !/\b(?:how|help|explain|walk|guide|tour|what can|show me how)\b/i.test(text);
}

function isRecordsPreviewOnlyRequest(question) {
  return /\b(?:do not|don[’']t|dont|without|stop before|nothing yet|not yet|just show|only show|explain only)\b/i
    .test(String(question || ""));
}

const RECORDS_HELP_ROLLBACK_TARGET = /^(?:cancel|close|discard|undo|reset|clear)\b/i;

function isRecordsRollbackRequest(question) {
  return /\b(?:cancel|close|discard|undo|reset|clear)\b/i.test(String(question || ""));
}

function hasUnrequestedRecordsRollbackStep(guide, question) {
  if (isRecordsRollbackRequest(question)) return false;
  return (Array.isArray(guide?.steps) ? guide.steps : []).some((step) =>
    RECORDS_HELP_ROLLBACK_TARGET.test(String(step?.target || "").trim())
  );
}

function getRecordsHelpActionIdForRoute(route) {
  return Object.entries(RECORDS_HELP_ACTION_ROUTES)
    .find(([, candidateRoute]) => candidateRoute === String(route || ""))?.[0] || "";
}

function buildRecordsArrivalNarration(answer, actionLabel = "") {
  const visible = String(answer || "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[\*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = visible.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || visible;
  if (firstSentence) return firstSentence.slice(0, 220);
  const destination = String(actionLabel || "this area").replace(/^(Open|Show)\s+/i, "");
  return `This is where you work with ${destination}.`;
}

function inferRecordsAnswerGuideSteps(answer) {
  const steps = [];
  for (const line of String(answer || "").split(/\r?\n/)) {
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (!numbered) continue;
    const narration = numbered[1]
      .replace(/[\*_`#]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    const targets = Array.from(numbered[1].matchAll(/\*\*([^*\n]+)\*\*/g), (match) => match[1].trim());
    for (const target of targets) {
      if (!target || steps.some((step) => step.target.toLowerCase() === target.toLowerCase())) continue;
      steps.push({ target: target.slice(0, 100), narration });
      if (steps.length === 7) break;
    }
    if (steps.length === 7) break;
  }
  return steps;
}

function inferRecordsWorkflowGuide(actionId, answer, question = "") {
  const route = RECORDS_HELP_ACTION_ROUTES[actionId];
  if (!route) return null;
  const steps = inferRecordsAnswerGuideSteps(answer);
  const fallbackSteps = getRecordsHelpFallbackGuideSteps(actionId, answer, question);
  if (fallbackSteps) {
    steps.splice(0, steps.length, ...fallbackSteps);
  } else if (steps.length < 2) {
    steps.splice(0, steps.length, ...(fallbackSteps || []));
  }
  if (steps.length < 2) return null;
  return {
    id: "guided.path",
    label: "Show me how",
    guide: {
      buttonLabel: "Show me how",
      route,
      arrivalNarration: buildRecordsArrivalNarration(answer, RECORDS_HELP_ACTIONS[actionId]),
      steps,
    },
  };
}

function normalizeRecordsTaskGuide(guide, actionId, answer, question = "") {
  const fallbackSteps = getRecordsHelpFallbackGuideSteps(actionId, answer, question);
  const suppliedSteps = Array.isArray(guide?.steps) ? guide.steps : [];
  const answerSteps = inferRecordsAnswerGuideSteps(answer);
  const countContentSteps = (steps) => steps.filter((step) => !RECORDS_HELP_NAVIGATION_LABELS.has(
    normalizeHelpActionText(step?.target)
  )).length;
  const sourceSteps = fallbackSteps
    || (countContentSteps(answerSteps) > countContentSteps(suppliedSteps) ? answerSteps : suppliedSteps);
  const verifiedLabels = loadRecordsUiCatalog(actionId);
  const seen = new Set();
  const steps = sourceSteps.filter((step) => isRecordsRollbackRequest(question)
    || !RECORDS_HELP_ROLLBACK_TARGET.test(String(step?.target || "").trim())).map((step) => {
    const originalTarget = String(step?.target || "").trim();
    const target = resolveRecordsUiLabel(originalTarget, verifiedLabels);
    return target ? { ...step, target } : null;
  }).filter((step) => {
    const target = String(step?.target || "").trim().toLowerCase();
    if (!target || seen.has(target)) return false;
    seen.add(target);
    return true;
  }).map((step) => {
    const target = String(step.target || "").trim().slice(0, 100);
    if (!RECORDS_HELP_CONSEQUENTIAL_TARGET.test(target)) {
      return { target, narration: String(step.narration || "").trim().slice(0, 220) };
    }
    return {
      target,
      narration: fallbackSteps
        ? String(step.narration || "").trim().slice(0, 220)
        : `${target} is the control that completes this action.`,
    };
  });
  return {
    ...guide,
    buttonLabel: "Show me how",
    arrivalNarration: buildRecordsArrivalNarration(answer, RECORDS_HELP_ACTIONS[actionId]),
    steps,
  };
}

function inferRecordsHelpAction(question, answer) {
  if (!isRecordsHelpTaskRequest(question)) return null;
  const normalizedQuestion = normalizeHelpMatchText(question);
  const normalizedAnswer = normalizeHelpMatchText(answer);
  const candidates = Object.entries(RECORDS_HELP_ACTIONS)
    .map(([id, label]) => {
      const destination = normalizeHelpMatchText(label.replace(/^(Open|Show)\s+/i, ""));
      const aliases = RECORDS_HELP_ACTION_ALIASES[id] || [];
      const questionAliasLength = aliases.reduce((longest, alias) => {
        const normalizedAlias = normalizeHelpMatchText(alias);
        return normalizedQuestion.includes(normalizedAlias) ? Math.max(longest, normalizedAlias.length) : longest;
      }, 0);
      const score = (normalizedQuestion.includes(destination) ? 1000 + destination.length : 0)
        + (questionAliasLength ? 500 + questionAliasLength : 0)
        + (normalizedAnswer.includes(destination) ? 100 : 0);
      return { id, score, destinationLength: destination.length };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.destinationLength - a.destinationLength);
  if (!candidates.length) return null;
  if (candidates[1]?.score === candidates[0].score) return null;
  return candidates[0].id;
}

function decodeRecordsUiText(value) {
  return String(value || "")
    .replace(/<([a-z][\w-]*)\b[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\*+$/, "");
}

function getRecordsUiCatalogHtml(route) {
  const normalizedRoute = String(route || "");
  const relativePath = normalizedRoute.startsWith("/n3xra-records/account/")
    ? "account/index.html"
    : normalizedRoute === "/n3xra-records/meeting-notes"
      ? "meeting-notes/index.html"
      : normalizedRoute === "/n3xra-records/documents.html"
        ? "documents.html"
        : normalizedRoute === "/n3xra-records/messages.html"
          ? "messages.html"
          : "library/index.html";
  try {
    let html = fs.readFileSync(path.join(__dirname, "..", "n3xra-records", relativePath), "utf8");
    if (normalizedRoute.startsWith("/n3xra-records/account/")) {
      const view = new URL(normalizedRoute, "https://records.local").searchParams.get("view") || "";
      const panelId = view === "support" ? "support-access-card" : `admin-${view}-panel`;
      const markerIndex = html.indexOf(`id="${panelId}"`);
      if (markerIndex >= 0) {
        const start = Math.max(0, html.lastIndexOf("<section", markerIndex));
        const next = html.indexOf('<section class="admin-panel"', markerIndex + panelId.length);
        html = html.slice(start, next >= 0 ? next : html.length);
      }
    }
    return html;
  } catch {
    return "";
  }
}

function loadRecordsUiCatalog(actionId) {
  const route = RECORDS_HELP_ACTION_ROUTES[actionId];
  if (!route) return [];
  if (recordsUiCatalogCache.has(route)) return recordsUiCatalogCache.get(route);
  const html = getRecordsUiCatalogHtml(route);
  const labels = [];
  const seen = new Set();
  const pattern = /<(button|label|summary|legend|h[1-5]|option)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const primary = /<(?:strong)\b[^>]*>([\s\S]*?)<\/(?:strong)>/i.exec(match[2]);
    const label = decodeRecordsUiText(primary?.[1] || match[2]);
    const normalized = normalizeHelpActionText(label);
    if (!label || label.length > 80 || seen.has(normalized)) continue;
    seen.add(normalized);
    labels.push(label);
    if (labels.length === 100) break;
  }
  recordsUiCatalogCache.set(route, labels);
  return labels;
}

function resolveRecordsUiLabel(target, labels) {
  const original = String(target || "").trim();
  const expected = normalizeHelpActionText(original);
  if (!expected) return "";
  if (RECORDS_HELP_NAVIGATION_LABELS.has(expected)) return original;
  const exact = labels.find((label) => normalizeHelpActionText(label) === expected);
  if (exact) return exact;
  const related = labels.filter((label) => {
    const candidate = normalizeHelpActionText(label);
    return candidate.startsWith(expected) || expected.startsWith(candidate);
  });
  const unique = [...new Set(related.map((label) => normalizeHelpActionText(label)))];
  return unique.length === 1 ? related[0] : "";
}

function isRecordsHelpGuideGrounded(guide, actionId) {
  const steps = Array.isArray(guide?.steps) ? guide.steps : [];
  const labels = loadRecordsUiCatalog(actionId);
  const contentSteps = steps.filter((step) => !RECORDS_HELP_NAVIGATION_LABELS.has(
    normalizeHelpActionText(step?.target)
  ));
  return Boolean(contentSteps.length && labels.length && steps.every(
    (step) => resolveRecordsUiLabel(step?.target, labels)
  ));
}

function mergeRecordsHelpActions(...groups) {
  const merged = [];
  for (const action of groups.flat()) {
    if (!action?.id || merged.some((item) => item.id === action.id)) continue;
    merged.push(action);
    if (merged.length === 2) break;
  }
  return merged;
}

function buildRecordsHelpEmptyAnswerFallback(actions) {
  const action = Array.isArray(actions) ? actions[0] : null;
  if (!action?.label) return "";
  const destination = String(action.label).replace(/^(Open|Show)\s+/i, "").trim();
  return `I can guide you to ${destination}. Use the option below and Records AI will show you where to go.`;
}

function isRecordsHelpAnswerIncomplete(answer) {
  const text = String(answer || "").trim();
  if (!text) return true;
  return (text.match(/\*\*/g) || []).length % 2 !== 0
    || (text.match(/`/g) || []).length % 2 !== 0;
}

function repairRecordsHelpMarkdown(answer) {
  let text = String(answer || "").trim();
  for (const marker of ["**", "`"]) {
    const pattern = marker === "**" ? /\*\*/g : /`/g;
    if ((text.match(pattern) || []).length % 2 === 0) continue;
    const index = text.lastIndexOf(marker);
    if (index >= 0) text = `${text.slice(0, index)}${text.slice(index + marker.length)}`;
  }
  return text.trim();
}

function combineRecordsHelpUsage(...items) {
  return items.reduce((total, usage) => ({
    promptTokens: total.promptTokens + Math.max(0, Number(usage?.promptTokens || 0)),
    completionTokens: total.completionTokens + Math.max(0, Number(usage?.completionTokens || 0)),
    totalTokens: total.totalTokens + Math.max(0, Number(usage?.totalTokens || 0)),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

async function requestRecordsHelpModel(apiKey, messages) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
  return {
    ok: response.ok,
    data,
    rawAnswer: String(data?.choices?.[0]?.message?.content || "").trim(),
    error: String(data?.error?.message || data?.message || "Unable to reach Records AI."),
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

function buildSystemPrompt(user, appContext, verifiedUiLabels = []) {
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
    "You can offer safe navigation and page-highlighting buttons. For a simple destination, append an allowlisted action token. For a multi-step workflow, append one generic guide token. Put tokens at the very end of the answer, each on its own line; the app removes them and renders buttons.",
    "Simple action allowlist: [[action:library.search]], [[action:library.ai_search]], [[action:library.upload]], [[action:meeting.new]], [[action:documents.new]], [[action:messages.compose]], [[action:account.profile]], [[action:account.library]], [[action:account.templates]], [[action:account.phone]], [[action:account.ai]], [[action:account.users]], [[action:account.contacts]], [[action:account.access]], [[action:account.storage]], [[action:account.billing]], [[action:account.activity]], [[action:account.support]].",
    "Generic guide format: [[guide:Button label|SAFE_ROUTE|Exact UI label~Natural spoken instruction>Exact UI label~Natural spoken instruction]]. Use 2 to 7 verified interface labels in the order the user would encounter them.",
    "SAFE_ROUTE must be one of: /n3xra-records/library, /n3xra-records/meeting-notes, /n3xra-records/documents.html, /n3xra-records/messages.html, or /n3xra-records/account/?view= followed by profile, library, templates, phone, ai, users, contacts, access, storage, billing, activity, or support.",
    "Guide targets must be exact visible interface labels from product knowledge. Narration should explain what each highlighted choice means in the user's workflow, not merely read a button label. The guide may reveal expandable sections but never submits forms, starts recordings or calls, sends messages, uploads files, changes settings, or activates destructive controls.",
    "Keep each answer and guide scoped to the topic the user asked about. Do not tour or explain every feature, field, or alternative on the destination page unless the user explicitly asks for an overview, comparison, tour, or all options.",
    "When the user asks not to save, submit, send, or complete an action, end by explaining the final consequential control without activating it. Do not add a cancel, close, discard, or rollback step unless the user explicitly asks to close or discard the work.",
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
    ...(verifiedUiLabels.length ? [
      "",
      "Exact UI labels read from the likely destination's current page:",
      verifiedUiLabels.map((label) => `- ${label}`).join("\n"),
      "For this workflow, use these current labels exactly. Omit any requested field or control that is not present; never invent a substitute.",
    ] : []),
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
    const likelyActionId = inferRecordsHelpAction(question, "");
    const verifiedUiLabels = loadRecordsUiCatalog(likelyActionId);
    const systemPrompt = buildSystemPrompt(user, verifiedContext, verifiedUiLabels);
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: question },
    ];
    const initialCompletion = await requestRecordsHelpModel(groqApiKey, messages);
    if (!initialCompletion.ok) return res.status(502).json({ error: initialCompletion.error });

    let extracted = extractHelpActions(initialCompletion.rawAnswer);
    let answer = extracted.answer;
    let actions = extracted.actions;
    const usageParts = [normalizeGroqUsage(
      initialCompletion.data,
      messages.map((item) => item.content).join("\n\n"),
      initialCompletion.rawAnswer
    )];

    if (!answer || isRecordsHelpAnswerIncomplete(answer)) {
      const retryMessages = [
        ...messages,
        { role: "assistant", content: initialCompletion.rawAnswer || "I did not provide a visible answer." },
        {
          role: "user",
          content: "Provide the complete visible Records help answer now. Include concise instructions before any optional action or guide token. Never return only a token or an empty response.",
        },
      ];
      const retryCompletion = await requestRecordsHelpModel(groqApiKey, retryMessages);
      if (retryCompletion.ok) {
        const retried = extractHelpActions(retryCompletion.rawAnswer);
        if (retried.answer && !isRecordsHelpAnswerIncomplete(retried.answer)) answer = retried.answer;
        else if (!answer) answer = retried.answer;
        actions = mergeRecordsHelpActions(actions, retried.actions);
        usageParts.push(normalizeGroqUsage(
          retryCompletion.data,
          retryMessages.map((item) => item.content).join("\n\n"),
          retryCompletion.rawAnswer
        ));
      }
    }

    answer = repairRecordsHelpMarkdown(answer);

    const fallbackActionId = actions.length ? null : inferRecordsHelpAction(question, answer);
    if (fallbackActionId) actions = [{ id: fallbackActionId, label: RECORDS_HELP_ACTIONS[fallbackActionId] }];
    const existingGuideAction = actions.find((action) => action.id === "guided.path" && action.guide);
    const guideRetryAction = actions.find((action) => RECORDS_HELP_ACTIONS[action.id]);
    const guideRetryActionId = guideRetryAction?.id
      || getRecordsHelpActionIdForRoute(existingGuideAction?.guide?.route);
    const hasGroundedGuide = existingGuideAction
      && isRecordsHelpGuideGrounded(existingGuideAction.guide, guideRetryActionId)
      && !hasUnrequestedRecordsRollbackStep(existingGuideAction.guide, question);
    if (
      answer
      && guideRetryActionId
      && isRecordsHelpTaskRequest(question)
      && !isRecordsNavigationOnlyRequest(question)
      && !hasGroundedGuide
    ) {
      const route = RECORDS_HELP_ACTION_ROUTES[guideRetryActionId];
      const guideRetryMessages = [
        ...messages,
        { role: "assistant", content: answer },
        {
          role: "user",
          content: `Rewrite the complete answer with a guided-path token for ${route}. Use only exact labels from the verified current-page label list. Put the safe form opener before its fields, omit controls that are not listed, and stop before any submit or consequential action.`,
        },
      ];
      const guideRetryCompletion = await requestRecordsHelpModel(groqApiKey, guideRetryMessages);
      if (guideRetryCompletion.ok) {
        const guided = extractHelpActions(guideRetryCompletion.rawAnswer);
        const guideAction = guided.actions.find((action) => action.id === "guided.path" && action.guide);
        if (guided.answer && guideAction && !isRecordsHelpAnswerIncomplete(guided.answer)) {
          answer = guided.answer;
          actions = [guideAction];
        }
        usageParts.push(normalizeGroqUsage(
          guideRetryCompletion.data,
          guideRetryMessages.map((item) => item.content).join("\n\n"),
          guideRetryCompletion.rawAnswer
        ));
      }
    }
    if (!answer) answer = buildRecordsHelpEmptyAnswerFallback(actions);
    if (answer && isRecordsHelpTaskRequest(question) && !isRecordsNavigationOnlyRequest(question)) {
      const hasGuide = actions.some((action) => action.id === "guided.path" && action.guide);
      const primaryAction = actions.find((action) => RECORDS_HELP_ACTIONS[action.id]);
      if (hasGuide) {
        const guideActionId = getRecordsHelpActionIdForRoute(
          actions.find((action) => action.id === "guided.path" && action.guide)?.guide?.route
        );
        if (isRecordsPreviewOnlyRequest(question) && RECORDS_HELP_SAFE_PREVIEW_ANSWERS[guideActionId]) {
          answer = RECORDS_HELP_SAFE_PREVIEW_ANSWERS[guideActionId];
        }
        actions = actions.map((action) => action.id === "guided.path" && action.guide ? {
          ...action,
          label: "Show me how",
          guide: normalizeRecordsTaskGuide(action.guide, guideActionId, answer, question),
        } : action);
      } else if (primaryAction) {
        if (isRecordsPreviewOnlyRequest(question) && RECORDS_HELP_SAFE_PREVIEW_ANSWERS[primaryAction.id]) {
          answer = RECORDS_HELP_SAFE_PREVIEW_ANSWERS[primaryAction.id];
        }
        const inferredGuide = inferRecordsWorkflowGuide(primaryAction.id, answer, question);
        if (inferredGuide) {
          inferredGuide.guide = normalizeRecordsTaskGuide(inferredGuide.guide, primaryAction.id, answer, question);
          actions = [inferredGuide];
        } else {
          actions = actions.map((action) => action.id === primaryAction.id ? {
            ...action,
            guidanceMode: "task",
            arrivalNarration: buildRecordsArrivalNarration(answer, action.label),
          } : action);
        }
      }
    }
    const usage = combineRecordsHelpUsage(...usageParts);
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "help",
      model: RECORDS_HELP_MODEL,
      usage,
    });

    if (!answer) return res.status(502).json({ error: "Records AI could not produce an answer. Please try again." });

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
module.exports.parseRecordsGuideToken = parseRecordsGuideToken;
module.exports.isRecordsHelpTaskRequest = isRecordsHelpTaskRequest;
module.exports.inferRecordsHelpAction = inferRecordsHelpAction;
module.exports.mergeRecordsHelpActions = mergeRecordsHelpActions;
module.exports.buildRecordsHelpEmptyAnswerFallback = buildRecordsHelpEmptyAnswerFallback;
module.exports.combineRecordsHelpUsage = combineRecordsHelpUsage;
module.exports.isRecordsNavigationOnlyRequest = isRecordsNavigationOnlyRequest;
module.exports.buildRecordsArrivalNarration = buildRecordsArrivalNarration;
module.exports.inferRecordsWorkflowGuide = inferRecordsWorkflowGuide;
module.exports.isRecordsPreviewOnlyRequest = isRecordsPreviewOnlyRequest;
module.exports.normalizeRecordsTaskGuide = normalizeRecordsTaskGuide;
module.exports.isRecordsHelpAnswerIncomplete = isRecordsHelpAnswerIncomplete;
module.exports.repairRecordsHelpMarkdown = repairRecordsHelpMarkdown;
module.exports.loadRecordsUiCatalog = loadRecordsUiCatalog;
module.exports.resolveRecordsUiLabel = resolveRecordsUiLabel;
module.exports.isRecordsHelpGuideGrounded = isRecordsHelpGuideGrounded;
