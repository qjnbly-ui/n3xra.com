const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ""
).trim();
const {
  getClientUsageSummary,
  prepareRecordsAiUsage,
  sendRecordsAiUsageError,
} = require("./_records-ai-usage");

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase auth config.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error("Invalid session.");
  return data;
}

function getOrganizationId(req) {
  const direct = req.query && typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  if (direct) return direct.trim();
  const url = new URL(req.url || "/", `https://${req.headers.host || "n3xra.com"}`);
  return String(url.searchParams.get("organizationId") || "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let user = null;
  try {
    user = await verifyUser(getBearerToken(req));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  try {
    const organizationId = getOrganizationId(req);
    const usageContext = await prepareRecordsAiUsage({
      organizationId,
      user,
      enforceLimit: false,
      allowPlatformAdmin: true,
    });

    return res.status(200).json({
      usage: getClientUsageSummary(usageContext.usage),
    });
  } catch (error) {
    if (sendRecordsAiUsageError(res, error, "Unable to load Records AI usage.")) return;
    return res.status(500).json({ error: "Server error." });
  }
};
