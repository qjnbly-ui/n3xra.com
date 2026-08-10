let session;
let escapeHtml;
let formatDate;
let setStatus;

async function analyticsRequest(days, force = false) {
  const params = new URLSearchParams({ days: String(days) });
  if (force) params.set("refresh", "1");
  const response = await fetch(`/api/vercel-analytics?${params}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.error || "Analytics could not be loaded."));
    error.code = String(data?.code || "");
    error.missing = Array.isArray(data?.missing) ? data.missing : [];
    throw error;
  }
  return data;
}

function formatAnalyticsNumber(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits });
}

function analyticsLabel(value, fallback = "Unknown") {
  const label = String(value || "").trim();
  if (!label || label.toLowerCase() === "null") return fallback;
  return label.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderAnalyticsList(id, rows, key, metric = "pageviews", fallback = "No data recorded", available = true) {
  const container = document.getElementById(id);
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<p class="analytics-empty${available ? "" : " is-unavailable"}">${escapeHtml(available ? fallback : "Temporarily unavailable")}</p>`;
    return;
  }
  const maximum = Math.max(...list.map((row) => Number(row?.[metric] || 0)), 1);
  container.innerHTML = list.map((row, index) => {
    const value = Number(row?.[metric] || 0);
    const rawLabel = row?.[key];
    const label = key === "requestPath"
      ? String(rawLabel || "/")
      : analyticsLabel(rawLabel, key === "referrerHostname" ? "Direct / none" : "Unknown");
    const width = Math.max(4, Math.round((value / maximum) * 100));
    return `
      <div class="analytics-list-row">
        <div><em>${String(index + 1).padStart(2, "0")}</em><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><strong>${formatAnalyticsNumber(value)}</strong></div>
        <div class="analytics-list-bar"><i style="width:${width}%"></i></div>
      </div>
    `;
  }).join("");
}

function renderAnalyticsChart(rows) {
  const chart = document.getElementById("analytics-chart");
  if (!chart) return;
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) {
    chart.innerHTML = '<p class="analytics-empty">No traffic was recorded in this timeframe.</p>';
    return;
  }

  const width = 1000;
  const height = 230;
  const left = 18;
  const right = 982;
  const top = 20;
  const bottom = 190;
  const maximum = Math.max(...data.map((row) => Number(row?.pageviews || 0)), 1);
  const points = data.map((row, index) => {
    const x = data.length === 1 ? width / 2 : left + ((right - left) * index) / (data.length - 1);
    const y = bottom - ((bottom - top) * Number(row?.pageviews || 0)) / maximum;
    return { x, y, value: Number(row?.pageviews || 0), timestamp: row?.timestamp };
  });
  const pointString = points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaString = `${left},${bottom} ${pointString} ${right},${bottom}`;
  const firstDate = formatDate(points[0]?.timestamp).split(",")[0];
  const lastDate = formatDate(points.at(-1)?.timestamp).split(",")[0];

  chart.setAttribute("aria-label", `Daily page views from ${firstDate} through ${lastDate}. Peak ${formatAnalyticsNumber(maximum)} page views.`);
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${left}" y1="${top}" x2="${right}" y2="${top}" class="analytics-chart-grid"></line>
      <line x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" class="analytics-chart-grid"></line>
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="analytics-chart-grid"></line>
      <polygon points="${areaString}" class="analytics-chart-area"></polygon>
      <polyline points="${pointString}" class="analytics-chart-line"></polyline>
    </svg>
    <div class="analytics-chart-scale"><span>${escapeHtml(firstDate)}</span><strong>Peak ${formatAnalyticsNumber(maximum)}</strong><span>${escapeHtml(lastDate)}</span></div>
  `;
}

function renderAnalyticsConfiguration(error) {
  const configuration = document.getElementById("analytics-configuration");
  const dashboard = document.getElementById("analytics-dashboard");
  const missing = document.getElementById("analytics-missing-config");
  if (!configuration || !dashboard || !missing) return;
  missing.innerHTML = (error.missing || []).map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("");
  configuration.classList.remove("hidden");
  dashboard.classList.add("hidden");
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = "Connection required";
}

function renderAnalytics(data = {}) {
  document.getElementById("analytics-configuration")?.classList.add("hidden");
  document.getElementById("analytics-dashboard")?.classList.remove("hidden");
  const totals = data.totals || {};
  document.getElementById("analytics-visitors").textContent = formatAnalyticsNumber(totals.visitors);
  document.getElementById("analytics-pageviews").textContent = formatAnalyticsNumber(totals.pageviews);
  document.getElementById("analytics-pages-per-visitor").textContent = formatAnalyticsNumber(totals.pagesPerVisitor, 2);
  document.getElementById("analytics-events").textContent = formatAnalyticsNumber(totals.events);
  const periodLabel = document.getElementById("analytics-period-label");
  if (periodLabel) periodLabel.textContent = data.period?.label || "Current range";
  const updated = document.getElementById("analytics-updated");
  if (updated) {
    updated.textContent = `${data.period?.label || "Current range"} · Updated ${formatDate(data.generatedAt)}${data.cached ? " · cached" : ""}`;
  }
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = `Updated ${formatDate(data.generatedAt)}${data.cached ? " · cached" : ""}`;
  renderAnalyticsChart(data.trend);
  const availability = data.availability || {};
  renderAnalyticsList("analytics-pages", data.breakdowns?.pages, "requestPath", "visitors", "No data recorded", availability.pages !== "unavailable");
  renderAnalyticsList("analytics-referrers", data.breakdowns?.referrers, "referrerHostname", "visitors", "No data recorded", availability.referrers !== "unavailable");
  renderAnalyticsList("analytics-countries", data.breakdowns?.countries, "country", "visitors", "No data recorded", availability.countries !== "unavailable");
  renderAnalyticsList("analytics-devices", data.breakdowns?.devices, "deviceType", "visitors", "No data recorded", availability.devices !== "unavailable");
  renderAnalyticsList("analytics-event-list", data.breakdowns?.events, "eventName", "count", "No custom events recorded", availability.events !== "unavailable");
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  const warningList = document.getElementById("analytics-warnings");
  if (warningList) {
    warningList.innerHTML = warnings.map((warning) => `<div><span>${escapeHtml(analyticsLabel(warning.section, "Report section"))}</span><strong>${escapeHtml(warning.message || "This report section could not be loaded.")}</strong></div>`).join("");
    warningList.classList.toggle("hidden", !warnings.length);
  }
  const unavailableCount = Object.values(availability).filter((value) => value === "unavailable").length;
  setStatus(
    warnings.length
      ? `Traffic loaded. ${unavailableCount || "One or more"} detailed ${unavailableCount === 1 ? "panel is" : "panels are"} temporarily unavailable.`
      : "Analytics loaded.",
    warnings.length ? "" : "success",
  );
}

async function loadAnalytics(force = false) {
  const range = document.getElementById("analytics-range");
  const refresh = document.getElementById("analytics-refresh");
  const days = Number(range?.value || 30);
  if (range) range.disabled = true;
  if (refresh) refresh.disabled = true;
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = "Loading current data…";
  setStatus("Loading Vercel Analytics…");
  try {
    renderAnalytics(await analyticsRequest(days, force));
  } catch (error) {
    if (error.code === "vercel_analytics_not_configured") renderAnalyticsConfiguration(error);
    else if (sourceUpdated) sourceUpdated.textContent = "Report unavailable";
    setStatus(error.message, "error");
  } finally {
    if (range) range.disabled = false;
    if (refresh) refresh.disabled = false;
  }
}

async function loadAnalyticsView() {
  document.getElementById("analytics-range")?.addEventListener("change", () => loadAnalytics(false));
  document.getElementById("analytics-refresh")?.addEventListener("click", () => loadAnalytics(true));
  await loadAnalytics(false);
}


export async function startAnalytics(context = {}) {
  session = context.session;
  escapeHtml = context.escapeHtml;
  formatDate = context.formatDate;
  setStatus = context.setStatus;
  await loadAnalyticsView();
}
