type Fetcher = typeof fetch;

export interface PortalColorCandidate {
  value: string;
  score: number;
  primaryScore: number;
  accentScore: number;
  evidence?: string[];
}

export interface PortalLogoCandidate {
  id: string;
  label: string;
  assetKey: string;
  publicUrl: string;
  mimeType: string;
  score: number;
}

export interface PortalBrandAdviceInput {
  websiteName: string;
  currentPrimaryColor: string;
  currentAccentColor: string;
  colorCandidates: PortalColorCandidate[];
  logoCandidates: PortalLogoCandidate[];
}

export interface PortalBrandAdvice {
  primaryColor: string | null;
  accentColor: string | null;
  logoAssetId: string | null;
  confidence: number;
  reason: string;
  provider: "groq" | "openai";
  model: string;
}

interface AdvisorEnvironment {
  GROQ_API_KEY?: string;
  GROQ_PORTAL_VISION_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_PORTAL_VISION_MODEL?: string;
  OPENAI_ASSISTANT_MODEL?: string;
}

interface RawAdvice {
  primary_color?: unknown;
  accent_color?: unknown;
  logo_asset_id?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

interface ProviderPayload {
  choices?: Array<{ message?: { content?: unknown } }>;
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
}

const GROQ_DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";

function clean(value: unknown, limit = 500): string {
  return String(value ?? "").trim().slice(0, limit);
}

function safeImageUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function promptFor(input: PortalBrandAdviceInput, logos: PortalLogoCandidate[]): string {
  const colors = input.colorCandidates.slice(0, 12).map((candidate) => ({
    value: candidate.value,
    score: Math.round(candidate.score),
    primary_score: Math.round(candidate.primaryScore),
    accent_score: Math.round(candidate.accentScore),
    evidence: (candidate.evidence || []).slice(0, 6),
  }));
  const logoIndex = logos.map((logo, index) => ({
    image_number: index + 1,
    asset_id: logo.id,
    label: logo.label,
    asset_key: logo.assetKey,
    deterministic_score: Math.round(logo.score),
  }));
  return [
    "You are a brand-identity classifier for a website management portal.",
    "Choose only from the supplied exact color values and logo asset IDs. Never invent a color or ID.",
    "Prefer a primary color that represents the brand, works as a portal header/background, and supports readable white text.",
    "Prefer an accent that is genuinely brand-specific and visibly distinct from the primary color.",
    "For the logo, choose the main business logo variant that will be most legible on the proposed primary background. Ignore favicons, icons, decorative marks, photos, and duplicates when a clearer full logo exists.",
    "Return null for a field when the evidence is insufficient. Confidence is 0 through 1. Keep the reason under 180 characters.",
    "Return JSON only with keys primary_color, accent_color, logo_asset_id, confidence, reason.",
    JSON.stringify({
      website_name: input.websiteName,
      deterministic_primary: input.currentPrimaryColor,
      deterministic_accent: input.currentAccentColor,
      allowed_colors: colors,
      logo_images: logoIndex,
    }),
  ].join("\n");
}

function parseJsonText(value: unknown): RawAdvice | null {
  const text = clean(value, 10_000);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RawAdvice : null;
  } catch {
    return null;
  }
}

function groqText(payload: ProviderPayload): unknown {
  return payload.choices?.[0]?.message?.content;
}

function openAiText(payload: ProviderPayload): unknown {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function validateAdvice(
  raw: RawAdvice,
  input: PortalBrandAdviceInput,
  provider: "groq" | "openai",
  model: string,
): PortalBrandAdvice | null {
  const allowedColors = new Map(input.colorCandidates.map((candidate) => [candidate.value.toLowerCase(), candidate.value]));
  const allowedLogos = new Set(input.logoCandidates.map((candidate) => candidate.id));
  const selectedPrimary = clean(raw.primary_color, 20).toLowerCase();
  const selectedAccent = clean(raw.accent_color, 20).toLowerCase();
  const selectedLogo = clean(raw.logo_asset_id, 100);
  const confidence = Number(raw.confidence);
  const reason = clean(raw.reason, 180);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) return null;
  const primaryColor = allowedColors.get(selectedPrimary) || null;
  const accentColor = allowedColors.get(selectedAccent) || null;
  const logoAssetId = allowedLogos.has(selectedLogo) ? selectedLogo : null;
  if (!primaryColor && !accentColor && !logoAssetId) return null;
  return { primaryColor, accentColor, logoAssetId, confidence, reason, provider, model };
}

async function requestGroq(
  input: PortalBrandAdviceInput,
  logos: PortalLogoCandidate[],
  apiKey: string,
  model: string,
  fetcher: Fetcher,
): Promise<PortalBrandAdvice | null> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: promptFor(input, logos) }];
  for (const logo of logos) content.push({ type: "image_url", image_url: { url: logo.publicUrl } });
  const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_completion_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`Groq brand analysis returned ${response.status}.`);
  const raw = parseJsonText(groqText(await response.json() as ProviderPayload));
  return raw ? validateAdvice(raw, input, "groq", model) : null;
}

async function requestOpenAi(
  input: PortalBrandAdviceInput,
  logos: PortalLogoCandidate[],
  apiKey: string,
  model: string,
  fetcher: Fetcher,
): Promise<PortalBrandAdvice | null> {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: promptFor(input, logos) }];
  for (const logo of logos) content.push({ type: "input_image", image_url: logo.publicUrl, detail: "low" });
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "portal_brand_advice",
          strict: true,
          schema: {
            type: "object",
            properties: {
              primary_color: { type: ["string", "null"] },
              accent_color: { type: ["string", "null"] },
              logo_asset_id: { type: ["string", "null"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string", maxLength: 180 },
            },
            required: ["primary_color", "accent_color", "logo_asset_id", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI brand analysis returned ${response.status}.`);
  const raw = parseJsonText(openAiText(await response.json() as ProviderPayload));
  return raw ? validateAdvice(raw, input, "openai", model) : null;
}

export async function advisePortalBrand(
  input: PortalBrandAdviceInput,
  options: { env?: AdvisorEnvironment; fetcher?: Fetcher } = {},
): Promise<{ advice: PortalBrandAdvice | null; warnings: string[] }> {
  const env = options.env || process.env;
  const fetcher = options.fetcher || fetch;
  const logos = input.logoCandidates
    .map((logo) => ({ ...logo, publicUrl: safeImageUrl(logo.publicUrl) }))
    .filter((logo) => logo.publicUrl)
    .slice(0, 5);
  const normalizedInput = { ...input, logoCandidates: logos };
  const warnings: string[] = [];
  const groqKey = clean(env.GROQ_API_KEY, 500);
  const groqModel = clean(env.GROQ_PORTAL_VISION_MODEL || GROQ_DEFAULT_VISION_MODEL, 120);
  if (groqKey && groqModel) {
    try {
      const advice = await requestGroq(normalizedInput, logos, groqKey, groqModel, fetcher);
      if (advice) return { advice, warnings };
      warnings.push("Groq returned no usable brand recommendation.");
    } catch (error) {
      warnings.push(clean(error instanceof Error ? error.message : error, 180));
    }
  }
  const openAiKey = clean(env.OPENAI_API_KEY, 500);
  const openAiModel = clean(env.OPENAI_PORTAL_VISION_MODEL || env.OPENAI_ASSISTANT_MODEL, 120);
  if (openAiKey && openAiModel) {
    try {
      const advice = await requestOpenAi(normalizedInput, logos, openAiKey, openAiModel, fetcher);
      if (advice) return { advice, warnings };
      warnings.push("OpenAI returned no usable brand recommendation.");
    } catch (error) {
      warnings.push(clean(error instanceof Error ? error.message : error, 180));
    }
  }
  return { advice: null, warnings };
}
