export interface ProspectCardDetails {
  fullName: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  email: string;
  emails: string[];
  phoneE164: string;
  phonesE164: string[];
  websiteUrl: string;
  addressText: string;
  interestTags: string[];
  notes: string;
  confidence: number;
}

interface GroqProspectCardResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface ProspectCardOptions {
  env?: { GROQ_API_KEY?: string; GROQ_PROSPECT_CARD_MODEL?: string };
  fetcher?: typeof fetch;
}

const DEFAULT_MODEL = "qwen/qwen3.6-27b";
const SUPPORTED_IMAGE = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=]+)$/i;

function clean(value: unknown, limit = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeEmail(value: unknown): string {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizePhone(value: unknown): string {
  let digits = clean(value, 40).replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : "";
}

function normalizeUrl(value: unknown): string {
  const input = clean(value, 500);
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((tag) => clean(tag, 80)).filter(Boolean))).slice(0, 12);
}

function normalizeList(value: unknown, normalizer: (item: unknown) => string, fallback: unknown): string[] {
  const source = [...(fallback ? [fallback] : []), ...(Array.isArray(value) ? value : [])];
  return Array.from(new Set(source.map(normalizer).filter(Boolean))).slice(0, 6);
}

function normalizeConfidence(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000;
}

function imageByteLength(imageDataUrl: string): number {
  const match = imageDataUrl.match(SUPPORTED_IMAGE);
  if (!match?.[2]) return 0;
  return Math.floor((match[2].length * 3) / 4) - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
}

export function validateProspectCardImage(imageDataUrl: string): void {
  if (!SUPPORTED_IMAGE.test(imageDataUrl)) {
    throw new Error("Upload a JPEG, PNG, or WebP business-card image.");
  }
  const bytes = imageByteLength(imageDataUrl);
  if (!bytes || bytes > 3_500_000) {
    throw new Error("The business-card image must be 3.5 MB or smaller for scanning.");
  }
}

export function normalizeProspectCardDetails(value: unknown): ProspectCardDetails {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const emails = normalizeList(record.emails, normalizeEmail, record.email);
  const phonesE164 = normalizeList(record.phones, normalizePhone, record.phone);
  return {
    fullName: clean(record.full_name, 180),
    firstName: clean(record.first_name, 100),
    lastName: clean(record.last_name, 100),
    jobTitle: clean(record.job_title, 180),
    companyName: clean(record.company_name, 220),
    email: emails[0] || "",
    emails,
    phoneE164: phonesE164[0] || "",
    phonesE164,
    websiteUrl: normalizeUrl(record.website_url),
    addressText: clean(record.address, 500),
    interestTags: normalizeTags(record.interest_tags),
    notes: clean(record.notes, 1000),
    confidence: normalizeConfidence(record.confidence),
  };
}

export async function analyzeProspectBusinessCard(
  imageDataUrl: string,
  options: ProspectCardOptions = {},
): Promise<{ details: ProspectCardDetails; provider: "groq"; model: string }> {
  validateProspectCardImage(imageDataUrl);
  const apiKey = clean(options.env?.GROQ_API_KEY ?? process.env.GROQ_API_KEY, 1000);
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  const model = clean(options.env?.GROQ_PROSPECT_CARD_MODEL ?? process.env.GROQ_PROSPECT_CARD_MODEL, 180) || DEFAULT_MODEL;
  const fetcher = options.fetcher ?? fetch;

  const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract contact details from business cards. Return only valid JSON. Never invent a value that is not visible or strongly supported by the card. Use empty strings and empty arrays for unknown values.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this business card and return this exact JSON shape: {\"full_name\":\"\",\"first_name\":\"\",\"last_name\":\"\",\"job_title\":\"\",\"company_name\":\"\",\"email\":\"\",\"emails\":[],\"phone\":\"\",\"phones\":[],\"website_url\":\"\",\"address\":\"\",\"interest_tags\":[],\"notes\":\"\",\"confidence\":0}. Put every clearly printed email address in emails and every clearly printed phone number in phones, with the primary value first; also repeat the first one in email or phone for compatibility. Format phones as international numbers when the country is clear. Interest tags may include only services or business categories explicitly printed on the card. Confidence must be between 0 and 1.",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  const payload = await response.json() as GroqProspectCardResponse;
  if (!response.ok) {
    throw new Error(clean(payload.error?.message, 500) || "Groq could not scan this business card.");
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The business-card scan returned no contact details.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The business-card scan returned an unreadable result. Try a clearer photo.");
  }

  return { details: normalizeProspectCardDetails(parsed), provider: "groq", model };
}
