import { getAdminSession } from "/account/admin/admin-session.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const DEFAULT_BRAND = {
  primary_color: "#17231b",
  accent_color: "#b77946",
  heading_font: "Fraunces",
  body_font: "Manrope",
  powered_by_label: "Powered by N3XRA",
};
const FEATURE_DEFAULTS = { overview: true, progress: true, files_assets: true, services: true, billing: true, support: true, analytics: false };
const COUNTER_DEFAULTS = { enabled: false, metric: "all_time_pageviews", label: "Website visits", public_key: null };
const byId = (id) => document.getElementById(id);
const websiteSelect = byId("portal-website-select");
const form = byId("portal-settings-form");
const status = byId("portal-settings-status");
const statusScreen = byId("portal-status");
const featureGrid = byId("portal-feature-grid");
const consoleElement = byId("portal-console");
const emptyElement = byId("portal-empty");
let supabase;
let currentUser;
let currentSession;
let websites = [];
let domains = [];
let analysis = null;
let selectedWebsite = null;
let formDirty = false;
let analysisSequence = 0;
let portalAssetChoices = [];
let accessSaveQueue = Promise.resolve();

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function normalizeHostname(value = "") {
  const text = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!text) return "";
  try { return new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

function portalUrl(domain = "") {
  const hostname = normalizeHostname(domain);
  return hostname ? `https://${hostname}/` : "";
}

function safeAssetUrl(value = "") {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function message(text = "", isError = false) {
  status.textContent = text;
  status.classList.toggle("is-error", isError);
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
  button.disabled = Boolean(busy);
}

function currentDomain() {
  return domains.find((item) => item.website_id === selectedWebsite?.id && item.domain_purpose === "portal");
}

function connection(key, label, state, detail, required = false, action = "") {
  return { key, label, state, detail, required, action };
}

function colorLuminance(value = "") {
  const match = String(value).match(/^#([0-9a-f]{6})$/i);
  if (!match) return 0;
  const channels = [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16) / 255).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function assetScore(asset, favicon = false, backgroundColor = DEFAULT_BRAND.primary_color) {
  const text = `${asset.asset_key || ""} ${asset.label || ""} ${asset.category || ""}`.toLowerCase();
  if (favicon) return (text.includes("favicon") ? 100 : 0) + (text.includes("icon") ? 40 : 0) + (asset.category === "logo" ? 10 : 0);
  const lightVariant = /(?:^|[\s_.-])(light|white|reverse|reversed|negative|knockout)(?:[\s_.-]|$)|on[\s_.-]*dark/.test(text);
  const darkVariant = /(?:^|[\s_.-])(dark|black)(?:[\s_.-]|$)|on[\s_.-]*light/.test(text);
  const darkBackground = colorLuminance(backgroundColor) < 0.35;
  const variantScore = darkBackground
    ? (lightVariant ? 180 : 0) - (darkVariant ? 120 : 0)
    : (darkVariant ? 180 : 0) - (lightVariant ? 120 : 0);
  return (asset.category === "logo" ? 80 : 0) + (text.includes("logo") ? 60 : 0) + (text.includes("brand") ? 20 : 0) - (text.includes("favicon") ? 80 : 0) + variantScore;
}

async function directAnalysis(website) {
  const websiteId = website.id;
  const results = await Promise.all([
    supabase.from("website_portal_branding").select("*").eq("website_id", websiteId).maybeSingle(),
    supabase.from("website_portal_features").select("feature_key,enabled").eq("website_id", websiteId),
    supabase.from("website_assets").select("id,asset_key,label,category,status,current_version_id").eq("website_id", websiteId).neq("status", "archived"),
    supabase.from("website_repositories").select("provider,full_name,default_branch,access_status").eq("website_id", websiteId).order("created_at"),
    supabase.from("website_services").select("service_type,name,provider,status,public_url").eq("website_id", websiteId).order("sort_order"),
    supabase.from("website_members").select("user_id,role,status").eq("website_id", websiteId),
    supabase.from("website_public_traffic_counters").select("website_id,enabled,metric,label,public_key,updated_at").eq("website_id", websiteId).maybeSingle(),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [brandingResult, featureResult, assetResult, repositoryResult, serviceResult, memberResult, counterResult] = results;
  const rawAssets = assetResult.data || [];
  const assetIds = rawAssets.map((asset) => asset.current_version_id).filter(Boolean);
  const versionResult = assetIds.length
    ? await supabase.from("website_asset_versions").select("id,public_url,mime_type").in("id", assetIds)
    : { data: [], error: null };
  if (versionResult.error) throw versionResult.error;
  const versions = new Map((versionResult.data || []).map((version) => [version.id, version]));
  const assets = rawAssets.map((asset) => ({ ...asset, public_url: versions.get(asset.current_version_id)?.public_url || null, mime_type: versions.get(asset.current_version_id)?.mime_type || null }));
  const branding = brandingResult.data || {};
  const logoAssets = assets.filter((asset) => asset.category === "logo");
  const logoBackground = branding.primary_color || DEFAULT_BRAND.primary_color;
  const logo = [...logoAssets].sort((a, b) => assetScore(b, false, logoBackground) - assetScore(a, false, logoBackground))[0] || null;
  const favicon = [...assets].sort((a, b) => assetScore(b, true) - assetScore(a, true))[0] || null;
  const websiteDomains = domains.filter((item) => item.website_id === website.id);
  const domain = websiteDomains.find((item) => item.domain_purpose === "portal");
  const portalSlug = String(website.portal_slug || website.slug || "").trim();
  const proposedDomain = portalSlug ? `${portalSlug}.portal.n3xra.com` : "";
  const activeMembers = (memberResult.data || []).filter((member) => member.status === "active");
  const repository = repositoryResult.data?.find((item) => item.provider === "github")
    || (website.repository_full_name ? { provider: "github", full_name: website.repository_full_name, default_branch: "main", access_status: "recorded" } : null);
  const vercel = serviceResult.data?.find((item) => /vercel/i.test(`${item.provider || ""} ${item.name || ""}`));
  const features = { ...FEATURE_DEFAULTS, ...Object.fromEntries((featureResult.data || []).map((item) => [item.feature_key, item.enabled])) };
  const websiteState = website.status === "active" ? "connected" : (website.status === "draft" ? "default" : "attention");
  const websiteDetail = website.status === "active"
    ? `${website.name} is active`
    : (website.status === "draft" ? `${website.name} is a draft · portal testing is allowed` : `Website status is ${website.status}`);
  const proposed = {
    portal_domain: proposedDomain,
    management_domain: normalizeHostname(domain?.domain_name),
    theme_id: website.portal_theme_id || "classic",
    logo_asset_id: branding.logo_asset_id || logo?.id || null,
    favicon_asset_id: branding.favicon_asset_id || favicon?.id || logo?.id || null,
    primary_color: branding.primary_color || DEFAULT_BRAND.primary_color,
    accent_color: branding.accent_color || DEFAULT_BRAND.accent_color,
    heading_font: branding.heading_font || DEFAULT_BRAND.heading_font,
    body_font: branding.body_font || DEFAULT_BRAND.body_font,
    powered_by_label: branding.powered_by_label ?? DEFAULT_BRAND.powered_by_label,
    features,
    public_counter: { ...COUNTER_DEFAULTS, ...(counterResult.data || {}) },
  };
  const connections = [
    connection("website", "Website record", websiteState, websiteDetail, true, "/n3xra-admin/websites/"),
    connection("portal_host", "N3XRA portal address", "attention", `${proposedDomain || "Portal address"} · wildcard infrastructure is verified by the deployed setup check`, true, "/n3xra-admin/website-portal/"),
    connection("membership", "Client access", activeMembers.length ? "connected" : "attention", activeMembers.length ? `${activeMembers.length} active website member${activeMembers.length === 1 ? "" : "s"}` : "Assign at least one active website member before activation", true, "/n3xra-admin/websites/"),
    connection("domain", "Custom portal domain", domain ? (domain.status === "active" ? "connected" : "attention") : "default", domain ? `${domain.domain_name} · ${domain.status}` : "Optional · the N3XRA portal address will be used", false, "/n3xra-admin/services/"),
    connection("branding", "Branding", proposed.logo_asset_id ? "connected" : "default", proposed.logo_asset_id ? `${assets.find((item) => item.id === proposed.logo_asset_id)?.label || "Logo"} and saved brand settings` : "Safe N3XRA defaults will be used", true, "/n3xra-admin/assets/"),
    connection("github", "GitHub", repository ? "recorded" : "missing", repository ? `${repository.full_name} · ${repository.default_branch || "main"}` : "No repository is connected", false, "/n3xra-admin/services/"),
    connection("vercel", "Vercel", vercel?.status === "active" ? "connected" : (vercel ? "attention" : "missing"), vercel ? `${vercel.name}${vercel.public_url ? ` · ${vercel.public_url}` : ""}` : "No Vercel hosting record is connected", false, "/n3xra-admin/services/"),
    connection("client_analytics", "Client analytics", features.analytics ? "attention" : "default", features.analytics ? "Run the deployed setup check to verify the saved Vercel connection" : "Optional · enable when this client should see traffic reports", false, "/n3xra-admin/website-portal/"),
    connection("supabase", "Supabase", "connected", `N3XRA shared project · ${assets.length} website asset${assets.length === 1 ? "" : "s"} isolated by website`, true, "/n3xra-admin/assets/"),
    connection("live_site", "Live website", website.live_url ? "recorded" : "missing", website.live_url || "No live URL is recorded", false, "/n3xra-admin/websites/"),
  ];
  const requiredReady = connections.filter((item) => item.required).every((item) => ["connected", "default"].includes(item.state));
  const completed = connections.filter((item) => ["connected", "recorded", "default"].includes(item.state)).length;
  return {
    website: { id: website.id, name: website.name, status: website.status, live_url: website.live_url, portal_enabled: Boolean(website.portal_enabled), portal_slug: portalSlug, organization_id: website.organization_id || null },
    proposed,
    assets,
    connections,
    readiness: { activation_ready: requiredReady, completed, total: connections.length, percent: Math.round((completed / connections.length) * 100) },
    analytics_connection: null,
    discovery: { remote_scanned: false, live_site: { connected: null, sourceUrl: website.live_url || "", error: "" }, detected_colors: [], detected_fonts: [] },
  };
}

async function serverAnalysis(websiteId, includeRemote) {
  const response = await fetch("/api/website-portal-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentSession.access_token}` },
    body: JSON.stringify({ website_id: websiteId, include_remote: includeRemote }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Setup analysis is unavailable.");
  return result;
}

function isLocalStaticPreview() {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname) && !window.location.port.startsWith("3");
}

function applyValues(values, { force = false } = {}) {
  if (!values || (formDirty && !force)) return;
  byId("portal-domain").value = values.management_domain || "";
  byId("portal-theme").value = values.theme_id || "classic";
  setPortalAssetValue("logo", values.logo_asset_id || "");
  setPortalAssetValue("favicon", values.favicon_asset_id || "");
  setColor("primary", values.primary_color || DEFAULT_BRAND.primary_color);
  setColor("accent", values.accent_color || DEFAULT_BRAND.accent_color);
  byId("portal-heading-font").value = values.heading_font || DEFAULT_BRAND.heading_font;
  byId("portal-body-font").value = values.body_font || DEFAULT_BRAND.body_font;
  byId("portal-powered-by").value = values.powered_by_label ?? DEFAULT_BRAND.powered_by_label;
  featureGrid.querySelectorAll("input[data-portal-feature]").forEach((input) => { input.checked = values.features?.[input.value] ?? true; });
  const counter = { ...COUNTER_DEFAULTS, ...(values.public_counter || {}) };
  byId("portal-public-counter-enabled").checked = Boolean(counter.enabled);
  byId("portal-public-counter-metric").value = counter.metric;
  byId("portal-public-counter-label").value = counter.label;
  formDirty = false;
}

function setColor(kind, value) {
  const normalized = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : DEFAULT_BRAND[`${kind}_color`];
  byId(`portal-${kind}-color`).value = normalized;
  byId(`portal-${kind}-color-text`).value = normalized;
}

function renderAssetOptions(result) {
  portalAssetChoices = result.assets.filter((asset) => asset.category === "logo" && safeAssetUrl(asset.public_url) && String(asset.mime_type || "").startsWith("image/"));
  updatePortalAssetTrigger("logo");
  updatePortalAssetTrigger("favicon");
}

function portalAssetFallback(kind) {
  return kind === "logo"
    ? { name: "Website name", prompt: "Choose logo", mark: "Aa" }
    : { name: "Default favicon", prompt: "Choose favicon", mark: "◇" };
}

function setPortalAssetValue(kind, assetId = "") {
  const selectedId = portalAssetChoices.some((asset) => asset.id === assetId) ? String(assetId) : "";
  byId(`portal-${kind}-asset`).value = selectedId;
  updatePortalAssetTrigger(kind);
}

function updatePortalAssetTrigger(kind) {
  const selectedId = byId(`portal-${kind}-asset`)?.value || "";
  const asset = portalAssetChoices.find((item) => item.id === selectedId);
  const fallback = portalAssetFallback(kind);
  const image = byId(`portal-${kind}-picker-image`);
  if (!image) return;
  image.innerHTML = asset
    ? `<img src="${escapeHtml(safeAssetUrl(asset.public_url))}" alt="">`
    : `<span>${fallback.mark}</span>`;
  byId(`portal-${kind}-picker-name`).textContent = asset?.label || fallback.name;
}

function renderPortalAssetDialog(kind) {
  const selectedId = byId(`portal-${kind}-asset`).value;
  const fallback = portalAssetFallback(kind);
  byId("portal-asset-dialog-title").textContent = kind === "logo" ? "Choose portal logo" : "Choose browser favicon";
  byId("portal-asset-dialog-copy").textContent = `Only approved images from ${selectedWebsite?.name || "this website"}’s Logo folder are shown.`;
  byId("portal-asset-dialog-options").setAttribute("aria-label", kind === "logo" ? "Choose a portal logo" : "Choose a browser favicon");
  byId("portal-asset-dialog-options").innerHTML = `
    <button class="website-portal-logo-option website-portal-logo-option-fallback${selectedId ? "" : " is-selected"}" type="button" data-portal-asset-choice="" role="option" aria-selected="${selectedId ? "false" : "true"}" aria-label="Use ${escapeHtml(fallback.name)}"><span class="website-portal-logo-image"><span>${fallback.mark}</span></span><span class="website-portal-logo-name">${escapeHtml(fallback.name)}</span></button>
    ${portalAssetChoices.map((asset) => `<button class="website-portal-logo-option${asset.id === selectedId ? " is-selected" : ""}" type="button" data-portal-asset-choice="${escapeHtml(asset.id)}" role="option" aria-selected="${asset.id === selectedId}" title="${escapeHtml(asset.label || "Logo image")}" aria-label="Use ${escapeHtml(asset.label || "logo image")}"><span class="website-portal-logo-image"><img src="${escapeHtml(safeAssetUrl(asset.public_url))}" alt="" loading="lazy"></span><span class="website-portal-logo-name">${escapeHtml(asset.label || "Logo image")}</span></button>`).join("")}
    ${portalAssetChoices.length ? "" : '<p class="website-portal-logo-empty">No approved images are currently available in this website’s Logo folder.</p>'}
  `;
}

function openPortalAssetDialog(kind) {
  const dialog = byId("portal-asset-dialog");
  dialog.dataset.assetKind = kind;
  renderPortalAssetDialog(kind);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closePortalAssetDialog() {
  const dialog = byId("portal-asset-dialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function openPortalCustomize() {
  const customize = byId("portal-customize");
  customize.open = true;
  const scrollRegion = customize.closest(".website-admin-scroll-region");
  if (!scrollRegion || getComputedStyle(scrollRegion).overflowY === "visible") {
    customize.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const regionBounds = scrollRegion.getBoundingClientRect();
  const customizeBounds = customize.getBoundingClientRect();
  const targetTop = scrollRegion.scrollTop + customizeBounds.top - regionBounds.top - 16;
  scrollRegion.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

function renderConnections(result) {
  const completed = result.connections.filter((item) => ["connected", "recorded", "default"].includes(item.state)).length;
  byId("portal-connection-count").textContent = `${completed} of ${result.connections.length} connected or recorded`;
  byId("portal-connection-list").innerHTML = result.connections.map((item) => `
    <a class="website-portal-connection is-${escapeHtml(item.state)}" href="${escapeHtml(item.action || "#")}">
      <span class="website-portal-connection-icon" aria-hidden="true"></span>
      <span class="website-portal-connection-copy"><strong>${escapeHtml(item.label)}</strong><span title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</span></span>
      <span class="website-portal-connection-meta">${item.required ? '<span class="website-portal-required">Required</span>' : ""}<span class="website-portal-arrow" aria-hidden="true">›</span></span>
    </a>
  `).join("");
}

function renderBrand(result) {
  const values = result.proposed;
  const logo = result.assets.find((asset) => asset.id === values.logo_asset_id);
  const preview = byId("portal-brand-preview");
  preview.style.setProperty("--brand-primary", values.primary_color);
  preview.style.setProperty("--brand-accent", values.accent_color);
  preview.style.setProperty("--brand-heading", values.heading_font);
  preview.style.setProperty("--brand-body", values.body_font);
  byId("portal-brand-name").textContent = result.website.name;
  const image = byId("portal-brand-logo");
  image.hidden = !logo?.public_url;
  if (logo?.public_url) image.src = logo.public_url;
  else image.removeAttribute("src");
  byId("portal-primary-swatch").style.background = values.primary_color;
  byId("portal-accent-swatch").style.background = values.accent_color;
  byId("portal-colors-label").textContent = `${values.primary_color} · ${values.accent_color}`;
  byId("portal-fonts-label").textContent = `${values.heading_font} · ${values.body_font}`;
  byId("portal-logo-label").textContent = logo?.label || "Website name fallback";
  const detectedParts = [];
  if (result.discovery.detected_colors?.length) detectedParts.push(`${result.discovery.detected_colors.length} colors`);
  if (result.discovery.detected_fonts?.length) detectedParts.push(`${result.discovery.detected_fonts.length} fonts`);
  const aiReview = result.discovery.ai_brand_analysis;
  const aiCopy = aiReview?.available
    ? `${aiReview.cached ? "Cached AI review" : "AI review"} ${aiReview.used ? "refined the recommendation" : "confirmed or preserved the guarded recommendation"}.`
    : "Deterministic brand analysis was used.";
  byId("portal-detection-note").textContent = result.discovery.remote_scanned
    ? (detectedParts.length ? `This selected website scan detected ${detectedParts.join(" and ")}. ${aiCopy} These are recommendations only until you apply or save them.` : `This selected website was checked. ${aiCopy} Its saved branding remains unchanged until you apply or save a recommendation.`)
    : "Showing this website’s saved branding. Use Refresh selected site to inspect only this website’s live CSS; nothing is saved automatically.";
}

function renderNextStep(result) {
  const blocker = result.connections.find((item) => item.required && ["missing", "attention"].includes(item.state));
  const suggestion = result.connections.find((item) => item.state === "suggested");
  if (blocker) {
    byId("portal-next-step-title").textContent = `${blocker.label} needs attention`;
    byId("portal-next-step-copy").textContent = blocker.detail;
  } else if (suggestion) {
    byId("portal-next-step-title").textContent = "Recommended setup is ready to apply";
    byId("portal-next-step-copy").textContent = `${suggestion.detail}. Review the recommendations or apply them now.`;
  } else if (!result.website.portal_enabled) {
    byId("portal-next-step-title").textContent = "Required setup checks are complete";
    byId("portal-next-step-copy").textContent = "Review the portal sections, then activate client access when you are ready.";
  } else {
    byId("portal-next-step-title").textContent = "Website Portal is active";
    byId("portal-next-step-copy").textContent = "Continue using this page to review connections and adjust client-visible sections.";
  }
}

function renderAnalysis(result, { apply = false } = {}) {
  analysis = result;
  renderAssetOptions(result);
  if (apply || !formDirty) applyValues(result.proposed, { force: apply });
  renderConnections(result);
  renderBrand(result);
  renderNextStep(result);
  const legacySiteName = byId("portal-site-name");
  if (legacySiteName) legacySiteName.textContent = `${result.website.name} Website Portal`;
  byId("portal-summary-title").textContent = result.website.portal_enabled ? `${result.website.name} portal is active` : `Set up ${result.website.name} portal`;
  byId("portal-summary-copy").textContent = result.website.portal_enabled
    ? "Client-branded access is enabled. Connection checks remain visible so infrastructure changes do not become hidden problems."
    : "N3XRA has assembled recommended settings from this website’s existing records, approved assets, and connected services.";
  byId("portal-address").hidden = !result.proposed.portal_domain;
  const address = portalUrl(result.proposed.portal_domain);
  byId("portal-address-value").textContent = address;
  byId("portal-copy-url").disabled = !address;
  byId("portal-open-url").href = address || "#";
  byId("portal-readiness-value").textContent = `${result.readiness.percent}%`;
  byId("portal-readiness-bar").style.width = `${result.readiness.percent}%`;
  const state = byId("portal-state");
  state.textContent = result.website.portal_enabled ? "Active" : "Not active";
  state.className = `website-portal-state ${result.website.portal_enabled ? "is-on" : "is-off"}`;
  byId("portal-activate").hidden = result.website.portal_enabled;
  byId("portal-deactivate").hidden = !result.website.portal_enabled;
  byId("portal-activate").disabled = !result.readiness.activation_ready;
  byId("portal-activation-copy").textContent = result.readiness.activation_ready
    ? (result.website.portal_enabled ? "Client access is active. Deactivation preserves all settings and can be reversed." : `Required checks are complete. Activating makes the portal available to assigned clients at ${result.proposed.portal_domain}.`)
    : "Resolve the required setup items shown above before activating client access.";
  renderPreviewFromForm();
}

function renderPreviewFromForm() {
  if (!analysis) return;
  const primary = byId("portal-primary-color").value;
  const accent = byId("portal-accent-color").value;
  const preview = byId("portal-brand-preview");
  preview.style.setProperty("--brand-primary", primary);
  preview.style.setProperty("--brand-accent", accent);
  preview.style.setProperty("--brand-heading", byId("portal-heading-font").value.trim() || DEFAULT_BRAND.heading_font);
  preview.style.setProperty("--brand-body", byId("portal-body-font").value.trim() || DEFAULT_BRAND.body_font);
  byId("portal-primary-swatch").style.background = primary;
  byId("portal-accent-swatch").style.background = accent;
  byId("portal-colors-label").textContent = `${primary} · ${accent}`;
  byId("portal-fonts-label").textContent = `${byId("portal-heading-font").value.trim() || DEFAULT_BRAND.heading_font} · ${byId("portal-body-font").value.trim() || DEFAULT_BRAND.body_font}`;
  const logo = analysis.assets.find((asset) => asset.id === byId("portal-logo-asset").value);
  const image = byId("portal-brand-logo");
  image.hidden = !logo?.public_url;
  if (logo?.public_url) image.src = logo.public_url;
  else image.removeAttribute("src");
  byId("portal-logo-label").textContent = logo?.label || "Website name fallback";
  renderCounterPreview();
}

function counterSnippet(publicKey) {
  if (!publicKey) return "Turn on the public counter to create this website’s private integration key.";
  return `<div data-n3xra-traffic-counter="${publicKey}" hidden>\n  <span data-n3xra-counter-value></span>\n  <span data-n3xra-counter-label></span>\n</div>\n<script src="https://www.n3xra.com/client-portal/public-traffic-counter.js?v=2" defer></script>`;
}

function renderCounterPreview() {
  const enabled = byId("portal-public-counter-enabled").checked;
  const label = byId("portal-public-counter-label").value.trim() || COUNTER_DEFAULTS.label;
  const metric = byId("portal-public-counter-metric").value;
  const preview = byId("portal-public-counter-preview");
  const details = byId("portal-public-counter-details");
  if (enabled && details.hidden) {
    details.hidden = false;
    details.open = true;
  } else if (!enabled) {
    details.hidden = true;
  }
  byId("portal-public-counter-preview-value").textContent = metric === "daily_visitors" ? "184" : "12,480";
  byId("portal-public-counter-preview-label").textContent = label;
  const publicKey = analysis?.proposed?.public_counter?.public_key || "";
  byId("portal-public-counter-code").value = counterSnippet(publicKey);
  byId("portal-copy-counter-code").disabled = !publicKey;
}

function restoreAdminScrollPosition(scrollTop) {
  const scrollRegion = document.querySelector(".website-admin-scroll-region");
  if (!scrollRegion || !Number.isFinite(scrollTop)) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    scrollRegion.scrollTop = Math.min(scrollTop, Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight));
  }));
}

async function analyze({ includeRemote = false, announce = true } = {}) {
  if (!selectedWebsite) return;
  const sequence = ++analysisSequence;
  const button = byId("portal-refresh-analysis");
  if (announce) setBusy(button, true, includeRemote ? "Scanning…" : "Checking…");
  const scanState = byId("portal-scan-state");
  scanState.textContent = includeRemote ? "Scanning website and connections…" : "Reading saved N3XRA data…";
  scanState.classList.add("is-working");
  try {
    const result = includeRemote && !isLocalStaticPreview()
      ? await serverAnalysis(selectedWebsite.id, true)
      : await directAnalysis(selectedWebsite);
    if (sequence !== analysisSequence) return;
    renderAnalysis(result);
    scanState.textContent = includeRemote && result.discovery.remote_scanned
      ? (result.discovery.ai_brand_analysis?.available ? "Live + AI brand review complete" : "Live website scan complete")
      : "Using saved N3XRA data";
    if (announce) message(includeRemote && isLocalStaticPreview()
      ? "Saved connections refreshed. Live-site inspection runs in a deployed preview or production."
      : `${selectedWebsite.name} recommendations refreshed. Review them, then apply or save only if they look right.`);
  } catch (error) {
    if (sequence !== analysisSequence) return;
    if (includeRemote && analysis) {
      scanState.textContent = "Saved data loaded · live scan unavailable";
      message(`${error?.message || "Live-site scan unavailable"} Saved setup information is still shown.`, true);
    } else {
      throw error;
    }
  } finally {
    if (sequence === analysisSequence) scanState.classList.remove("is-working");
    if (announce) setBusy(button, false);
  }
}

function settingsPayload() {
  const domainName = normalizeHostname(byId("portal-domain").value);
  return {
    domainName,
    website: { portal_theme_id: byId("portal-theme").value },
    branding: {
      website_id: selectedWebsite.id,
      logo_asset_id: byId("portal-logo-asset").value || null,
      favicon_asset_id: byId("portal-favicon-asset").value || null,
      primary_color: byId("portal-primary-color").value,
      accent_color: byId("portal-accent-color").value,
      heading_font: byId("portal-heading-font").value.trim() || DEFAULT_BRAND.heading_font,
      body_font: byId("portal-body-font").value.trim() || DEFAULT_BRAND.body_font,
      powered_by_label: byId("portal-powered-by").value.trim(),
    },
    features: [...featureGrid.querySelectorAll("input[data-portal-feature]")].map((input) => ({ website_id: selectedWebsite.id, feature_key: input.value, enabled: input.checked })),
    publicCounter: {
      website_id: selectedWebsite.id,
      enabled: byId("portal-public-counter-enabled").checked,
      metric: byId("portal-public-counter-metric").value,
      label: byId("portal-public-counter-label").value.trim() || COUNTER_DEFAULTS.label,
    },
  };
}

function setAccessSaveState(text, state = "") {
  const element = byId("portal-feature-save-state");
  element.textContent = text;
  element.classList.toggle("is-saving", state === "saving");
  element.classList.toggle("is-error", state === "error");
}

async function persistAccessSettings(payload, { connect = false } = {}) {
  setAccessSaveState("Saving…", "saving");
  if (connect) {
    const response = await fetch("/api/client-analytics-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentSession.access_token}` },
      body: JSON.stringify({ website_id: selectedWebsite.id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "Vercel Analytics could not be connected.");
  }
  const featureResult = await supabase.from("website_portal_features").upsert(payload.features, { onConflict: "website_id,feature_key" });
  if (featureResult.error) throw featureResult.error;
  const counterResult = await supabase.from("website_public_traffic_counters")
    .upsert(payload.publicCounter, { onConflict: "website_id" })
    .select("public_key,enabled,metric,label")
    .single();
  if (counterResult.error) throw counterResult.error;
  if (analysis?.proposed?.public_counter) {
    analysis.proposed.public_counter = { ...analysis.proposed.public_counter, ...counterResult.data };
    renderCounterPreview();
  }
  setAccessSaveState("Saved");
  message("Portal visibility settings saved automatically.");
}

function queueAccessSave({ connect = false } = {}) {
  const payload = settingsPayload();
  accessSaveQueue = accessSaveQueue.catch(() => {}).then(() => persistAccessSettings(payload, { connect }));
  accessSaveQueue.catch((error) => {
    setAccessSaveState("Not saved", "error");
    message(error?.message || "Portal visibility settings could not be saved.", true);
  });
  return accessSaveQueue;
}

async function saveSettings({ enabled = selectedWebsite?.portal_enabled, success = "Website Portal settings saved." } = {}) {
  const scrollTop = document.querySelector(".website-admin-scroll-region")?.scrollTop;
  const payload = settingsPayload();
  const analyticsEnabled = payload.features.some((feature) => feature.feature_key === "analytics" && feature.enabled);
  if (analyticsEnabled || payload.publicCounter.enabled) {
    message("Securely matching this website to its Vercel Analytics project…");
    const response = await fetch("/api/client-analytics-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentSession.access_token}` },
      body: JSON.stringify({ website_id: selectedWebsite.id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "Vercel Analytics could not be connected.");
  }
  const websiteResult = await supabase.from("client_websites").update({ ...payload.website, portal_enabled: Boolean(enabled) }).eq("id", selectedWebsite.id);
  if (websiteResult.error) throw websiteResult.error;
  const brandingResult = await supabase.from("website_portal_branding").upsert(payload.branding, { onConflict: "website_id" });
  if (brandingResult.error) throw brandingResult.error;
  const oldDomain = currentDomain();
  if (payload.domainName) {
    const sameDomain = normalizeHostname(oldDomain?.domain_name) === payload.domainName;
    const domainValues = {
      website_id: selectedWebsite.id,
      domain_name: payload.domainName,
      domain_purpose: "portal",
      status: sameDomain ? oldDomain.status : "pending",
      is_primary: false,
    };
    const domainResult = oldDomain
      ? await supabase.from("website_domains").update(domainValues).eq("id", oldDomain.id)
      : await supabase.from("website_domains").insert(domainValues);
    if (domainResult.error) throw domainResult.error;
  } else if (oldDomain) {
    const domainResult = await supabase.from("website_domains").delete().eq("id", oldDomain.id);
    if (domainResult.error) throw domainResult.error;
  }
  const featureResult = await supabase.from("website_portal_features").upsert(payload.features, { onConflict: "website_id,feature_key" });
  if (featureResult.error) throw featureResult.error;
  const counterResult = await supabase.from("website_public_traffic_counters").upsert(payload.publicCounter, { onConflict: "website_id" });
  if (counterResult.error) throw counterResult.error;
  selectedWebsite.portal_enabled = Boolean(enabled);
  selectedWebsite.portal_theme_id = payload.website.portal_theme_id;
  formDirty = false;
  message(success);
  await loadBaseData(selectedWebsite.id, { keepVisible: true });
  restoreAdminScrollPosition(scrollTop);
}

async function handleSave(event) {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, "Saving…");
  message("Saving portal overrides…");
  try { await saveSettings(); } catch (error) { message(error?.message || "Website Portal settings could not be saved.", true); } finally { setBusy(button, false); }
}

async function applyRecommended() {
  const button = byId("portal-auto-configure");
  setBusy(button, true, "Applying…");
  message("Applying detected branding, domain, and portal defaults…");
  try {
    applyValues(analysis.proposed, { force: true });
    await saveSettings({ success: "Recommended Website Portal setup applied. Review the checks, then activate when ready." });
  } catch (error) { message(error?.message || "Recommended setup could not be applied.", true); } finally { setBusy(button, false); }
}

async function activate(enabled) {
  const button = enabled ? byId("portal-activate") : byId("portal-deactivate");
  setBusy(button, true, enabled ? "Activating…" : "Deactivating…");
  message(enabled ? "Activating client access…" : "Deactivating client access…");
  try {
    await saveSettings({ enabled, success: enabled ? "Website Portal activated." : "Website Portal deactivated. Settings were preserved." });
  } catch (error) { message(error?.message || "Portal activation could not be changed.", true); } finally { setBusy(button, false); }
}

async function loadBaseData(preferredId, { keepVisible = false } = {}) {
  const [websiteResult, domainResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,slug,portal_slug,organization_id,status,live_url,repository_full_name,portal_enabled,portal_theme_id").order("name"),
    supabase.from("website_domains").select("id,website_id,domain_name,domain_purpose,status,is_primary").order("is_primary", { ascending: false }),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  websites = websiteResult.data || [];
  domains = domainResult.data || [];
  websiteSelect.innerHTML = websites.length ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("") : '<option value="">No managed websites</option>';
  const saved = readWorkspaceContext("admin", currentUser.id).websiteId;
  const selectedId = websites.some((item) => item.id === preferredId) ? preferredId : websites.some((item) => item.id === saved) ? saved : websites[0]?.id || "";
  websiteSelect.value = selectedId;
  selectedWebsite = websites.find((item) => item.id === selectedId) || null;
  consoleElement.hidden = !selectedWebsite;
  emptyElement.hidden = Boolean(selectedWebsite);
  if (!selectedWebsite) return;
  writeWorkspaceContext("admin", currentUser.id, { websiteId: selectedWebsite.id, name: selectedWebsite.name });
  if (!keepVisible) message();
  await analyze({ includeRemote: false, announce: false });
}

function bindEvents() {
  websiteSelect.addEventListener("change", async () => {
    selectedWebsite = websites.find((website) => website.id === websiteSelect.value) || null;
    if (!selectedWebsite) return;
    formDirty = false;
    writeWorkspaceContext("admin", currentUser.id, { websiteId: selectedWebsite.id, name: selectedWebsite.name, projectId: null, requestId: null, proposalId: null, onboardingId: null });
    try { await loadBaseData(selectedWebsite.id); } catch (error) { message(error?.message || "Website Portal setup could not be loaded.", true); }
  });
  form.addEventListener("submit", handleSave);
  form.addEventListener("input", () => { formDirty = true; renderPreviewFromForm(); });
  form.addEventListener("change", () => { formDirty = true; renderPreviewFromForm(); });
  featureGrid.addEventListener("change", (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    renderCounterPreview();
    void queueAccessSave({ connect: input.checked && (input.value === "analytics" || input.id === "portal-public-counter-enabled") });
  });
  byId("portal-public-counter-label").addEventListener("input", renderCounterPreview);
  byId("portal-public-counter-label").addEventListener("change", () => { void queueAccessSave(); });
  byId("portal-public-counter-metric").addEventListener("change", () => { renderCounterPreview(); void queueAccessSave(); });
  byId("portal-copy-counter-code").addEventListener("click", async () => {
    const code = byId("portal-public-counter-code").value;
    if (!analysis?.proposed?.public_counter?.public_key) return;
    try {
      await navigator.clipboard.writeText(code);
      byId("portal-copy-counter-code").textContent = "Copied";
      message("Website counter code copied. Paste it wherever the counter should appear, then style those two spans in the website’s own CSS.");
      window.setTimeout(() => { byId("portal-copy-counter-code").textContent = "Copy website code"; }, 1800);
    } catch {
      byId("portal-public-counter-code").focus();
      byId("portal-public-counter-code").select();
      message("The code is selected. Copy it manually from the box.", true);
    }
  });
  byId("portal-refresh-analysis").addEventListener("click", () => analyze({ includeRemote: true }).catch((error) => message(error.message, true)));
  byId("portal-auto-configure").addEventListener("click", applyRecommended);
  document.querySelectorAll("[data-portal-asset-picker]").forEach((button) => button.addEventListener("click", () => openPortalAssetDialog(button.dataset.portalAssetPicker)));
  byId("portal-asset-dialog-options").addEventListener("click", (event) => {
    const option = event.target.closest("[data-portal-asset-choice]");
    if (!option) return;
    const kind = byId("portal-asset-dialog").dataset.assetKind;
    setPortalAssetValue(kind, option.dataset.portalAssetChoice || "");
    formDirty = true;
    renderPreviewFromForm();
    closePortalAssetDialog();
  });
  byId("portal-asset-dialog-close").addEventListener("click", closePortalAssetDialog);
  byId("portal-asset-dialog").addEventListener("click", (event) => { if (event.target === byId("portal-asset-dialog")) closePortalAssetDialog(); });
  byId("portal-activate").addEventListener("click", () => activate(true));
  byId("portal-deactivate").addEventListener("click", () => activate(false));
  byId("portal-open-customize").addEventListener("click", openPortalCustomize);
  byId("portal-reset-recommendations").addEventListener("click", () => { applyValues(analysis?.proposed, { force: true }); renderPreviewFromForm(); message("Recommended values restored locally. Save to keep them."); });
  byId("portal-copy-url").addEventListener("click", async () => {
    const address = portalUrl(analysis?.proposed?.portal_domain);
    if (!address) return;
    const button = byId("portal-copy-url");
    try {
      await navigator.clipboard.writeText(address);
      button.textContent = "Copied";
      message("Portal URL copied. Use it as a normal sign-in link so the portal opens and returns in the same tab.");
      window.setTimeout(() => { button.textContent = "Copy URL"; }, 1800);
    } catch {
      message("The portal URL could not be copied automatically. Select the URL above and copy it manually.", true);
    }
  });
  ["primary", "accent"].forEach((kind) => {
    byId(`portal-${kind}-color`).addEventListener("input", (event) => { byId(`portal-${kind}-color-text`).value = event.target.value; });
    byId(`portal-${kind}-color-text`).addEventListener("input", (event) => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) byId(`portal-${kind}-color`).value = event.target.value; });
  });
}

async function init() {
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;
  currentSession = context.session;
  bindEvents();
  await loadBaseData();
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Website Portal setup could not be opened.";
});
