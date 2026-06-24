import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const PLATFORM_ADMIN_EMAILS = new Set(["quentin@n3xra.com", "quentin@quentinnichols.com"]);

const logoutButton = document.getElementById("utilities-admin-logout");
const refreshButton = document.getElementById("utilities-admin-refresh");
const statusLine = document.getElementById("utilities-admin-status");
const adminPanel = document.getElementById("utilities-admin-panel");
const orgList = document.getElementById("utilities-org-list");
const orgCount = document.getElementById("utilities-admin-count");
const emptyState = document.getElementById("utilities-admin-empty");
const detailContent = document.getElementById("utilities-admin-detail-content");
const detailEyebrow = document.getElementById("detail-eyebrow");
const detailName = document.getElementById("detail-name");
const detailMeta = document.getElementById("detail-meta");
const detailPortalLink = document.getElementById("detail-portal-link");
const statusForm = document.getElementById("utilities-status-form");
const organizationStatusInput = document.getElementById("organization-status");
const launchStatusInput = document.getElementById("launch-status");
const portalSummary = document.getElementById("portal-summary");
const brandingSummary = document.getElementById("branding-summary");
const paymentSummary = document.getElementById("payment-summary");
const contactSummary = document.getElementById("contact-summary");
const launchProgress = document.getElementById("launch-progress");
const launchStepList = document.getElementById("launch-step-list");
const settingsPreview = document.getElementById("settings-preview");

let supabase = null;
let session = null;
let organizations = [];
let selectedOrganizationId = "";

function lockAdminShell() {
  adminPanel.hidden = true;
  emptyState.hidden = true;
  detailContent.hidden = true;
  refreshButton.hidden = true;
  logoutButton.hidden = true;
  orgList.innerHTML = "";
  orgCount.textContent = "0";
}

function unlockAdminShell() {
  refreshButton.hidden = false;
  logoutButton.hidden = false;
}

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

function getSelectedOrganization() {
  return organizations.find((organization) => organization.id === selectedOrganizationId) || null;
}

function primaryDomain(organization) {
  return (organization?.domains || []).find((domain) => domain.is_primary) || organization?.domains?.[0] || null;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function summaryHtml(entries) {
  return entries
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd>`)
    .join("");
}

async function apiFetch(path = "", options = {}) {
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Authentication required.");

  const response = await fetch(`/api/utilities-admin${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Utilities admin request failed.");
  return data;
}

function renderList() {
  orgCount.textContent = String(organizations.length);
  if (!organizations.length) {
    orgList.innerHTML = '<p class="utilities-list-empty">No utility organizations yet.</p>';
    return;
  }

  orgList.innerHTML = organizations
    .map((organization) => {
      const domain = primaryDomain(organization);
      const progress = organization.launch_progress || {};
      const selected = organization.id === selectedOrganizationId ? " is-selected" : "";
      return `
        <button class="utilities-org-button${selected}" type="button" data-id="${escapeHtml(organization.id)}">
          <strong>${escapeHtml(organization.name)}</strong>
          <span>${escapeHtml(domain?.domain || organization.slug)}</span>
          <small>${escapeHtml(titleCase(organization.status))} · ${Number(progress.required_completed || 0)}/${Number(progress.required_total || 0)} required</small>
        </button>
      `;
    })
    .join("");
}

function renderSteps(organization) {
  const steps = organization.launch_steps || [];
  const progress = organization.launch_progress || {};
  launchProgress.textContent = `${Number(progress.required_completed || 0)}/${Number(progress.required_total || 0)} required`;

  if (!steps.length) {
    launchStepList.innerHTML = '<p class="utilities-list-empty">No launch steps found.</p>';
    return;
  }

  launchStepList.innerHTML = steps
    .map((step) => `
      <div class="launch-step" data-step-id="${escapeHtml(step.id)}">
        <div>
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.description || "")}</span>
          <small>${step.required ? "Required" : "Optional"}${step.locked ? " · Locked" : ""}${step.completed_at ? ` · Completed ${escapeHtml(formatDate(step.completed_at))}` : ""}</small>
        </div>
        <select data-step-status="${escapeHtml(step.id)}" ${step.locked && step.status !== "blocked" ? "disabled" : ""}>
          ${["not_started", "in_progress", "completed", "skipped", "blocked"]
            .map((status) => `<option value="${status}" ${step.status === status ? "selected" : ""}>${escapeHtml(titleCase(status))}</option>`)
            .join("")}
        </select>
      </div>
    `)
    .join("");
}

function renderDetail() {
  const organization = getSelectedOrganization();
  emptyState.hidden = Boolean(organization);
  detailContent.hidden = !organization;
  if (!organization) return;

  const domain = primaryDomain(organization);
  const branding = organization.branding || {};
  const settings = organization.settings || {};
  const paymentPreferences = settings.payment_preferences || {};

  detailEyebrow.textContent = organization.legal_name || "Organization";
  detailName.textContent = organization.name || "Utility";
  detailMeta.textContent = `Created ${formatDate(organization.created_at)} · ${titleCase(organization.status)} · ${titleCase(organization.launch_status)}`;
  detailPortalLink.href = `/utilities/portal/${encodeURIComponent(organization.slug || "")}`;
  detailPortalLink.hidden = !domain?.domain && !organization.slug;
  organizationStatusInput.value = organization.status || "onboarding";
  launchStatusInput.value = organization.launch_status || "draft";

  portalSummary.innerHTML = summaryHtml([
    ["Slug", organization.slug],
    ["Primary domain", domain?.domain],
    ["Domain type", titleCase(domain?.domain_type)],
    ["DNS status", titleCase(domain?.verification_status)],
  ]);

  brandingSummary.innerHTML = summaryHtml([
    ["Display name", branding.portal_display_name],
    ["Logo", branding.logo_storage_path || branding.metadata?.logo_url],
    ["Primary color", branding.primary_color],
    ["Secondary color", branding.secondary_color],
    ["Email reply-to", branding.email_reply_to],
  ]);

  paymentSummary.innerHTML = summaryHtml([
    ["Mode", titleCase(paymentPreferences.payment_mode || "stripe_connect")],
    ["Stripe Connect", paymentPreferences.wants_stripe_connect === false ? "Not requested" : "Required"],
    ["Stripe status", titleCase(organization.stripe_connect_status)],
    ["Charges enabled", organization.stripe_charges_enabled ? "Yes" : "No"],
    ["Payouts enabled", organization.stripe_payouts_enabled ? "Yes" : "No"],
  ]);

  contactSummary.innerHTML = summaryHtml([
    ["Primary contact", organization.primary_contact_name],
    ["Primary email", organization.primary_contact_email],
    ["Primary phone", organization.primary_contact_phone],
    ["Support email", organization.support_email],
    ["Support phone", organization.support_phone],
    ["Finance email", organization.metadata?.finance_contact_email],
  ]);

  renderSteps(organization);
  settingsPreview.textContent = JSON.stringify(settings, null, 2);
}

async function loadOrganizations() {
  setStatus("Loading utility organizations...");
  const data = await apiFetch("");
  organizations = data.organizations || [];
  if (!selectedOrganizationId && organizations[0]) selectedOrganizationId = organizations[0].id;
  if (selectedOrganizationId && !organizations.some((organization) => organization.id === selectedOrganizationId)) {
    selectedOrganizationId = organizations[0]?.id || "";
  }
  renderList();
  renderDetail();
  adminPanel.hidden = false;
  setStatus(`${organizations.length} utility organization${organizations.length === 1 ? "" : "s"} loaded.`, "is-active");
}

async function handleStatusSave(event) {
  event.preventDefault();
  const organization = getSelectedOrganization();
  if (!organization) return;
  setStatus("Saving organization status...");
  await apiFetch("", {
    method: "PATCH",
    body: JSON.stringify({
      action: "update-organization",
      organization_id: organization.id,
      status: organizationStatusInput.value,
      launch_status: launchStatusInput.value,
    }),
  });
  await loadOrganizations();
  setStatus("Organization status saved.", "is-active");
}

async function handleStepChange(event) {
  const select = event.target.closest("select[data-step-status]");
  if (!select) return;
  setStatus("Updating launch step...");
  await apiFetch("", {
    method: "PATCH",
    body: JSON.stringify({
      action: "update-launch-step",
      step_id: select.getAttribute("data-step-status"),
      status: select.value,
    }),
  });
  await loadOrganizations();
  setStatus("Launch step updated.", "is-active");
}

async function handleLogout() {
  await supabase?.auth.signOut({ scope: "local" });
  window.location.replace("/utilities/login/");
}

async function init() {
  lockAdminShell();

  if (!hasConfig()) {
    setStatus("Missing Supabase browser config in /shared/config.js.", "is-error");
    return;
  }

  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/utilities/login/");
    return;
  }

  if (!PLATFORM_ADMIN_EMAILS.has(String(session.user.email || "").toLowerCase())) {
    logoutButton.hidden = false;
    setStatus("N3XRA platform admin access required.", "is-error");
    return;
  }

  unlockAdminShell();

  orgList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    selectedOrganizationId = button.getAttribute("data-id") || "";
    renderList();
    renderDetail();
  });
  statusForm.addEventListener("submit", handleStatusSave);
  launchStepList.addEventListener("change", handleStepChange);
  refreshButton.addEventListener("click", () => loadOrganizations().catch((error) => setStatus(error.message, "is-error")));
  logoutButton.addEventListener("click", handleLogout);

  await loadOrganizations();
}

init().catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load utilities admin.", "is-error"));
