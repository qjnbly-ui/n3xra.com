const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

async function json(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Supabase request failed."));
  return data;
}

async function countRows(table, applicationId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=id&partner_application_id=eq.${encodeURIComponent(applicationId)}`,
    { method: "HEAD", headers: serviceHeaders({ Prefer: "count=exact" }) }
  );
  if (!response.ok) throw new Error(`Unable to inspect ${table}.`);
  const total = String(response.headers.get("content-range") || "").split("/").pop();
  return Number.isFinite(Number(total)) ? Number(total) : 0;
}

async function partnerActivity(applicationId) {
  const encodedId = encodeURIComponent(applicationId);
  const [referrals, commissions] = await Promise.all([
    json(`partner_referrals?select=id,referred_name,referred_email,program,status,notes,created_at,updated_at&partner_application_id=eq.${encodedId}&order=created_at.desc`, { headers: serviceHeaders() }),
    json(`partner_commission_entries?select=id,referral_id,description,amount_cents,currency,status,earned_at,paid_at,created_at,updated_at&partner_application_id=eq.${encodedId}&order=created_at.desc`, { headers: serviceHeaders() }),
  ]);
  const entries = commissions || [];
  const sum = (status) => entries
    .filter((entry) => entry.status === status)
    .reduce((total, entry) => total + Number(entry.amount_cents || 0), 0);
  return {
    referrals: referrals || [],
    commissions: entries,
    balances: {
      pending_cents: sum("pending"),
      available_cents: sum("available"),
      paid_cents: sum("paid"),
      currency: entries[0]?.currency || "USD",
    },
  };
}

async function requireAdmin(req) {
  const token = bearer(req);
  if (!token) return null;
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY || SERVICE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) return null;
  const rows = await json(
    `platform_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,admin)&access_scope=eq.full&limit=1`,
    { headers: serviceHeaders() }
  );
  return rows?.length ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SERVICE_KEY) return res.status(503).json({ error: "Partner administration is not configured." });

  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: "Platform admin access is required." });
    const applicationId = String(req.query?.id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return res.status(400).json({ error: "A valid application is required." });

    const includeDetails = String(req.query?.details || "") === "1";
    const [activity, websiteRequests, accounts] = await Promise.all([
      includeDetails
        ? partnerActivity(applicationId)
        : Promise.all([
          countRows("partner_referrals", applicationId),
          countRows("partner_commission_entries", applicationId),
        ]).then(([referrals, commissions]) => ({ referrals, commissions })),
      countRows("website_service_requests", applicationId),
      countRows("profiles", applicationId),
    ]);
    const referrals = includeDetails ? activity.referrals.length : activity.referrals;
    const commissions = includeDetails ? activity.commissions.length : activity.commissions;
    return res.status(200).json({
      ok: true,
      used: referrals + commissions + websiteRequests + accounts > 0,
      usage: { referrals, commissions, website_requests: websiteRequests, accounts },
      ...(includeDetails ? { activity } : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to inspect partner usage." });
  }
}
