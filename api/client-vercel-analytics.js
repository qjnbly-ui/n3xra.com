const {
  apiError, serviceRequest, verifyAuthenticatedRequest,
} = require("./_website-proposal-ai-supabase");
const { analyticsUrl, loadArchivedRows, queryAnalytics } = require("./_client-analytics-archive");

const VERCEL_TOKEN = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();
const ALLOWED_RANGES = new Set([7, 30]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BREAKDOWNS = [
  { key: "pages", dataset: "visits", groupBy: "requestPath", limit: 8 },
  { key: "referrers", dataset: "visits", groupBy: "referrerHostname", limit: 8 },
  { key: "countries", dataset: "visits", groupBy: "country", limit: 6 },
  { key: "devices", dataset: "visits", groupBy: "deviceType", limit: 6 },
  { key: "events", dataset: "events", groupBy: "eventName", limit: 8 },
];

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(days) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since: formatDate(since), until: formatDate(until) };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function total(rows, key) {
  return rows.reduce((sum, row) => sum + number(row?.[key]), 0);
}

async function authorizeWebsite(userId, websiteId) {
  const encodedWebsite = encodeURIComponent(websiteId);
  const encodedUser = encodeURIComponent(userId);
  const [websites, memberships, admins, features, connections] = await Promise.all([
    serviceRequest(`client_websites?select=id,name,live_url,portal_enabled,status&id=eq.${encodedWebsite}&limit=1`),
    serviceRequest(`website_members?select=website_id,user_id,role,status&website_id=eq.${encodedWebsite}&user_id=eq.${encodedUser}&status=eq.active&limit=1`),
    serviceRequest(`platform_admins?select=user_id,status&user_id=eq.${encodedUser}&status=eq.active&limit=1`),
    serviceRequest(`website_portal_features?select=website_id,feature_key,enabled&website_id=eq.${encodedWebsite}&feature_key=eq.analytics&enabled=eq.true&limit=1`),
    serviceRequest(`website_analytics_connections?select=website_id,provider,project_id,project_name,team_id,status,last_verified_at,archive_status,archive_started_on,archive_last_synced_at,archive_error&website_id=eq.${encodedWebsite}&limit=1`),
  ]);
  const website = one(websites);
  if (!website) throw apiError("This website workspace no longer exists.", 404);
  if (!one(memberships) && !one(admins)) throw apiError("You do not have access to analytics for this website.", 403);
  if (!one(features)) throw apiError("Analytics has not been enabled for this website.", 403);
  const connection = one(connections);
  if (!connection || connection.status !== "active") throw apiError("Analytics is not connected for this website yet.", 503);
  return { website, connection };
}

async function reportFor(website, connection, days) {
  const cacheKey = `${website.id}:${days}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) return { ...cached.payload, cached: true };
  const range = dateRange(days);
  const trend = await queryAnalytics(connection, "visits", "day", range, days);
  const breakdowns = {};
  const availability = {};
  const warnings = [];
  for (const query of BREAKDOWNS) {
    try {
      breakdowns[query.key] = await queryAnalytics(connection, query.dataset, query.groupBy, range, query.limit);
      availability[query.key] = "available";
    } catch (error) {
      breakdowns[query.key] = [];
      availability[query.key] = "unavailable";
      warnings.push({ section: query.key, message: error?.message || "This section could not be loaded." });
    }
  }
  const pageviews = total(trend, "pageviews");
  const visitors = total(trend, "visitors");
  const payload = {
    generatedAt: new Date().toISOString(),
    cached: false,
    website: { id: website.id, name: website.name, liveUrl: website.live_url || "" },
    source: { provider: "Vercel Web Analytics", projectName: connection.project_name || "" },
    period: { days, since: range.since, until: range.until, label: `Last ${days} days` },
    totals: {
      visitors,
      pageviews,
      pagesPerVisitor: visitors ? Number((pageviews / visitors).toFixed(2)) : 0,
      events: total(breakdowns.events || [], "count"),
    },
    trend,
    breakdowns,
    availability,
    warnings,
  };
  if (!warnings.length) responseCache.set(cacheKey, { storedAt: Date.now(), payload });
  return payload;
}

function archiveTrend(rows) {
  if (rows.length <= 120) {
    return { granularity: "day", rows: rows.map((row) => ({ timestamp: row.metric_date, pageviews: number(row.pageviews), visitors: number(row.visitors) })) };
  }
  const months = new Map();
  for (const row of rows) {
    const timestamp = `${String(row.metric_date).slice(0, 7)}-01`;
    const current = months.get(timestamp) || { timestamp, pageviews: 0, visitors: 0 };
    current.pageviews += number(row.pageviews);
    current.visitors += number(row.visitors);
    months.set(timestamp, current);
  }
  return { granularity: "month", rows: [...months.values()] };
}

async function archivedReport(website, connection) {
  const archivedRows = await loadArchivedRows(website.id);
  if (!archivedRows.length) throw apiError("Permanent analytics history is being prepared. It will appear after the first synchronization finishes.", 503);
  const recent = await reportFor(website, connection, 30).catch((error) => ({
    breakdowns: {}, availability: {}, warnings: [{ section: "breakdowns", message: error?.message || "Recent audience details are temporarily unavailable." }],
  }));
  let recentEventsByDate = new Map();
  if (Array.isArray(recent.trend)) {
    try {
      const eventRows = await queryAnalytics(connection, "events", "day", dateRange(30), 30);
      recentEventsByDate = new Map(eventRows.map((row) => [String(row?.timestamp || "").slice(0, 10), number(row?.count)]));
    } catch { /* Completed event totals remain available from the permanent archive. */ }
  }
  const latestArchivedDate = String(archivedRows.at(-1)?.metric_date || "");
  const liveRows = (recent.trend || []).map((row) => ({
    metric_date: String(row?.timestamp || "").slice(0, 10),
    pageviews: number(row?.pageviews),
    visitors: number(row?.visitors),
    events: recentEventsByDate.get(String(row?.timestamp || "").slice(0, 10)) || 0,
  })).filter((row) => row.metric_date > latestArchivedDate);
  const rows = [...archivedRows, ...liveRows];
  const trend = archiveTrend(rows);
  const pageviews = total(rows, "pageviews");
  const visitors = total(rows, "visitors");
  const generatedAt = recent.generatedAt || connection.archive_last_synced_at || archivedRows.at(-1)?.synced_at || new Date().toISOString();
  return {
    generatedAt,
    cached: false,
    website: { id: website.id, name: website.name, liveUrl: website.live_url || "" },
    source: { provider: "Vercel Web Analytics + N3XRA archive", projectName: connection.project_name || "" },
    period: { days: null, since: rows[0].metric_date, until: rows.at(-1).metric_date, label: "All recorded history" },
    totals: {
      visitors,
      pageviews,
      pagesPerVisitor: visitors ? Number((pageviews / visitors).toFixed(2)) : 0,
      events: total(rows, "events"),
    },
    trend: trend.rows,
    trendGranularity: trend.granularity,
    breakdowns: recent.breakdowns,
    breakdownsPeriodLabel: "Audience details below show the latest 30 days.",
    availability: recent.availability,
    warnings: recent.warnings || [],
    archive: {
      status: connection.archive_status || "pending",
      startedOn: connection.archive_started_on || archivedRows[0].metric_date,
      lastSyncedAt: connection.archive_last_synced_at || null,
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const { user } = await verifyAuthenticatedRequest(req);
    const websiteId = String(req.query?.website_id || "").trim();
    if (!UUID_PATTERN.test(websiteId)) throw apiError("Choose a valid website.", 400);
    const requestedRange = String(req.query?.days || "30").trim().toLowerCase();
    const allTime = requestedRange === "all";
    const requestedDays = Number(requestedRange);
    const days = ALLOWED_RANGES.has(requestedDays) ? requestedDays : 30;
    if (!allTime && !VERCEL_TOKEN) throw apiError("Client analytics is not configured for this deployment.", 503);
    const { website, connection } = await authorizeWebsite(user.id, websiteId);
    const cacheKey = `${website.id}:${allTime ? "all" : days}`;
    if (String(req.query?.refresh || "") === "1") responseCache.delete(cacheKey);
    return res.status(200).json(allTime ? await archivedReport(website, connection) : await reportFor(website, connection, days));
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({ error: error?.message || "Website analytics could not be loaded." });
  }
};

module.exports.analyticsUrl = analyticsUrl;
module.exports.authorizeWebsite = authorizeWebsite;
module.exports.archivedReport = archivedReport;
module.exports.reportFor = reportFor;
