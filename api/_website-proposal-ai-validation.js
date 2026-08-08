const { apiError } = require("./_website-proposal-ai-supabase");

const PROPOSAL_FIELDS = new Set(["title"]);
const VERSION_FIELDS = new Set([
  "introduction", "project_objective", "scope_summary", "deliverables", "exclusions",
  "timeline", "estimated_start_date", "estimated_completion_date", "valid_until",
  "discount_cents", "deposit_cents", "payment_schedule", "revision_policy", "terms",
]);
const LINE_ITEM_FIELDS = new Set([
  "category", "name", "description", "billing_type", "quantity", "unit_amount_cents",
  "recurring_interval", "sort_order",
]);
const PROTECTED_VERSION_FIELDS = new Set([
  "timeline", "estimated_start_date", "estimated_completion_date", "valid_until",
  "discount_cents", "deposit_cents", "payment_schedule", "revision_policy", "terms",
]);
const ARRAY_FIELDS = new Set(["deliverables", "exclusions"]);
const DATE_FIELDS = new Set(["estimated_start_date", "estimated_completion_date", "valid_until"]);
const MONEY_FIELDS = new Set(["discount_cents", "deposit_cents", "unit_amount_cents"]);
const CONTRACT_FIELDS = new Set(["timeline", "payment_schedule", "revision_policy", "terms"]);
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const SMALL_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function plain(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseEnglishNumber(value) {
  const tokens = String(value || "").toLowerCase().replace(/-/g, " ").match(/[a-z]+/g) || [];
  let total = 0;
  let current = 0;
  let used = false;
  for (const token of tokens) {
    if (token === "and" || token === "dollars" || token === "dollar" || token === "usd") continue;
    if (Object.hasOwn(SMALL_NUMBERS, token)) { current += SMALL_NUMBERS[token]; used = true; continue; }
    if (token === "hundred" && current > 0) { current *= 100; used = true; continue; }
    if (token === "thousand" && current > 0) { total += current * 1000; current = 0; used = true; continue; }
  }
  return used ? total + current : null;
}

function normalizeMoneyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const text = String(value || "").trim();
  if (!text || /%|\bpercent\b/i.test(text)) return null;
  const relativeAction = /\b(increase|decrease|raise|lower|discount|add|subtract|more|less)\b/i.test(text);
  const exactDestination = /\b(to|at|final(?:\s+price)?(?:\s+is|\s+of)?|set(?:\s+it|\s+the\s+price)?(?:\s+to|\s+at)?)\b/i.test(text);
  if (relativeAction && !exactDestination) return null;
  const dollar = text.match(/(?:\$|usd\s*)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (dollar) return Math.round(Number(dollar[1].replaceAll(",", "")) * 100);
  if (/^[0-9][0-9,]*(?:\.\d{1,2})?$/.test(text)) return Math.round(Number(text.replaceAll(",", "")) * 100);
  const english = parseEnglishNumber(text);
  return english === null ? null : english * 100;
}

function laDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(value, now = new Date()) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/\b(today|tomorrow|yesterday|next|later|soon|in\s+\d+)\b/i.test(text)) return null;
  const iso = text.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(text)) return null;
  const named = text.toLowerCase().match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (!named || !MONTHS[named[1]]) return null;
  const month = MONTHS[named[1]];
  const day = Number(named[2]);
  const today = laDateParts(now);
  let year = named[3] ? Number(named[3]) : today.year;
  let result = validIsoDate(year, month, day);
  if (!result) return null;
  const todayIso = validIsoDate(today.year, today.month, today.day);
  if (!named[3] && result < todayIso) result = validIsoDate(++year, month, day);
  return result;
}

function protectedOperation(operation) {
  return operation?.target?.kind === "line_item"
    || (operation?.target?.kind === "version" && PROTECTED_VERSION_FIELDS.has(operation.field));
}

function canonicalOriginal(operation, baseline) {
  if (operation.target.kind === "proposal") return baseline.proposal[operation.field];
  if (operation.target.kind === "version") return baseline.version[operation.field];
  if (operation.target.kind === "line_item") {
    if (operation.operation === "add") return null;
    const item = baseline.line_items.find((row) => row.id === operation.target.id);
    if (!item) throw apiError(`Suggestion ${operation.id} references a line item outside this proposal version.`, 422);
    return operation.operation === "remove" || operation.field === "item" ? item : item[operation.field];
  }
  return undefined;
}

function validateShape(operation, baseline) {
  if (!operation || typeof operation !== "object") throw apiError("OpenAI returned an invalid suggestion.", 422);
  operation.id = plain(operation.id).slice(0, 100);
  if (!operation.id) throw apiError("OpenAI returned a suggestion without an ID.", 422);
  const kind = operation.target?.kind;
  const type = operation.operation;
  if (!new Set(["proposal", "version", "line_item"]).has(kind)) throw apiError(`Suggestion ${operation.id} has an invalid target.`, 422);
  if (!new Set(["replace", "add", "remove"]).has(type)) throw apiError(`Suggestion ${operation.id} has an invalid operation.`, 422);
  if (kind === "proposal") {
    if (type !== "replace" || !PROPOSAL_FIELDS.has(operation.field) || operation.target.id !== baseline.proposal.id) {
      throw apiError(`Suggestion ${operation.id} targets an unsupported proposal field.`, 422);
    }
    if (typeof operation.proposed !== "string" || !plain(operation.proposed) || plain(operation.proposed).length > 160) {
      throw apiError(`Suggestion ${operation.id} contains an invalid proposal title.`, 422);
    }
  } else if (kind === "version") {
    if (type !== "replace" || !VERSION_FIELDS.has(operation.field) || operation.target.id !== baseline.version.id) {
      throw apiError(`Suggestion ${operation.id} targets an unsupported version field.`, 422);
    }
    if (ARRAY_FIELDS.has(operation.field) && (!Array.isArray(operation.proposed) || operation.proposed.some((value) => typeof value !== "string"))) {
      throw apiError(`Suggestion ${operation.id} must replace ${operation.field} with a complete text array.`, 422);
    }
    if (!ARRAY_FIELDS.has(operation.field)) validateVersionValue(operation.field, operation.proposed, operation.id);
  } else if (type === "add") {
    if (operation.field !== "item" || operation.target.id !== null || !operation.proposed || typeof operation.proposed !== "object") {
      throw apiError(`Suggestion ${operation.id} has an invalid line-item addition.`, 422);
    }
    validateLineItemValue(operation.proposed, operation.id);
  } else if (type === "remove") {
    if (operation.field !== "item" || !operation.target.id) throw apiError(`Suggestion ${operation.id} has an invalid line-item removal.`, 422);
  } else if ((!LINE_ITEM_FIELDS.has(operation.field) && operation.field !== "item") || !operation.target.id) {
    throw apiError(`Suggestion ${operation.id} targets an unsupported line-item field.`, 422);
  } else if (operation.field === "item") {
    validateLineItemValue(operation.proposed, operation.id);
  } else {
    const existing = baseline.line_items.find((row) => row.id === operation.target.id);
    validateLineItemValue({ ...existing, [operation.field]: operation.proposed }, operation.id);
  }
  operation.original = canonicalOriginal(operation, baseline);
  if (sameJson(operation.original, operation.proposed)) throw apiError(`Suggestion ${operation.id} does not change its target.`, 422);
  operation.rationale = plain(operation.rationale).slice(0, 1000);
  operation.evidence = Array.isArray(operation.evidence) ? operation.evidence.slice(0, 8) : [];
}

function validateVersionValue(field, value, operationId) {
  if (["discount_cents", "deposit_cents"].includes(field)) {
    if (!Number.isInteger(value) || value < 0) throw apiError(`Suggestion ${operationId} contains an invalid monetary value.`, 422);
    return;
  }
  if (DATE_FIELDS.has(field)) {
    if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      throw apiError(`Suggestion ${operationId} contains an invalid date value.`, 422);
    }
    return;
  }
  const nullable = new Set(["introduction", "payment_schedule", "revision_policy"]);
  if (value === null && nullable.has(field)) return;
  if (typeof value !== "string") throw apiError(`Suggestion ${operationId} contains an invalid ${field} value.`, 422);
  if (!nullable.has(field) && !plain(value)) throw apiError(`Suggestion ${operationId} cannot make ${field} empty.`, 422);
}

function validateLineItemValue(value, operationId) {
  const categories = new Set(["website_build", "domain", "hosting", "maintenance", "email", "ssl_cdn", "content", "ecommerce", "integration", "other"]);
  const intervals = new Set(["monthly", "quarterly", "yearly"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !categories.has(value.category)
    || !plain(value.name) || plain(value.name).length > 160
    || (value.description !== null && (typeof value.description !== "string" || value.description.length > 500))
    || !new Set(["one_time", "recurring"]).has(value.billing_type)
    || !Number.isFinite(value.quantity) || value.quantity <= 0
    || !Number.isInteger(value.unit_amount_cents) || value.unit_amount_cents < 0
    || !Number.isInteger(value.sort_order)
    || (value.billing_type === "one_time" && value.recurring_interval !== null)
    || (value.billing_type === "recurring" && !intervals.has(value.recurring_interval))) {
    throw apiError(`Suggestion ${operationId} contains an invalid line item.`, 422);
  }
}

function referencedEvidence(operation, evidenceMap) {
  return operation.evidence.flatMap((evidence) => {
    const key = `${plain(evidence?.source_type)}:${plain(evidence?.source_id)}`;
    const source = evidenceMap.get(key);
    const excerpt = String(evidence?.supporting_value || "").trim();
    if (!source || !excerpt || !String(source.text || "").includes(excerpt)) return [];
    return [{ source, excerpt, evidence: { ...evidence, source_type: plain(evidence.source_type), source_id: plain(evidence.source_id) } }];
  });
}

function evidenceMatchesCents(match, proposedCents) {
  const fieldPath = plain(match.evidence?.field_path).toLowerCase();
  if (fieldPath.endsWith("_cents") && /^-?[0-9][0-9,]*$/.test(match.excerpt)) {
    return Number(match.excerpt.replaceAll(",", "")) === proposedCents;
  }
  return normalizeMoneyToCents(match.excerpt) === proposedCents;
}

function sourceContainsValue(match, value) {
  const wanted = plain(value).toLowerCase();
  if (!wanted) return false;
  const text = plain(match.source.text).toLowerCase();
  return text.includes(wanted) || text.includes(wanted.replaceAll("_", " "));
}

function completeLineItemSupported(operation, authoritative) {
  const proposed = operation.proposed || {};
  const original = operation.operation === "add" ? {} : operation.original || {};
  const changed = (field) => operation.operation === "add"
    ? !(new Set(["description", "recurring_interval"]).has(field) && (proposed[field] === null || proposed[field] === ""))
    : !sameJson(original[field], proposed[field]);
  if (changed("unit_amount_cents") && !authoritative.some((match) => evidenceMatchesCents(match, Number(proposed.unit_amount_cents)))) {
    return { supported: false, reason: "The line item’s exact final price is not supported by the cited source." };
  }
  if (changed("quantity") && !authoritative.some((match) => {
    const path = plain(match.evidence?.field_path).toLowerCase();
    const numeric = match.excerpt.match(/\d+(?:\.\d+)?/)?.[0];
    const value = numeric === undefined ? parseEnglishNumber(match.excerpt) : Number(numeric);
    return path.endsWith("quantity") && value === Number(proposed.quantity);
  })) {
    return { supported: false, reason: "The line item’s exact quantity is not supported by quantity evidence." };
  }
  for (const field of ["name", "description", "billing_type", "recurring_interval"]) {
    if (!changed(field)) continue;
    if (proposed[field] === null || proposed[field] === "") {
      if (!authoritative.some(({ excerpt }) => /\b(remove|delete|clear|without|none|no)\b/i.test(excerpt))) {
        return { supported: false, reason: `Removing the line item ${field.replaceAll("_", " ")} requires an explicit instruction.` };
      }
    } else if (!authoritative.some((match) => sourceContainsValue(match, proposed[field]))) {
      return { supported: false, reason: `The line item ${field.replaceAll("_", " ")} is not directly present in an authoritative source.` };
    }
  }
  return { supported: true };
}

function supportedProtected(operation, evidenceMap, now) {
  const matches = referencedEvidence(operation, evidenceMap);
  if (!matches.length) return { supported: false, reason: "No evidence excerpt was found verbatim in an included immutable source." };
  const authoritative = matches.filter(({ source }) => ["admin_instruction", "contractual", "implementation"].includes(source.authority));
  if (!authoritative.length) return { supported: false, reason: "The cited source is not authoritative for a protected proposal change." };

  if (MONEY_FIELDS.has(operation.field)) {
    const proposedCents = Number(operation.proposed);
    const matched = authoritative.some((match) => evidenceMatchesCents(match, proposedCents));
    return matched ? { supported: true } : { supported: false, reason: "The exact final monetary value is not supported by the cited source." };
  }
  if (DATE_FIELDS.has(operation.field)) {
    if (operation.proposed === null) {
      const fieldWords = operation.field.replaceAll("_", " ").replace("estimated ", "");
      const matched = authoritative.some(({ excerpt }) => /\b(remove|delete|clear|unset|no)\b/i.test(excerpt)
        && plain(excerpt).toLowerCase().includes(fieldWords));
      return matched ? { supported: true } : { supported: false, reason: "Removing a date requires an explicit instruction naming that date field." };
    }
    const matched = authoritative.some(({ excerpt }) => normalizeDate(excerpt, now) === operation.proposed);
    return matched ? { supported: true } : { supported: false, reason: "The date is ambiguous or does not match the cited source." };
  }
  if (CONTRACT_FIELDS.has(operation.field)) {
    const proposed = plain(operation.proposed).toLowerCase();
    const matched = proposed && authoritative.some(({ source }) => plain(source.text).toLowerCase().includes(proposed));
    return matched ? { supported: true } : { supported: false, reason: "The substantive contractual replacement is not directly present in an authoritative source." };
  }
  if (operation.target.kind === "line_item") {
    if (operation.operation === "remove") {
      const name = plain(operation.original?.name).toLowerCase();
      const matched = authoritative.some(({ excerpt }) => plain(excerpt).toLowerCase().includes(name)
        && /\b(remove|delete|omit|exclude|drop)\b/i.test(excerpt));
      return matched ? { supported: true } : { supported: false, reason: "Removing a priced item requires an explicit instruction naming the item." };
    }
    if (operation.operation === "add" || operation.field === "item") {
      return completeLineItemSupported(operation, authoritative);
    }
    if (operation.field === "quantity") {
      const matched = authoritative.some(({ excerpt, evidence }) => {
        if (!plain(evidence?.field_path).toLowerCase().endsWith("quantity")) return false;
        const numeric = excerpt.match(/\d+(?:\.\d+)?/)?.[0];
        const value = numeric === undefined ? parseEnglishNumber(excerpt) : Number(numeric);
        return value === Number(operation.proposed);
      });
      return matched ? { supported: true } : { supported: false, reason: "The exact quantity is not supported by the cited source." };
    }
    const proposed = plain(operation.proposed).toLowerCase();
    const matched = proposed && authoritative.some(({ source }) => plain(source.text).toLowerCase().includes(proposed));
    return matched ? { supported: true } : { supported: false, reason: "The protected line-item value is not directly present in an authoritative source." };
  }
  return { supported: false, reason: "This protected change is not supported by a deterministic evidence rule." };
}

function validateChangeSet(raw, baseline, evidenceMap, now = new Date()) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.operations)) throw apiError("OpenAI returned malformed structured output.", 422);
  if (raw.operations.length > 40) throw apiError("OpenAI returned too many suggestions for one review.", 422);
  const seen = new Set();
  const operations = raw.operations.map((input) => {
    const operation = structuredClone(input);
    validateShape(operation, baseline);
    if (seen.has(operation.id)) throw apiError(`OpenAI returned duplicate suggestion ID ${operation.id}.`, 422);
    seen.add(operation.id);
    operation.risk = protectedOperation(operation) ? "protected" : "standard";
    operation.server_validation = operation.risk === "protected"
      ? supportedProtected(operation, evidenceMap, now)
      : { supported: true };
    return operation;
  });
  return { summary: plain(raw.summary).slice(0, 2000), operations };
}

module.exports = {
  normalizeDate,
  normalizeMoneyToCents,
  protectedOperation,
  validateChangeSet,
};
