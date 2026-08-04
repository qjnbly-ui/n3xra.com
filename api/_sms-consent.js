const crypto = require("crypto");
const twilio = require("twilio");
const { authenticatedUser, normalizePhone } = require("./_account-phone");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const DISCLOSURE_VERSION = "2026-08-04";
const SMS_DISCLOSURE = "I agree to receive transactional SMS messages from N3XRA, including requested links, account and security notices, appointment reminders, records notifications, and support responses. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.";
const VALID_CONSENT_METHODS = new Set(["web_form", "sms_keyword"]);

function serviceHeaders(extra = {}) {
  if (!SERVICE_KEY) throw new Error("Supabase service access is not configured.");
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function supabaseJson(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Supabase request failed."));
  return data;
}

function consentHash(value) {
  const secret = String(process.env.SMS_CONSENT_HASH_SECRET || process.env.TWILIO_AUTH_TOKEN || "n3xra-sms-consent");
  return crypto.createHmac("sha256", secret).update(String(value || "unknown")).digest("hex");
}

function requestIp(req) {
  return String(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function allowedWebOrigin(req) {
  const origin = String(req?.headers?.origin || "").trim();
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "n3xra.com" || host === "www.n3xra.com" || host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function recentWebConsentCount(ipHash) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await supabaseJson(`sms_consent_events?select=id&ip_hash=eq.${encodeURIComponent(ipHash)}&consent_method=eq.web_form&created_at=gte.${encodeURIComponent(since)}&limit=21`);
  return Array.isArray(rows) ? rows.length : 0;
}

async function recordSmsConsent({
  phone,
  eventType = "opt_in",
  method,
  userId = null,
  sourceUrl = null,
  callSid = null,
  ipHash = null,
  userAgent = null,
}) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) throw new Error("Enter a valid mobile phone number including area code.");
  if (!["opt_in", "opt_out"].includes(eventType)) throw new Error("Invalid consent event.");
  if (!VALID_CONSENT_METHODS.has(method)) throw new Error("Invalid consent method.");
  const rows = await supabaseJson("sms_consent_events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      phone_e164: phoneE164,
      user_id: userId || null,
      event_type: eventType,
      consent_method: method,
      disclosure_version: DISCLOSURE_VERSION,
      disclosure_text: SMS_DISCLOSURE,
      source_url: sourceUrl ? String(sourceUrl).slice(0, 500) : null,
      call_sid: callSid || null,
      ip_hash: ipHash || null,
      user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function latestConsent(phone) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) return null;
  const rows = await supabaseJson(`sms_consent_events?select=event_type,consent_method,created_at&phone_e164=eq.${encodeURIComponent(phoneE164)}&order=created_at.desc&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function sendTransactionalSms(phone, body) {
  const phoneE164 = normalizePhone(phone);
  const consent = await latestConsent(phoneE164);
  if (!phoneE164 || consent?.event_type !== "opt_in") throw new Error("SMS consent is not active for this number.");
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = normalizePhone(process.env.TWILIO_RECEPTIONIST_NUMBER || "+15416526840");
  if (!accountSid || !authToken || !from) throw new Error("Twilio messaging is not configured.");
  return twilio(accountSid, authToken).messages.create({
    from,
    to: phoneE164,
    body: String(body || "").trim().slice(0, 1200),
  });
}

async function optionalAuthenticatedUser(req) {
  try {
    return await authenticatedUser(req);
  } catch {
    return null;
  }
}

module.exports = {
  DISCLOSURE_VERSION,
  SMS_DISCLOSURE,
  VALID_CONSENT_METHODS,
  allowedWebOrigin,
  consentHash,
  latestConsent,
  optionalAuthenticatedUser,
  recentWebConsentCount,
  recordSmsConsent,
  requestIp,
  sendTransactionalSms,
};
