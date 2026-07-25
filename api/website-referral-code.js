const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const rateMap = new Map();

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
}

function limited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.started > 60000) {
    rateMap.set(ip, { started: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SERVICE_KEY) return res.status(503).json({ error: "Referral validation is temporarily unavailable." });
  if (limited(clientIp(req))) return res.status(429).json({ error: "Please wait before checking another code." });

  const code = cleanCode(req.query?.code);
  const scope = String(req.query?.scope || "website").trim().toLowerCase();
  if (code.length < 4) return res.status(200).json({ valid: false, code });

  // FREEBUILD is a public founding offer, not a partner referral. It is only
  // valid for website requests and is handled separately from partner lookup.
  if (code === "FREEBUILD") {
    return res.status(200).json({ valid: scope === "website", code, offer: "free_build" });
  }

  try {
    const params = new URLSearchParams({
      select: "id,interested_products",
      status: "eq.approved",
      referral_code: `eq.${code}`,
      limit: "1",
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/founding_partner_applications?${params}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error("Referral validation failed.");
    const application = Array.isArray(rows) ? rows[0] : null;
    const programs = Array.isArray(application?.interested_products) ? application.interested_products : [];
    return res.status(200).json({
      valid: Boolean(application && (scope === "account" || programs.includes("Website Referral Program"))),
      code,
    });
  } catch {
    return res.status(503).json({ error: "Referral validation is temporarily unavailable." });
  }
}
