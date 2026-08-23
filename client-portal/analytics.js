import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { portalLoginUrl, resolvePortalTenant, scopeWebsitesToPortalTenant } from "./tenant-context.js";
const websiteSelect = document.querySelector("#analytics-website-select");
const rangeSelect = document.querySelector("#analytics-range");
const refreshButton = document.querySelector("#analytics-refresh");
const status = document.querySelector("#analytics-status");
const report = document.querySelector("#analytics-report");
const dashboard = document.querySelector("#analytics-dashboard");
const screen = document.querySelector("#portal-status");
let session;
let websites = [];
let selectedWebsite;
function element(id) {
    const found = document.getElementById(id);
    if (!found)
        throw new Error(`Missing analytics element: ${id}`);
    return found;
}
function storedWebsiteId(userId) {
    try {
        const saved = JSON.parse(localStorage.getItem("n3xra-client-workspace-context") || "{}");
        return !saved.userId || saved.userId === userId ? String(saved.websiteId || "") : "";
    }
    catch {
        return "";
    }
}
function saveWebsite(website) {
    try {
        const prior = JSON.parse(localStorage.getItem("n3xra-client-workspace-context") || "{}");
        localStorage.setItem("n3xra-client-workspace-context", JSON.stringify({ ...prior, websiteId: website.id, name: website.name, userId: session.user.id }));
    }
    catch { /* The report still works if local storage is unavailable. */ }
}
function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function formatDate(value) {
    if (!value)
        return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
function displayLabel(value, kind) {
    const clean = String(value || "").trim();
    if (!clean || clean.toLowerCase() === "null")
        return kind === "referrer" ? "Direct / none" : "Unknown";
    if (kind === "country" && /^[A-Z]{2}$/i.test(clean)) {
        try {
            return new Intl.DisplayNames(undefined, { type: "region" }).of(clean.toUpperCase()) || clean.toUpperCase();
        }
        catch {
            return clean.toUpperCase();
        }
    }
    if (kind === "page")
        return clean || "/";
    return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function showStatus(copy, isError = false) {
    if (!status || !report)
        return;
    status.textContent = copy;
    status.classList.toggle("is-error", isError);
    status.hidden = false;
    report.hidden = true;
}
function renderList(id, rows, key, metric, kind, emptyCopy) {
    const container = element(id);
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
        container.innerHTML = `<p class="client-analytics-empty">${emptyCopy}</p>`;
        return;
    }
    const maximum = Math.max(...items.map((row) => Number(row[metric] || 0)), 1);
    container.innerHTML = items.map((row, index) => {
        const value = Number(row[metric] || 0);
        const label = displayLabel(String(row[key] || ""), kind);
        const width = Math.max(4, Math.round((value / maximum) * 100));
        return `<div class="client-analytics-row"><div class="client-analytics-row-copy"><em>${String(index + 1).padStart(2, "0")}</em><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div><div class="client-analytics-row-track"><i style="width:${width}%"></i></div></div>`;
    }).join("");
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function renderChart(rows) {
    const chart = element("analytics-chart");
    if (!rows.length) {
        chart.innerHTML = '<p class="client-analytics-empty">No traffic was recorded in this timeframe.</p>';
        element("analytics-peak").textContent = "Peak 0";
        return;
    }
    const width = 1000, height = 210, left = 14, right = 986, top = 16, bottom = 182;
    const maximum = Math.max(...rows.map((row) => Number(row.pageviews || 0)), 1);
    const points = rows.map((row, index) => ({
        x: rows.length === 1 ? width / 2 : left + ((right - left) * index) / (rows.length - 1),
        y: bottom - ((bottom - top) * Number(row.pageviews || 0)) / maximum,
        value: Number(row.pageviews || 0),
        timestamp: String(row.timestamp || ""),
    }));
    const line = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const area = `${left},${bottom} ${line} ${right},${bottom}`;
    const circles = points.map((point) => `<circle class="client-analytics-chart-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3"><title>${escapeHtml(formatDate(point.timestamp))}: ${formatNumber(point.value)} page views</title></circle>`).join("");
    const first = formatDate(points[0]?.timestamp || ""), last = formatDate(points.at(-1)?.timestamp || "");
    chart.setAttribute("aria-label", `Daily page views from ${first} through ${last}. Peak ${maximum} page views.`);
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><line x1="${left}" y1="${top}" x2="${right}" y2="${top}" class="client-analytics-chart-grid"></line><line x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" class="client-analytics-chart-grid"></line><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="client-analytics-chart-grid"></line><polygon points="${area}" class="client-analytics-chart-area"></polygon><polyline points="${line}" class="client-analytics-chart-line"></polyline>${circles}</svg><div class="client-analytics-chart-labels"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>`;
    element("analytics-peak").textContent = `Peak ${formatNumber(maximum)}`;
}
function renderAnalytics(data) {
    const allTime = data.period.days === null;
    element("analytics-site-name").textContent = data.website.name;
    element("analytics-period-copy").textContent = `${data.period.label} · ${formatDate(data.period.since)}–${formatDate(data.period.until)}`;
    element("analytics-visitors").textContent = formatNumber(data.totals.visitors);
    element("analytics-pageviews").textContent = formatNumber(data.totals.pageviews);
    element("analytics-depth").textContent = formatNumber(data.totals.pagesPerVisitor, 2);
    element("analytics-events").textContent = formatNumber(data.totals.events);
    element("analytics-visitors-label").textContent = allTime ? "Daily visitors" : "Visitors";
    element("analytics-visitors-copy").textContent = allTime ? "Unique visitors summed by day" : "Unique daily visitors";
    element("analytics-trend-title").textContent = data.trendGranularity === "month" ? "Monthly page views" : "Daily page views";
    element("analytics-breakdown-period").textContent = data.breakdownsPeriodLabel || "Breakdowns match the selected timeframe.";
    renderChart(data.trend || []);
    renderList("analytics-pages", data.breakdowns.pages, "requestPath", "visitors", "page", "No page traffic was recorded yet.");
    renderList("analytics-referrers", data.breakdowns.referrers, "referrerHostname", "visitors", "referrer", "No referring websites were recorded yet.");
    renderList("analytics-countries", data.breakdowns.countries, "country", "visitors", "country", "No country data was recorded yet.");
    renderList("analytics-devices", data.breakdowns.devices, "deviceType", "visitors", "device", "No device data was recorded yet.");
    renderList("analytics-event-list", data.breakdowns.events, "eventName", "count", "event", "No custom actions are being tracked yet.");
    element("analytics-source").textContent = data.source.projectName ? `${data.source.provider} · ${data.source.projectName}` : data.source.provider;
    element("analytics-updated").textContent = `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generatedAt))}${data.cached ? " · cached" : ""}`;
    if (status && report) {
        status.hidden = true;
        report.hidden = false;
    }
}
async function loadAnalytics(force = false) {
    if (!selectedWebsite)
        return;
    showStatus("Loading website analytics…");
    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing…";
    }
    try {
        const params = new URLSearchParams({ website_id: selectedWebsite.id, days: rangeSelect?.value || "30" });
        if (force)
            params.set("refresh", "1");
        const response = await fetch(`/api/client-vercel-analytics?${params}`, { headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(String(data?.error || "Website analytics could not be loaded."));
        renderAnalytics(data);
    }
    catch (error) {
        showStatus(error instanceof Error ? error.message : "Website analytics could not be loaded.", true);
    }
    finally {
        if (refreshButton) {
            refreshButton.disabled = false;
            refreshButton.textContent = "Refresh";
        }
        dashboard?.setAttribute("aria-busy", "false");
    }
}
async function init() {
    if (!hasConfig())
        throw new Error("Portal configuration is unavailable.");
    const supabase = createBrowserSupabase();
    session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(portalLoginUrl());
        return;
    }
    const tenant = await resolvePortalTenant(supabase);
    const { data, error } = await supabase.from("client_websites").select("id,name").order("name");
    if (error)
        throw error;
    websites = scopeWebsitesToPortalTenant((data || []), tenant);
    if (!websites.length)
        throw new Error("No website analytics workspace is available for this account.");
    const requested = new URLSearchParams(window.location.search).get("website") || storedWebsiteId(session.user.id);
    selectedWebsite = websites.find((website) => website.id === requested) || websites[0];
    if (websiteSelect) {
        websiteSelect.innerHTML = websites.map((website) => `<option value="${escapeHtml(website.id)}">${escapeHtml(website.name)}</option>`).join("");
        websiteSelect.value = selectedWebsite?.id || "";
        websiteSelect.disabled = tenant.mode !== "unbound" || websites.length < 2;
        websiteSelect.addEventListener("change", () => {
            selectedWebsite = websites.find((website) => website.id === websiteSelect.value);
            if (selectedWebsite)
                saveWebsite(selectedWebsite);
            void loadAnalytics();
        });
    }
    if (selectedWebsite)
        saveWebsite(selectedWebsite);
    rangeSelect?.addEventListener("change", () => void loadAnalytics());
    refreshButton?.addEventListener("click", () => void loadAnalytics(true));
    document.body.classList.remove("portal-loading");
    if (screen)
        screen.hidden = true;
    await loadAnalytics();
}
void init().catch((error) => {
    document.body.classList.remove("portal-loading");
    if (screen) {
        screen.hidden = false;
        screen.textContent = error instanceof Error ? error.message : "Website analytics could not be opened.";
    }
});
