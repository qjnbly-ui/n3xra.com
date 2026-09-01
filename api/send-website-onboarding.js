const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function headers() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!SUPABASE_ANON_KEY || !SERVICE_KEY || !process.env.RESEND_API_KEY) return res.status(500).json({ error: "Project-details email service is not configured." });
  try {
    const token = bearer(req);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json();
    if (!userResponse.ok || !user?.id) return res.status(401).json({ error: "Authentication required." });
    const admin = await one("platform_admins", `select=user_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active`);
    if (!admin) return res.status(403).json({ error: "Website administration access is required." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const onboardingId = String(body.onboardingId || "").trim();
    const onboarding = await one("website_onboardings", `select=id,project_id,client_user_id,status&id=eq.${encodeURIComponent(onboardingId)}`);
    if (!onboarding) return res.status(404).json({ error: "Project details form not found." });
    const project = await one("website_projects", `select=id,name,managed_website_id&id=eq.${encodeURIComponent(onboarding.project_id)}`);
    if (!project?.managed_website_id) return res.status(400).json({ error: "This form is not connected to a managed website." });
    const website = await one("client_websites", `select=id,name,portal_slug,slug&id=eq.${encodeURIComponent(project.managed_website_id)}`);
    const authUser = await json(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(onboarding.client_user_id)}`, { headers: headers() });
    const recipient = String(authUser?.email || "").trim().toLowerCase();
    if (!recipient) return res.status(400).json({ error: "The project owner does not have an email address." });
    const recipientName = String(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || recipient).trim();
    const firstName = recipientName.split(/\s+/)[0] || recipientName;
    const slug = String(website?.portal_slug || website?.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "This website does not have a client portal address." });
    const formUrl = `https://${slug}.portal.n3xra.com/website-onboarding/?onboarding=${encodeURIComponent(onboarding.id)}`;
    const projectName = project.name || website?.name || "your website project";
    const html = `<div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.65;"><div style="max-width:620px;margin:auto;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 24px 60px rgba(12,18,28,.12);"><div style="padding:30px;background:linear-gradient(135deg,#07111d,#123047);color:#fff;"><p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#a9e9ff;">N3XRA · Project details</p><h1 style="margin:0;font-size:30px;line-height:1.15;">A few details will help move your website forward.</h1></div><div style="padding:32px;"><p>Hi ${escapeHtml(firstName)},</p><p>N3XRA opened a secure project-details form for <strong>${escapeHtml(projectName)}</strong>. Add what you know and save as you go. Your answers and files stay connected to this project.</p><p style="margin:26px 0;"><a href="${formUrl}" style="display:inline-block;padding:14px 20px;border-radius:9px;background:#09111a;color:#fff;font-weight:700;text-decoration:none;">Open project details</a></p><p style="color:#475569;">If no additional information is needed, you can ignore this message.<br><strong>N3XRA</strong></p></div></div></div>`;
    const text = `Hi ${firstName},\n\nN3XRA opened a secure project-details form for ${projectName}. Add what you know and save as you go. Your answers and files stay connected to this project.\n\nOpen project details: ${formUrl}\n\nIf no additional information is needed, you can ignore this message.\nN3XRA`;
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.PROPOSAL_FROM_EMAIL || "N3XRA <noreply@n3xra.com>",
        to: [recipient],
        reply_to: process.env.PROPOSAL_REPLY_TO || "quentin@n3xra.com",
        subject: `Project details requested — ${projectName}`,
        html,
        text,
      }),
    });
    const emailResult = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) throw new Error(emailResult.message || "Unable to send the project-details email.");
    return res.status(200).json({ ok: true, recipient, formUrl, messageId: emailResult.id || null });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unable to send the project-details form." });
  }
}
