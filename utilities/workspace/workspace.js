import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const page = document.body?.dataset?.workspacePage || "home";
const el = (id) => document.getElementById(id);

const logoutButton = el("workspace-logout");
const statusLine = el("workspace-status");
const title = el("workspace-title");
const subtitle = el("workspace-subtitle");
const statusPill = el("workspace-status-pill");
const progress = el("workspace-progress");
const progressCopy = el("workspace-progress-copy");
const portalLinks = [el("workspace-portal-link"), el("workspace-mobile-portal-link"), el("workspace-preview-link")].filter(Boolean);
const dashboardGrid = el("workspace-dashboard-grid");
const summaryOrganization = el("summary-organization");
const summaryStatus = el("summary-status");
const summaryLaunch = el("summary-launch");
const summaryUtilityProgress = el("summary-utility-progress");
const summaryN3xraProgress = el("summary-n3xra-progress");
const utilityStepList = el("utility-step-list");
const n3xraStepList = el("n3xra-step-list");
const moduleGrid = el("workspace-module-grid");
const profileForm = el("profile-form");
const brandingForm = el("branding-form");
const settingsForm = el("settings-form");
const logoPath = el("workspace-logo-path");

let supabase = null;
let session = null;
let workspace = null;

function setStatus(message, tone = "") {
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.className = "status-line";
  if (tone) statusLine.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getOrgParam() {
  return String(new URLSearchParams(window.location.search).get("org") || "").trim();
}

function organizationId() {
  return workspace?.organization?.id || "";
}

function isOnboardingComplete(organization) {
  return organization?.status === "active" && organization?.launch_status === "live";
}

function routeWithOrg(path) {
  const slug = workspace?.organization?.slug || getOrgParam();
  return slug ? `${path}?org=${encodeURIComponent(slug)}` : path;
}

function moduleByKey(key) {
  return (workspace?.modules || []).find((module) => module.module_key === key) || null;
}

function moduleState(key, fallback = "disabled") {
  return moduleByKey(key)?.state || fallback;
}

function moduleStateLabel(state) {
  const labels = {
    enabled: "On",
    disabled: "Inactive",
    requestable: "Request access",
    coming_soon: "Coming soon",
    requires_n3xra_setup: "Waiting on N3XRA",
  };
  return labels[state] || titleCase(state);
}

function dashboardCards() {
  const organization = workspace?.organization || {};
  const complete = isOnboardingComplete(organization);
  const requiredCompleted = workspace?.progress?.required_completed || 0;
  const requiredTotal = workspace?.progress?.required_total || 0;
  return [
    {
      title: complete ? "Onboarding complete" : "Finish onboarding",
      description: complete
        ? "Setup is complete. Review launch history and setup status any time."
        : "Complete setup tasks and track what N3XRA still needs to finish.",
      status: complete ? "Complete" : `${requiredCompleted}/${requiredTotal} required`,
      href: routeWithOrg("/utilities/workspace/onboarding"),
      tone: complete ? "is-complete" : "is-highlighted",
    },
    {
      title: "Account settings",
      description: "Company profile, contacts, branding, portal URL, and account details.",
      status: "Open",
      href: routeWithOrg("/utilities/workspace/settings"),
      tone: "is-active",
    },
    {
      title: "Dashboard settings",
      description: "Turn available workspace areas on or off and request access to future modules.",
      status: "Open",
      href: routeWithOrg("/utilities/workspace/features"),
      tone: "is-active",
    },
    {
      title: "Customer accounts",
      description: "Customer search, account profiles, service addresses, and account history.",
      status: moduleStateLabel(moduleState("customers")),
      tone: moduleState("customers") === "enabled" ? "is-enabled" : "is-inactive",
    },
    {
      title: "Work orders",
      description: "Service requests, assignments, internal notes, and status updates.",
      status: moduleStateLabel(moduleState("service_requests")),
      tone: moduleState("service_requests") === "enabled" ? "is-enabled" : "is-inactive",
    },
    {
      title: "Meter logs",
      description: "Meter reading logs, submissions, history, and meter issue tracking.",
      status: moduleStateLabel(moduleState("meter_readings", "requestable")),
      tone: "is-inactive",
    },
    {
      title: "GIS Maps",
      description: "Map-based utility operations and service-area views.",
      status: moduleStateLabel(moduleState("gis_maps", "coming_soon")),
      tone: "is-inactive",
    },
    {
      title: "N3XRA Records",
      description: "Documents, meeting records, board packets, and utility records.",
      status: moduleStateLabel(moduleState("n3xra_records", "coming_soon")),
      tone: "is-inactive",
    },
  ];
}

async function apiFetch(options = {}) {
  const accessToken = session?.access_token || "";
  if (!accessToken) throw new Error("Authentication required.");
  const org = getOrgParam();
  const response = await fetch(`/api/utilities-workspace${options.method ? "" : org ? `?org=${encodeURIComponent(org)}` : ""}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Utilities workspace request failed.");
  return data;
}

function setInput(form, name, value) {
  const input = form?.elements?.[name];
  if (!input) return;
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = value || "";
}

function renderHero() {
  const organization = workspace?.organization;
  if (!organization) {
    if (title) title.textContent = "No utility workspace found";
    if (subtitle) subtitle.textContent = "This account is not linked to a utility organization yet.";
    return;
  }
  const complete = isOnboardingComplete(organization);
  document.title = `${organization.name} | Utility Workspace`;
  if (title) title.textContent = organization.name || "Utility workspace";
  if (subtitle) subtitle.textContent = `${titleCase(organization.status)} · ${titleCase(organization.launch_status)} · ${organization.access_role || "member"}`;
  if (statusPill) statusPill.textContent = titleCase(organization.launch_status || "setup");
  if (progress) progress.textContent = `${workspace.progress?.required_completed || 0}/${workspace.progress?.required_total || 0} required`;
  if (progressCopy) {
    progressCopy.textContent = complete
      ? "Your utility workspace is live."
      : "Complete onboarding while N3XRA finishes platform-controlled setup items.";
  }
  portalLinks.forEach((link) => {
    link.href = workspace.portal_url || `/utilities/portal/${encodeURIComponent(organization.slug || "")}`;
  });
}

function renderSummary() {
  const organization = workspace?.organization || {};
  if (summaryOrganization) summaryOrganization.textContent = organization.name || "-";
  if (summaryStatus) summaryStatus.textContent = titleCase(organization.status);
  if (summaryLaunch) summaryLaunch.textContent = titleCase(organization.launch_status);
  if (summaryUtilityProgress) summaryUtilityProgress.textContent = `${workspace?.progress?.utility_completed || 0}/${workspace?.progress?.utility_total || 0}`;
  if (summaryN3xraProgress) summaryN3xraProgress.textContent = `${workspace?.progress?.n3xra_completed || 0}/${workspace?.progress?.n3xra_total || 0}`;
}

function renderDashboard() {
  if (!dashboardGrid) return;
  dashboardGrid.innerHTML = dashboardCards().map((card) => {
    const content = `
      <small>${escapeHtml(card.status)}</small>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.description)}</p>
    `;
    if (card.href) {
      return `<a class="workspace-dashboard-card ${escapeHtml(card.tone || "")}" href="${escapeHtml(card.href)}">${content}</a>`;
    }
    return `<article class="workspace-dashboard-card ${escapeHtml(card.tone || "is-inactive")}" aria-disabled="true">${content}</article>`;
  }).join("");
}

function renderSteps(steps, container, canEdit) {
  if (!container) return;
  if (!steps.length) {
    container.innerHTML = '<p class="utilities-list-empty">No setup tasks in this group.</p>';
    return;
  }
  container.innerHTML = steps.map((step) => `
    <article class="workspace-step">
      <div>
        <span>${escapeHtml(titleCase(step.status))}</span>
        <strong>${escapeHtml(step.title)}</strong>
        <p>${escapeHtml(step.description || "")}</p>
        <small>${step.required ? "Required" : "Optional"}${step.locked ? " · Locked" : ""}</small>
      </div>
      ${canEdit ? `
        <select data-step-id="${escapeHtml(step.id)}">
          ${["not_started", "in_progress", "completed", "skipped", "blocked"]
            .map((status) => `<option value="${status}" ${step.status === status ? "selected" : ""}>${escapeHtml(titleCase(status))}</option>`)
            .join("")}
        </select>
      ` : ""}
    </article>
  `).join("");
}

function renderOnboarding() {
  renderSummary();
  const utilitySteps = (workspace?.launch_steps || []).filter((step) => step.owner === "utility");
  const n3xraSteps = (workspace?.launch_steps || []).filter((step) => step.owner === "n3xra");
  renderSteps(utilitySteps, utilityStepList, true);
  renderSteps(n3xraSteps, n3xraStepList, false);
}

function renderSettings() {
  renderSummary();
  const organization = workspace?.organization || {};
  const branding = workspace?.branding || {};
  const settings = workspace?.settings || {};
  const modules = settings.modules || {};
  if (logoPath) logoPath.textContent = branding.logo_storage_path || "No logo path saved yet.";

  setInput(profileForm, "name", organization.name);
  setInput(profileForm, "legal_name", organization.legal_name);
  setInput(profileForm, "website", organization.website);
  setInput(profileForm, "primary_contact_name", organization.primary_contact_name);
  setInput(profileForm, "primary_contact_email", organization.primary_contact_email);
  setInput(profileForm, "primary_contact_phone", organization.primary_contact_phone);
  setInput(profileForm, "support_email", organization.support_email);
  setInput(profileForm, "support_phone", organization.support_phone);
  setInput(profileForm, "finance_contact_email", organization.metadata?.finance_contact_email);

  setInput(brandingForm, "portal_display_name", branding.portal_display_name);
  setInput(brandingForm, "primary_color", branding.primary_color);
  setInput(brandingForm, "secondary_color", branding.secondary_color);
  setInput(brandingForm, "accent_color", branding.accent_color);
  setInput(brandingForm, "email_reply_to", branding.email_reply_to);

  setInput(settingsForm, "service_types", (settings.service_types || []).join(", "));
  setInput(settingsForm, "customer_portal", modules.customer_portal !== false);
  setInput(settingsForm, "support_requests", modules.support_requests !== false);
  setInput(settingsForm, "document_uploads", modules.document_uploads !== false);
  setInput(settingsForm, "announcements", modules.announcements !== false);
}

function renderModules(modules) {
  if (!moduleGrid) return;
  const list = (Array.isArray(modules) ? modules : []).filter((module) => module.module_key !== "finish_onboarding");
  if (!list.length) {
    moduleGrid.innerHTML = '<p class="utilities-list-empty">No workspace features are configured yet.</p>';
    return;
  }

  moduleGrid.innerHTML = list.map((module) => {
    const state = module.state || "requestable";
    const canToggle = ["enabled", "disabled"].includes(state);
    const enabled = state === "enabled";
    const action = canToggle
      ? `<label class="workspace-feature-toggle">
          <input type="checkbox" data-module-key="${escapeHtml(module.module_key)}" ${enabled ? "checked" : ""}>
          <span>${enabled ? "On" : "Off"}</span>
        </label>`
      : state === "requestable"
        ? `<button class="secondary-action workspace-feature-request" type="button" data-request-module="${escapeHtml(module.module_key)}">Request</button>`
        : `<span class="workspace-feature-status">${escapeHtml(moduleStateLabel(state))}</span>`;
    return `
      <article class="workspace-feature-row">
        <div>
          <small>${escapeHtml(titleCase(module.category || "feature"))} · ${escapeHtml(moduleStateLabel(state))}</small>
          <strong>${escapeHtml(module.name)}</strong>
          <p>${escapeHtml(module.description || "")}</p>
        </div>
        ${action}
      </article>
    `;
  }).join("");
}

function renderWorkspace() {
  renderHero();
  if (!workspace?.organization) return;
  if (page === "home") renderDashboard();
  if (page === "onboarding") renderOnboarding();
  if (page === "settings") renderSettings();
  if (page === "features") renderModules(workspace.modules || []);
}

async function loadWorkspace() {
  setStatus("Loading workspace...");
  const data = await apiFetch();
  workspace = data.workspace || null;
  renderWorkspace();
  setStatus("Workspace loaded.", "is-active");
}

function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    data[input.name] = input.checked;
  });
  data.organization_id = organizationId();
  return data;
}

async function saveAction(action, payload) {
  setStatus("Saving...");
  await apiFetch({
    method: "PATCH",
    body: JSON.stringify({ action, ...payload }),
  });
  await loadWorkspace();
  setStatus("Saved.", "is-active");
}

profileForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-profile", formDataObject(profileForm)).catch((error) => setStatus(error.message, "is-error"));
});

brandingForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-branding", formDataObject(brandingForm)).catch((error) => setStatus(error.message, "is-error"));
});

settingsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-settings", formDataObject(settingsForm)).catch((error) => setStatus(error.message, "is-error"));
});

utilityStepList?.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-step-id]");
  if (!select) return;
  saveAction("update-step", {
    organization_id: organizationId(),
    step_id: select.getAttribute("data-step-id"),
    status: select.value,
  }).catch((error) => setStatus(error.message, "is-error"));
});

moduleGrid?.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-module-key]");
  if (!input) return;
  saveAction("update-module-state", {
    organization_id: organizationId(),
    module_key: input.getAttribute("data-module-key"),
    enabled: input.checked,
  }).catch((error) => setStatus(error.message, "is-error"));
});

moduleGrid?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-request-module]");
  if (!button) return;
  saveAction("request-module", {
    organization_id: organizationId(),
    module_key: button.getAttribute("data-request-module"),
  }).catch((error) => setStatus(error.message, "is-error"));
});

logoutButton?.addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  window.location.replace("/utilities/login");
});

async function init() {
  if (!hasConfig()) {
    setStatus("Missing N3XRA auth configuration.", "is-error");
    return;
  }
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(`/utilities/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return;
  }
  await loadWorkspace();
}

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Unable to load utility workspace.", "is-error");
});
