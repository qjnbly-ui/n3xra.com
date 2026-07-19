const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const DASHBOARD_URL = "https://www.n3xra.com/account";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function headers(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `Request failed (${response.status}).`);
  return data;
}

async function one(table, query) {
  const rows = await json(`${SUPABASE_URL}/rest/v1/${table}?${query}&limit=1`, { headers: headers() });
  return rows?.[0] || null;
}

function itemRows(items) {
  return items.map((item) => {
    const amount = money(Math.round(Number(item.quantity) * item.unit_amount_cents));
    const suffix = item.billing_type === "recurring" ? ` / ${item.recurring_interval}` : "";
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(item.name)}</strong>${item.description ? `<br><span style="font-size:13px;color:#64748b;">${escapeHtml(item.description)}</span>` : ""}</td><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">${amount}${suffix}</td></tr>`;
  }).join("");
}

function buildHtml(payload) {
  const firstName = payload.request.contact_name.split(/\s+/)[0] || payload.request.contact_name;
  const oneTime = payload.items.filter((item) => item.billing_type === "one_time");
  const recurring = payload.items.filter((item) => item.billing_type === "recurring");
  return `<div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.65;">
    <div style="max-width:640px;margin:auto;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 24px 60px rgba(12,18,28,.12);">
      <div style="padding:32px;background:linear-gradient(135deg,#07111d,#123047);color:#fff;">
        <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#a9e9ff;">N3XRA · Website proposal</p>
        <h1 style="margin:0;font-size:32px;line-height:1.15;">Your proposal is ready.</h1>
      </div>
      <div style="padding:32px;">
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>We’ve put together the proposal for <strong>${escapeHtml(payload.proposal.title)}</strong>. It includes the project scope, schedule, investment, and terms for you to review in your secure dashboard.</p>
        <div style="margin:24px 0;padding:18px;border:1px solid #dbe4ec;border-radius:12px;background:#f8fafc;"><strong>Project at a glance</strong><p style="margin:8px 0;">${escapeHtml(payload.version.project_objective)}</p><p style="margin:8px 0 0;"><strong>Timeline:</strong> ${escapeHtml(payload.version.timeline)}</p></div>
        ${oneTime.length ? `<h2 style="margin:28px 0 6px;font-size:19px;">Project investment</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(oneTime)}${payload.version.discount_cents ? `<tr><td style="padding:12px 0;">Discount</td><td style="padding:12px 0;text-align:right;font-weight:700;">−${money(payload.version.discount_cents)}</td></tr>` : ""}<tr><td style="padding:14px 0;font-size:17px;font-weight:700;">Total</td><td style="padding:14px 0;text-align:right;font-size:17px;font-weight:700;">${money(payload.version.total_cents)}</td></tr></table>` : ""}
        ${recurring.length ? `<h2 style="margin:28px 0 6px;font-size:19px;">Ongoing services</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(recurring)}</table>` : ""}
        <div style="margin:24px 0;padding:16px;border:1px solid #bae6fd;border-radius:12px;background:#f0f9ff;color:#0c4a6e;"><strong>This is a proposal, not a bill.</strong><br>No payment is due from this email. After you approve the proposal, the applicable contract and billing steps will be prepared separately.</div>
        <p style="margin-top:28px;">When you’re ready, open your dashboard to read the complete proposal and respond.</p>
        <p style="margin:26px 0;"><a href="${DASHBOARD_URL}" style="display:inline-block;padding:14px 20px;border-radius:9px;background:#09111a;color:#fff;font-weight:700;text-decoration:none;">Review proposal in your dashboard</a></p>
        <p style="color:#475569;">We’re excited about the opportunity to help bring this project to life.<br><strong>N3XRA</strong></p>
      </div>
    </div>
  </div>`;
}

function buildText(payload) {
  const items = payload.items.map((item) => `- ${item.name}: ${money(Math.round(Number(item.quantity) * item.unit_amount_cents))}${item.billing_type === "recurring" ? ` / ${item.recurring_interval}` : ""}`);
  return [`Hi ${payload.request.contact_name.split(/\s+/)[0]},`, "", `Your proposal for ${payload.proposal.title} is ready.`, "", ...items, "", "This is a proposal, not a bill. No payment is due from this email. After approval, the applicable contract and billing steps will be prepared separately.", "", `Review the complete proposal: ${DASHBOARD_URL}`, "", "We’re excited to help bring this project to life.", "N3XRA"].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!SUPABASE_ANON_KEY || !SERVICE_KEY || !process.env.RESEND_API_KEY) return res.status(500).json({ error: "Proposal email service is not configured." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const token = bearer(req);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json();
    if (!userResponse.ok || !user?.id) return res.status(401).json({ error: "Authentication required." });
    const admin = await one("platform_admins", `select=user_id&user_id=eq.${encodeURIComponent(user.id)}`);
    if (!admin) return res.status(403).json({ error: "Proposal administration access is required." });

    const proposalId = String(body.proposalId || "");
    const versionId = String(body.versionId || "");
    const proposal = await one("website_proposals", `select=*&id=eq.${encodeURIComponent(proposalId)}`);
    const version = await one("website_proposal_versions", `select=*&id=eq.${encodeURIComponent(versionId)}&proposal_id=eq.${encodeURIComponent(proposalId)}`);
    if (!proposal || !version || proposal.status !== "sent" || proposal.current_version_id !== version.id) return res.status(409).json({ error: "Publish this proposal version before emailing it." });
    const request = await one("website_service_requests", `select=id,contact_name,contact_email,business_name&id=eq.${encodeURIComponent(proposal.request_id)}`);
    if (!request?.contact_email) return res.status(400).json({ error: "The client request does not have an email address." });
    const items = await json(`${SUPABASE_URL}/rest/v1/website_proposal_line_items?select=*&version_id=eq.${encodeURIComponent(version.id)}&order=sort_order.asc`, { headers: headers() });
    const payload = { proposal, version, request, items: items || [] };
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.PROPOSAL_FROM_EMAIL || "N3XRA <noreply@n3xra.com>",
        to: [request.contact_email],
        reply_to: process.env.PROPOSAL_REPLY_TO || "quentin@n3xra.com",
        subject: `Your N3XRA proposal is ready — ${proposal.title}`,
        html: buildHtml(payload),
        text: buildText(payload),
      }),
    });
    const emailResult = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) throw new Error(emailResult.message || "Unable to send the proposal email.");
    await json(`${SUPABASE_URL}/rest/v1/website_proposals?id=eq.${encodeURIComponent(proposal.id)}`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ email_sent_at: new Date().toISOString(), email_recipient: request.contact_email, email_message_id: emailResult.id || null }),
    });
    return res.status(200).json({ ok: true, recipient: request.contact_email });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unable to send the proposal email." });
  }
}
