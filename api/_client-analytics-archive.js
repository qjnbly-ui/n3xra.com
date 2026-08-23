const { apiError, serviceRequest } = require("./_website-proposal-ai-supabase");

const VERCEL_TOKEN = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();
const DEFAULT_TEAM_ID = String(process.env.VERCEL_ANALYTICS_TEAM_ID || process.env.VERCEL_TEAM_ID || "").trim();
const DEFAULT_TEAM_SLUG = String(process.env.VERCEL_ANALYTICS_TEAM_SLUG || process.env.VERCEL_TEAM_SLUG || "").trim();
const MAX_BACKFILL_DAYS = 730;
const configuredBackfillDays = Number(process.env.VERCEL_ANALYTICS_BACKFILL_DAYS || MAX_BACKFILL_DAYS);
const DEFAULT_BACKFILL_DAYS = Math.min(
  Math.max(Number.isFinite(configuredBackfillDays) ? configuredBackfillDays : MAX_BACKFILL_DAYS, 30),
  MAX_BACKFILL_DAYS,
);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function completedDateRange(days) {
  const until = new Date();
  until.setUTCDate(until.getUTCDate() - 1);
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since: formatDate(since), until: formatDate(until) };
}

function analyticsUrl(connection, dataset, groupBy, range, limit) {
  const url = new URL(`https://api.vercel.com/v1/query/web-analytics/${dataset}/aggregate`);
  url.searchParams.set("projectId", connection.project_id);
  if (connection.team_id || DEFAULT_TEAM_ID) url.searchParams.set("teamId", connection.team_id || DEFAULT_TEAM_ID);
  else if (DEFAULT_TEAM_SLUG) url.searchParams.set("slug", DEFAULT_TEAM_SLUG);
  url.searchParams.set("since", range.since);
  url.searchParams.set("until", range.until);
  url.searchParams.set("by", groupBy);
  url.searchParams.set("limit", String(limit));
  return url;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryAnalytics(connection, dataset, groupBy, range, limit) {
  if (!VERCEL_TOKEN) throw apiError("Client analytics is not configured for this deployment.", 503);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(analyticsUrl(connection, dataset, groupBy, range, limit), {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return Array.isArray(payload?.data) ? payload.data : [];
    if (response.status === 429 && attempt === 0) {
      const retryAfter = Math.min(Math.max(Number(response.headers.get("retry-after") || 0) * 1000, 400), 2500);
      await wait(retryAfter);
      continue;
    }
    const error = apiError(String(payload?.error?.message || payload?.message || "Vercel Analytics could not be loaded."), response.status === 429 ? 429 : 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  return [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function rowDate(row) {
  const raw = row?.timestamp ?? row?.date ?? row?.day;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : formatDate(date);
}

async function loadArchivedRows(websiteId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await serviceRequest(`website_analytics_daily?select=metric_date,pageviews,visitors,events,synced_at&website_id=eq.${encodeURIComponent(websiteId)}&order=metric_date.asc&limit=1000&offset=${offset}`);
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function latestArchivedDate(websiteId) {
  const rows = await serviceRequest(`website_analytics_daily?select=metric_date&website_id=eq.${encodeURIComponent(websiteId)}&order=metric_date.desc&limit=1`);
  return Array.isArray(rows) ? String(rows[0]?.metric_date || "") : "";
}

async function startRun(websiteId, requestedDays) {
  const rows = await serviceRequest("website_analytics_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ website_id: websiteId, status: "running", requested_days: requestedDays }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function finishRun(runId, values) {
  if (!runId) return;
  await serviceRequest(`website_analytics_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...values, completed_at: new Date().toISOString() }),
  });
}

async function updateConnection(websiteId, values) {
  await serviceRequest(`website_analytics_connections?website_id=eq.${encodeURIComponent(websiteId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
}

async function fetchArchiveRows(connection, requestedDays) {
  const candidates = [...new Set(requestedDays > 365 ? [requestedDays, 365, 30] : requestedDays > 30 ? [requestedDays, 30] : [requestedDays])];
  let lastError;
  for (const days of candidates) {
    const range = completedDateRange(days);
    try {
      return {
        range,
        trend: await queryAnalytics(connection, "visits", "day", range, days),
        requestedDays: days,
        warning: days === requestedDays ? "" : `Vercel limited the initial history request, so the available ${days}-day window was archived.`,
      };
    } catch (error) {
      lastError = error;
      if (Number(error?.upstreamStatus || 0) !== 400) throw error;
    }
  }
  throw lastError;
}

async function syncAnalyticsConnection(connection, options = {}) {
  const websiteId = String(connection?.website_id || "");
  if (!websiteId || !connection?.project_id) throw apiError("This analytics connection is incomplete.", 400);
  const latest = options.forceBackfill ? "" : await latestArchivedDate(websiteId);
  const requestedDays = latest ? 3 : DEFAULT_BACKFILL_DAYS;
  const run = await startRun(websiteId, requestedDays);
  await updateConnection(websiteId, { archive_status: "syncing", archive_error: null });

  try {
    const result = await fetchArchiveRows(connection, requestedDays);
    let eventRows = [];
    let eventWarning = "";
    try {
      eventRows = await queryAnalytics(connection, "events", "day", result.range, result.requestedDays);
    } catch (error) {
      eventWarning = error?.message || "Custom event history was unavailable.";
    }
    const eventsByDate = new Map(eventRows.map((row) => [rowDate(row), number(row?.count)]).filter(([date]) => date));
    const dailyRows = result.trend.map((row) => ({
      website_id: websiteId,
      metric_date: rowDate(row),
      pageviews: number(row?.pageviews),
      visitors: number(row?.visitors),
      events: eventsByDate.get(rowDate(row)) || 0,
      source: "vercel",
      synced_at: new Date().toISOString(),
    })).filter((row) => row.metric_date);

    if (dailyRows.length) {
      await serviceRequest("website_analytics_daily?on_conflict=website_id,metric_date", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(dailyRows),
      });
    }
    const archivedDates = dailyRows.map((row) => row.metric_date).sort();
    const syncedAt = new Date().toISOString();
    const connectionUpdate = {
      archive_status: "healthy",
      archive_last_synced_at: syncedAt,
      archive_error: null,
    };
    if (!latest && archivedDates[0]) connectionUpdate.archive_started_on = archivedDates[0];
    await updateConnection(websiteId, connectionUpdate);
    const warnings = [result.warning, eventWarning].filter(Boolean);
    await finishRun(run?.id, {
      status: "succeeded",
      requested_days: result.requestedDays,
      stored_days: dailyRows.length,
      metadata: { since: result.range.since, until: result.range.until, warnings },
    });
    return { storedDays: dailyRows.length, since: result.range.since, until: result.range.until, syncedAt, warnings };
  } catch (error) {
    const message = String(error?.message || "Analytics archive synchronization failed.").slice(0, 1000);
    await Promise.allSettled([
      updateConnection(websiteId, { archive_status: "attention", archive_error: message }),
      finishRun(run?.id, { status: "failed", error_message: message, stored_days: 0 }),
    ]);
    throw error;
  }
}

module.exports = {
  analyticsUrl,
  completedDateRange,
  loadArchivedRows,
  queryAnalytics,
  syncAnalyticsConnection,
};
