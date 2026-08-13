import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { resolveWebsiteUrl } from "/client-portal/website-url.js";
import {
  isBrandedPortalHostname,
  portalTenantEmptyMessage,
  resolvePortalTenant,
  scopeWebsitesToPortalTenant,
} from "/client-portal/tenant-context.js";

const CLIENT_ROUTES = [
  ...(isBrandedPortalHostname() ? [[["dashboard"], "Dashboard", "/client-portal/"]] : []),
  [["proposals", "progress", "onboarding"], "Progress", "/project-workspace/"],
  [["assets"], "Files & assets", "/client-portal/#files-assets"],
  [["services"], "Services & ownership", "/client-portal/services/"],
  [["billing"], "Billing", "/client-portal/billing/"],
];

const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const statusLabel = (value = "") => String(value || "active").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

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
      <div id="client-organization-links"></div>
    </section>
    <nav class="website-organization-navigation" aria-label="Selected organization sections">
      <p>Workspace</p>
      ${CLIENT_ROUTES.map(([keys, label, href]) => `<a class="${keys.includes(pageKey) ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}
    </nav>
    <div class="website-organization-intake-link"><span>Workspace tools</span><a href="/client-portal/#support">Get support</a><a href="/client-portal/#new-project">Start a new project</a></div>
  `;
}

export async function initializeClientWorkspaceContext(panel, { pageKey = "overview" } = {}) {
  if (!panel || !hasConfig()) return;
  renderShell(panel, pageKey);
  const supabase = createBrowserSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const tenantResolution = await resolvePortalTenant(supabase);

  const [websiteResult, domainResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,status,live_url,website_members(role,status,user_id)").order("name"),
    supabase.from("website_domains").select("website_id,domain_name,is_primary").order("is_primary", { ascending: false }),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  const websites = scopeWebsitesToPortalTenant(websiteResult.data || [], tenantResolution);
  const domains = domainResult.data || [];
  const context = readWorkspaceContext("client", session.user.id);
  const explicitWebsiteId = new URLSearchParams(window.location.search).get("website");
  let selectedId = websites.some((website) => website.id === explicitWebsiteId)
    ? explicitWebsiteId
    : websites.some((website) => website.id === context.websiteId) ? context.websiteId : websites[0]?.id || "";

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
      return;
    }
    selectedId = website.id;
    selectedValue.textContent = website.name;
    const websiteUrl = resolveWebsiteUrl(website, domains);
    options().forEach((option) => option.setAttribute("aria-selected", String(option.dataset.organizationId === website.id)));
    const membership = (website.website_members || []).find((row) => row.user_id === session.user.id && row.status === "active");
    card.hidden = false;
    panel.querySelector("#client-organization-status").textContent = membership?.role ? `${statusLabel(membership.role)} access` : statusLabel(website.status);
    panel.querySelector("#client-organization-name").textContent = website.name;
    panel.querySelector("#client-organization-url").textContent = websiteUrl || "Website is not live yet";
    panel.querySelector("#client-organization-links").innerHTML = websiteUrl
      ? `<a href="${escapeHtml(websiteUrl)}">Back to ${escapeHtml(website.name)} Website</a>`
      : "";
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
