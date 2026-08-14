const crypto = require("crypto");
const { normalizePhone } = require("./_account-phone");

const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || "",
).replace(/\/+$/, "");
const SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "",
).trim();

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

function normalizeKeyword(value) {
  return clean(value, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function requestIp(req) {
  return clean(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "unknown", 200)
    .split(",")[0]
    .trim();
}

function hashRequestIp(req) {
  const secret = String(
    process.env.COMMUNICATIONS_HASH_SECRET || "",
  ).trim();
  if (!secret) throw new Error("Communications request hashing is not configured.");
  return crypto.createHmac("sha256", secret).update(requestIp(req)).digest("hex");
}

function serviceHeaders(extra = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Communications database access is not configured.");
  const credentials = SERVICE_KEY.startsWith("sb_secret_")
    ? { apikey: SERVICE_KEY }
    : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  return {
    ...credentials,
    ...extra,
  };
}

async function supabaseJson(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const error = new Error(String(data?.message || data?.error || "Communications database request failed."));
    error.status = response.status;
    throw error;
  }
  return data;
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function authenticatedUser(req) {
  const authorization = clean(req?.headers?.authorization, 3000);
  if (!authorization.toLowerCase().startsWith("bearer ") || !SERVICE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: authorization },
  });
  if (!response.ok) return null;
  return response.json();
}

function normalizedUrl(value) {
  try {
    const url = new URL(clean(value, 500));
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "") || "/"}`.toLowerCase();
  } catch {
    return "";
  }
}

async function resolveRequesterOwnership(req, websiteUrl) {
  const user = await authenticatedUser(req);
  if (!user?.id) return { requesterUserId: null, organizationId: null, websiteId: null };
  const memberships = await supabaseJson(
    `organization_memberships?select=organization_id&user_id=eq.${encodeURIComponent(user.id)}&limit=3`,
  );
  const organizationId = memberships.length === 1 ? memberships[0].organization_id : null;
  if (!organizationId) return { requesterUserId: user.id, organizationId: null, websiteId: null };

  const websiteMemberships = await supabaseJson(
    `website_members?select=website_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&limit=100`,
  );
  const websiteIds = websiteMemberships.map((item) => item.website_id).filter(Boolean);
  if (!websiteIds.length) return { requesterUserId: user.id, organizationId, websiteId: null };
  const websites = await supabaseJson(
    `client_websites?select=id,organization_id,live_url&id=in.(${websiteIds.map(encodeURIComponent).join(",")})`,
  );
  const requestedUrl = normalizedUrl(websiteUrl);
  const matches = websites.filter((website) => (
    website.organization_id === organizationId && normalizedUrl(website.live_url) === requestedUrl
  ));
  return {
    requesterUserId: user.id,
    organizationId,
    websiteId: matches.length === 1 ? matches[0].id : null,
  };
}

async function loadPublicWorkspace(slug) {
  const normalizedSlug = clean(slug, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) return null;
  const workspace = firstRow(await supabaseJson(
    `communications_workspaces?select=id,slug,program_name,sender_name,website_url,privacy_policy_url,program_terms_url,support_email,support_phone,expected_message_frequency,status&slug=eq.${encodeURIComponent(normalizedSlug)}&status=eq.active&limit=1`,
  ));
  if (!workspace) return null;
  const form = firstRow(await supabaseJson(
    `website_forms?select=id,public_id,name,success_message,allowed_origins,active_consent_configuration&communications_workspace_id=eq.${encodeURIComponent(workspace.id)}&form_type=eq.subscription&status=eq.active&limit=1`,
  ));
  if (!form) return null;
  const [fields, channels, topics, numbers] = await Promise.all([
    supabaseJson(`website_form_fields?select=field_key,field_type,label,placeholder,required,sort_order,choices,validation_configuration&form_id=eq.${encodeURIComponent(form.id)}&order=sort_order.asc`),
    supabaseJson(`communications_channels?select=channel,status&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=channel.asc`),
    supabaseJson(`communications_topics?select=id,slug,name,description,sort_order&workspace_id=eq.${encodeURIComponent(workspace.id)}&active=eq.true&order=sort_order.asc,name.asc`),
    supabaseJson(`communications_numbers?select=phone_e164,status,carrier_registration_status,texting_activated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&order=created_at.asc&limit=1`),
  ]);
  return {
    workspace,
    form,
    fields: Array.isArray(fields) ? fields : [],
    channels: Array.isArray(channels) ? channels : [],
    topics: Array.isArray(topics) ? topics : [],
    number: firstRow(numbers),
  };
}

async function loadSignupSource(formId, token) {
  const normalizedToken = clean(token, 200);
  if (!normalizedToken) return null;
  return firstRow(await supabaseJson(
    `communications_signup_sources?select=id,form_id,workspace_id,source_type,public_token,status&form_id=eq.${encodeURIComponent(formId)}&public_token=eq.${encodeURIComponent(normalizedToken)}&status=eq.active&limit=1`,
  ));
}

async function loadSourceByType(formId, sourceType) {
  return firstRow(await supabaseJson(
    `communications_signup_sources?select=id,public_token,source_type&form_id=eq.${encodeURIComponent(formId)}&source_type=eq.${encodeURIComponent(sourceType)}&status=eq.active&order=created_at.asc&limit=1`,
  ));
}

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

module.exports = {
  SUPABASE_URL,
  authenticatedUser,
  clean,
  firstRow,
  hashRequestIp,
  loadPublicWorkspace,
  loadSignupSource,
  loadSourceByType,
  normalizeEmail,
  normalizeKeyword,
  normalizePhone,
  resolveRequesterOwnership,
  sendJson,
  supabaseJson,
};
