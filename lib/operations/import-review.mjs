const HEADER_ALIASES = {
  transactionDate: ["transaction date", "date", "trans date"],
  postedDate: ["posted date", "posting date"],
  description: ["description", "merchant", "name", "memo", "details", "transaction"],
  amount: ["amount", "transaction amount"],
  debit: ["debit", "withdrawal", "withdrawals"],
  credit: ["credit", "deposit", "deposits"],
  type: ["type", "transaction type", "debit credit"],
  sourceCategory: ["category", "bank category", "source category"],
  classification: ["classification", "business classification", "tax classification"],
  businessUsePercent: ["business use percent", "business use %", "business-use percentage", "business use"],
  deductibleAmount: ["deductible amount", "proposed deductible", "deductible"],
  suggestionReason: ["reason", "suggestion reason", "review note"],
  sourceId: ["transaction id", "transaction identifier", "source id", "reference id"],
};

const BUSINESS_RULES = [
  [["adobe", "openai", "chatgpt", "github", "vercel", "supabase", "google workspace", "microsoft 365", "dropbox", "canva"], "Software", 94],
  [["namecheap", "godaddy", "cloudflare", "domain", "hosting"], "Hosting & domains", 92],
  [["meta ads", "facebook ads", "google ads", "linkedin ads", "mailchimp", "constant contact"], "Advertising", 92],
  [["staples", "office depot", "usps", "ups store", "fedex office"], "Office supplies", 82],
];

const TRANSFER_TERMS = [
  "online transfer", "funds transfer", "payment thank you", "credit card payment",
  "autopay payment", "zelle transfer", "internal transfer",
];

const REVIEW_RULES = [
  [["apple", "itunes", "app store"], "Software", 35, 100, "Apple charges can be business or personal; verify the receipt."],
  [["restaurant", "cafe", "coffee", "doordash", "ubereats", "grubhub"], "Meals", 45, 50, "Meals require a documented business purpose and may have deduction limits."],
  [["shell", "chevron", "exxon", "mobil", "fuel", "gas station"], "Fuel", 40, 50, "Vehicle costs may require a business-use allocation and mileage records."],
  [["amazon", "walmart", "target", "costco"], "Needs review", 25, 0, "General retailers sell both business and personal items; verify the receipt."],
];

export function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isResolvedExpenseCategory(value) {
  const category = normalizeHeader(value);
  return Boolean(category) && !["needs review", "uncategorized"].includes(category);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted && character === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

export function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("The file must include a header row and at least one transaction.");
  }
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value ?? "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header || `column ${index + 1}`, row[index] ?? ""])));
}

function valueFor(record, key) {
  const aliases = HEADER_ALIASES[key] || [];
  for (const alias of aliases) {
    if (record[alias] !== undefined && String(record[alias]).trim() !== "") return record[alias];
  }
  return "";
}

export function parseImportDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + (value * 86400000)).toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function parseMoneyCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  let text = String(value ?? "").trim();
  if (!text) return null;
  const parenthesized = /^\(.*\)$/.test(text);
  text = text.replace(/[,$\s]/g, "").replace(/[()]/g, "");
  if (!/^[+-]?\d+(\.\d{0,2})?$/.test(text)) return null;
  const sign = text.startsWith("-") || parenthesized ? -1 : 1;
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
  return sign * ((Number(whole) * 100) + Number(fraction.padEnd(2, "0")));
}

function importedClassification(record) {
  const value = normalizeHeader(valueFor(record, "classification"));
  const aliases = {
    business: "business",
    personal: "personal",
    mixed: "mixed",
    "mixed use": "mixed",
    transfer: "transfer",
    "needs review": "needs_review",
    unclear: "needs_review",
  };
  return aliases[value] || null;
}

export function suggestClassification(description, flow = "debit") {
  const normalized = normalizeHeader(description);
  if (flow === "credit") {
    return {
      classification: "needs_review",
      category: "Credit or refund",
      businessUsePercent: 0,
      confidence: 30,
      reason: "Credits, refunds, deposits, and income should be reviewed before expense posting.",
    };
  }
  if (TRANSFER_TERMS.some((term) => normalized.includes(term))) {
    return {
      classification: "transfer",
      category: "Transfer",
      businessUsePercent: 0,
      confidence: 92,
      reason: "The description appears to be a transfer or account payment, not an expense.",
    };
  }
  for (const [terms, category, confidence] of BUSINESS_RULES) {
    if (terms.some((term) => normalized.includes(term))) {
      return {
        classification: "business",
        category,
        businessUsePercent: 100,
        confidence,
        reason: `The merchant commonly matches N3XRA ${category.toLowerCase()} spending; verify the receipt before approval.`,
      };
    }
  }
  for (const [terms, category, confidence, businessUsePercent, reason] of REVIEW_RULES) {
    if (terms.some((term) => normalized.includes(term))) {
      return { classification: "needs_review", category, businessUsePercent, confidence, reason };
    }
  }
  return {
    classification: "needs_review",
    category: "Needs review",
    businessUsePercent: 0,
    confidence: 10,
    reason: "No reliable business rule matched this transaction.",
  };
}

export function normalizeImportRecord(record, rowNumber) {
  const transactionDate = parseImportDate(valueFor(record, "transactionDate"));
  const postedDate = parseImportDate(valueFor(record, "postedDate"));
  const description = String(valueFor(record, "description") ?? "").trim();
  if (!transactionDate || !description) {
    throw new Error(`Row ${rowNumber}: a valid date and description are required.`);
  }

  const debit = parseMoneyCents(valueFor(record, "debit"));
  const credit = parseMoneyCents(valueFor(record, "credit"));
  const amount = parseMoneyCents(valueFor(record, "amount"));
  const type = normalizeHeader(valueFor(record, "type"));
  let signedAmount;
  let flow;
  if (debit !== null && debit !== 0) {
    signedAmount = -Math.abs(debit);
    flow = "debit";
  } else if (credit !== null && credit !== 0) {
    signedAmount = Math.abs(credit);
    flow = "credit";
  } else if (amount !== null && amount !== 0) {
    const creditType = /credit|deposit|refund|income/.test(type);
    const debitType = /debit|withdrawal|purchase|payment|charge/.test(type);
    flow = creditType ? "credit" : debitType ? "debit" : "debit";
    signedAmount = flow === "debit" ? -Math.abs(amount) : Math.abs(amount);
  } else {
    throw new Error(`Row ${rowNumber}: a non-zero amount is required.`);
  }

  const suggestion = suggestClassification(description, flow);
  const classification = importedClassification(record) || suggestion.classification;
  const importedPercent = Number(String(valueFor(record, "businessUsePercent")).replace("%", "").trim());
  let businessUsePercent = Number.isFinite(importedPercent) && importedPercent >= 0 && importedPercent <= 100
    ? importedPercent
    : suggestion.businessUsePercent;
  if (classification === "business" && businessUsePercent <= 0) businessUsePercent = 100;
  if (classification === "mixed" && (businessUsePercent <= 0 || businessUsePercent >= 100)) businessUsePercent = 50;
  if (["personal", "transfer"].includes(classification)) businessUsePercent = 0;

  const importedDeductible = parseMoneyCents(valueFor(record, "deductibleAmount"));
  if (importedDeductible !== null && Math.abs(importedDeductible) <= Math.abs(signedAmount) && Math.abs(signedAmount) > 0) {
    businessUsePercent = Math.round((Math.abs(importedDeductible) / Math.abs(signedAmount)) * 10000) / 100;
  }

  return {
    rowNumber,
    sourceId: String(valueFor(record, "sourceId") || "").trim() || null,
    transactionDate,
    postedDate,
    description,
    amountCents: Math.abs(signedAmount),
    flow,
    sourceCategory: String(valueFor(record, "sourceCategory") || "").trim() || null,
    classification,
    businessUsePercent,
    category: suggestion.category,
    confidence: importedClassification(record) ? 100 : suggestion.confidence,
    suggestionReason: String(valueFor(record, "suggestionReason") || "").trim() || suggestion.reason,
    rawData: record,
  };
}

export function normalizeImportRecords(records) {
  const normalized = [];
  const errors = [];
  records.forEach((record, index) => {
    try {
      normalized.push(normalizeImportRecord(record, index + 2));
    } catch (error) {
      errors.push(error.message);
    }
  });
  if (!normalized.length) throw new Error(errors[0] || "No usable transactions were found.");
  return { records: normalized, errors };
}
