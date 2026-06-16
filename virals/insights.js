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
    const media = row.thumbnail
      ? `<img src="${escapeHtml(row.thumbnail)}" alt="">`
      : `<div class="insight-thumb-fallback">N3XRA</div>`;
    return `
      <article class="insight-result-card">
        <div class="insight-rank">#${rank}</div>
        <div class="insight-thumb">${media}</div>
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
          ${row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Open source</a>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

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
