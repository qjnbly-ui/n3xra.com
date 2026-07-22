const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}
function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
async function supabaseJson(path, key = SERVICE_KEY) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || "Unable to load Records account.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    if (!SERVICE_KEY || !ANON_KEY || !process.env.RESEND_API_KEY) throw new Error("Emergency notice service is not configured.");
    const token = bearer(req);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => ({}));
    if (!userResponse.ok || !user?.id) return res.status(401).json({ error: "Authentication required." });
    const admins = await supabaseJson(`platform_admins?select=role,status&user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&status=eq.active&limit=1`);
    if (!admins.length && String(user.email || "").toLowerCase() !== "quentin@n3xra.com") return res.status(403).json({ error: "Platform owner access required." });
    const organizationId = String(req.body?.organizationId || "").trim();
    const emergencyAccessId = String(req.body?.emergencyAccessId || "").trim();
    const reason = String(req.body?.reason || "").trim().slice(0, 1000);
    if (!organizationId || !emergencyAccessId || reason.length < 20) return res.status(400).json({ error: "Emergency access, organization, and detailed reason are required." });
    const emergencies = await supabaseJson(`records_emergency_access?select=id&id=eq.${encodeURIComponent(emergencyAccessId)}&organization_id=eq.${encodeURIComponent(organizationId)}&admin_user_id=eq.${encodeURIComponent(user.id)}&ended_at=is.null&limit=1`);
    if (!emergencies.length) return res.status(404).json({ error: "Active emergency access was not found." });
    const organizations = await supabaseJson(`organizations?select=id,name,owner_user_id&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
    const organization = organizations[0];
    if (!organization) return res.status(404).json({ error: "Records organization not found." });
    const profiles = await supabaseJson(`profiles?select=email,full_name&id=eq.${encodeURIComponent(organization.owner_user_id)}&limit=1`);
    const owner = profiles[0];
    if (!owner?.email) return res.status(409).json({ error: "The account owner has no email address. End emergency access and contact the customer before trying again." });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "N3XRA Security <notifications@n3xra.com>",
        to: [owner.email],
        subject: `Emergency support access opened for ${organization.name}`,
        text: `N3XRA emergency support access was opened for ${organization.name}.\n\nReason: ${reason}\n\nAccess expires automatically after one hour. This event is permanently recorded in your Records support audit history.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#101722"><h1>Emergency support access opened</h1><p>N3XRA emergency support access was opened for <strong>${escapeHtml(organization.name)}</strong>.</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p><p>Access expires automatically after one hour. This event is permanently recorded in your Records support audit history.</p><p><a href="https://www.n3xra.com/n3xra-records/account/">Review your account</a></p></div>`,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || "Unable to send customer notice.");
    const markNotified = await fetch(`${SUPABASE_URL}/rest/v1/records_emergency_access?id=eq.${encodeURIComponent(emergencyAccessId)}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ customer_notified_at: new Date().toISOString() }),
    });
    if (!markNotified.ok) throw new Error("Customer notice sent, but its delivery timestamp could not be recorded.");
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unable to send emergency access notice." });
  }
}
