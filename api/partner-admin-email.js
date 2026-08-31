const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const FROM_EMAIL = String(process.env.PARTNER_FROM_EMAIL || "N3XRA <noreply@n3xra.com>").trim();
const REPLY_TO = String(process.env.PARTNER_REPLY_TO || "quentin@n3xra.com").trim();
const PORTAL_URL = "https://www.n3xra.com/client-portal/partners/";

function bearer(req) { return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
function serviceHeaders(extra = {}) { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra }; }
function clean(value, maximum) { return String(value || "").trim().slice(0, maximum); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }

async function json(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Supabase request failed."));
  return data;
}

async function requireFullAdmin(req) {
  const token = bearer(req);
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) return null;
  const rows = await json(`platform_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,admin)&access_scope=eq.full&limit=1`, { headers: serviceHeaders() });
  return rows?.length ? user : null;
}

async function applicationAndTerms(applicationId) {
  const [applications, termsRows] = await Promise.all([
    json(`founding_partner_applications?select=id,full_name,email,status,referral_code,interested_products,approved_at&id=eq.${encodeURIComponent(applicationId)}&limit=1`, { headers: serviceHeaders() }),
    json(`partner_terms?select=status,commission_type,commission_rate_bps,commission_amount_cents,currency,commission_description,contract_title,effective_at,expires_at,revision&partner_application_id=eq.${encodeURIComponent(applicationId)}&limit=1`, { headers: serviceHeaders() }).catch((error) => /partner_terms|schema cache|does not exist/i.test(error.message) ? [] : Promise.reject(error)),
  ]);
  return { application: applications?.[0] || null, terms: termsRows?.[0] || null };
}

function commissionLabel(terms) {
  if (!terms) return "Your partner-specific commission details will be included in the agreement.";
  if (terms.commission_type === "percentage") return `${Number(terms.commission_rate_bps || 0) / 100}% commission`;
  if (terms.commission_type === "fixed") return new Intl.NumberFormat("en-US", { style: "currency", currency: terms.currency || "USD" }).format(Number(terms.commission_amount_cents || 0) / 100) + " fixed commission";
  return terms.commission_description || "Custom commission terms";
}

function defaultTemplates(application, terms) {
  const firstName = clean(application.full_name, 180).split(/\s+/)[0] || "there";
  const programs = Array.isArray(application.interested_products) && application.interested_products.length
    ? application.interested_products.join(", ")
    : "your approved N3XRA partner opportunities";
  return {
    approval: {
      label: "Initial approval",
      subject: "You’re approved for N3XRA Partner Programs",
      body: `Hi ${firstName},\n\nWe’re happy to let you know that your application for N3XRA Partner Programs has been approved. Your approved opportunities currently include ${programs}.\n\nNo action is required today. Please await further details while we prepare your partner-specific commission terms, agreement, and portal access. We’ll send a separate message when the next step is ready.\n\nWe’re excited to have you partnering with N3XRA.\n\nN3XRA`,
    },
    contract_ready: {
      label: "Contract ready",
      subject: "Your N3XRA partner agreement is ready",
      body: `Hi ${firstName},\n\nYour partner agreement and commission terms are ready for review.\n\nCurrent commission arrangement: ${commissionLabel(terms)}${terms?.contract_title ? `\nAgreement: ${terms.contract_title}` : ""}${terms?.effective_at ? `\nEffective date: ${terms.effective_at}` : ""}\n\nOpen your N3XRA Partner Portal to review the current agreement and commission details:\n${PORTAL_URL}\n\nPlease reply to this email if anything needs clarification before you move forward.\n\nN3XRA`,
    },
    portal_ready: {
      label: "Portal ready",
      subject: "Your N3XRA Partner Portal is ready",
      body: `Hi ${firstName},\n\nYour N3XRA Partner Portal is ready. You can use it to review your approved programs, referral identity, current agreement, referrals, and commission activity.\n\nOpen your Partner Portal:\n${PORTAL_URL}\n\nSign in using the same email address that received this message: ${application.email}.${application.referral_code ? ` Your current referral code is ${application.referral_code}.` : " You can create your referral code from the portal."}\n\nIf you need help getting started, reply to this email.\n\nN3XRA`,
    },
    follow_up: {
      label: "Custom follow-up",
      subject: "A follow-up from N3XRA Partner Programs",
      body: `Hi ${firstName},\n\nWe’re following up regarding your N3XRA partnership.\n\n[Add your customized update or next step here.]\n\nYou can review your current partner account at any time:\n${PORTAL_URL}\n\nN3XRA`,
    },
  };
}

function buildHtml(subject, bodyText) {
  const paragraphs = bodyText.split(/\n{2,}/).map((part) => `<p style="margin:0 0 18px;white-space:pre-wrap;">${escapeHtml(part)}</p>`).join("");
  return `<div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.65;"><div style="max-width:640px;margin:auto;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 24px 60px rgba(12,18,28,.12);"><div style="padding:30px 32px;background:linear-gradient(135deg,#07111d,#123047);color:#fff;"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#a9e9ff;">N3XRA Partner Programs</p><h1 style="margin:0;font-size:28px;line-height:1.2;">${escapeHtml(subject)}</h1></div><div style="padding:32px;">${paragraphs}<p style="margin:26px 0 0;color:#64748b;font-size:12px;">This message was sent by N3XRA Partner Programs.</p></div></div></div>`;
}

async function deliveryHistory(applicationId) {
  return json(`partner_email_deliveries?select=id,stage,recipient_email,subject,body_text,status,provider_message_id,error_message,sent_at,created_at&partner_application_id=eq.${encodeURIComponent(applicationId)}&order=created_at.desc&limit=50`, { headers: serviceHeaders() }).catch((error) => /partner_email_deliveries|schema cache|does not exist/i.test(error.message) ? [] : Promise.reject(error));
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed." }); }
  if (!SERVICE_KEY) return res.status(503).json({ error: "Partner email administration is not configured." });
  try {
    const admin = await requireFullAdmin(req);
    if (!admin) return res.status(403).json({ error: "Full platform administrator access is required." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const applicationId = String(req.query?.id || body.partner_application_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return res.status(400).json({ error: "A valid partner application is required." });
    const { application, terms } = await applicationAndTerms(applicationId);
    if (!application) return res.status(404).json({ error: "Partner application not found." });
    const templates = defaultTemplates(application, terms);
    if (req.method === "GET") return res.status(200).json({ ok: true, recipient: application.email, application_status: application.status, terms_status: terms?.status || null, templates, history: await deliveryHistory(applicationId) });

    if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: "Partner email delivery is not configured." });
    if (application.status !== "approved") return res.status(409).json({ error: "Approve this partner before sending partner workflow email." });
    const stage = clean(body.stage, 30);
    if (!templates[stage]) return res.status(400).json({ error: "Choose a valid partner email stage." });
    if (stage === "contract_ready" && terms?.status !== "active") return res.status(409).json({ error: "Activate the partner contract before sending the contract-ready email." });
    const subject = clean(body.subject, 240);
    const bodyText = clean(body.body_text, 20000);
    if (!subject || !bodyText) return res.status(400).json({ error: "Add an email subject and message." });
    const idempotencyKey = String(body.idempotency_key || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return res.status(400).json({ error: "A valid delivery key is required." });
    const existing = (await json(`partner_email_deliveries?select=*&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`, { headers: serviceHeaders() }))?.[0] || null;
    if (existing?.status === "sent") return res.status(200).json({ ok: true, already_sent: true, delivery: existing });
    if (!existing) await json("partner_email_deliveries", { method: "POST", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ partner_application_id: applicationId, stage, recipient_email: application.email, subject, body_text: bodyText, idempotency_key: idempotencyKey, sent_by: admin.id }) });

    let emailResponse;
    try {
      emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `partner/${idempotencyKey}` },
        body: JSON.stringify({ from: FROM_EMAIL, to: [application.email], reply_to: REPLY_TO, subject, text: bodyText, html: buildHtml(subject, bodyText) }),
      });
    } catch (error) {
      const message = clean(error instanceof Error ? error.message : "Email provider could not be reached.", 2000);
      await json(`partner_email_deliveries?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`, { method: "PATCH", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "failed", error_message: message }) });
      return res.status(502).json({ error: message });
    }
    const emailResult = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) {
      await json(`partner_email_deliveries?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`, { method: "PATCH", headers: serviceHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "failed", error_message: clean(emailResult.message || "Email provider rejected the message.", 2000) }) });
      return res.status(502).json({ error: emailResult.message || "Unable to send partner email." });
    }
    const saved = await json(`partner_email_deliveries?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`, { method: "PATCH", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify({ status: "sent", provider_message_id: emailResult.id, sent_at: new Date().toISOString(), error_message: null }) });
    return res.status(200).json({ ok: true, delivery: saved?.[0] || null });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to manage partner email." });
  }
}

export { buildHtml, defaultTemplates };
