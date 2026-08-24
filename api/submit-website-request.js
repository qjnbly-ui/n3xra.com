const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const WEBSITE_REQUEST_NOTIFY_TO = String(process.env.WEBSITE_REQUEST_NOTIFY_TO || "quentin@n3xra.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const { createAdminNotification } = require("./_admin-notifications");

function clean(value, limit = 1600) {
  return String(value || "").trim().slice(0, limit);
}

function cleanList(value) {
  return Array.isArray(value) ? value.map((item) => clean(item, 120)).filter(Boolean).slice(0, 40) : [];
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

async function getUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await response.json().catch(() => ({}));
  return response.ok && user?.id ? user : null;
}

function normalizePayload(input, user) {
  const projectTypes = new Set(["new_website", "redesign", "landing_page", "ecommerce", "maintenance", "other"]);
  const plans = new Set(["starter", "starter_plus", "advanced"]);
  const projectType = clean(input.project_type, 40);
  const servicePlan = clean(input.service_plan, 40);
  return {
    user_id: user.id,
    contact_name: clean(input.contact_name, 160),
    business_name: clean(input.business_name, 200),
    contact_email: clean(user.email || input.contact_email, 320).toLowerCase(),
    contact_phone: clean(input.contact_phone, 80) || null,
    project_type: projectTypes.has(projectType) ? projectType : "other",
    existing_website_url: clean(input.existing_website_url, 1000) || null,
    primary_goal: clean(input.primary_goal, 3000),
    audience: clean(input.audience, 2000) || null,
    requested_pages: cleanList(input.requested_pages),
    requested_features: cleanList(input.requested_features),
    service_plan: plans.has(servicePlan) ? servicePlan : null,
    service_plan_auto_applied: input.service_plan_auto_applied === true,
    service_plan_reason: clean(input.service_plan_reason, 1000) || null,
    budget_range: clean(input.budget_range, 80) || null,
    target_launch_date: clean(input.target_launch_date, 40) || null,
    referral_code: clean(input.referral_code, 24).toUpperCase() || null,
    offer_code: clean(input.offer_code, 24).toUpperCase() || null,
    additional_notes: clean(input.additional_notes, 4000) || null,
    ai_review_id: clean(input.ai_review_id, 80) || null,
    status: "submitted",
  };
}

function requestEmail(request) {
  const actionUrl = `https://www.n3xra.com/n3xra-admin/requests/?request=${encodeURIComponent(request.id)}`;
  const text = [
    "New N3XRA website request",
    "",
    `${request.business_name} submitted a website request.`,
    `Contact: ${request.contact_name}`,
    `Email: ${request.contact_email}`,
    `Phone: ${request.contact_phone || "Not provided"}`,
    `Project: ${request.project_type.replaceAll("_", " ")}`,
    `Plan: ${request.service_plan || "Not specified"}`,
    "",
    `Goal: ${request.primary_goal}`,
    "",
    `Open and process the request: ${actionUrl}`,
  ].join("\n");
  const html = `<div style="margin:0;padding:32px 16px;background:#edf3f5;font-family:Arial,sans-serif;color:#0b1016"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #d9e1e5"><div style="padding:26px 30px;background:#07121c;color:#fff"><p style="margin:0 0 8px;color:#75d7ca;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">N3XRA Website Admin</p><h1 style="margin:0;font-size:28px">New website request</h1></div><div style="padding:28px 30px"><h2 style="margin:0 0 8px">${escapeHtml(request.business_name)}</h2><p style="margin:0 0 22px;color:#657184">${escapeHtml(request.contact_name)} · ${escapeHtml(request.contact_email)}${request.contact_phone ? ` · ${escapeHtml(request.contact_phone)}` : ""}</p><p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;color:#287a72">Primary goal</p><p style="margin:0 0 24px;line-height:1.55">${escapeHtml(request.primary_goal)}</p><a href="${actionUrl}" style="display:inline-block;padding:13px 18px;color:#fff;background:#07121c;border-radius:8px;font-weight:700;text-decoration:none">Open and process request</a></div></div></div>`;
  return { actionUrl, text, html };
}

async function sendAdminEmail(request) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey || !WEBSITE_REQUEST_NOTIFY_TO.length) throw new Error("Website request email delivery is not configured.");
  const content = requestEmail(request);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.WEBSITE_REQUEST_FROM_EMAIL || "N3XRA Website Requests <noreply@n3xra.com>",
      to: WEBSITE_REQUEST_NOTIFY_TO,
      reply_to: request.contact_email,
      subject: `New website request — ${request.business_name}`,
      html: content.html,
      text: content.text,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(data?.message || data?.error, 500) || "Request notification email failed.");
  return data;
}

async function createRecoveryNotification(payload, reason) {
  if (!payload.ai_review_id) return null;
  const query = new URLSearchParams({
    select: "id",
    event_type: "eq.websites.request_recovery.needed",
    source_table: "eq.website_request_ai_reviews",
    source_id: `eq.${payload.ai_review_id}`,
    deleted_at: "is.null",
    limit: "1",
  });
  const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications?${query}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const existing = await existingResponse.json().catch(() => []);
  if (existingResponse.ok && Array.isArray(existing) && existing.length) return existing[0];
  return createAdminNotification({
    eventType: "websites.request_recovery.needed",
    product: "websites",
    priority: "important",
    title: "Website request recovery needed",
    summary: `${payload.business_name || payload.contact_name || "A verified client"} completed intake, but the submitted request was not created.`,
    actorName: payload.contact_name,
    actorEmail: payload.contact_email,
    sourceTable: "website_request_ai_reviews",
    sourceId: payload.ai_review_id,
    actionUrl: "/n3xra-admin/requests/",
    metadata: { ai_review_id: payload.ai_review_id, submission_error: clean(reason, 800) },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Request submission is not configured." });
  const token = bearerToken(req);
  const user = token ? await getUser(token) : null;
  if (!user) return res.status(401).json({ error: "Sign in again before submitting your request." });

  const payload = normalizePayload(parseBody(req), user);
  if (!payload.contact_name || !payload.business_name || !payload.contact_email || !payload.primary_goal || !payload.service_plan) {
    await createRecoveryNotification(payload, "Required request details were missing during the verified submission handoff.").catch(() => null);
    return res.status(400).json({ error: "Complete the required request details before submitting." });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/website_service_requests?select=*`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const saveError = clean(rows?.message || rows?.error, 800) || "Unable to save the website request.";
    await createRecoveryNotification(payload, saveError).catch(() => null);
    return res.status(response.status).json({ error: saveError });
  }
  const request = Array.isArray(rows) ? rows[0] : rows;

  return res.status(201).json({ request, notification: { adminInbox: true, email: "queued" } });
};
