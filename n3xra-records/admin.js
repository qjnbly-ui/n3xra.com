import { createBrowserSupabase, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import { getPlanConfig } from "./lib/plan-config.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const adminPanel = document.getElementById("admin-panel");
const logoutButton = document.getElementById("logout-button");
const adminStatus = document.getElementById("admin-status");
const organizationList = document.getElementById("organization-list");
const adminUsageList = document.getElementById("admin-usage-list");
const adminUsageStatus = document.getElementById("admin-usage-status");
const usageRefreshButton = document.getElementById("usage-refresh-button");
const organizationForm = document.getElementById("organization-form");
const organizationNameInput = document.getElementById("organization-name");
const organizationTierInput = document.getElementById("organization-tier");
const organizationStatusInput = document.getElementById("organization-status");
const organizationDocumentLimitInput = document.getElementById("organization-document-limit");
const organizationUserLimitInput = document.getElementById("organization-user-limit");
const organizationStorageLimitInput = document.getElementById("organization-storage-limit");
const organizationTrialEndInput = document.getElementById("organization-trial-end");
const organizationPublicEmbedInput = document.getElementById("organization-public-embed");
const organizationKeywordSearchInput = document.getElementById("organization-keyword-search");
const organizationGrantSixMonthTrialButton = document.getElementById("organization-grant-six-month-trial");
const organizationFormStatus = document.getElementById("organization-form-status");
const selectedOrganizationTitle = document.getElementById("selected-organization-title");
const selectedOrganizationSummary = document.getElementById("selected-organization-summary");
const selectedOrganizationSupportLink = document.getElementById("selected-organization-support-link");
const passwordResetForm = document.getElementById("password-reset-form");
const passwordResetEmailInput = document.getElementById("password-reset-email");
const passwordResetStatus = document.getElementById("password-reset-status");

let supabase = null;
let currentSession = null;
let organizations = [];
let adminUsageAccounts = [];
let selectedOrganizationId = "";

async function hasPlatformAdminAccess() {
  if (isPlatformAdminEmail(currentSession?.user?.email)) return true;
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "get-platform-admin-access",
    },
  });
  return Boolean(!error && data?.ok);
}

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

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatStorageDecimal(value, digits = 1) {
  return Number(value || 0).toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
}

function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (!value) return "0 B";
  if (value >= 1024 * 1024 * 1024) {
    const gb = value / (1024 * 1024 * 1024);
    return `${formatStorageDecimal(gb, gb >= 10 ? 1 : 2)} GB`;
  }
  if (value >= 1024 * 1024) {
    const mb = value / (1024 * 1024);
    return `${formatStorageDecimal(mb, mb >= 10 ? 1 : 2)} MB`;
  }
  if (value >= 1024) {
    const kb = value / 1024;
    return `${formatStorageDecimal(kb, kb >= 10 ? 0 : 1)} KB`;
  }
  return `${Math.round(value)} B`;
}

function formatDateTime(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderMetric(metric, formatter = formatWholeNumber) {
  const used = formatter(metric?.used || 0);
  const limit = formatter(metric?.limit || 0);
  const percent = Math.max(0, Math.min(100, Number(metric?.percent || 0)));
  const tone = metric?.over ? " is-over" : metric?.near ? " is-near" : "";
  return `
    <div class="admin-usage-metric${tone}">
      <strong>${escapeHtml(used)}/${escapeHtml(limit)}</strong>
      <span class="admin-usage-meter" aria-hidden="true"><span style="width: ${percent}%"></span></span>
    </div>
  `;
}

function renderUsageFlags(flags) {
  if (!Array.isArray(flags) || !flags.length) {
    return '<span class="admin-usage-flag is-clear">OK</span>';
  }
  return flags.map((flag) => {
    const tone = String(flag).toLowerCase().includes("over") ? " is-over" : " is-near";
    return `<span class="admin-usage-flag${tone}">${escapeHtml(flag)}</span>`;
  }).join("");
}

async function getFreshAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentSession = data?.session || currentSession;
  return currentSession?.access_token || "";
}

function renderSelectedOrganization() {
  if (!organizationForm) return;
  const organization = getSelectedOrganization();
  if (!organization) {
    organizationForm.reset();
    if (selectedOrganizationTitle) selectedOrganizationTitle.textContent = "Select an organization";
    if (selectedOrganizationSummary) selectedOrganizationSummary.textContent = "Library settings and support actions will appear here.";
    selectedOrganizationSupportLink?.classList.add("hidden");
    if (passwordResetEmailInput) passwordResetEmailInput.value = "";
    return;
  }

  const ownerEmail = organization.owner_profile?.email || "";
  if (selectedOrganizationTitle) selectedOrganizationTitle.textContent = organization.name || "Selected organization";
  if (selectedOrganizationSummary) {
    selectedOrganizationSummary.textContent = [
      ownerEmail ? `Owner: ${ownerEmail}` : "No owner email found",
      `Plan: ${organization.subscription_tier || "free"}`,
      `Status: ${organization.account_status || "active"}`,
      `${organization.member_count || 0} member${Number(organization.member_count || 0) === 1 ? "" : "s"}`,
    ].join(" · ");
  }
  if (selectedOrganizationSupportLink) {
    selectedOrganizationSupportLink.href = `/n3xra-records/account?support_org=${encodeURIComponent(organization.id)}`;
    selectedOrganizationSupportLink.classList.remove("hidden");
  }
  organizationNameInput.value = organization.name || "";
  organizationTierInput.value = organization.subscription_tier || "free";
  organizationStatusInput.value = organization.account_status || "active";
  organizationDocumentLimitInput.value = String(organization.document_limit || "");
  organizationUserLimitInput.value = String(organization.user_limit || "");
  organizationStorageLimitInput.value = String(organization.storage_limit_mb || "");
  organizationTrialEndInput.value = dateInputValue(organization.subscription_current_period_end);
  organizationPublicEmbedInput.checked = Boolean(organization.public_embed_enabled);
  organizationKeywordSearchInput.checked = Boolean(organization.keyword_search_enabled);
  if (passwordResetEmailInput && !passwordResetEmailInput.matches(":focus")) {
    passwordResetEmailInput.value = ownerEmail;
  }
  setStatus(passwordResetStatus, ownerEmail ? "" : "No owner email is available for this organization.", ownerEmail ? "" : "notice");
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function isoFromDateInput(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return null;
  const date = new Date(`${cleanValue}T23:59:59.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function addMonths(date, count) {
  const next = new Date(date.getTime());
  const originalDay = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + count);
  if (next.getUTCDate() !== originalDay) {
    next.setUTCDate(0);
  }
  return next;
}

function renderOrganizations() {
  if (!organizationList) return;
  organizationList.innerHTML = "";
  if (!organizations.length) {
    organizationList.innerHTML = '<p class="field-note">No organizations found.</p>';
    return;
  }

  organizations.forEach((organization) => {
    const row = document.createElement("button");
    const isSelected = organization.id === selectedOrganizationId;
    row.className = `records-admin-org-item${isSelected ? " is-selected" : ""}`;
    row.type = "button";
    row.dataset.id = organization.id;
    const ownerEmail = organization.owner_profile?.email || "No owner email";
    row.innerHTML = `
      <span class="records-admin-org-main">
        <strong>${escapeHtml(organization.name)}</strong>
        <span>${escapeHtml(ownerEmail)}</span>
      </span>
      <span class="records-admin-org-meta">
        <span>${escapeHtml(organization.subscription_tier || "free")} / ${escapeHtml(organization.account_status || "active")}</span>
        <span>${organization.member_count} member${Number(organization.member_count || 0) === 1 ? "" : "s"}${organization.subscription_current_period_end ? ` / ends ${escapeHtml(dateInputValue(organization.subscription_current_period_end))}` : ""}</span>
      </span>
    `;
    organizationList.append(row);
  });
}

function renderAdminUsageOverview() {
  if (!adminUsageList) return;
  adminUsageList.innerHTML = "";
  if (!adminUsageAccounts.length) {
    adminUsageList.innerHTML = '<tr><td colspan="8">No usage data found.</td></tr>';
    return;
  }

  adminUsageAccounts.forEach((account) => {
    const row = document.createElement("tr");
    row.className = account.id === selectedOrganizationId ? "is-selected-row" : "";
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(account.name)}</strong>
        <br><small>${escapeHtml(account.ownerEmail || "No owner email")}</small>
      </td>
      <td>${escapeHtml(account.planName || account.planId || "Free")}<br><small>${escapeHtml(account.accountStatus || "active")}</small></td>
      <td>${renderMetric(account.metrics?.storage, formatStorageBytes)}</td>
      <td>
        ${renderMetric(account.metrics?.documents)}
        <small>${formatWholeNumber(account.usage?.appDocuments || 0)} app docs</small>
      </td>
      <td>
        ${renderMetric(account.metrics?.aiRequests)}
        <small>${formatWholeNumber(account.usage?.aiTokens || 0)} tokens this month</small>
      </td>
      <td>${renderMetric(account.metrics?.users)}</td>
      <td>${escapeHtml(formatDateTime(account.usage?.lastActiveAt))}</td>
      <td><div class="admin-usage-flags">${renderUsageFlags(account.flags)}</div></td>
    `;
    row.addEventListener("click", () => {
      selectedOrganizationId = account.id;
      renderOrganizations();
      renderAdminUsageOverview();
      renderSelectedOrganization();
    });
    adminUsageList.append(row);
  });
}

async function loadAdminUsageOverview() {
  if (!adminUsageList) return;
  setStatus(adminUsageStatus, "Loading usage overview...");
  try {
    const accessToken = await getFreshAccessToken();
    const response = await fetch("/api/records-admin-usage", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to load usage overview.");

    adminUsageAccounts = Array.isArray(data?.usage?.accounts) ? data.usage.accounts : [];
    renderAdminUsageOverview();
    setStatus(adminUsageStatus, `${adminUsageAccounts.length} account${adminUsageAccounts.length === 1 ? "" : "s"} in usage overview.`, "success");
  } catch (error) {
    adminUsageAccounts = [];
    renderAdminUsageOverview();
    setStatus(adminUsageStatus, error?.message || "Unable to load usage overview.", "error");
  }
}

async function loadOrganizations() {
  if (!organizationList) return;
  setStatus(adminStatus, "Loading organizations...");

  const [{ data: orgRows, error: orgError }, { data: membershipRows, error: membershipError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, owner_user_id, subscription_tier, account_status, document_limit, user_limit, storage_limit_mb, public_embed_enabled, keyword_search_enabled, subscription_current_period_end")
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
  renderAdminUsageOverview();
  setStatus(adminStatus, `${organizations.length} organization${organizations.length === 1 ? "" : "s"} loaded.`, "success");
}

async function handleLogout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(adminStatus, error.message, "error");
    return;
  }
  window.location.replace("/n3xra-records/login");
}

function handleOrganizationListClick(event) {
  const row = event.target.closest("[data-id]");
  if (!row) return;
  selectedOrganizationId = row.getAttribute("data-id") || "";
  renderOrganizations();
  renderAdminUsageOverview();
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
  await saveSelectedOrganization();
}

async function saveSelectedOrganization(overrides = {}, successMessage = "Organization updated.") {
  const organization = getSelectedOrganization();
  if (!organization) {
    setStatus(organizationFormStatus, "Select an organization first.", "error");
    return null;
  }

  const updates = {
    name: organizationNameInput.value.trim() || organization.name,
    subscription_tier: organizationTierInput.value,
    account_status: organizationStatusInput.value,
    document_limit: Number.parseInt(organizationDocumentLimitInput.value.trim(), 10) || organization.document_limit,
    user_limit: Number.parseInt(organizationUserLimitInput.value.trim(), 10) || organization.user_limit,
    storage_limit_mb: Number.parseInt(organizationStorageLimitInput.value.trim(), 10) || organization.storage_limit_mb,
    subscription_current_period_end: isoFromDateInput(organizationTrialEndInput.value),
    public_embed_enabled: organizationPublicEmbedInput.checked,
    keyword_search_enabled: organizationKeywordSearchInput.checked,
    ...overrides,
  };

  setStatus(organizationFormStatus, "Saving organization...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, owner_user_id, subscription_tier, account_status, document_limit, user_limit, storage_limit_mb, public_embed_enabled, keyword_search_enabled, subscription_current_period_end")
    .single();

  if (error) {
    setStatus(organizationFormStatus, error.message, "error");
    return null;
  }

  organizations = organizations.map((item) => (item.id === data.id ? { ...item, ...data } : item));
  renderOrganizations();
  await loadAdminUsageOverview();
  renderSelectedOrganization();
  setStatus(organizationFormStatus, successMessage, "success");
  return data;
}

async function handleGrantSixMonthTrial() {
  const organization = getSelectedOrganization();
  if (!organization) {
    setStatus(organizationFormStatus, "Select an organization first.", "error");
    return;
  }

  const plan = getPlanConfig("organization");
  const trialEnd = addMonths(new Date(), 6);
  const trialEndValue = trialEnd.toISOString().slice(0, 10);

  organizationTierInput.value = "organization";
  organizationStatusInput.value = "trialing";
  organizationDocumentLimitInput.value = String(plan.documentLimit);
  organizationUserLimitInput.value = String(plan.userLimit);
  organizationStorageLimitInput.value = String(plan.storageLimitMb);
  organizationTrialEndInput.value = trialEndValue;
  organizationPublicEmbedInput.checked = true;
  organizationKeywordSearchInput.checked = true;

  await saveSelectedOrganization(
    {
      subscription_tier: "organization",
      account_status: "trialing",
      document_limit: plan.documentLimit,
      user_limit: plan.userLimit,
      storage_limit_mb: plan.storageLimitMb,
      public_embed_enabled: true,
      keyword_search_enabled: true,
      cancel_at_period_end: false,
      subscription_current_period_end: isoFromDateInput(trialEndValue),
    },
    `6-month Organization trial granted through ${trialEndValue}.`
  );
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
    window.location.replace("/n3xra-records/login");
    return;
  }

  if (!(await hasPlatformAdminAccess())) {
    window.location.replace("/n3xra-records/library");
    return;
  }

  setupPanel.classList.add("hidden");
  adminPanel.classList.remove("hidden");

  await Promise.all([
    organizationList ? loadOrganizations() : Promise.resolve(),
    adminUsageList ? loadAdminUsageOverview() : Promise.resolve(),
  ]);

  logoutButton?.addEventListener("click", handleLogout);
  organizationList?.addEventListener("click", handleOrganizationListClick);
  usageRefreshButton?.addEventListener("click", loadAdminUsageOverview);
  organizationTierInput?.addEventListener("change", handleTierChange);
  organizationGrantSixMonthTrialButton?.addEventListener("click", handleGrantSixMonthTrial);
  organizationForm?.addEventListener("submit", handleOrganizationSave);
  passwordResetForm?.addEventListener("submit", handlePasswordReset);
}

init();
