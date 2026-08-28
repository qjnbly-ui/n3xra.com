const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const HASH_SECRET = String(process.env.CONTACT_CARD_HASH_SECRET || process.env.COMMUNICATIONS_HASH_SECRET || "").trim();

function clean(value, limit) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
}

function serviceHeaders(extra = {}) {
  const credentials = SERVICE_KEY.startsWith("sb_secret_")
    ? { apikey: SERVICE_KEY }
    : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  return { ...credentials, ...extra };
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(String(data?.message || data?.error || "Contact Card request failed."));
    error.status = response.status;
    throw error;
  }
  return data;
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  return email;
}

function normalizePhone(value) {
  let digits = clean(value, 40).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) digits = `1${digits}`;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw Object.assign(new Error("Enter a valid phone number with area code."), { status: 400 });
  return `+${digits}`;
}

function requestKey(req, profileId) {
  const ip = clean(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown", 200).split(",")[0].trim();
  return crypto.createHmac("sha256", HASH_SECRET).update(`${profileId}:${ip}`).digest("hex");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !HASH_SECRET) return send(res, 503, { error: "Contact sharing is temporarily unavailable." });

  try {
    const slug = clean(req.body?.slug, 64).toLowerCase();
    const name = clean(req.body?.name, 180);
    const email = normalizeEmail(req.body?.email);
    const phoneE164 = normalizePhone(req.body?.phone);
    const companyName = clean(req.body?.company, 220);
    const message = clean(req.body?.message, 800);

    if (clean(req.body?.website, 100)) return send(res, 201, { success: true });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return send(res, 400, { error: "This Contact Card is not valid." });
    if (!name) return send(res, 400, { error: "Enter your name." });
    if (!email && !phoneE164) return send(res, 400, { error: "Enter an email address or phone number." });

    const params = new URLSearchParams({
      select: "id,owner_user_id,display_name",
      slug: `eq.${slug}`,
      status: "eq.published",
      exchange_enabled: "eq.true",
      limit: "1",
    });
    const profiles = await supabaseRequest(`contact_card_profiles?${params}`);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile) return send(res, 404, { error: "This card is not accepting connections right now." });
    const premiumParams = new URLSearchParams({ select: "premium_active", owner_user_id: `eq.${profile.owner_user_id}`, premium_active: "eq.true", limit: "1" });
    const premiumRows = await supabaseRequest(`contact_card_entitlements?${premiumParams}`);
    if (!Array.isArray(premiumRows) || !premiumRows[0]?.premium_active) return send(res, 404, { error: "This card is not accepting connections right now." });

    const allowed = await supabaseRequest("rpc/consume_contact_card_connection_rate_limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_key_hash: requestKey(req, profile.id), input_limit: 8, input_window_seconds: 3600 }),
    });
    if (allowed !== true) return send(res, 429, { error: "Please wait before sharing another contact." });

    await supabaseRequest("contact_card_connections", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        profile_id: profile.id,
        owner_user_id: profile.owner_user_id,
        name,
        email,
        phone_e164: phoneE164,
        company_name: companyName,
        message,
        source: "public_card",
        privacy_notice_version: "2026-08-28",
      }),
    });
    return send(res, 201, { success: true, ownerName: profile.display_name });
  } catch (error) {
    return send(res, Number(error?.status) || 500, { error: error?.message || "Your information could not be shared." });
  }
};
