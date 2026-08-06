import { createBrowserSupabase, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import {
  buildMembershipMap,
  dedupeMembershipsByOrganization,
  formatRoleLabel,
  isPlatformAdminEmail,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
} from "/shared/lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const storagePanel = document.getElementById("storage-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const storagePlanName = document.getElementById("storage-plan-name");
const storageAccountStatus = document.getElementById("storage-account-status");
const storageTotalValue = document.getElementById("storage-total-value");
const storageTotalCopy = document.getElementById("storage-total-copy");
const storageTotalMeter = document.getElementById("storage-total-meter");
const storageBreakdownGrid = document.getElementById("storage-breakdown-grid");
const storageLargestList = document.getElementById("storage-largest-list");
const storageSuggestionList = document.getElementById("storage-suggestion-list");
const storageStatus = document.getElementById("storage-status");

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setStatus(message, tone = "") {
  if (!storageStatus) return;
  storageStatus.textContent = message || "";
  storageStatus.className = "status";
  if (tone) storageStatus.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatPlanName(value) {
  const plan = String(value || "free").trim().toLowerCase();
  if (plan === "organization") return "Organization";
  if (plan === "starter") return "Starter";
  return "Free";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getActiveOrganization() {
  return activeMembership?.organization || null;
}

async function getFreshAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentSession = data?.session || currentSession;
  return currentSession?.access_token || "";
}

function closeMobileMenu() {
  mobileMenu?.classList.remove("is-open");
  mobileMenu?.classList.add("hidden");
  mobileMenuToggle?.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const nextOpen = !mobileMenu?.classList.contains("is-open");
  mobileMenu?.classList.toggle("is-open", nextOpen);
  mobileMenu?.classList.toggle("hidden", !nextOpen);
  mobileMenuToggle?.setAttribute("aria-expanded", String(nextOpen));
}

function renderOrganizationSelector() {
  if (!memberships.length) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeOrganizationSelect.disabled = true;
    storagePlanName.textContent = "-";
    storageAccountStatus.textContent = "-";
    return;
  }

  activeOrganizationSelect.innerHTML = memberships
    .map((membership) => {
      const organization = membership.organization || {};
      const selected = organization.id === getActiveOrganization()?.id ? " selected" : "";
      const role = formatRoleLabel(membership.role);
      return `<option value="${escapeHtml(organization.id)}"${selected}>${escapeHtml(organization.name || "Records library")} (${escapeHtml(role)})</option>`;
    })
    .join("");
  activeOrganizationSelect.disabled = memberships.length <= 1;

  const organization = getActiveOrganization();
  storagePlanName.textContent = formatPlanName(organization?.subscription_tier);
  storageAccountStatus.textContent = organization?.account_status || "active";
}

async function bootstrapAccess() {
  const { data: bootstrapData, error: bootstrapError } = await supabase.rpc("bootstrap_organization", {
    input_organization_name: null,
    input_invite_code: null,
  });
  if (bootstrapError) throw bootstrapError;

  const { data, error } = await supabase
    .from("organization_memberships")
    .select(`
      id,
      user_id,
      organization_id,
      role,
      organization:organizations(
        id,
        name,
        subscription_tier,
        document_limit,
        storage_limit_mb,
        user_limit,
        account_status,
        owner_user_id
      )
    `)
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  memberships = dedupeMembershipsByOrganization(buildMembershipMap(data || []));
  activeMembership = resolveActiveOrganization(memberships, String(bootstrapData?.active_organization_id || ""));
  setStoredActiveOrganizationId(activeMembership?.organization?.id || "");
}

async function loadUsage() {
  const organization = getActiveOrganization();
  if (!organization?.id) return null;
  const accessToken = await getFreshAccessToken();
  const response = await fetch(`/api/records-usage?organizationId=${encodeURIComponent(organization.id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to load storage usage.");
  return data?.usage || null;
}

function renderBreakdownCard(label, value, detail) {
  return `
    <div class="storage-breakdown-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderLargestItem(item) {
  return `
    <div class="storage-item">
      <div class="storage-item-main">
        <span class="storage-type-badge">${escapeHtml(item.type || "File")}</span>
        <strong>${escapeHtml(item.name || "Stored file")}</strong>
        <p>${escapeHtml([formatStorageBytes(item.sizeBytes), formatDate(item.createdAt)].filter(Boolean).join(" · "))}</p>
      </div>
      ${item.href ? `<a class="btn secondary button-link" href="${escapeHtml(item.href)}">Open</a>` : ""}
    </div>
  `;
}

function renderSuggestion(item) {
  return `
    <div class="storage-suggestion">
      <strong>${escapeHtml(item.name || "Stored file")}</strong>
      <p>${escapeHtml(item.suggestion || "Review this item for possible cleanup.")}</p>
      <span>${escapeHtml(formatStorageBytes(item.sizeBytes))}</span>
    </div>
  `;
}

function renderUsage(usage) {
  const storageMetric = usage?.metrics?.storage || { used: 0, limit: 0, remaining: 0, percent: 0 };
  const details = usage?.storageDetails || {};
  const breakdown = details.breakdown || {};
  const largestItems = Array.isArray(details.largestItems) ? details.largestItems : [];
  const suggestions = Array.isArray(details.suggestions) ? details.suggestions : [];

  storageTotalValue.textContent = `${formatStorageBytes(storageMetric.used)} used`;
  storageTotalCopy.textContent = `${formatStorageBytes(storageMetric.remaining)} remaining of ${formatStorageBytes(storageMetric.limit)}. ${formatWholeNumber(breakdown.trackedFileCount)} stored item${Number(breakdown.trackedFileCount) === 1 ? "" : "s"} are counted here.`;
  storageTotalMeter.style.width = `${Math.max(0, Math.min(100, Number(storageMetric.percent || 0)))}%`;

  storageBreakdownGrid.innerHTML = [
    renderBreakdownCard("Uploaded files", formatStorageBytes(breakdown.uploadedFilesBytes), "PDFs, documents, scans, images, and source files."),
    renderBreakdownCard("Meeting recordings", formatStorageBytes(breakdown.meetingRecordingsBytes), "Stored audio or video attached to meeting notes."),
    renderBreakdownCard("Transcript sources", formatStorageBytes(breakdown.transcriptSourceBytes), "Source files linked to meeting transcripts."),
    renderBreakdownCard("App documents", `${formatWholeNumber(breakdown.appDocumentsCount)} docs`, "Text documents are tracked for limits but use minimal file storage."),
  ].join("");

  storageLargestList.innerHTML = largestItems.length
    ? largestItems.map(renderLargestItem).join("")
    : '<p class="empty">No stored files are using measurable storage yet.</p>';

  storageSuggestionList.innerHTML = suggestions.length
    ? suggestions.map(renderSuggestion).join("")
    : '<p class="empty">No large cleanup candidates found. Storage usage looks healthy right now.</p>';
}

async function refreshStorage() {
  const organization = getActiveOrganization();
  if (!organization) {
    renderOrganizationSelector();
    setStatus("No Records library is available for this account.", "error");
    return;
  }

  setStatus("Loading storage usage...");
  renderOrganizationSelector();
  const usage = await loadUsage();
  renderUsage(usage);
  setStatus("");
}

async function handleOrganizationChange() {
  const nextOrganizationId = activeOrganizationSelect.value;
  activeMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId) || activeMembership;
  setStoredActiveOrganizationId(activeMembership?.organization?.id || "");
  try {
    await refreshStorage();
  } catch (error) {
    setStatus(error?.message || "Unable to load storage usage.", "error");
  }
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("/n3xra-records/login");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(storagePanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/n3xra-records/login");
    return;
  }

  show(setupPanel, false);
  show(storagePanel, true);

  try {
    await bootstrapAccess();
    await refreshStorage();
  } catch (error) {
    memberships = [];
    activeMembership = null;
    renderOrganizationSelector();
    setStatus(error?.message || "Unable to load storage usage.", "error");
  }

  mobileLogoutButton?.addEventListener("click", handleSignout);
  mobileMenuToggle?.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount?.addEventListener("click", () => {
    window.location.href = "/n3xra-records/account";
  });
  mobileMenuLibrary?.addEventListener("click", () => {
    window.location.href = "/n3xra-records/library";
  });
  mobileMenuMessagesLink?.classList.remove("hidden");
  mobileMenuRecordingsLink?.classList.remove("hidden");
  activeOrganizationSelect?.addEventListener("change", handleOrganizationChange);
  document.addEventListener("click", (event) => {
    if (!mobileMenu?.classList.contains("is-open")) return;
    if (mobileMenu.contains(event.target) || mobileMenuToggle?.contains(event.target)) return;
    closeMobileMenu();
  });
}

init();
