import { createBrowserSupabase, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import { getPlanConfig } from "./lib/plan-config.js";
import { isPlatformAdminEmail, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";

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
const organizationsWorkspace = document.getElementById("organizations-workspace");
const supportWorkspace = document.getElementById("support-workspace");
const supportWorkspaceClose = document.getElementById("support-workspace-close");
const supportWorkspaceSummary = document.getElementById("support-workspace-summary");
const supportAccessState = document.getElementById("support-access-state");
const supportScopeList = document.getElementById("support-scope-list");
const supportWorkspaceStatus = document.getElementById("support-workspace-status");
const supportAccountFacts = document.getElementById("support-account-facts");
const supportUsageFacts = document.getElementById("support-usage-facts");
const supportFeatureFacts = document.getElementById("support-feature-facts");
const supportDocumentsList = document.getElementById("support-documents-list");
const supportRecordingsList = document.getElementById("support-recordings-list");
const supportAuditList = document.getElementById("support-audit-list");
const supportWorkspaceLinks = Array.from(document.querySelectorAll("[data-support-workspace-link]"));
const organizationsLinks = Array.from(document.querySelectorAll("[data-organizations-link]"));
const passwordResetForm = document.getElementById("password-reset-form");
const passwordResetEmailInput = document.getElementById("password-reset-email");
const passwordResetStatus = document.getElementById("password-reset-status");
const emergencyAccessForm = document.getElementById("emergency-access-form");
const emergencyAccessReason = document.getElementById("emergency-access-reason");
const emergencyAccessConfirm = document.getElementById("emergency-access-confirm");
const emergencyAccessStatus = document.getElementById("emergency-access-status");
const emergencyAccessEnd = document.getElementById("emergency-access-end");
const demoWorkspaceForm = document.getElementById("demo-workspace-form");
const demoWorkspaceRefresh = document.getElementById("demo-workspace-refresh");
const demoWorkspaceList = document.getElementById("demo-workspace-list");
const demoWorkspaceStatus = document.getElementById("demo-workspace-status");
const demoWorkspaceClaimResult = document.getElementById("demo-workspace-claim-result");
const demoWorkspaceClaimCode = document.getElementById("demo-workspace-claim-code");
const demoWorkspaceClaimUrl = document.getElementById("demo-workspace-claim-url");
const demoWorkspaceCopyCode = document.getElementById("demo-workspace-copy-code");
const demoWorkspaceCopyLink = document.getElementById("demo-workspace-copy-link");

let supabase = null;
let currentSession = null;
let organizations = [];
let adminUsageAccounts = [];
let selectedOrganizationId = "";
let activeEmergencyAccessId = "";
let activeSupportGrant = null;
let demoWorkspaces = [];
let latestDemoClaimCode = "";
let latestDemoClaimUrl = "";

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

async function invokePlatformAdmin(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action, ...payload },
  });
  if (error || data?.error) {
    let functionMessage = "";
    if (error?.context && typeof error.context.json === "function") {
      try {
        const errorBody = await error.context.json();
        functionMessage = String(errorBody?.error || errorBody?.message || "").trim();
      } catch {
        // Fall back to the SDK error when the function did not return JSON.
      }
    }
    throw new Error(data?.error || functionMessage || error?.message || "Admin request failed.");
  }
  return data;
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

async function handleEmergencyAccess(event) {
  event.preventDefault();
  const organization = getSelectedOrganization();
  const reason = String(emergencyAccessReason?.value || "").trim();
  if (!organization || reason.length < 20 || !emergencyAccessConfirm?.checked) {
    setStatus(emergencyAccessStatus, "Select an organization, provide a detailed reason, and confirm the permanent audit notice.", "error");
    return;
  }
  const button = emergencyAccessForm.querySelector("button[type='submit']");
  button.disabled = true;
  setStatus(emergencyAccessStatus, "Starting audited emergency access...");
  const { data: emergencyId, error } = await supabase.rpc("begin_records_emergency_access", {
    input_organization_id: organization.id,
    input_reason: reason,
  });
  button.disabled = false;
  if (error) { setStatus(emergencyAccessStatus, error.message, "error"); return; }
  activeEmergencyAccessId = String(emergencyId || "");
  emergencyAccessEnd?.classList.toggle("hidden", !activeEmergencyAccessId);
  const accessToken = await getFreshAccessToken();
  const noticeResponse = await fetch("/api/records-emergency-access-notice", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: organization.id, emergencyAccessId: activeEmergencyAccessId, reason }),
  });
  const notice = await noticeResponse.json().catch(() => ({}));
  if (!noticeResponse.ok && activeEmergencyAccessId) {
    await supabase.rpc("end_records_emergency_access", { input_emergency_access_id: activeEmergencyAccessId });
    activeEmergencyAccessId = "";
    emergencyAccessEnd?.classList.add("hidden");
  }
  setStatus(emergencyAccessStatus, noticeResponse.ok
    ? "Emergency access is active for one hour. The customer was notified and the event was permanently recorded."
    : `Emergency access was immediately closed because the customer notice failed: ${notice.error || notice.warning || "Unknown error"}`,
    noticeResponse.ok ? "success" : "error");
  emergencyAccessForm.reset();
}

async function handleEmergencyAccessEnd() {
  if (!activeEmergencyAccessId) return;
  emergencyAccessEnd.disabled = true;
  const { data, error } = await supabase.rpc("end_records_emergency_access", {
    input_emergency_access_id: activeEmergencyAccessId,
  });
  emergencyAccessEnd.disabled = false;
  if (error || !data) { setStatus(emergencyAccessStatus, error?.message || "Unable to end emergency access.", "error"); return; }
  activeEmergencyAccessId = "";
  emergencyAccessEnd.classList.add("hidden");
  setStatus(emergencyAccessStatus, "Emergency access ended and was permanently recorded.", "success");
}

function renderSelectedOrganization() {
  if (!organizationForm) return;
  const organization = getSelectedOrganization();
  if (!organization) {
    organizationForm.reset();
    if (selectedOrganizationTitle) selectedOrganizationTitle.textContent = "Select an organization";
    if (selectedOrganizationSummary) selectedOrganizationSummary.textContent = "Choose an organization to continue.";
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
    if (organizationList instanceof HTMLSelectElement) {
      organizationList.innerHTML = '<option value="">No organizations found</option>';
      organizationList.disabled = true;
    } else {
      organizationList.innerHTML = '<p class="field-note">No organizations found.</p>';
    }
    return;
  }

  if (organizationList instanceof HTMLSelectElement) {
    organizationList.disabled = false;
    organizations.forEach((organization) => {
      const option = document.createElement("option");
      option.value = organization.id;
      option.selected = organization.id === selectedOrganizationId;
      option.textContent = `${organization.name} — ${organization.owner_profile?.email || "No owner email"}`;
      organizationList.append(option);
    });
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
      .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, user_limit, storage_limit_mb, public_embed_enabled, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, cancel_at_period_end, billing_cycle, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, subscription_current_period_end")
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

  const requestedOrganizationId = new URLSearchParams(window.location.search).get("organization") || "";
  if (requestedOrganizationId && organizations.some((organization) => organization.id === requestedOrganizationId)) {
    selectedOrganizationId = requestedOrganizationId;
  } else if (!selectedOrganizationId && organizations[0]) {
    selectedOrganizationId = organizations[0].id;
  }

  renderOrganizations();
  renderSelectedOrganization();
  renderAdminUsageOverview();
  setStatus(adminStatus, `${organizations.length} organization${organizations.length === 1 ? "" : "s"} loaded.`, "success");
}

function renderDemoWorkspaces() {
  if (!demoWorkspaceList) return;
  demoWorkspaceList.innerHTML = demoWorkspaces.length ? demoWorkspaces.map((workspace) => {
    const status = String(workspace.status || "pending");
    const pending = status === "pending";
    const statusDate = status === "claimed"
      ? `Claimed ${formatDateTime(workspace.claimedAt)}`
      : `Expires ${formatDateTime(workspace.expiresAt)}`;
    return `
      <article class="records-demo-workspace-row">
        <div>
          <strong>${escapeHtml(workspace.organizationName)}</strong>
          <p>${escapeHtml(status)} · ${escapeHtml(statusDate)}${workspace.recipientEmail ? ` · ${escapeHtml(workspace.recipientEmail)}` : ""}${pending ? ` · code ending ${escapeHtml(workspace.codeLastFour)}` : ""}</p>
        </div>
        <div class="records-button-group">
          ${pending ? `<button class="portal-button portal-button-secondary" type="button" data-demo-action="rotate" data-demo-id="${escapeHtml(workspace.id)}">New code</button>` : ""}
          ${pending ? `<button class="portal-button portal-button-secondary" type="button" data-demo-action="revoke" data-demo-id="${escapeHtml(workspace.id)}">Revoke</button>` : ""}
          ${pending ? `<button class="portal-button" type="button" data-demo-action="open" data-organization-id="${escapeHtml(workspace.organizationId)}">Open workspace</button>` : ""}
        </div>
      </article>
    `;
  }).join("") : '<p class="field-note">No demo workspaces have been created.</p>';
}

function showDemoClaimResult(code, claimUrl) {
  latestDemoClaimCode = String(code || "");
  latestDemoClaimUrl = String(claimUrl || "");
  if (demoWorkspaceClaimCode) demoWorkspaceClaimCode.textContent = latestDemoClaimCode;
  if (demoWorkspaceClaimUrl) demoWorkspaceClaimUrl.textContent = latestDemoClaimUrl;
  demoWorkspaceClaimResult?.classList.toggle("hidden", !latestDemoClaimCode);
}

async function copyDemoText(value, successMessage) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setStatus(demoWorkspaceStatus, successMessage, "success");
}

async function loadDemoWorkspaces() {
  if (!demoWorkspaceList) return;
  const data = await invokePlatformAdmin("list-records-demo-workspaces");
  demoWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  renderDemoWorkspaces();
}

async function createDemoWorkspace(event) {
  event.preventDefault();
  setStatus(demoWorkspaceStatus, "Creating demo workspace...");
  try {
    const data = await invokePlatformAdmin("create-records-demo-workspace", {
      organizationName: document.getElementById("demo-workspace-name")?.value || "",
      recipientEmail: document.getElementById("demo-workspace-email")?.value || "",
    });
    showDemoClaimResult(data.code, data.claimUrl);
    event.currentTarget.reset();
    await Promise.all([loadDemoWorkspaces(), loadOrganizations()]);
    setStatus(demoWorkspaceStatus, "Demo workspace created. Save the one-time code, then open the workspace to prepare the meeting.", "success");
  } catch (error) {
    setStatus(demoWorkspaceStatus, error.message, "error");
  }
}

async function handleDemoWorkspaceAction(event) {
  const button = event.target.closest("button[data-demo-action]");
  if (!button) return;
  const action = button.dataset.demoAction;
  const claimId = button.dataset.demoId || "";

  if (action === "open") {
    setStoredActiveOrganizationId(button.dataset.organizationId || "");
    window.location.href = "/n3xra-records/library/";
    return;
  }

  try {
    if (action === "rotate") {
      setStatus(demoWorkspaceStatus, "Generating a replacement claim code...");
      const data = await invokePlatformAdmin("rotate-records-demo-claim-code", { claimId });
      showDemoClaimResult(data.code, data.claimUrl);
      setStatus(demoWorkspaceStatus, "A new claim code was generated. The previous code no longer works.", "success");
    } else if (action === "revoke") {
      setStatus(demoWorkspaceStatus, "Revoking demo claim...");
      await invokePlatformAdmin("revoke-records-demo-claim", { claimId });
      setStatus(demoWorkspaceStatus, "Demo claim revoked. The workspace remains available to the admin.", "success");
    }
    await loadDemoWorkspaces();
  } catch (error) {
    setStatus(demoWorkspaceStatus, error.message, "error");
  }
}

async function handleLogout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(adminStatus, error.message, "error");
    return;
  }
  window.location.replace("/n3xra-records/login");
}

function normalizeRpcRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function isValidSupportGrant(grant) {
  if (!grant?.id || !grant?.expires_at || grant.revoked_at) return false;
  const expiresAt = new Date(grant.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  return Boolean(
    grant.can_view_documents ||
    grant.can_view_recordings ||
    grant.can_download_files ||
    grant.can_change_content
  );
}

function formatSupportEvent(value) {
  return String(value || "Support activity").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderSupportGate(list, allowed, emptyMessage) {
  if (!list) return;
  if (!allowed) {
    list.innerHTML = `<div class="records-support-locked"><strong>Not granted</strong><span>${escapeHtml(emptyMessage)}</span></div>`;
  }
}

async function loadCurrentSupportAccess(organizationId) {
  const { data, error } = await supabase.rpc("active_records_support_grant", {
    target_organization_id: organizationId,
  });
  if (error) throw error;
  const grant = normalizeRpcRow(data);
  if (isValidSupportGrant(grant)) return { ...grant, emergency_access: false };

  const { data: emergency, error: emergencyError } = await supabase
    .from("records_emergency_access")
    .select("id, reason, expires_at")
    .eq("organization_id", organizationId)
    .eq("admin_user_id", currentSession.user.id)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (emergencyError) throw emergencyError;
  return emergency ? {
    ...emergency,
    emergency_access: true,
    can_view_documents: true,
    can_view_recordings: true,
    can_download_files: true,
    can_change_content: true,
  } : null;
}

function renderSupportOverview(organization, usageAccount) {
  if (supportAccountFacts) {
    supportAccountFacts.innerHTML = [
      ["Owner", organization.owner_profile?.email || "Not available"],
      ["Plan", organization.subscription_tier || "Free"],
      ["Billing status", organization.account_status || "Active"],
      ["Members", `${organization.member_count || 0}`],
      ["Current period ends", organization.subscription_current_period_end ? new Date(organization.subscription_current_period_end).toLocaleDateString() : "Not scheduled"],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }
  if (supportFeatureFacts) {
    const features = [
      ["Public records and embeds", organization.public_embed_enabled],
      ["Transcript previews", organization.transcript_preview_enabled],
      ["Keyword search", organization.keyword_search_enabled],
      ["File preview cards", organization.file_preview_cards_enabled],
      ["Hosted public portal", organization.hosted_public_portal_enabled],
    ];
    supportFeatureFacts.innerHTML = features.map(([label, enabled]) => `<div><span>${escapeHtml(label)}</span><strong class="${enabled ? "is-enabled" : ""}">${enabled ? "Enabled" : "Disabled"}</strong></div>`).join("");
  }
  if (supportUsageFacts) {
    if (!usageAccount) {
      supportUsageFacts.innerHTML = '<p class="field-note">Usage information is currently unavailable.</p>';
    } else {
      supportUsageFacts.innerHTML = `
        <div><span>Storage</span>${renderMetric(usageAccount.metrics?.storage, formatStorageBytes)}</div>
        <div><span>Documents</span>${renderMetric(usageAccount.metrics?.documents)}</div>
        <div><span>AI requests</span>${renderMetric(usageAccount.metrics?.aiRequests)}</div>
        <div><span>Users</span>${renderMetric(usageAccount.metrics?.users)}</div>
        <div><span>Last activity</span><strong>${escapeHtml(formatDateTime(usageAccount.usage?.lastActiveAt))}</strong></div>
        <div><span>Account health</span><div class="admin-usage-flags">${renderUsageFlags(usageAccount.flags)}</div></div>
      `;
    }
  }
}

async function loadSupportUsageAccount(organizationId) {
  try {
    const accessToken = await getFreshAccessToken();
    const response = await fetch("/api/records-admin-usage", { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const accounts = Array.isArray(payload?.usage?.accounts) ? payload.usage.accounts : [];
    return accounts.find((account) => account.id === organizationId) || null;
  } catch {
    return null;
  }
}

function renderSupportScopes(grant) {
  if (!supportScopeList) return;
  const scopes = [
    ["Documents", grant?.can_view_documents],
    ["Recordings and transcripts", grant?.can_view_recordings],
    ["File downloads", grant?.can_download_files],
    ["Changes", grant?.can_change_content],
  ];
  supportScopeList.innerHTML = scopes.map(([label, enabled]) => `<span class="records-support-scope${enabled ? " is-active" : ""}">${enabled ? "✓" : "—"} ${escapeHtml(label)}</span>`).join("");
}

function renderSupportDocuments(rows, allowed) {
  renderSupportGate(supportDocumentsList, allowed, "The customer has not granted document access.");
  if (!allowed) return;
  supportDocumentsList.innerHTML = rows.length ? rows.map((row) => `
    <article class="records-support-item"><div><strong>${escapeHtml(row.title || row.original_filename || "Untitled document")}</strong><span>${escapeHtml(row.status || "Saved")} · ${escapeHtml(formatDateTime(row.created_at))}</span></div><span class="records-support-badge">${row.is_public ? "Public" : "Private"}</span></article>
  `).join("") : '<p class="field-note">No documents are stored in this organization.</p>';
}

function renderSupportRecordings(rows, allowed) {
  renderSupportGate(supportRecordingsList, allowed, "The customer has not granted recording or transcript access.");
  if (!allowed) return;
  supportRecordingsList.innerHTML = rows.length ? rows.map((row) => `
    <details class="records-support-item records-support-recording"><summary><div><strong>${escapeHtml(row.title || "Untitled recording")}</strong><span>${escapeHtml(row.transcript_status || row.status || "Saved")} · ${escapeHtml(formatDateTime(row.started_at || row.created_at))}</span></div><span class="records-support-badge">Review</span></summary><div class="records-support-transcript">${escapeHtml(row.speaker_transcript_text || row.transcript_text || "No transcript is available.")}</div></details>
  `).join("") : '<p class="field-note">No recordings are stored in this organization.</p>';
}

function renderSupportAudit(rows) {
  if (!supportAuditList) return;
  if (!rows.length) {
    supportAuditList.innerHTML = '<p class="field-note">No support access has been recorded.</p>';
    return;
  }
  const renderRows = (items) => items.map((row) => `
    <article class="records-support-item"><div><strong>${escapeHtml(formatSupportEvent(row.event_type))}</strong><span>${escapeHtml(row.actor_email || "Customer")} · ${escapeHtml(formatDateTime(row.created_at))}</span></div><span class="records-support-badge">${escapeHtml(row.resource_type || "Library")}</span></article>
  `).join("");
  const recentRows = rows.slice(0, 3);
  const olderRows = rows.slice(3);
  supportAuditList.innerHTML = renderRows(recentRows) + (olderRows.length ? `
    <details class="records-support-audit-more">
      <summary>Show full history (${rows.length})</summary>
      <div class="records-support-list">${renderRows(olderRows)}</div>
    </details>
  ` : "");
}

async function loadRecordsSupportWorkspace() {
  const organization = getSelectedOrganization();
  if (!organization) return;
  setStatus(supportWorkspaceStatus, "Checking customer-granted access...");
  supportWorkspaceSummary.textContent = `${organization.name || "Selected organization"} · ${organization.owner_profile?.email || "Owner email unavailable"}`;
  const [grant, usageAccount] = await Promise.all([
    loadCurrentSupportAccess(organization.id),
    loadSupportUsageAccount(organization.id),
  ]);
  activeSupportGrant = grant;
  renderSupportOverview(organization, usageAccount);
  renderSupportScopes(activeSupportGrant);

  const canViewDocuments = Boolean(activeSupportGrant?.can_view_documents);
  const canViewRecordings = Boolean(activeSupportGrant?.can_view_recordings);
  if (supportAccessState) {
    supportAccessState.classList.toggle("is-active", Boolean(activeSupportGrant));
    supportAccessState.innerHTML = activeSupportGrant
      ? `<strong>${activeSupportGrant.emergency_access ? "Audited emergency access" : "Customer access grant"} is active</strong><span>Expires ${escapeHtml(new Date(activeSupportGrant.expires_at).toLocaleString())}. Only the approved scopes below are available.</span>`
      : "<strong>No private-content access</strong><span>The customer has not granted active support access. Account administration and the support audit remain available.</span>";
  }

  renderSupportDocuments([], canViewDocuments);
  renderSupportRecordings([], canViewRecordings);

  const requests = [
    supabase.from("records_support_audit_log").select("event_type, actor_email, resource_type, resource_id, reason, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(100),
    canViewDocuments
      ? supabase.from("documents").select("id, title, original_filename, status, is_public, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    canViewRecordings
      ? supabase.from("meeting_recordings").select("id, title, status, transcript_status, transcript_text, speaker_transcript_text, started_at, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ];
  const [auditResult, documentResult, recordingResult] = await Promise.all(requests);
  const accessError = documentResult.error || recordingResult.error;
  if (auditResult.error) throw auditResult.error;
  renderSupportAudit(auditResult.data || []);
  renderSupportDocuments(documentResult.data || [], canViewDocuments);
  renderSupportRecordings(recordingResult.data || [], canViewRecordings);
  if (accessError) {
    throw new Error(`The grant is active, but Supabase denied the approved content query: ${accessError.message}`);
  }
  if (activeSupportGrant) {
    const auditEvents = [["session_started", "support_workspace"]];
    if (canViewDocuments) auditEvents.push(["content_viewed", "document_list"]);
    if (canViewRecordings) auditEvents.push(["content_viewed", "recording_list"]);
    await Promise.allSettled(auditEvents.map(([eventType, resourceType]) => supabase.rpc("record_records_support_event", {
      input_organization_id: organization.id,
      input_event_type: eventType,
      input_resource_type: resourceType,
      input_resource_id: organization.id,
      input_reason: null,
      input_metadata: {},
    })));
  }
  setStatus(supportWorkspaceStatus, activeSupportGrant ? "Approved support access loaded." : "Support audit loaded. Private content remains protected.", "success");
}

async function openRecordsSupportView(event) {
  event?.preventDefault?.();
  if (!getSelectedOrganization() || !supportWorkspace || !organizationsWorkspace) return;
  organizationsWorkspace.classList.add("hidden");
  supportWorkspace.classList.remove("hidden");
  supportWorkspaceLinks.forEach((link) => {
    link.classList.remove("hidden");
    link.classList.add("is-current");
  });
  organizationsLinks.forEach((link) => link.classList.remove("is-current"));
  window.history.replaceState(null, "", "#support-workspace");
  try {
    await loadRecordsSupportWorkspace();
  } catch (error) {
    setStatus(supportWorkspaceStatus, error?.message || "Unable to load the support workspace.", "error");
  }
}

function closeRecordsSupportView(event) {
  event?.preventDefault?.();
  supportWorkspace?.classList.add("hidden");
  organizationsWorkspace?.classList.remove("hidden");
  supportWorkspaceLinks.forEach((link) => {
    link.classList.remove("is-current");
    link.classList.add("hidden");
  });
  organizationsLinks.forEach((link) => link.classList.add("is-current"));
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

function handleOrganizationListClick(event) {
  const isSelect = event.currentTarget instanceof HTMLSelectElement;
  const row = isSelect ? null : event.target.closest("[data-id]");
  if (!isSelect && !row) return;
  selectedOrganizationId = isSelect ? event.currentTarget.value : (row.getAttribute("data-id") || "");
  supportWorkspaceLinks.forEach((link) => link.classList.add("hidden"));
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
    demoWorkspaceList
      ? loadDemoWorkspaces().catch((error) => {
          setStatus(demoWorkspaceStatus, error.message || "Unable to load demo workspaces.", "error");
        })
      : Promise.resolve(),
  ]);

  logoutButton?.addEventListener("click", handleLogout);
  organizationList?.addEventListener(
    organizationList instanceof HTMLSelectElement ? "change" : "click",
    handleOrganizationListClick
  );
  usageRefreshButton?.addEventListener("click", loadAdminUsageOverview);
  organizationTierInput?.addEventListener("change", handleTierChange);
  organizationGrantSixMonthTrialButton?.addEventListener("click", handleGrantSixMonthTrial);
  organizationForm?.addEventListener("submit", handleOrganizationSave);
  passwordResetForm?.addEventListener("submit", handlePasswordReset);
  emergencyAccessForm?.addEventListener("submit", handleEmergencyAccess);
  emergencyAccessEnd?.addEventListener("click", handleEmergencyAccessEnd);
  selectedOrganizationSupportLink?.addEventListener("click", openRecordsSupportView);
  supportWorkspaceLinks.forEach((link) => link.addEventListener("click", openRecordsSupportView));
  organizationsLinks.forEach((link) => link.addEventListener("click", closeRecordsSupportView));
  supportWorkspaceClose?.addEventListener("click", closeRecordsSupportView);
  demoWorkspaceForm?.addEventListener("submit", createDemoWorkspace);
  demoWorkspaceRefresh?.addEventListener("click", async () => {
    try {
      await loadDemoWorkspaces();
      setStatus(demoWorkspaceStatus, "Demo workspaces refreshed.", "success");
    } catch (error) {
      setStatus(demoWorkspaceStatus, error.message, "error");
    }
  });
  demoWorkspaceCopyCode?.addEventListener("click", () => copyDemoText(latestDemoClaimCode, "Claim code copied."));
  demoWorkspaceCopyLink?.addEventListener("click", () => copyDemoText(latestDemoClaimUrl, "Claim link copied."));
  demoWorkspaceList?.addEventListener("click", handleDemoWorkspaceAction);
}

init();
