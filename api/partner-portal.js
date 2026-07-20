const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function send(res, status, body) {
  res.status(status).json(body);
}

async function getUser(req) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: authorization },
  });
  return response.ok ? response.json() : null;
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || "Partner portal request failed.");
  return data;
}

async function approvedApplication(email) {
  const rows = await rest(`founding_partner_applications?select=*&email=eq.${encodeURIComponent(email.toLowerCase())}&status=eq.approved&limit=1`);
  return rows?.[0] || null;
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) return send(res, 503, { error: "Partner portal configuration is unavailable." });
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const user = await getUser(req);
    if (!user?.email) return send(res, 401, { error: "Sign in to continue." });
    const application = await approvedApplication(user.email);
    if (!application) return send(res, 403, { error: "An approved partner account is required." });

    if (req.method === "POST") {
      const action = String(req.body?.action || "");
      if (action !== "set_referral_code") return send(res, 400, { error: "Unsupported partner action." });
      const referralCode = cleanCode(req.body?.referral_code);
      if (referralCode.length < 4) return send(res, 400, { error: "Use at least four letters or numbers." });
      try {
        await rest(`founding_partner_applications?id=eq.${encodeURIComponent(application.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ referral_code: referralCode }),
        });
      } catch (error) {
        if (/duplicate|unique/i.test(error.message)) return send(res, 409, { error: "That referral code is already in use." });
        throw error;
      }
      return send(res, 200, { ok: true, referral_code: referralCode });
    }

    const [referrals, commissions] = await Promise.all([
      rest(`partner_referrals?select=*&partner_application_id=eq.${encodeURIComponent(application.id)}&order=created_at.desc`),
      rest(`partner_commission_entries?select=*&partner_application_id=eq.${encodeURIComponent(application.id)}&order=created_at.desc`),
    ]);
    const sum = (status) => (commissions || [])
      .filter((entry) => entry.status === status)
      .reduce((total, entry) => total + Number(entry.amount_cents || 0), 0);

    return send(res, 200, {
      ok: true,
      partner: {
        full_name: application.full_name,
        email: application.email,
        referral_code: application.referral_code,
        approved_at: application.approved_at || application.updated_at,
        programs: application.interested_products || [],
      },
      balances: {
        pending_cents: sum("pending"),
        available_cents: sum("available"),
        paid_cents: sum("paid"),
        currency: commissions?.[0]?.currency || "USD",
      },
      referrals: referrals || [],
      commissions: commissions || [],
    });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "Unable to open the partner portal." });
  }
}
