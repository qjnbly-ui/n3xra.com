const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function serviceHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}

async function json(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Supabase request failed."));
  return data;
}

async function requireFullAdmin(req) {
  const token = bearer(req);
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) return null;
  const rows = await json(
    `platform_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,admin)&access_scope=eq.full&limit=1`,
    { headers: serviceHeaders() },
  );
  return rows?.length ? user : null;
}

function text(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function nullableDate(value) {
  const cleaned = text(value, 10);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) throw new Error("Use a valid contract date.");
  return cleaned;
}

function normalizeTerms(body, adminId, revision) {
  const commissionType = text(body.commission_type, 20);
  if (!["percentage", "fixed", "custom"].includes(commissionType)) throw new Error("Choose a valid commission type.");
  const status = text(body.status, 20);
  if (!["draft", "active"].includes(status)) throw new Error("Choose draft or active contract status.");
  const rateBps = commissionType === "percentage" ? Number(body.commission_rate_bps) : null;
  const amountCents = commissionType === "fixed" ? Number(body.commission_amount_cents) : null;
  if (commissionType === "percentage" && (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000)) throw new Error("Percentage commission must be between 0% and 100%.");
  if (commissionType === "fixed" && (!Number.isInteger(amountCents) || amountCents < 0)) throw new Error("Fixed commission must be a valid non-negative amount.");
  const effectiveAt = nullableDate(body.effective_at);
  const expiresAt = nullableDate(body.expires_at);
  if (effectiveAt && expiresAt && expiresAt < effectiveAt) throw new Error("The contract expiration cannot be before its effective date.");
  const contractBody = text(body.contract_body, 50000);
  if (status === "active" && contractBody.length < 20) throw new Error("Add the custom contract terms before activating this agreement.");
  return {
    status,
    commission_type: commissionType,
    commission_rate_bps: rateBps,
    commission_amount_cents: amountCents,
    currency: text(body.currency || "USD", 3).toUpperCase(),
    commission_description: text(body.commission_description, 2000),
    contract_title: text(body.contract_title || "N3XRA Partner Agreement", 240),
    contract_body: contractBody,
    effective_at: effectiveAt,
    expires_at: expiresAt,
    revision,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SERVICE_KEY) return res.status(503).json({ error: "Partner administration is not configured." });
  try {
    const admin = await requireFullAdmin(req);
    if (!admin) return res.status(403).json({ error: "Full platform administrator access is required." });
    const applicationId = String(req.query?.id || req.body?.partner_application_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return res.status(400).json({ error: "A valid partner application is required." });
    const path = `partner_terms?partner_application_id=eq.${encodeURIComponent(applicationId)}`;
    const existing = (await json(`${path}&select=*`, { headers: serviceHeaders() }))?.[0] || null;
    if (req.method === "GET") return res.status(200).json({ ok: true, terms: existing });
    const terms = normalizeTerms(req.body || {}, admin.id, Number(existing?.revision || 0) + 1);
    const options = existing
      ? { method: "PATCH", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify(terms) }
      : { method: "POST", headers: serviceHeaders({ Prefer: "return=representation" }), body: JSON.stringify({ partner_application_id: applicationId, ...terms, created_by: admin.id }) };
    const saved = await json(existing ? path : "partner_terms", options);
    return res.status(200).json({ ok: true, terms: saved?.[0] || null });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save partner terms." });
  }
}

export { normalizeTerms };
