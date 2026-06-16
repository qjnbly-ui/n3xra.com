const VIRALS_SUPABASE_URL = String(process.env.VIRALS_SUPABASE_URL || "").replace(/\/+$/, "");
const VIRALS_SUPABASE_SERVICE_ROLE_KEY = String(process.env.VIRALS_SUPABASE_SERVICE_ROLE_KEY || "").trim();

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function serviceHeaders() {
  return {
    apikey: VIRALS_SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${VIRALS_SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchRows(table, query) {
  if (!VIRALS_SUPABASE_URL || !VIRALS_SUPABASE_SERVICE_ROLE_KEY) return [];
  const response = await fetch(`${VIRALS_SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: serviceHeaders(),
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchVideoPublishDates(videoIds) {
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await fetchRows(
    "virals_videos",
    `?select=id,published_at&id=in.(${ids.map(encodeURIComponent).join(",")})`
  );
  return new Map(rows.map((row) => [row.id, row.published_at || null]));
}

function cleanTikTokHandle(handle) {
  return String(handle || "").trim().replace(/^@+/, "");
}

function buildCanonicalTikTokUrl(handle, videoId, fallback = "") {
  const cleanHandle = cleanTikTokHandle(handle);
  const id = String(videoId || "").trim();
  if (cleanHandle && id) return `https://www.tiktok.com/@${encodeURIComponent(cleanHandle)}/video/${encodeURIComponent(id)}`;
  const raw = String(fallback || "").trim();
  if (!raw) return "";
  if (/^www\.tiktok\.com\//i.test(raw) || /^tiktok\.com\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function buildTikTokPlayerUrl(videoId) {
  const id = String(videoId || "").trim();
  if (!id) return "";
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&loop=1&autoplay=1&muted=0&music_info=0&description=0&rel=0`;
}

function normalizeVideo(row, publishedAtByVideoId = new Map()) {
  const metrics = row.latest_metrics || {};
  const videoId = row.external_video_id || "";
  return {
    title: row.title || "Untitled TikTok",
    creator: row.creator_handle ? `@${row.creator_handle}` : "Creator pending",
    url: buildCanonicalTikTokUrl(row.creator_handle, videoId, row.normalized_url),
    videoId,
    embedUrl: buildTikTokPlayerUrl(videoId),
    thumbnail: row.thumbnail_url || "",
    searches: Number(row.search_count || 0),
    analyses: Number(row.analysis_count || 0),
    publishedAt: publishedAtByVideoId.get(row.latest_video_id) || null,
    lastSeen: row.last_seen_at || null,
    framework: row.latest_framework || {},
    metrics,
  };
}

function normalizeSnapshot(row, kind) {
  return {
    rank: row.rank || null,
    title: row.title || row.product_name || row.display_name || row.handle || "Snapshot pending",
    creator: row.creator_handle || row.handle || "",
    url: row.source_url || "",
    thumbnail: row.thumbnail_url || "",
    score: row.viral_score || row.opportunity_score || row.velocity_score || null,
    capturedAt: row.captured_at || null,
    metrics: row.metrics || {},
    framework: row.framework_summary || {},
    kind,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const requestUrl = new URL(req.url || "/api/virals-insights", "http://n3xra.local");
  const type = String(req.query?.type || requestUrl.searchParams.get("type") || "searched").trim();
  const limit = Math.min(Math.max(Number(req.query?.limit || requestUrl.searchParams.get("limit") || 12) || 12, 1), 50);

  if (!VIRALS_SUPABASE_URL || !VIRALS_SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 200, { type, rows: [], configured: false });
  }

  if (type === "searched") {
    const rows = await fetchRows(
      "virals_video_search_stats",
      `?select=normalized_url,external_video_id,title,creator_handle,thumbnail_url,search_count,analysis_count,last_seen_at,latest_video_id,latest_metrics,latest_framework&order=search_count.desc,last_seen_at.desc&limit=${limit}`
    );
    const publishedAtByVideoId = await fetchVideoPublishDates(rows.map((row) => row.latest_video_id));
    return sendJson(res, 200, { type, rows: rows.map((row) => normalizeVideo(row, publishedAtByVideoId)), configured: true });
  }

  const tableByType = {
    videos: "virals_daily_video_snapshots",
    creators: "virals_daily_creator_snapshots",
    products: "virals_daily_product_snapshots",
  };
  const table = tableByType[type];
  if (!table) return sendJson(res, 400, { error: "Unknown insight type." });

  const rows = await fetchRows(table, `?select=*&order=snapshot_date.desc,rank.asc,captured_at.desc&limit=${limit}`);
  return sendJson(res, 200, { type, rows: rows.map((row) => normalizeSnapshot(row, type)), configured: true });
};
