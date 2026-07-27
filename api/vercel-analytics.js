const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SERVICE_ROLE_KEY
  || ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const VERCEL_TOKEN = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();
const VERCEL_PROJECT_ID = String(process.env.VERCEL_ANALYTICS_PROJECT_ID || process.env.VERCEL_PROJECT_ID || "").trim();
const VERCEL_TEAM_ID = String(process.env.VERCEL_ANALYTICS_TEAM_ID || process.env.VERCEL_TEAM_ID || "").trim();
const VERCEL_TEAM_SLUG = String(process.env.VERCEL_ANALYTICS_TEAM_SLUG || "").trim();
const CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_RANGES = new Set([7, 30]);
const responseCache = new Map();
const BREAKDOWN_QUERIES = [
  { key: "pages", dataset: "visits", groupBy: "requestPath", limit: 10 },
  { key: "referrers", dataset: "visits", groupBy: "referrerHostname", limit: 10 },
  { key: "countries", dataset: "visits", groupBy: "country", limit: 10 },
  { key: "devices", dataset: "visits", groupBy: "deviceType", limit: 10 },
  { key: "events", dataset: "events", groupBy: "eventName", limit: 10 },
];

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyUser(token) {
  if (!token) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    const error = new Error("Your session is no longer valid.");
    error.status = 401;
    throw error;
  }
  return user;
}

async function requireActivePlatformAdmin(user) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_admins?select=user_id,role,status&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || !rows.length) {
    const error = new Error("Active platform administrator access is required.");
    error.status = 403;
    throw error;
  }
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function getDateRange(days) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since: formatDate(since), until: formatDate(until) };
}

function analyticsUrl(dataset, groupBy, { since, until, limit = 12 }) {
  const url = new URL(`https://api.vercel.com/v1/query/web-analytics/${dataset}/aggregate`);
  url.searchParams.set("projectId", VERCEL_PROJECT_ID);
  if (VERCEL_TEAM_ID) url.searchParams.set("teamId", VERCEL_TEAM_ID);
  else if (VERCEL_TEAM_SLUG) url.searchParams.set("slug", VERCEL_TEAM_SLUG);
  url.searchParams.set("since", since);
  url.searchParams.set("until", until);
  url.searchParams.set("by", groupBy);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "environment eq 'production'");
  return url;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 2500);
  }

  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const resetAt = reset > 1e12 ? reset : reset * 1000;
    return Math.min(Math.max(resetAt - Date.now(), 250), 2500);
  }

  return 500;
}

async function queryAnalytics(dataset, groupBy, range, limit) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(analyticsUrl(dataset, groupBy, { ...range, limit }), {
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return Array.isArray(payload?.data) ? payload.data : [];

    if (response.status === 429 && attempt === 0) {
      await wait(retryDelay(response));
      continue;
    }

    const message = payload?.error?.message || payload?.message || "Vercel Analytics could not be loaded.";
    const error = new Error(String(message));
    error.status = response.status === 429 ? 429 : 502;
    error.upstreamStatus = response.status;
    throw error;
  }

  return [];
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function total(rows, key) {
  return rows.reduce((sum, row) => sum + numeric(row?.[key]), 0);
}

async function getAnalytics(days) {
  const cacheKey = String(days);
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const range = getDateRange(days);
  const trend = await queryAnalytics("visits", "day", range, days);
  const breakdowns = {};
  const availability = {};
  const warnings = [];

  // Vercel applies endpoint-level rate limits. Keep these requests ordered so a
  // traffic summary cannot crowd out all of the supporting dashboard panels.
  for (const query of BREAKDOWN_QUERIES) {
    try {
      breakdowns[query.key] = await queryAnalytics(query.dataset, query.groupBy, range, query.limit);
      availability[query.key] = "available";
    } catch (error) {
      breakdowns[query.key] = [];
      availability[query.key] = "unavailable";
      warnings.push({
        section: query.key,
        message: error?.message || "This breakdown could not be loaded.",
        status: Number(error?.upstreamStatus || error?.status || 502),
      });
    }
  }

  const pageviews = total(trend, "pageviews");
  const visitors = total(trend, "visitors");
  const payload = {
    generatedAt: new Date().toISOString(),
    cached: false,
    period: {
      days,
      since: range.since,
      until: range.until,
      label: `Last ${days} days`,
    },
    totals: {
      pageviews,
      visitors,
      pagesPerVisitor: visitors ? Number((pageviews / visitors).toFixed(2)) : 0,
      events: total(breakdowns.events, "count"),
    },
    trend,
    breakdowns,
    availability,
    warnings: warnings.slice(0, 5),
  };
  // Do not preserve a transient Vercel failure as an apparently empty report.
  if (!warnings.length) responseCache.set(cacheKey, { storedAt: Date.now(), payload });
  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "Private analytics access is not configured.", code: "admin_auth_not_configured" });
  }

  try {
    const user = await verifyUser(getBearerToken(req));
    await requireActivePlatformAdmin(user);

    const missing = [
      !VERCEL_TOKEN && "VERCEL_ACCESS_TOKEN",
      !VERCEL_PROJECT_ID && "VERCEL_ANALYTICS_PROJECT_ID",
    ].filter(Boolean);
    if (missing.length) {
      return res.status(503).json({
        error: "Vercel Analytics is ready to connect, but its server credentials have not been added yet.",
        code: "vercel_analytics_not_configured",
        missing,
      });
    }

    const requestedDays = Number(req.query?.days || 30);
    const days = ALLOWED_RANGES.has(requestedDays) ? requestedDays : 30;
    if (String(req.query?.refresh || "") === "1") responseCache.delete(String(days));
    return res.status(200).json(await getAnalytics(days));
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error instanceof Error ? error.message : "Unable to load Vercel Analytics.",
    });
  }
};
