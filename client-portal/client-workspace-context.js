import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { resolveWebsiteUrl } from "/client-portal/website-url.js";
import {
  isBrandedPortalHostname,
  portalTenantEmptyMessage,
  resolvePortalTenant,
  scopeWebsitesToPortalTenant,
} from "/client-portal/tenant-context.js";

const brandedPortal = isBrandedPortalHostname();
const HIDDEN_CUSTOMER_PRODUCT_KEYS = new Set(["ai_music", "music", "virals"]);
const APP_ROUTES = [
  ...(brandedPortal ? [{ keys: ["dashboard"], label: "Apps Dashboard", href: "/client-portal/", requiresAdditionalApps: true }] : []),
  ...(brandedPortal ? [{ keys: ["records"], label: "Records", href: "/n3xra-records/library", requiresRecordsApp: true }] : []),
  { keys: ["team"], label: "Team & Permissions", href: "/client-portal/team/" },
  ...(brandedPortal || String(window.location.pathname).replace(/\/+$/, "") === "/client-portal/communications"
    ? [{ keys: ["communications"], label: "Communications", href: "/client-portal/communications/", requiresCommunicationsApp: brandedPortal }]
    : []),
  { keys: ["support"], label: "Support", href: "/client-portal/#support", feature: "support" },
];
const WEBSITE_ROUTES = [
  { keys: ["proposals", "progress", "onboarding"], label: "Progress", href: "/project-workspace/", feature: "progress", projectProgress: true },
  { keys: ["assets"], label: "Files & Assets", href: "/client-portal/#files-assets", feature: "files_assets" },
  { keys: ["services"], label: "Services & Ownership", href: "/client-portal/services/", feature: "services" },
  { keys: ["analytics"], label: "Analytics", href: "/client-portal/analytics/", feature: "analytics" },
  { keys: ["billing"], label: "Billing", href: "/client-portal/billing/", feature: "billing" },
  { keys: ["new-request"], label: "Start a New Project", href: "/client-portal/#new-project" },
];
const PAGE_FEATURES = {
  progress: "progress",
  proposals: "progress",
  onboarding: "progress",
  assets: "files_assets",
  services: "services",
  analytics: "analytics",
  billing: "billing",
  support: "support",
};

const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const statusLabel = (value = "") => String(value || "active").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

function featureMap(rows, websiteId) {
  return Object.fromEntries(rows
    .filter((feature) => feature.website_id === websiteId)
    .map((feature) => [feature.feature_key, feature.enabled]));
}

function defaultWebsiteRoute(features = {}) {
  const routes = [
    ["progress", "/project-workspace/", features.progress !== false],
    ["files_assets", "/client-portal/#files-assets", features.files_assets !== false],
    ["services", "/client-portal/services/", features.services !== false],
    ["analytics", "/client-portal/analytics/", features.analytics === true],
    ["billing", "/client-portal/billing/", features.billing !== false],
    ["support", "/client-portal/#support", features.support !== false],
  ];
  return routes.find(([, , enabled]) => enabled)?.[1] || "/client-portal/#new-project";
}

function featureEnabled(featureKey, features = {}) {
  return featureKey === "analytics" ? features.analytics === true : features[featureKey] !== false;
}

function updateWebsiteReturnLink(websiteUrl, websiteName = "your website") {
  const actions = document.querySelector(".client-portal-topbar .site-nav-actions");
  const destination = brandedPortal ? websiteUrl : "/account/";
  if (!actions || !destination) {
    document.querySelectorAll("[data-client-website-return]").forEach((link) => link.remove());
    return;
  }
  let returnLink = actions.querySelector("[data-client-website-return]");
  if (!returnLink) {
    returnLink = document.createElement("a");
    returnLink.className = "site-menu-link client-website-return-link";
    returnLink.dataset.clientWebsiteReturn = "";
    actions.prepend(returnLink);
  }
  returnLink.href = destination;
  returnLink.textContent = brandedPortal ? "Return to Website" : "Return to Dashboard";
  returnLink.setAttribute("aria-label", brandedPortal ? `Return to ${websiteName} website` : "Return to N3XRA dashboard");
  document.querySelectorAll(".site-mobile-menu [data-client-website-return]").forEach((mobileLink) => {
    mobileLink.href = destination;
    mobileLink.textContent = brandedPortal ? "Return to Website" : "Return to Dashboard";
    mobileLink.setAttribute("aria-label", brandedPortal ? `Return to ${websiteName} website` : "Return to N3XRA dashboard");
  });
}

function routeMarkup(route, pageKey) {
  const availability = `${route.requiresAdditionalApps ? " data-client-app-dashboard hidden" : ""}${route.requiresRecordsApp ? " data-client-records-app hidden" : ""}${route.requiresCommunicationsApp ? " data-client-communications-app hidden" : ""}${route.feature ? ` data-client-feature="${route.feature}" hidden` : ""}${route.projectProgress ? " data-client-project-progress" : ""}`;
  return `<a class="${route.keys.includes(pageKey) ? "is-current" : ""}" href="${route.href}"${availability}>${route.label}</a>`;
}

function renderShell(panel, pageKey) {
  panel.innerHTML = `
    <div class="website-organization-panel-head">
      <p class="portal-kicker">Organization workspace</p>
      <div class="website-organization-picker" id="client-organization-picker">
        <span class="website-organization-picker-label" id="client-organization-picker-label">Viewing</span>
        <button class="website-organization-picker-trigger" id="client-organization-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="client-organization-options" aria-labelledby="client-organization-picker-label client-organization-value">
          <span id="client-organization-value">Loading organizations…</span><i aria-hidden="true"></i>
        </button>
        <div class="website-organization-picker-menu" id="client-organization-options" role="listbox" aria-labelledby="client-organization-picker-label" hidden></div>
      </div>
    </div>
    <section class="website-organization-card" id="client-organization-card" hidden>
      <span id="client-organization-status">Website access</span>
      <strong id="client-organization-name">Organization</strong>
      <small id="client-organization-url"></small>
    </section>
    <nav class="website-organization-navigation" aria-label="Selected organization sections">
      <p>${brandedPortal ? "Apps" : "N3XRA"}</p>
      ${APP_ROUTES.map((route) => routeMarkup(route, pageKey)).join("")}
      <p class="is-separated">Website Workspace</p>
      ${WEBSITE_ROUTES.map((route) => routeMarkup(route, pageKey)).join("")}
    </nav>
  `;
}

async function visiblePortalAppKeys(supabase, organizationId) {
  if (!organizationId) return [];
  const { data, error } = await supabase
    .from("organization_product_entitlements")
    .select("product:n3xra_product_catalog(product_key,status,client_portal_available,portal_path)")
    .eq("organization_id", organizationId)
    .eq("portal_enabled", true)
    .in("status", ["trialing", "active", "past_due"]);
  if (error) return [];
  return (data || []).flatMap((row) => {
    const products = Array.isArray(row.product) ? row.product : [row.product];
    return products.filter((product) => {
      const productKey = String(product?.product_key || "").toLowerCase();
      const portalPath = String(product?.portal_path || "").trim();
      return product?.status === "active"
        && product?.client_portal_available
        && !HIDDEN_CUSTOMER_PRODUCT_KEYS.has(productKey)
        && /^\/(?!\/)[^\s]*$/.test(portalPath);
    }).map((product) => String(product.product_key || "").toLowerCase());
  });
}

function setAppsDashboardAvailability(available) {
  document.querySelectorAll("[data-client-app-dashboard]").forEach((item) => {
    item.hidden = !available;
  });
}

function setRecordsAvailability(available, organizationId = "") {
  document.querySelectorAll("[data-client-records-app]").forEach((item) => {
    item.hidden = !available;
    if (available && organizationId) item.href = `/n3xra-records/library?support_org=${encodeURIComponent(organizationId)}`;
  });
}

function setCommunicationsAvailability(available) {
  document.querySelectorAll("[data-client-communications-app]").forEach((item) => {
    item.hidden = !available;
  });
}

export async function initializeClientWorkspaceContext(panel, { pageKey = "overview" } = {}) {
  if (!panel || !hasConfig()) return;
  renderShell(panel, pageKey);
  const supabase = createBrowserSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const tenantResolution = await resolvePortalTenant(supabase);

  const [websiteResult, domainResult, featureResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,status,live_url,organization_id,website_members(role,status,user_id)").order("name"),
    supabase.from("website_domains").select("website_id,domain_name,is_primary").order("is_primary", { ascending: false }),
    supabase.from("website_portal_features").select("website_id,feature_key,enabled"),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  if (featureResult.error) throw featureResult.error;
  const websites = scopeWebsitesToPortalTenant(websiteResult.data || [], tenantResolution);
  const domains = domainResult.data || [];
  const context = readWorkspaceContext("client", session.user.id);
  const explicitWebsiteId = new URLSearchParams(window.location.search).get("website");
  let selectedId = websites.some((website) => website.id === explicitWebsiteId)
    ? explicitWebsiteId
    : websites.some((website) => website.id === context.websiteId) ? context.websiteId : websites[0]?.id || "";
  const selectedWebsite = websites.find((website) => website.id === selectedId);
  const portalAppKeys = tenantResolution.mode === "tenant"
    ? await visiblePortalAppKeys(supabase, selectedWebsite?.organization_id)
    : [];
  setAppsDashboardAvailability(portalAppKeys.length > 1);
  setRecordsAvailability(portalAppKeys.includes("records"), selectedWebsite?.organization_id);
  setCommunicationsAvailability(portalAppKeys.includes("communications"));

  const picker = panel.querySelector("#client-organization-picker");
  const trigger = panel.querySelector("#client-organization-trigger");
  const selectedValue = panel.querySelector("#client-organization-value");
  const menu = panel.querySelector("#client-organization-options");
  picker.hidden = tenantResolution.mode !== "unbound";

  function options() {
    return [...menu.querySelectorAll('[role="option"]')];
  }

  function renderOptions() {
    menu.innerHTML = websites.length
      ? websites.map((website) => `<button type="button" role="option" data-organization-id="${escapeHtml(website.id)}" aria-selected="${website.id === selectedId}"><span>${escapeHtml(website.name)}</span><i aria-hidden="true"></i></button>`).join("")
      : `<div class="website-organization-picker-empty">${escapeHtml(portalTenantEmptyMessage(tenantResolution))}</div>`;
    trigger.disabled = tenantResolution.mode !== "unbound" || !websites.length;
  }

  function showOrganization(websiteId, { persist = true } = {}) {
    const website = websites.find((item) => item.id === websiteId);
    const card = panel.querySelector("#client-organization-card");
    if (!website) {
      selectedValue.textContent = portalTenantEmptyMessage(tenantResolution);
      card.hidden = true;
      updateWebsiteReturnLink("");
      return;
    }
    selectedId = website.id;
    const selectedFeatures = featureMap(featureResult.data || [], website.id);
    document.querySelectorAll("[data-client-feature]").forEach((item) => {
      const featureKey = item.dataset.clientFeature;
      item.hidden = featureKey === "analytics" ? selectedFeatures.analytics !== true : selectedFeatures[featureKey] === false;
    });
    const currentFeature = PAGE_FEATURES[pageKey];
    if (currentFeature && !featureEnabled(currentFeature, selectedFeatures)) {
      window.location.replace(defaultWebsiteRoute(selectedFeatures));
      return;
    }
    selectedValue.textContent = website.name;
    const websiteUrl = resolveWebsiteUrl(website, domains);
    options().forEach((option) => option.setAttribute("aria-selected", String(option.dataset.organizationId === website.id)));
    const membership = (website.website_members || []).find((row) => row.user_id === session.user.id && row.status === "active");
    card.hidden = false;
    panel.querySelector("#client-organization-status").textContent = membership?.role ? `${statusLabel(membership.role)} access` : statusLabel(website.status);
    panel.querySelector("#client-organization-name").textContent = website.name;
    panel.querySelector("#client-organization-url").textContent = websiteUrl || "Website is not live yet";
    updateWebsiteReturnLink(websiteUrl, website.name);
    if (persist) {
      const previous = readWorkspaceContext("client", session.user.id);
      writeWorkspaceContext("client", session.user.id, {
        websiteId: website.id,
        name: website.name,
        ...(previous.websiteId && previous.websiteId !== website.id
          ? { projectId: null, requestId: null, proposalId: null, onboardingId: null }
          : {}),
      });
    }
  }

  function closePicker({ restoreFocus = false } = {}) {
    menu.hidden = true;
    picker.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  function openPicker(focusIndex) {
    if (trigger.disabled) return;
    menu.hidden = false;
    picker.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    if (Number.isInteger(focusIndex)) {
      const available = options();
      window.requestAnimationFrame(() => available[Math.max(0, Math.min(focusIndex, available.length - 1))]?.focus());
    }
  }

  function chooseOrganization(websiteId) {
    if (!websites.some((website) => website.id === websiteId)) return;
    const changed = websiteId !== selectedId;
    showOrganization(websiteId);
    closePicker();
    if (changed) window.location.reload();
  }

  renderOptions();
  showOrganization(selectedId, { persist: context.websiteId !== selectedId });
  trigger.addEventListener("click", () => menu.hidden ? openPicker() : closePicker());
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closePicker();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const available = options();
    const current = Math.max(0, available.findIndex((option) => option.getAttribute("aria-selected") === "true"));
    openPicker(event.key === "End" ? available.length - 1 : event.key === "ArrowUp" ? current - 1 : event.key === "ArrowDown" ? current + 1 : 0);
  });
  menu.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) chooseOrganization(option.dataset.organizationId);
  });
  menu.addEventListener("keydown", (event) => {
    const available = options();
    const current = available.indexOf(event.target.closest('[role="option"]'));
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker({ restoreFocus: true });
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : current + (event.key === "ArrowDown" ? 1 : -1);
      available[Math.max(0, Math.min(next, available.length - 1))]?.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) closePicker();
  });
  window.addEventListener("n3xra:workspace-context-change", (event) => {
    if (event.detail?.scope === "client" && websites.some((website) => website.id === event.detail.context?.websiteId)) {
      showOrganization(event.detail.context.websiteId, { persist: false });
    }
  });
}
