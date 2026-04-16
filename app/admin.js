import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { getPlanConfig } from "./lib/plan-config.js";
import { isPlatformAdminEmail } from "./lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const adminPanel = document.getElementById("admin-panel");
const logoutButton = document.getElementById("logout-button");
const adminStatus = document.getElementById("admin-status");
const organizationList = document.getElementById("organization-list");
const organizationForm = document.getElementById("organization-form");
const organizationNameInput = document.getElementById("organization-name");
const organizationTierInput = document.getElementById("organization-tier");
const organizationStatusInput = document.getElementById("organization-status");
const organizationDocumentLimitInput = document.getElementById("organization-document-limit");
const organizationUserLimitInput = document.getElementById("organization-user-limit");
const organizationStorageLimitInput = document.getElementById("organization-storage-limit");
const organizationPublicEmbedInput = document.getElementById("organization-public-embed");
const organizationKeywordSearchInput = document.getElementById("organization-keyword-search");
const organizationFormStatus = document.getElementById("organization-form-status");
const passwordResetForm = document.getElementById("password-reset-form");
const passwordResetEmailInput = document.getElementById("password-reset-email");
const passwordResetStatus = document.getElementById("password-reset-status");

let supabase = null;
let currentSession = null;
let organizations = [];
let selectedOrganizationId = "";

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "status";
  if (tone) el.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSelectedOrganization() {
  return organizations.find((item) => item.id === selectedOrganizationId) || null;
}

function renderSelectedOrganization() {
  const organization = getSelectedOrganization();
  if (!organization) {
    organizationForm.reset();
    return;
  }

  organizationNameInput.value = organization.name || "";
  organizationTierInput.value = organization.subscription_tier || "free";
  organizationStatusInput.value = organization.account_status || "active";
  organizationDocumentLimitInput.value = String(organization.document_limit || "");
  organizationUserLimitInput.value = String(organization.user_limit || "");
  organizationStorageLimitInput.value = String(organization.storage_limit_mb || "");
  organizationPublicEmbedInput.checked = Boolean(organization.public_embed_enabled);
  organizationKeywordSearchInput.checked = Boolean(organization.keyword_search_enabled);
}

function renderOrganizations() {
  organizationList.innerHTML = "";
  if (!organizations.length) {
    organizationList.innerHTML = '<tr><td colspan="6">No organizations found.</td></tr>';
    return;
  }

  organizations.forEach((organization) => {
    const row = document.createElement("tr");
    const isSelected = organization.id === selectedOrganizationId;
    row.className = isSelected ? "is-selected-row" : "";
    row.innerHTML = `
      <td>${escapeHtml(organization.name)}</td>
      <td>${escapeHtml(organization.owner_profile?.email || "")}</td>
      <td>${escapeHtml(organization.subscription_tier)}</td>
      <td>${escapeHtml(organization.account_status)}</td>
      <td>${organization.member_count}</td>
      <td class="inline-actions">
        <button class="btn secondary" type="button" data-action="select" data-id="${organization.id}">Select</button>
        <a class="btn secondary button-link" href="./dashboard.html?support_org=${encodeURIComponent(organization.id)}&section=account">Support view</a>
      </td>
    `;
    organizationList.append(row);
  });
}

async function loadOrganizations() {
  setStatus(adminStatus, "Loading organizations...");

  const [{ data: orgRows, error: orgError }, { data: membershipRows, error: membershipError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, owner_user_id, subscription_tier, account_status, document_limit, user_limit, storage_limit_mb, public_embed_enabled, keyword_search_enabled")
      .order("created_at", { ascending: true }),
    supabase.from("organization_memberships").select("organization_id, user_id"),
    supabase.from("profiles").select("id, email, full_name"),
  ]);

  if (orgError || membershipError || profileError) {
    setStatus(adminStatus, orgError?.message || membershipError?.message || profileError?.message || "Unable to load admin data.", "error");
    return;
  }

  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const memberCounts = new Map();
  (membershipRows || []).forEach((membership) => {
    memberCounts.set(membership.organization_id, (memberCounts.get(membership.organization_id) || 0) + 1);
  });

  organizations = (orgRows || []).map((organization) => ({
    ...organization,
    owner_profile: profileMap.get(organization.owner_user_id) || null,
    member_count: memberCounts.get(organization.id) || 0,
  }));

  if (!selectedOrganizationId && organizations[0]) {
    selectedOrganizationId = organizations[0].id;
  }

  renderOrganizations();
  renderSelectedOrganization();
  setStatus(adminStatus, `${organizations.length} organization${organizations.length === 1 ? "" : "s"} loaded.`, "success");
}

async function handleLogout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    setStatus(adminStatus, error.message, "error");
    return;
  }
  window.location.replace("./login.html");
}

function handleOrganizationListClick(event) {
  const button = event.target.closest("button[data-action='select']");
  if (!button) return;
  selectedOrganizationId = button.getAttribute("data-id") || "";
  renderOrganizations();
  renderSelectedOrganization();
}

async function handleTierChange() {
  const plan = getPlanConfig(organizationTierInput.value);
  organizationDocumentLimitInput.value = String(plan.documentLimit);
  organizationUserLimitInput.value = String(plan.userLimit);
  organizationStorageLimitInput.value = String(plan.storageLimitMb);
  if (!plan.embedAllowed) {
    organizationPublicEmbedInput.checked = false;
  }
}

async function handleOrganizationSave(event) {
  event.preventDefault();
  const organization = getSelectedOrganization();
  if (!organization) {
    setStatus(organizationFormStatus, "Select an organization first.", "error");
    return;
  }

  const updates = {
    name: organizationNameInput.value.trim() || organization.name,
    subscription_tier: organizationTierInput.value,
    account_status: organizationStatusInput.value,
    document_limit: Number.parseInt(organizationDocumentLimitInput.value.trim(), 10) || organization.document_limit,
    user_limit: Number.parseInt(organizationUserLimitInput.value.trim(), 10) || organization.user_limit,
    storage_limit_mb: Number.parseInt(organizationStorageLimitInput.value.trim(), 10) || organization.storage_limit_mb,
    public_embed_enabled: organizationPublicEmbedInput.checked,
    keyword_search_enabled: organizationKeywordSearchInput.checked,
  };

  setStatus(organizationFormStatus, "Saving organization...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, owner_user_id, subscription_tier, account_status, document_limit, user_limit, storage_limit_mb, public_embed_enabled, keyword_search_enabled")
    .single();

  if (error) {
    setStatus(organizationFormStatus, error.message, "error");
    return;
  }

  organizations = organizations.map((item) => (item.id === data.id ? { ...item, ...data } : item));
  renderOrganizations();
  renderSelectedOrganization();
  setStatus(organizationFormStatus, "Organization updated.", "success");
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const email = passwordResetEmailInput.value.trim();
  if (!email) {
    setStatus(passwordResetStatus, "Enter an email address.", "error");
    return;
  }

  setStatus(passwordResetStatus, "Sending password reset...");
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "reset-password",
      email,
    },
  });

  if (error || data?.error) {
    setStatus(passwordResetStatus, error?.message || data?.error || "Unable to send password reset.", "error");
    return;
  }

  passwordResetForm.reset();
  setStatus(passwordResetStatus, "Password reset email sent.", "success");
}

async function init() {
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login.html");
    return;
  }

  if (!isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("./dashboard.html");
    return;
  }

  setupPanel.classList.add("hidden");
  adminPanel.classList.remove("hidden");

  await loadOrganizations();

  logoutButton.addEventListener("click", handleLogout);
  organizationList.addEventListener("click", handleOrganizationListClick);
  organizationTierInput.addEventListener("change", handleTierChange);
  organizationForm.addEventListener("submit", handleOrganizationSave);
  passwordResetForm.addEventListener("submit", handlePasswordReset);
}

init();
