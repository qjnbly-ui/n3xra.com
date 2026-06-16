const insightList = document.getElementById("insight-list");
const insightStatus = document.getElementById("insight-status");
const insightType = document.body?.dataset?.insightType || "searched";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}

function formatDate(value) {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not captured";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function metricValue(metrics = {}, keys = []) {
  for (const key of keys) {
    const value = Number(metrics[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function normalizeOpenSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^www\.tiktok\.com\//i.test(raw) || /^tiktok\.com\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function buildTikTokPlayerUrl(value, videoId) {
  const raw = String(value || "").trim();
  const id = String(videoId || "").trim();
  const base = raw || (id ? `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}` : "");
  if (!base) return "";
  try {
    const url = new URL(base);
    url.searchParams.set("controls", "1");
    url.searchParams.set("progress_bar", "1");
    url.searchParams.set("play_button", "1");
    url.searchParams.set("volume_control", "1");
    url.searchParams.set("fullscreen_button", "1");
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("muted", "0");
    url.searchParams.set("music_info", "0");
    url.searchParams.set("description", "0");
    return url.toString();
  } catch (_error) {
    return id ? `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?controls=1&autoplay=1` : "";
  }
}

function loadInsightPlayer(container) {
  const embedUrl = String(container?.dataset?.embedUrl || "").trim();
  if (!container || !embedUrl) return false;
  if (container.classList.contains("is-embed-previewing")) return true;
  let iframe = container.querySelector(".insight-thumb-embed");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.className = "insight-thumb-embed";
    iframe.title = "TikTok video player";
    iframe.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    container.appendChild(iframe);
  }
  if (!iframe.src) iframe.src = embedUrl;
  container.classList.add("is-embed-previewing");
  return true;
}

function openSourceUrl(url) {
  const sourceUrl = normalizeOpenSourceUrl(url);
  if (!sourceUrl) return false;
  window.open(sourceUrl, "_blank", "noopener");
  return true;
}

function renderEmpty() {
  if (!insightList) return;
  insightList.innerHTML = `
    <article class="insight-empty">
      <p class="panel-kicker">Most Searched</p>
      <h2>Most searched videos</h2>
      <p>This ranking will populate as videos are analyzed and searched inside N3XRA Virals.</p>
      <a class="insight-cta" href="/virals/">Analyze a video</a>
    </article>
  `;
}

function renderRows(rows) {
  if (!insightList) return;
  insightList.innerHTML = rows.map((row, index) => {
    const rank = row.rank || index + 1;
    const metrics = row.metrics || {};
    const primaryMetric = insightType === "searched"
      ? `${formatNumber(row.searches)} searches`
      : row.score
        ? `${row.score} score`
        : "No score yet";
    const secondaryMetric = insightType === "searched"
      ? `${formatNumber(row.analyses)} analyses`
      : `Captured ${formatDate(row.capturedAt)}`;
    const framework = row.framework?.hookType || row.framework?.product || row.framework?.formula || "Framework pending";
    const plays = metricValue(metrics, ["plays", "playCount", "views"]);
    const likes = metricValue(metrics, ["likes", "diggCount"]);
    const shares = metricValue(metrics, ["shares", "shareCount"]);
    const hasMetrics = Boolean(plays || likes || shares);
    const product = row.framework?.product || "";
    const publishedDate = formatShortDate(row.publishedAt);
    const embedUrl = buildTikTokPlayerUrl(row.embedUrl, row.videoId);
    const sourceUrl = normalizeOpenSourceUrl(row.url);
    const media = row.thumbnail
      ? `<img src="${escapeHtml(row.thumbnail)}" alt="">`
      : `<div class="insight-thumb-fallback">N3XRA</div>`;
    return `
      <article class="insight-result-card">
        <div class="insight-rank">#${rank}</div>
        <div class="insight-thumb${embedUrl ? " has-embed-preview" : ""}${sourceUrl ? " has-source-link" : ""}" ${embedUrl ? `data-embed-url="${escapeHtml(embedUrl)}"` : ""} ${sourceUrl ? `data-source-url="${escapeHtml(sourceUrl)}"` : ""} ${embedUrl || sourceUrl ? 'tabindex="0" aria-label="Play TikTok video"' : ""}>${media}</div>
        <div class="insight-result-body">
          <div class="insight-result-heading">
            <h2>${escapeHtml(row.title)}</h2>
            <span>${escapeHtml(primaryMetric)}</span>
          </div>
          <div class="insight-meta-row">
            <span>${escapeHtml(row.creator || "Creator pending")}</span>
            ${publishedDate ? `<span>${escapeHtml(publishedDate)}</span>` : ""}
          </div>
          ${hasMetrics ? `
            <div class="insight-stat-row" aria-label="Video metrics">
              ${plays ? `<span><strong>${escapeHtml(formatNumber(plays))}</strong> views</span>` : ""}
              ${likes ? `<span><strong>${escapeHtml(formatNumber(likes))}</strong> likes</span>` : ""}
              ${shares ? `<span><strong>${escapeHtml(formatNumber(shares))}</strong> shares</span>` : ""}
            </div>
          ` : ""}
          <div class="pill-row insight-pill-row">
            <span class="pill">${escapeHtml(secondaryMetric)}</span>
            ${product ? `<span class="pill">${escapeHtml(product)}</span>` : ""}
            <span class="pill">${escapeHtml(framework)}</span>
          </div>
          ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Open source</a>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

insightList?.addEventListener("click", (event) => {
  const thumb = event.target.closest?.(".insight-thumb.has-embed-preview, .insight-thumb.has-source-link");
  if (!thumb) return;
  if (thumb.classList.contains("has-embed-preview") && loadInsightPlayer(thumb)) return;
  openSourceUrl(thumb.dataset.sourceUrl);
});

insightList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const thumb = event.target.closest?.(".insight-thumb.has-embed-preview, .insight-thumb.has-source-link");
  if (!thumb) return;
  event.preventDefault();
  if (thumb.classList.contains("has-embed-preview") && loadInsightPlayer(thumb)) return;
  openSourceUrl(thumb.dataset.sourceUrl);
});

async function loadInsights() {
  if (!insightList) return;
  try {
    const response = await fetch(`/api/virals-insights?type=${encodeURIComponent(insightType)}&limit=12`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load insights.");
    if (insightStatus) {
      insightStatus.textContent = payload.rows?.length ? "Updated" : "";
      insightStatus.classList.toggle("is-hidden", !payload.rows?.length);
    }
    if (!payload.rows?.length) return renderEmpty();
    renderRows(payload.rows);
  } catch (error) {
    if (insightStatus) {
      insightStatus.textContent = "";
      insightStatus.classList.add("is-hidden");
    }
    renderEmpty();
  }
}

loadInsights();
