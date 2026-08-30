import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=5";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { resolveWebsiteUrl } from "/client-portal/website-url.js";

const ORGANIZATION_ROUTES = [
  [["overview", "new"], "Overview", "/n3xra-admin/websites/"],
  [["proposals", "progress", "onboarding"], "Project", "/n3xra-admin/projects/"],
  [["assets"], "Files & assets", "/n3xra-admin/assets/"],
  [["publishing"], "Website Publishing", "/n3xra-admin/publishing/"],
  [["build"], "Build Studio", "/n3xra-admin/build-studio/"],
  [["services"], "Services & ownership", "/n3xra-admin/services/"],
  [["billing"], "Billing", "/n3xra-admin/billing/"],
];

const ADVANCED_WEBSITE_ROUTES = [
  [["portal"], "Website Portal", "/n3xra-admin/website-portal/"],
];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function statusLabel(value = "") {
  return String(value || "active").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderShell(panel, pageKey) {
  panel.innerHTML = `
    <div class="website-organization-panel-head">
      <p class="portal-kicker">Organization workspace</p>
      <div class="website-organization-picker" id="website-admin-organization-picker">
        <span class="website-organization-picker-label" id="website-admin-organization-picker-label">Working with</span>
        <button class="website-organization-picker-trigger" id="website-admin-organization-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="website-admin-organization-options" aria-labelledby="website-admin-organization-picker-label website-admin-organization-value">
          <span id="website-admin-organization-value">Loading organizations…</span><i aria-hidden="true"></i>
        </button>
        <div class="website-organization-picker-menu" id="website-admin-organization-options" role="listbox" aria-labelledby="website-admin-organization-picker-label" hidden></div>
      </div>
    </div>
    <section class="website-organization-card" id="website-admin-organization-card" hidden>
      <span id="website-admin-organization-status">Managed website</span>
      <strong id="website-admin-organization-name">Organization</strong>
      <small id="website-admin-organization-url"></small>
      <div id="website-admin-organization-links"></div>
    </section>
    <nav class="website-organization-navigation" aria-label="Selected organization sections">
      <p>Workspace</p>
      ${ORGANIZATION_ROUTES.map(([keys, label, href]) => `<a class="${keys.includes(pageKey) ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}
      <p>Advanced website options</p>
      ${ADVANCED_WEBSITE_ROUTES.map(([keys, label, href]) => `<a class="${keys.includes(pageKey) ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}
    </nav>
    <div class="website-organization-intake-link"><span>Not attached yet?</span><a href="/n3xra-admin/requests/">Open intake inbox</a></div>
  `;
}

export async function initializeWebsiteOrganizationContext(panel, { pageKey = "overview" } = {}) {
  if (!panel || !hasConfig()) return;
  renderShell(panel, pageKey);
  const adminContext = await getAdminSession();
  if (!adminContext.allowed) return;
  const { supabase, session } = adminContext;
  const [websiteResult, domainResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,status,live_url").order("name"),
    supabase.from("website_domains").select("website_id,domain_name,is_primary").order("is_primary", { ascending: false }),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  const websites = websiteResult.data || [];
  const domains = domainResult.data || [];
  const context = readWorkspaceContext("admin", session.user.id);
  let selectedId = websites.some((website) => website.id === context.websiteId) ? context.websiteId : websites[0]?.id || "";
  const picker = panel.querySelector("#website-admin-organization-picker");
  const trigger = panel.querySelector("#website-admin-organization-trigger");
  const selectedValue = panel.querySelector("#website-admin-organization-value");
  const menu = panel.querySelector("#website-admin-organization-options");
  menu.innerHTML = websites.length
    ? websites.map((website) => `<button type="button" role="option" data-organization-id="${escapeHtml(website.id)}" aria-selected="${website.id === selectedId}"><span>${escapeHtml(website.name)}</span><i aria-hidden="true"></i></button>`).join("")
    : '<div class="website-organization-picker-empty">No managed organizations</div>';
  trigger.disabled = !websites.length;
  selectedValue.textContent = websites.find((website) => website.id === selectedId)?.name || "No managed organizations";

  function showOrganization(websiteId, { persist = true } = {}) {
    const website = websites.find((item) => item.id === websiteId);
    const card = panel.querySelector("#website-admin-organization-card");
    if (!website) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const websiteUrl = resolveWebsiteUrl(website, domains);
    panel.querySelector("#website-admin-organization-status").textContent = statusLabel(website.status);
    panel.querySelector("#website-admin-organization-name").textContent = website.name;
    panel.querySelector("#website-admin-organization-url").textContent = websiteUrl || "No live website connected";
    panel.querySelector("#website-admin-organization-links").innerHTML = `${websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">Visit website</a>` : ""}<a href="/client-portal/?website=${encodeURIComponent(website.id)}">Client workspace</a>`;
    if (persist) {
      const previous = readWorkspaceContext("admin", session.user.id);
      writeWorkspaceContext("admin", session.user.id, {
        websiteId: website.id,
        name: website.name,
        ...(previous.websiteId && previous.websiteId !== website.id
          ? { requestId: null, proposalId: null, projectId: null, onboardingId: null }
          : {}),
      });
    }
  }

  showOrganization(selectedId, { persist: context.websiteId !== selectedId });

  function options() {
    return [...menu.querySelectorAll('[role="option"]')];
  }

  function presentOrganization(websiteId) {
    const website = websites.find((item) => item.id === websiteId);
    if (!website) return;
    selectedId = website.id;
    selectedValue.textContent = website.name;
    options().forEach((option) => option.setAttribute("aria-selected", String(option.dataset.organizationId === website.id)));
    showOrganization(website.id, { persist: false });
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
      const index = Math.max(0, Math.min(focusIndex, available.length - 1));
      window.requestAnimationFrame(() => available[index]?.focus());
    }
  }

  function chooseOrganization(websiteId) {
    const website = websites.find((item) => item.id === websiteId);
    if (!website) return;
    const changed = website.id !== selectedId;
    presentOrganization(website.id);
    closePicker();
    if (!changed) return;
    showOrganization(website.id);
    window.location.reload();
  }

  trigger.addEventListener("click", () => {
    if (menu.hidden) openPicker();
    else closePicker();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closePicker();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const available = options();
    const selectedIndex = Math.max(0, available.findIndex((option) => option.getAttribute("aria-selected") === "true"));
    openPicker(event.key === "End" ? available.length - 1 : event.key === "ArrowUp" ? selectedIndex - 1 : event.key === "ArrowDown" ? selectedIndex + 1 : 0);
  });
  menu.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) chooseOrganization(option.dataset.organizationId);
  });
  menu.addEventListener("keydown", (event) => {
    const available = options();
    const currentIndex = available.indexOf(event.target.closest('[role="option"]'));
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker({ restoreFocus: true });
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      available[Math.max(0, Math.min(nextIndex, available.length - 1))]?.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) closePicker();
  });
  window.addEventListener("n3xra:workspace-context-change", (event) => {
    if (!panel.isConnected || event.detail?.scope !== "admin") return;
    const websiteId = event.detail?.context?.websiteId;
    if (websiteId && websiteId !== selectedId) presentOrganization(websiteId);
  });
}
