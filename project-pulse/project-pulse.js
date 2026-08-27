const formatNumber = (value) => new Intl.NumberFormat("en-US").format(Number(value || 0));
const RECENT_PREVIEW_COUNT = 5;
let recentUpdates = [];
let recentExpanded = false;
const pulseHeader = document.querySelector("[data-home-header]");

function updateHeaderState() {
  pulseHeader?.classList.toggle("is-scrolled", window.scrollY > 12);
}

window.addEventListener("scroll", updateHeaderState, { passive: true });
updateHeaderState();
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function formatDate(value) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update date unavailable";
  return `Updated ${date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(isDateOnly ? { timeZone: "UTC" } : {}),
  })}`;
}

function renderStats(summary) {
  const items = [
    [formatNumber(summary.sourceLines), "Source lines"],
    [formatNumber(summary.sourceFiles), "Source files"],
    [formatNumber(summary.products), "Products"],
    [formatNumber(summary.pages), "Pages"],
    [formatNumber(Number(summary.apiFunctions || 0) + Number(summary.edgeFunctions || 0)), "API & edge functions"],
    [formatNumber(summary.databaseMigrations), "Database migrations"],
  ];
  document.getElementById("pulse-stats").innerHTML = items
    .map(([value, label]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`)
    .join("");
}

function renderProducts(products) {
  document.getElementById("pulse-products").innerHTML = (products || []).map((product) => `
    <a class="pulse-product-card" href="${escapeHtml(product.route)}">
      <span class="pulse-product-status"><i></i> Live</span>
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.summary)}</p>
      <span class="pulse-product-link">View product <b aria-hidden="true">↗</b></span>
    </a>
  `).join("");
}

function renderSystemMap(systemMap) {
  document.getElementById("pulse-system-map").innerHTML = (systemMap.layers || []).map((layer) => `
    <li><h3>${escapeHtml(layer.name)}</h3><p>${escapeHtml(layer.description)}</p></li>
  `).join("");
}

function renderRecent(items) {
  recentUpdates = Array.isArray(items) ? items : [];
  const visibleItems = recentExpanded ? recentUpdates : recentUpdates.slice(0, RECENT_PREVIEW_COUNT);
  document.getElementById("pulse-recent").innerHTML = visibleItems.map((item) => `
    <article class="pulse-recent-item">
      <time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDate(item.date).replace("Updated ", ""))}</time>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
    </article>
  `).join("");
  const toggle = document.getElementById("pulse-recent-toggle");
  const hasMore = recentUpdates.length > RECENT_PREVIEW_COUNT;
  toggle.hidden = !hasMore;
  toggle.setAttribute("aria-expanded", String(recentExpanded));
  toggle.textContent = recentExpanded
    ? "Show fewer updates"
    : `Show ${recentUpdates.length - RECENT_PREVIEW_COUNT} more public updates`;
}

document.getElementById("pulse-recent-toggle")?.addEventListener("click", () => {
  recentExpanded = !recentExpanded;
  renderRecent(recentUpdates);
});

async function initPulse() {
  try {
    const response = await fetch("/project-pulse/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Project Pulse is temporarily unavailable.");
    const manifest = await response.json();
    document.getElementById("pulse-statement").textContent = manifest.summary.statement;
    document.getElementById("pulse-updated").textContent = `${formatDate(manifest.updatedAt)} · ${manifest.commit}`;
    document.getElementById("pulse-disclosure").textContent = manifest.disclosure;
    renderStats(manifest.summary);
    renderProducts(manifest.products);
    renderSystemMap(manifest.systemMap || {});
    renderRecent(manifest.recentCapabilities || []);
  } catch (error) {
    document.getElementById("pulse-stats").innerHTML = `<p class="pulse-error">${escapeHtml(error.message)}</p>`;
    document.getElementById("pulse-updated").textContent = "Snapshot unavailable";
  }
}

initPulse();
