const { serviceRequest } = require("./_website-proposal-ai-supabase");
const { loadArchivedRows, queryAnalytics } = require("./_client-analytics-archive");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function disabled(res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ enabled: false });
}

async function publicValue(settings, connection) {
  if (settings.metric === "daily_visitors") {
    const date = today();
    const rows = await queryAnalytics(connection, "visits", "day", { since: date, until: date }, 1);
    return rows.reduce((sum, row) => sum + number(row?.visitors), 0);
  }

  const valueField = settings.metric === "all_time_visitors" ? "visitors" : "pageviews";
  const archived = await loadArchivedRows(settings.website_id);
  const latestArchivedDate = String(archived.at(-1)?.metric_date || "");
  const archivedTotal = archived.reduce((sum, row) => sum + number(row?.[valueField]), 0);
  const date = today();
  const recentSince = latestArchivedDate && latestArchivedDate < date ? latestArchivedDate : date;
  let recent = [];
  try {
    recent = await queryAnalytics(connection, "visits", "day", { since: recentSince, until: date }, 32);
  } catch (error) {
    if (!archived.length) throw error;
  }
  const liveTotal = recent
    .filter((row) => String(row?.timestamp || row?.date || "").slice(0, 10) > latestArchivedDate)
    .reduce((sum, row) => sum + number(row?.[valueField]), 0);
  return archivedTotal + liveTotal;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const key = String(req.query?.key || "").trim();
    if (!UUID_PATTERN.test(key)) return disabled(res);
    const settings = one(await serviceRequest(
      `website_public_traffic_counters?select=website_id,enabled,metric,label,updated_at&public_key=eq.${encodeURIComponent(key)}&enabled=eq.true&limit=1`,
    ));
    if (!settings) return disabled(res);
    const connection = one(await serviceRequest(
      `website_analytics_connections?select=website_id,project_id,team_id,status,archive_last_synced_at&website_id=eq.${encodeURIComponent(settings.website_id)}&status=eq.active&limit=1`,
    ));
    if (!connection) return disabled(res);
    const value = await publicValue(settings, connection);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).json({
      enabled: true,
      metric: settings.metric,
      label: settings.label,
      value,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return disabled(res);
  }
};

module.exports.publicValue = publicValue;
