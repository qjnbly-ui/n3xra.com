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
const GROQ_RECORDS_OCR_MODEL = String(
  process.env.GROQ_RECORDS_OCR_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"
).trim();

const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

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

async function loadOrganization(organizationId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,owner_user_id,subscription_tier&id=eq.${encodeFilter(organizationId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function userCanScanNotes(organization, user) {
  if (!organization?.id || !user?.id) return false;
  if (organization.owner_user_id === user.id) return true;

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
  return ["account_owner", "account_admin", "editor"].includes(role);
}

function validateImageDataUrl(value) {
  const dataUrl = String(value || "").trim();
  if (!dataUrl) throw new Error("Missing handwritten note image.");
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("That note image is too large. Try a closer crop or screenshot.");
  }
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(dataUrl)) {
    throw new Error("Use a JPG, PNG, or WebP note image.");
  }
  return dataUrl;
}

function extractOcrText(rawContent) {
  const content = String(rawContent || "").trim();
  if (!content) return "";

  try {
    const parsed = JSON.parse(content);
    return String(parsed.text || parsed.transcribed_text || "").trim();
  } catch (_error) {
    return content
      .replace(/^```(?:json|text)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }
}

async function scanWithGroq(imageDataUrl) {
  if (!GROQ_RECORDS_API_KEY) throw new Error("Missing GROQ_RECORDS_API_KEY.");

  const prompt = [
    "Extract handwritten note text from this image for N3XRA Records meeting notes.",
    "Return only the readable note text.",
    "Preserve line breaks, names, dates, bullets, numbering, and short labels when visible.",
    "Do not summarize. Do not invent missing words.",
    "If a word is unclear, use [unclear].",
  ].join("\n");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_RECORDS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_RECORDS_OCR_MODEL,
      temperature: 0,
      max_tokens: 1800,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || response.statusText || "Unable to scan handwritten note.");
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  return {
    text: extractOcrText(content),
    usage: normalizeGroqUsage(data, prompt, content),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let user = null;
  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service role key.");
    user = await verifyUser(getBearerToken(req));
    const body = await parseJson(req);
    const organizationId = String(body.organizationId || "").trim();
    if (!organizationId) return res.status(400).json({ error: "Choose a library before scanning handwritten notes." });

    const imageDataUrl = validateImageDataUrl(body.imageDataUrl);
    const usageContext = await prepareRecordsAiUsage({ organizationId, user });
    const organization = await loadOrganization(organizationId);
    if (!organization) return res.status(404).json({ error: "Library was not found." });
    if (!(await userCanScanNotes(organization, user))) {
      return res.status(403).json({ error: "You need editor access to scan handwritten notes." });
    }

    const result = await scanWithGroq(imageDataUrl);
    const recorded = await recordRecordsAiUsage({
      usageContext,
      user,
      feature: "recording_notes",
      model: GROQ_RECORDS_OCR_MODEL,
      usage: result.usage,
    });

    return res.status(200).json({
      text: result.text,
      model: GROQ_RECORDS_OCR_MODEL,
      usage: getClientUsageSummary(recorded?.usage || usageContext.usage),
    });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Unable to scan handwritten note.")) return;
    const status = Number(error?.statusCode || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error instanceof Error ? error.message : "Unable to scan handwritten note.",
    });
  }
};
