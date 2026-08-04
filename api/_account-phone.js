const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function normalizePhone(value) {
  const raw = String(value || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return "";
  return `+${digits}`;
}

function validPin(value) {
  return /^[0-9]{4}$/.test(String(value || ""));
}

async function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  if (!validPin(pin)) throw new Error("Use a four-digit phone PIN.");
  const derived = await scrypt(String(pin), salt, 32);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

async function matchesPin(pin, salt, expectedHash) {
  if (!validPin(pin) || !salt || !expectedHash) return false;
  const { hash } = await hashPin(pin, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

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

async function authenticatedUser(req) {
  if (!ANON_KEY) throw new Error("Supabase authentication is not configured.");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function getCredentialByUser(userId, { includeSecret = false } = {}) {
  const fields = includeSecret
    ? "user_id,phone_e164,pin_salt,pin_hash,failed_attempts,locked_until,last_authenticated_at"
    : "user_id,phone_e164,last_authenticated_at,updated_at";
  const rows = await supabaseJson(`account_phone_credentials?select=${fields}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getCallerAccount(phone) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) return null;
  const credentials = await supabaseJson(`account_phone_credentials?select=user_id,phone_e164,pin_salt,pin_hash,failed_attempts,locked_until,last_password_reset_sent_at&phone_e164=eq.${encodeURIComponent(phoneE164)}&limit=1`);
  const credential = Array.isArray(credentials) ? credentials[0] : null;
  if (!credential) return null;
  const profiles = await supabaseJson(`profiles?select=id,full_name,email,account_status&id=eq.${encodeURIComponent(credential.user_id)}&limit=1`);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || !["active", "trialing"].includes(String(profile.account_status || "active"))) return null;
  return {
    ...credential,
    firstName: String(profile.full_name || "").trim().split(/\s+/)[0] || "",
  };
}

async function sendPasswordResetEmail(caller) {
  if (!caller?.user_id) throw new Error("Caller account is unavailable.");
  if (!ANON_KEY) throw new Error("Supabase authentication is not configured.");
  const lastSentAt = caller.last_password_reset_sent_at
    ? new Date(caller.last_password_reset_sent_at).getTime()
    : 0;
  if (lastSentAt > Date.now() - 10 * 60 * 1000) return { sent: false, reason: "cooldown" };

  const profiles = await supabaseJson(`profiles?select=email&id=eq.${encodeURIComponent(caller.user_id)}&limit=1`);
  const email = String(Array.isArray(profiles) ? profiles[0]?.email || "" : "").trim().toLowerCase();
  if (!email) throw new Error("No recovery email is available for this account.");

  const redirectTo = String(
    process.env.PASSWORD_RESET_REDIRECT_URL || "https://www.n3xra.com/account/?mode=recovery",
  ).trim();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.msg || data?.message || data?.error_description || "Unable to send password reset email."));

  caller.last_password_reset_sent_at = new Date().toISOString();
  await supabaseJson(`account_phone_credentials?user_id=eq.${encodeURIComponent(caller.user_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_password_reset_sent_at: caller.last_password_reset_sent_at }),
  });
  return { sent: true };
}

async function saveCredential(userId, phone, pin) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) throw new Error("Enter a valid phone number including area code.");
  const { salt, hash } = await hashPin(pin);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/account_phone_credentials?on_conflict=user_id`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      user_id: userId,
      phone_e164: phoneE164,
      pin_salt: salt,
      pin_hash: hash,
      failed_attempts: 0,
      locked_until: null,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409 || String(data?.code) === "23505") {
      throw new Error("That phone number is already connected to another N3XRA account.");
    }
    throw new Error(String(data?.message || data?.error || "Unable to save phone access."));
  }
  return Array.isArray(data) ? data[0] || null : data;
}

async function verifyCallerPin(caller, pin) {
  if (!caller?.user_id) return { ok: false, reason: "unrecognized" };
  const lockedUntil = caller.locked_until ? new Date(caller.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) return { ok: false, reason: "locked" };
  const ok = await matchesPin(pin, caller.pin_salt, caller.pin_hash);
  if (ok) {
    await supabaseJson(`account_phone_credentials?user_id=eq.${encodeURIComponent(caller.user_id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ failed_attempts: 0, locked_until: null, last_authenticated_at: new Date().toISOString() }),
    });
    return { ok: true };
  }
  const attempts = Number(caller.failed_attempts || 0) + 1;
  caller.failed_attempts = attempts;
  const locked = attempts >= 5;
  caller.locked_until = locked ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await supabaseJson(`account_phone_credentials?user_id=eq.${encodeURIComponent(caller.user_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ failed_attempts: attempts, locked_until: caller.locked_until }),
  });
  return { ok: false, reason: locked ? "locked" : "invalid" };
}

async function accountOverview(userId) {
  const [profiles, memberships, music, virals] = await Promise.all([
    supabaseJson(`profiles?select=subscription_tier,account_status&id=eq.${encodeURIComponent(userId)}&limit=1`),
    supabaseJson(`organization_memberships?select=role,organization:organizations(name,subscription_tier,account_status)&user_id=eq.${encodeURIComponent(userId)}`),
    supabaseJson(`music_profiles?select=plan,account_status,songs_used,monthly_song_limit&user_id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []),
    supabaseJson(`virals_profiles?select=plan,account_status,analyses_used,monthly_analysis_limit&user_id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []),
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  const parts = [`Your NEXRA account is ${profile?.account_status || "active"} on the ${profile?.subscription_tier || "free"} plan.`];
  const org = Array.isArray(memberships) ? memberships[0]?.organization : null;
  const organization = Array.isArray(org) ? org[0] : org;
  if (organization) parts.push(`Records is ${organization.account_status || "active"} on the ${organization.subscription_tier || "free"} plan.`);
  if (music?.[0]) parts.push(`AI Music is ${music[0].account_status || "active"} on the ${music[0].plan || "free"} plan, with ${Number(music[0].songs_used || 0)} of ${Number(music[0].monthly_song_limit || 0)} songs used.`);
  if (virals?.[0]) parts.push(`NEXRA Virals is ${virals[0].account_status || "active"} on the ${virals[0].plan || "free"} plan, with ${Number(virals[0].analyses_used || 0)} of ${Number(virals[0].monthly_analysis_limit || 0)} analyses used.`);
  parts.push("For private files or account changes, please use your signed-in dashboard.");
  return parts.join(" ");
}

module.exports = {
  accountOverview,
  authenticatedUser,
  getCallerAccount,
  getCredentialByUser,
  hashPin,
  matchesPin,
  normalizePhone,
  saveCredential,
  sendPasswordResetEmail,
  validPin,
  verifyCallerPin,
};
