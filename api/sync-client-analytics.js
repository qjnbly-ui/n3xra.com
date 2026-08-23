const { serviceRequest } = require("./_website-proposal-ai-supabase");
const { syncAnalyticsConnection } = require("./_client-analytics-archive");

async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const cronSecret = String(process.env.CRON_SECRET || "");
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const [connections, features, publicCounters] = await Promise.all([
      serviceRequest("website_analytics_connections?select=website_id,project_id,project_name,team_id,status,archive_status&status=eq.active&limit=1000"),
      serviceRequest("website_portal_features?select=website_id&feature_key=eq.analytics&enabled=eq.true&limit=1000"),
      serviceRequest("website_public_traffic_counters?select=website_id&enabled=eq.true&limit=1000"),
    ]);
    const enabledWebsiteIds = new Set([
      ...(features || []).map((row) => row.website_id),
      ...(publicCounters || []).map((row) => row.website_id),
    ]);
    const eligible = (connections || []).filter((connection) => enabledWebsiteIds.has(connection.website_id));
    const results = [];
    for (const connection of eligible) {
      try {
        results.push({ websiteId: connection.website_id, ok: true, ...(await syncAnalyticsConnection(connection)) });
      } catch (error) {
        results.push({ websiteId: connection.website_id, ok: false, error: error?.message || "Sync failed." });
      }
    }
    return res.status(200).json({ processed: results.length, succeeded: results.filter((item) => item.ok).length, results });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Client analytics synchronization failed." });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
