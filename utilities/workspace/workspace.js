import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const logoutButton = document.getElementById("workspace-logout");
const statusLine = document.getElementById("workspace-status");
const panel = document.getElementById("workspace-panel");
const title = document.getElementById("workspace-title");
const subtitle = document.getElementById("workspace-subtitle");
const statusPill = document.getElementById("workspace-status-pill");
const progress = document.getElementById("workspace-progress");
const progressCopy = document.getElementById("workspace-progress-copy");
const portalLink = document.getElementById("workspace-portal-link");
const mobilePortalLink = document.getElementById("workspace-mobile-portal-link");
const previewLink = document.getElementById("workspace-preview-link");
const summaryOrganization = document.getElementById("summary-organization");
const summaryStatus = document.getElementById("summary-status");
const summaryLaunch = document.getElementById("summary-launch");
const summaryUtilityProgress = document.getElementById("summary-utility-progress");
const summaryN3xraProgress = document.getElementById("summary-n3xra-progress");
const utilityStepList = document.getElementById("utility-step-list");
const n3xraStepList = document.getElementById("n3xra-step-list");
const moduleGrid = document.getElementById("workspace-module-grid");
const profileForm = document.getElementById("profile-form");
const brandingForm = document.getElementById("branding-form");
const settingsForm = document.getElementById("settings-form");

let supabase = null;
let session = null;
let workspace = null;

function setStatus(message, tone = "") {
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

function renderSteps(steps, container, canEdit) {
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

function moduleStateLabel(state) {
  const labels = {
    enabled: "Open",
    disabled: "Unavailable",
    requestable: "Request activation",
    coming_soon: "Coming soon",
    requires_n3xra_setup: "Requested",
  };
  return labels[state] || titleCase(state);
}

function moduleStateClass(state) {
  if (state === "enabled") return "is-enabled";
  if (state === "requestable") return "is-requestable";
  if (state === "requires_n3xra_setup") return "is-requested";
  return "is-disabled";
}

function moduleHref(module) {
  if (module.module_key === "finish_onboarding") return "#workspace-panel";
  return "";
}

function renderModules(modules) {
  const list = Array.isArray(modules) ? modules : [];
  if (!list.length) {
    moduleGrid.innerHTML = '<p class="utilities-list-empty">Workspace modules are not configured yet.</p>';
    return;
  }

  moduleGrid.innerHTML = list.map((module, index) => {
    const state = module.state || "requestable";
    const number = String(index + 1).padStart(2, "0");
    const stateClass = moduleStateClass(state);
    const actionLabel = moduleStateLabel(state);
    const body = `
      <span>${escapeHtml(number)}</span>
      <div>
        <small>${escapeHtml(titleCase(module.category || "module"))} · ${escapeHtml(actionLabel)}</small>
        <h2>${escapeHtml(module.name)}</h2>
        <p>${escapeHtml(module.description || "")}</p>
      </div>
    `;
    const href = moduleHref(module);
    if (state === "enabled" && href) {
      return `<a class="utilities-home-card ${stateClass}" href="${escapeHtml(href)}">${body}</a>`;
    }
    if (state === "requestable") {
      return `<button class="utilities-home-card ${stateClass}" type="button" data-module-key="${escapeHtml(module.module_key)}">${body}</button>`;
    }
    return `<button class="utilities-home-card ${stateClass}" type="button" disabled>${body}</button>`;
  }).join("");
}

function renderWorkspace() {
  const organization = workspace?.organization;
  if (!organization) {
    title.textContent = "No utility workspace found";
    subtitle.textContent = "This account is not linked to a utility organization yet.";
    panel.hidden = true;
    return;
  }

  const branding = workspace.branding || {};
  const settings = workspace.settings || {};
  const modules = settings.modules || {};
  const portalUrl = workspace.portal_url || `/utilities/portal/${encodeURIComponent(organization.slug || "")}`;
  const utilitySteps = (workspace.launch_steps || []).filter((step) => step.owner === "utility");
  const n3xraSteps = (workspace.launch_steps || []).filter((step) => step.owner === "n3xra");

  document.title = `${organization.name} | Utility Workspace`;
  title.textContent = organization.name || "Utility workspace";
  subtitle.textContent = `${titleCase(organization.status)} · ${titleCase(organization.launch_status)} · ${organization.access_role || "member"}`;
  statusPill.textContent = titleCase(organization.launch_status || "setup");
  progress.textContent = `${workspace.progress?.required_completed || 0}/${workspace.progress?.required_total || 0} required`;
  progressCopy.textContent = "Complete your tasks while N3XRA finishes platform-controlled setup items.";
  summaryOrganization.textContent = organization.name || "-";
  summaryStatus.textContent = titleCase(organization.status);
  summaryLaunch.textContent = titleCase(organization.launch_status);
  summaryUtilityProgress.textContent = `${workspace.progress?.utility_completed || 0}/${workspace.progress?.utility_total || 0}`;
  summaryN3xraProgress.textContent = `${workspace.progress?.n3xra_completed || 0}/${workspace.progress?.n3xra_total || 0}`;
  [portalLink, mobilePortalLink, previewLink].forEach((link) => {
    link.href = portalUrl;
  });

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

  renderSteps(utilitySteps, utilityStepList, true);
  renderSteps(n3xraSteps, n3xraStepList, false);
  renderModules(workspace.modules || []);
  panel.hidden = false;
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

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-profile", formDataObject(profileForm)).catch((error) => setStatus(error.message, "is-error"));
});

brandingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-branding", formDataObject(brandingForm)).catch((error) => setStatus(error.message, "is-error"));
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-settings", formDataObject(settingsForm)).catch((error) => setStatus(error.message, "is-error"));
});

utilityStepList.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-step-id]");
  if (!select) return;
  saveAction("update-step", {
    organization_id: organizationId(),
    step_id: select.getAttribute("data-step-id"),
    status: select.value,
  }).catch((error) => setStatus(error.message, "is-error"));
});

moduleGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-module-key]");
  if (!button) return;
  saveAction("request-module", {
    organization_id: organizationId(),
    module_key: button.getAttribute("data-module-key"),
  }).catch((error) => setStatus(error.message, "is-error"));
});

logoutButton.addEventListener("click", async () => {
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
