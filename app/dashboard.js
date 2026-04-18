import JSZip from "https://esm.sh/jszip@3.10.1";
import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { PLAN_ORDER, getPlanConfig, formatPlanName } from "./lib/plan-config.js";
import {
  buildMembershipMap,
  dedupeMembershipsByOrganization,
  formatRoleLabel,
  getCapabilities,
  getMembershipRole,
  getStoredActiveOrganizationId,
  isPlatformAdminEmail,
  MEMBERSHIP_ROLE_ORDER,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
  titleCase,
} from "./lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const supportBanner = document.getElementById("support-banner");
const accountNoLibraryNotice = document.getElementById("account-no-library-notice");
const libraryNoAccessNotice = document.getElementById("library-no-access-notice");
const contextStatus = document.getElementById("context-status");
const uploadStatus = document.getElementById("upload-status");
const docsStatus = document.getElementById("docs-status");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const accountSection = document.getElementById("account-section");
const librarySection = document.getElementById("library-section");
const libraryActionsGrid = document.getElementById("library-actions-grid");
const accountLibraryContext = document.getElementById("account-library-context");
const libraryContextPanel = document.getElementById("library-context-panel");
const librarySearchPanel = document.getElementById("library-search-panel");
const libraryRecentPanel = document.getElementById("library-recent-panel");
const billingSection = document.getElementById("billing-section");
const libraryAccessCard = document.getElementById("library-access-card");
const redeemInviteToggle = document.getElementById("redeem-invite-toggle");
const redeemInviteBody = document.getElementById("redeem-invite-body");
const inviteManagementToggle = document.getElementById("invite-management-toggle");
const inviteManagementBody = document.getElementById("invite-management-body");
const memberManagementToggle = document.getElementById("member-management-toggle");
const memberManagementBody = document.getElementById("member-management-body");
const embedSettingsToggle = document.getElementById("embed-settings-toggle");
const embedSettingsBody = document.getElementById("embed-settings-body");
const organizationPrimaryColorField = document.getElementById("organization-primary-color-field");
const organizationAccentColorField = document.getElementById("organization-accent-color-field");
const organizationAdvancedSettings = document.getElementById("organization-advanced-settings");
const libraryAccessCopy = document.getElementById("library-access-copy");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeOrganizationName = document.getElementById("active-organization-name");
const activeMembershipRole = document.getElementById("active-membership-role");
const sharedLibraryCount = document.getElementById("shared-library-count");
const libraryActiveOrganizationSelect = document.getElementById("library-active-organization-select");
const libraryActiveOrganizationName = document.getElementById("library-active-organization-name");
const libraryActiveMembershipRole = document.getElementById("library-active-membership-role");
const librarySharedLibraryCount = document.getElementById("library-shared-library-count");
const platformAdminLink = document.getElementById("platform-admin-link");
const uploadActionSlot = document.getElementById("upload-action-slot");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalFrame = document.getElementById("file-modal-frame");
const fileModalDownload = document.getElementById("file-modal-download");
const fileModalClose = document.getElementById("file-modal-close");
const profileSettingsToggle = document.getElementById("profile-settings-toggle");
const profileSettingsModal = document.getElementById("profile-settings-modal");
const profileSettingsClose = document.getElementById("profile-settings-close");
const openDeleteAccountModalButton = document.getElementById("open-delete-account-modal");
const deleteAccountBlockedNote = document.getElementById("delete-account-blocked-note");
const deleteAccountModal = document.getElementById("delete-account-modal");
const deleteAccountCancel = document.getElementById("delete-account-cancel");
const deleteAccountSubmit = document.getElementById("delete-account-submit");
const deleteAccountStatus = document.getElementById("delete-account-status");
const openEmbedCardButton = document.getElementById("open-embed-card-button");
const embedAccessCard = document.getElementById("embed-access-card");
const embedModal = document.getElementById("embed-modal");
const embedModalClose = document.getElementById("embed-modal-close");
const installAppModal = document.getElementById("install-app-modal");
const installAppClose = document.getElementById("install-app-close");
const installAppDismiss = document.getElementById("install-app-dismiss");
const installAppAction = document.getElementById("install-app-action");
const installAppCopy = document.getElementById("install-app-copy");
const installAppIosNotice = document.getElementById("install-app-ios-notice");
const installAppStatus = document.getElementById("install-app-status");
const embedPreviewUrlInput = document.getElementById("embed-preview-url");
const embedCodeInput = document.getElementById("embed-code");
const openEmbedPreview = document.getElementById("open-embed-preview");
const copyEmbedCodeButton = document.getElementById("copy-embed-code");
const embedStatus = document.getElementById("embed-status");
const openUploadModalButton = document.getElementById("open-upload-modal");
const uploadModal = document.getElementById("upload-modal");
const uploadModalClose = document.getElementById("upload-modal-close");
const accountName = document.getElementById("account-name");
const accountEmail = document.getElementById("account-email");
const accountOrganization = document.getElementById("account-organization");
const accountRole = document.getElementById("account-role");
const accountTierItem = document.getElementById("account-tier-item");
const accountTier = document.getElementById("account-tier");
const accountStatusItem = document.getElementById("account-status-item");
const accountStatus = document.getElementById("account-status");
const currentPlanName = document.getElementById("current-plan-name");
const currentPlanCopy = document.getElementById("current-plan-copy");
const manageBillingButton = document.getElementById("manage-billing-button");
const changePlanButton = document.getElementById("change-plan-button");
const billingPlanPicker = document.getElementById("billing-plan-picker");
const billingPlanGrid = document.getElementById("billing-plan-grid");
const billingStatus = document.getElementById("billing-status");
const profileForm = document.getElementById("profile-form");
const profileFullNameInput = document.getElementById("profile-full-name");
const profileStatus = document.getElementById("profile-status");
const organizationSettingsForm = document.getElementById("organization-settings-form");
const organizationNameField = document.getElementById("organization-name-field");
const organizationNameInput = document.getElementById("organization-name-input");
const organizationPrimaryColorInput = document.getElementById("organization-primary-color");
const organizationAccentColorInput = document.getElementById("organization-accent-color");
const organizationPublicEmbedInput = document.getElementById("organization-public-embed");
const organizationKeywordSearchInput = document.getElementById("organization-keyword-search");
const organizationFilePreviewCardsInput = document.getElementById("organization-file-preview-cards");
const organizationSettingsSave = document.getElementById("organization-settings-save");
const organizationSettingsStatus = document.getElementById("organization-settings-status");
const redeemInviteForm = document.getElementById("redeem-invite-form");
const redeemInviteCodeInput = document.getElementById("redeem-invite-code");
const redeemInviteStatus = document.getElementById("redeem-invite-status");
const inviteManagementSection = document.getElementById("invite-management-section");
const memberManagementSection = document.getElementById("member-management-section");
const createInviteForm = document.getElementById("create-invite-form");
const inviteRoleInput = document.getElementById("invite-role");
const inviteMaxUsesInput = document.getElementById("invite-max-uses");
const inviteExpiresAtInput = document.getElementById("invite-expires-at");
const createInviteStatus = document.getElementById("create-invite-status");
const inviteList = document.getElementById("invite-list");
const memberList = document.getElementById("member-list");
const memberStatus = document.getElementById("member-status");
const uploadForm = document.getElementById("upload-form");
const searchQueryInput = document.getElementById("search-query");
const searchYearSelect = document.getElementById("search-year");
const searchResetButton = document.getElementById("search-reset");
const uploadMetadataGrid = document.getElementById("upload-metadata-grid");
const uploadTitleInput = document.getElementById("upload-title");
const uploadTitleField = document.getElementById("upload-title-field");
const uploadYearInput = document.getElementById("upload-year");
const uploadMonthInput = document.getElementById("upload-month");
const uploadFileInput = document.getElementById("upload-file");
const uploadFileLabel = document.getElementById("upload-file-label");
const uploadFolderInput = document.getElementById("upload-folder");
const uploadFolderField = document.getElementById("upload-folder-field");
const uploadPublicField = document.getElementById("upload-public-field");
const uploadIsPublicInput = document.getElementById("upload-is-public");
const uploadModeNote = document.getElementById("upload-mode-note");
const uploadModeSingleButton = document.getElementById("upload-mode-single");
const uploadModeBatchButton = document.getElementById("upload-mode-batch");
const uploadResults = document.getElementById("upload-results");
const docList = document.getElementById("doc-list");
const docEmpty = document.getElementById("doc-empty");
const recentFilesList = document.getElementById("recent-files-list");
const recentFilesEmpty = document.getElementById("recent-files-empty");

let supabase = null;
let currentSession = null;
let currentProfile = null;
let memberships = [];
let activeMembership = null;
let documentsCache = [];
let inviteCache = [];
let memberCache = [];
let uploadMode = "single";
const POST_LOGIN_INSTALL_PROMPT_KEY = "n3xra-post-login-install-prompt";
let shouldOfferInstallAfterLoad = false;
function getInitialSection() {
  const params = new URLSearchParams(window.location.search);
  return params.get("section") === "library" ? "library" : "account";
}

function getSupportOrganizationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("support_org") || "";
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "status";
  if (tone) el.classList.add(tone);
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function getErrorMessage(error, fallback) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function closeMobileMenu() {
  if (!mobileMenu || !mobileMenuToggle) return;
  mobileMenu.classList.remove("is-open");
  mobileMenu.classList.add("hidden");
  mobileMenuToggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  if (!mobileMenu || !mobileMenuToggle) return;
  const nextOpen = !mobileMenu.classList.contains("is-open");
  mobileMenu.classList.toggle("is-open", nextOpen);
  mobileMenu.classList.toggle("hidden", !nextOpen);
  mobileMenuToggle.setAttribute("aria-expanded", String(nextOpen));
}

function setMenuActive(section) {
  mobileMenuAccount.classList.toggle("is-active", section === "account");
  mobileMenuLibrary.classList.toggle("is-active", section === "library");
}

function showSection(section) {
  const isAccount = section === "account";
  accountSection.hidden = !isAccount;
  librarySection.hidden = isAccount;
  setMenuActive(section);
  if (!isAccount) {
    setProfileSettingsOpen(false);
    setBillingPlanPickerOpen(false);
    setDeleteAccountModalOpen(false);
    setEmbedModalOpen(false);
    setInstallAppModalOpen(false);
  }
  if (isAccount) {
    setUploadModalOpen(false);
  }
  closeMobileMenu();
}

function setProfileSettingsOpen(isOpen) {
  profileSettingsModal.classList.toggle("is-open", isOpen);
  profileSettingsModal.setAttribute("aria-hidden", String(!isOpen));
  profileSettingsToggle.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen) setDeleteAccountModalOpen(false);
}

function setUploadModalOpen(isOpen) {
  uploadModal.classList.toggle("is-open", isOpen);
  uploadModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    resetUploadFeedback();
  }
}

function clearUploadFileSelections() {
  if (uploadFileInput) uploadFileInput.value = "";
  if (uploadFolderInput) uploadFolderInput.value = "";
}

function setUploadMode(mode) {
  uploadMode = mode === "batch" ? "batch" : "single";
  const isBatch = uploadMode === "batch";

  uploadModeSingleButton.classList.toggle("is-active", !isBatch);
  uploadModeSingleButton.setAttribute("aria-selected", String(!isBatch));
  uploadModeBatchButton.classList.toggle("is-active", isBatch);
  uploadModeBatchButton.setAttribute("aria-selected", String(isBatch));

  show(uploadMetadataGrid, !isBatch);
  show(uploadTitleField, !isBatch);
  show(uploadFolderField, isBatch);
  show(uploadPublicField, !isBatch);

  uploadFileLabel.textContent = isBatch ? "Files" : "File";
  if (isBatch) {
    uploadFileInput.setAttribute("multiple", "");
  } else {
    uploadFileInput.removeAttribute("multiple");
  }
  uploadModeNote.innerHTML = getUploadSupportCopy(isBatch);

  clearUploadFileSelections();
  resetUploadFeedback();
}

function setDeleteAccountModalOpen(isOpen) {
  deleteAccountModal.classList.toggle("is-open", isOpen);
  deleteAccountModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    setStatus(deleteAccountStatus, "");
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
  }
}

function setEmbedModalOpen(isOpen) {
  embedModal.classList.toggle("is-open", isOpen);
  embedModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) setStatus(embedStatus, "");
}

function setInstallAppModalOpen(isOpen) {
  installAppModal.classList.toggle("is-open", isOpen);
  installAppModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) setStatus(installAppStatus, "");
}

function consumePostLoginInstallFlag() {
  try {
    const shouldPrompt = window.sessionStorage.getItem(POST_LOGIN_INSTALL_PROMPT_KEY) === "1";
    window.sessionStorage.removeItem(POST_LOGIN_INSTALL_PROMPT_KEY);
    return shouldPrompt;
  } catch {
    return false;
  }
}

function maybeShowInstallPrompt() {
  if (!shouldOfferInstallAfterLoad) return;

  const pwaState = window.__n3xraPwa || {};
  if (pwaState.isStandalone) {
    shouldOfferInstallAfterLoad = false;
    return;
  }

  const canInstall = Boolean(pwaState.canInstall);
  const isIos = Boolean(pwaState.isIos);
  if (!canInstall && !isIos) return;

  installAppCopy.textContent = canInstall
    ? "Install N3XRA for quicker access and a more app-like experience."
    : "Add N3XRA to your home screen so it opens like an app the next time you use it.";
  show(installAppAction, canInstall);
  show(installAppIosNotice, isIos);
  installAppAction.textContent = "Install app";
  setStatus(installAppStatus, "");
  setInstallAppModalOpen(true);
  shouldOfferInstallAfterLoad = false;
}

function setBillingPlanPickerOpen(isOpen) {
  billingPlanPicker.classList.toggle("hidden", !isOpen);
  changePlanButton.setAttribute("aria-expanded", String(isOpen));
  changePlanButton.textContent = isOpen ? "Hide plans" : "Change plan";
}

function setSectionToggleOpen(toggle, body, isOpen) {
  if (!toggle || !body) return;
  const nextOpen = Boolean(isOpen);
  body.classList.toggle("hidden", !nextOpen);
  toggle.setAttribute("aria-expanded", String(nextOpen));
  toggle.classList.toggle("is-open", nextOpen);
  const indicator = toggle.querySelector(".section-toggle-indicator");
  if (indicator) {
    indicator.textContent = nextOpen ? "-" : "+";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function formatDate(value) {
  if (!value) return "Unknown upload date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function fileLabel(file) {
  return file.webkitRelativePath || file.name;
}

function clearUploadResults() {
  if (!uploadResults) return;
  uploadResults.innerHTML = "";
}

function appendUploadResult(label, tone, message) {
  if (!uploadResults) return;
  const item = document.createElement("li");
  item.className = "upload-result";
  item.innerHTML = `
    <span class="upload-result-tone ${escapeHtml(tone)}">${escapeHtml(tone)}</span>
    <span class="upload-result-name">${escapeHtml(label)}</span>
    <span class="upload-result-message">${escapeHtml(message)}</span>
  `;
  uploadResults.append(item);
}

function collectUploadFiles() {
  if (uploadMode === "single") {
    const file = uploadFileInput?.files?.[0];
    return file ? [file] : [];
  }

  const seen = new Set();
  const all = [];
  const inputs = [uploadFileInput, uploadFolderInput];

  inputs.forEach((input) => {
    const files = Array.from(input?.files || []);
    files.forEach((file) => {
      const key = `${fileLabel(file)}::${file.size}::${file.lastModified}`;
      if (seen.has(key)) return;
      seen.add(key);
      all.push(file);
    });
  });

  return all;
}

function resetUploadFeedback() {
  setStatus(uploadStatus, "");
  clearUploadResults();
}

function getUploadSupportCopy(isBatch) {
  const supported = '<code class="inline">.docx</code>, <code class="inline">.txt</code>, <code class="inline">.md</code>, <code class="inline">.csv</code>, <code class="inline">.json</code>, <code class="inline">.html</code>.';
  const legacyDocNote = 'Legacy <code class="inline">.doc</code> files must be converted to <code class="inline">.docx</code> before upload.';
  if (isBatch) {
    return `Supported in this first pass: ${supported} Batch mode reads both file selection and folder import and auto-detects year/month from filenames when available (private by default). ${legacyDocNote}`;
  }
  return `Supported in this first pass: ${supported} ${legacyDocNote}`;
}

async function insertDocumentRecord(record, userId) {
  const modernPayload = {
    ...record,
    uploaded_by_user_id: userId,
  };
  const { error: modernError } = await supabase.from("documents").insert(modernPayload);
  if (!modernError) return { error: null };

  const errorText = String(modernError.message || "").toLowerCase();
  const legacyFallbackNeeded =
    (errorText.includes("user_id") && errorText.includes("not-null")) ||
    (errorText.includes("uploaded_by_user_id") && errorText.includes("does not exist"));

  if (!legacyFallbackNeeded) {
    return { error: modernError };
  }

  const legacyPayload = {
    ...record,
    user_id: userId,
  };
  const { error: legacyError } = await supabase.from("documents").insert(legacyPayload);
  return { error: legacyError || null };
}

function getActiveOrganization() {
  return activeMembership?.organization || null;
}

function getActiveRole() {
  return getMembershipRole(activeMembership);
}

function getActiveCapabilities() {
  return getCapabilities(
    activeMembership,
    currentSession?.user?.id || "",
    isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function hasActiveLibraryAccess() {
  return Boolean(getActiveOrganization());
}

function getOwnedMemberships() {
  const currentUserId = currentSession?.user?.id || "";
  return memberships.filter((membership) => membership?.organization?.owner_user_id === currentUserId && !membership?.isSupportView);
}

function hasPaidOwnedLibraries() {
  return getOwnedMemberships().some((membership) => ["starter", "organization"].includes(membership?.organization?.subscription_tier || ""));
}

function canCreateOwnedLibrary() {
  const ownedMemberships = getOwnedMemberships();
  return ownedMemberships.length === 0 || ownedMemberships.some((membership) => ["starter", "organization"].includes(membership?.organization?.subscription_tier || ""));
}

function canDeleteOwnAccount() {
  return !hasPaidOwnedLibraries();
}

function isSupportView() {
  return activeMembership?.isSupportView === true;
}

function getDocumentLimit() {
  return Number(getActiveOrganization()?.document_limit || getPlanConfig(getActiveOrganization()?.subscription_tier).documentLimit);
}

function hasEmbeddedAccess() {
  return getActiveOrganization()?.subscription_tier === "organization";
}

function isFreePlanExperience() {
  return getActiveOrganization()?.subscription_tier === "free" && !isSupportView();
}

function hasMultipleLibraries() {
  return memberships.length > 1;
}

function isBillingEnabled() {
  return Boolean(getConfig().billingEnabled);
}

function formatBillingDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

async function openBillingFlow(action, payload = {}) {
  if (!isBillingEnabled()) {
    setStatus(billingStatus, "Stripe billing is not enabled in app/config.js yet.", "error");
    return false;
  }

  const { data, error } = await supabase.functions.invoke("stripe-billing", {
    body: {
      action,
      ...payload,
    },
  });

  if (error) {
    setStatus(billingStatus, error.message, "error");
    return false;
  }

  if (data?.error) {
    setStatus(billingStatus, data.error, "error");
    return false;
  }

  if (!data?.url) {
    setStatus(billingStatus, "Billing session did not return a redirect URL.", "error");
    return false;
  }

  window.location.assign(data.url);
  return true;
}

function showBillingFlashFromUrl() {
  const url = new URL(window.location.href);
  const billingState = url.searchParams.get("billing");
  if (!billingState) return;

  const flashMessages = {
    success: ["Checkout complete. Billing details should refresh in a few seconds.", "success"],
    canceled: ["Stripe checkout was canceled.", ""],
    portal: ["Returned from the billing portal.", "success"],
  };
  const [message, tone] = flashMessages[billingState] || ["", ""];
  if (message) {
    setStatus(billingStatus, message, tone);
  }

  if (billingState === "success") {
    window.setTimeout(() => {
      loadActiveOrganizationData().catch(() => {
        // Keep the initial success state if the delayed refresh fails.
      });
    }, 2500);
  }

  url.searchParams.delete("billing");
  window.history.replaceState({}, "", url);
}

function toLocalDateTimeInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDefaultInviteExpiresAtValue() {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  next.setHours(23, 59, 0, 0);
  return toLocalDateTimeInputValue(next);
}

function buildSiblingPageUrl(pageName) {
  const currentUrl = new URL(window.location.href);
  const currentPath = currentUrl.pathname;
  const siblingPath = currentPath.replace(/[^/]*$/, `${pageName}.html`);
  return new URL(siblingPath, currentUrl.origin);
}

function getEmbedUrl() {
  const organization = getActiveOrganization();
  if (!organization) return "";
  const embedUrl = buildSiblingPageUrl("embed");
  embedUrl.searchParams.set("org", organization.id);
  return embedUrl.href;
}

function buildPreviewUrl(doc, signedUrl) {
  const lowerName = String(doc?.original_filename || "").toLowerCase();
  if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
  }
  return signedUrl;
}

async function extractDocxText(file) {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("This DOCX file is missing word/document.xml.");
  const xml = await xmlFile.async("string");
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  return cleanWhitespace(
    paragraphs
      .map((paragraph) => {
        const runs = paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return runs
          .map((run) => run.replace(/<\/?w:t[^>]*>/g, ""))
          .map((value) => decodeXmlEntities(value))
          .join(" ");
      })
      .join("\n")
  );
}

async function extractTextFromFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) return extractDocxText(file);
  if (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".htm")
  ) {
    return cleanWhitespace(await file.text());
  }
  if (lowerName.endsWith(".doc")) {
    throw new Error("Legacy .doc files are not supported in the browser version. Convert them to .docx first.");
  }
  if (lowerName.endsWith(".pdf")) {
    throw new Error("PDF extraction is not set up in the browser version yet. Start with .docx or plain-text files.");
  }
  throw new Error("Unsupported file type. Use .docx, .txt, .md, .csv, .json, or .html.");
}

function snippetFromText(text, query) {
  if (!text) return "No extracted text yet.";
  if (!query) return `${text.slice(0, 220).trim()}${text.length > 220 ? "..." : ""}`;

  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return `${text.slice(0, 220).trim()}${text.length > 220 ? "..." : ""}`;

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + q.length + 120);
  const snippet = text.slice(start, end).trim();
  const relativeIndex = index - start;
  const before = escapeHtml(snippet.slice(0, relativeIndex));
  const match = escapeHtml(snippet.slice(relativeIndex, relativeIndex + q.length));
  const after = escapeHtml(snippet.slice(relativeIndex + q.length));
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

function inferYearMonthFromFilename(filename) {
  const baseName = String(filename || "").replace(/\.[^.]+$/, "");
  const tokenized = baseName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .replace(/(\d{4})/g, " $1 ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const monthMap = new Map([
    ["jan", "January"],
    ["january", "January"],
    ["feb", "February"],
    ["february", "February"],
    ["mar", "March"],
    ["march", "March"],
    ["apr", "April"],
    ["april", "April"],
    ["may", "May"],
    ["jun", "June"],
    ["june", "June"],
    ["jul", "July"],
    ["july", "July"],
    ["aug", "August"],
    ["august", "August"],
    ["sep", "September"],
    ["sept", "September"],
    ["september", "September"],
    ["oct", "October"],
    ["october", "October"],
    ["nov", "November"],
    ["november", "November"],
    ["dec", "December"],
    ["december", "December"],
  ]);

  const monthToken = tokenized.find((token) => monthMap.has(token));
  const yearToken = tokenized.find((token) => /^(19|20)\d{2}$/.test(token));

  return {
    year: yearToken || null,
    month: monthToken ? monthMap.get(monthToken) : null,
  };
}

function getMonthNumber(monthValue) {
  const raw = String(monthValue || "").trim().toLowerCase();
  if (!raw) return null;

  if (/^\d{1,2}$/.test(raw)) {
    const numeric = Number.parseInt(raw, 10);
    return numeric >= 1 && numeric <= 12 ? numeric : null;
  }

  const monthMap = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ]);

  return monthMap.get(raw) || null;
}

function getDocumentDateScore(doc) {
  const yearRaw = String(doc?.year || "").trim();
  if (!/^(19|20)\d{2}$/.test(yearRaw)) return null;
  const year = Number.parseInt(yearRaw, 10);
  const month = getMonthNumber(doc?.month) || 0;
  return year * 100 + month;
}

function sortMemberships(items) {
  const roleOrder = {
    account_admin: 0,
    editor: 1,
    viewer: 2,
  };

  return [...items].sort((a, b) => {
    const aSupport = a.isSupportView ? 0 : 1;
    const bSupport = b.isSupportView ? 0 : 1;
    if (aSupport !== bSupport) return aSupport - bSupport;
    const aRank = roleOrder[getMembershipRole(a)] ?? 99;
    const bRank = roleOrder[getMembershipRole(b)] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.organization?.name || "").localeCompare(String(b.organization?.name || ""));
  });
}

async function bootstrapAccess() {
  const supportOrgId = getSupportOrganizationId();
  const { data: bootstrapData, error: bootstrapError } = await supabase.rpc("bootstrap_organization", {
    input_organization_name: null,
    input_invite_code: null,
  });

  if (bootstrapError) {
    throw bootstrapError;
  }

  const [{ data: profileData, error: profileError }, { data: membershipData, error: membershipError }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("id", currentSession.user.id).maybeSingle(),
    supabase
      .from("organization_memberships")
      .select(`
        id,
        user_id,
        organization_id,
        role,
        permissions,
        created_at,
        organization:organizations(
          id,
          name,
          slug,
          owner_user_id,
          subscription_tier,
          account_status,
          document_limit,
          storage_limit_mb,
          user_limit,
          public_embed_enabled,
          public_embed_token,
          transcript_preview_enabled,
          keyword_search_enabled,
          file_preview_cards_enabled,
          hosted_public_portal_enabled,
          branded_primary_color,
          branded_accent_color
        )
      `)
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (profileError) throw profileError;
  if (membershipError) throw membershipError;

  currentProfile = profileData || null;
  memberships = dedupeMembershipsByOrganization(buildMembershipMap(membershipData || []));

  if (supportOrgId && isPlatformAdminEmail(currentSession.user.email)) {
    const { data: supportOrg, error: supportError } = await supabase
      .from("organizations")
      .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
      .eq("id", supportOrgId)
      .maybeSingle();

    if (supportError) throw supportError;
    if (supportOrg) {
      memberships = sortMemberships([
        {
          id: `support-${supportOrg.id}`,
          organization_id: supportOrg.id,
          role: "account_owner",
          permissions: {},
          organization: supportOrg,
          isSupportView: true,
        },
        ...memberships.filter((item) => item.organization?.id !== supportOrg.id),
      ]);
    }
  } else {
    memberships = sortMemberships(memberships);
  }

  const bootstrapOrgId = String(bootstrapData?.active_organization_id || "");
  const preferredOrgId = supportOrgId || bootstrapOrgId;
  activeMembership = resolveActiveOrganization(memberships, preferredOrgId);
  if (activeMembership?.organization?.id) {
    setStoredActiveOrganizationId(activeMembership.organization.id);
  } else {
    setStoredActiveOrganizationId("");
  }
}

async function loadInvites() {
  if (!activeMembership) return;
  if (!getActiveCapabilities().canManageInvites) {
    inviteCache = [];
    inviteList.innerHTML = "";
    return;
  }

  const { data, error } = await supabase
    .from("organization_invites")
    .select("id, code, role, max_uses, redeemed_uses, expires_at, is_disabled, created_at")
    .eq("organization_id", activeMembership.organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(createInviteStatus, error.message, "error");
    return;
  }

  inviteCache = Array.isArray(data) ? data : [];
  renderInvites();
}

async function loadMembers() {
  if (!activeMembership) return;

  const { data: membershipRows, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("id, organization_id, user_id, role, created_at")
    .eq("organization_id", activeMembership.organization.id)
    .order("created_at", { ascending: true });

  if (membershipError) {
    setStatus(memberStatus, membershipError.message, "error");
    return;
  }

  const userIds = Array.from(new Set((membershipRows || []).map((item) => item.user_id).filter(Boolean)));
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  if (profileError) {
    setStatus(memberStatus, profileError.message, "error");
    return;
  }

  const profileMap = new Map((profiles || []).map((item) => [item.id, item]));
  memberCache = (membershipRows || []).map((membership) => ({
    ...membership,
    profile: profileMap.get(membership.user_id) || null,
  }));
  renderMembers();
}

function renderOrganizationSelector() {
  if (!memberships.length || !activeMembership?.organization) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    libraryActiveOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeOrganizationName.textContent = "No active library";
    libraryActiveOrganizationName.textContent = "No active library";
    activeMembershipRole.textContent = "No library access";
    libraryActiveMembershipRole.textContent = "No library access";
    sharedLibraryCount.textContent = "0";
    librarySharedLibraryCount.textContent = "0";
    activeOrganizationSelect.disabled = true;
    libraryActiveOrganizationSelect.disabled = true;
    show(activeOrganizationSelect, false);
    show(libraryActiveOrganizationSelect, false);
    show(activeOrganizationName, true);
    show(libraryActiveOrganizationName, true);
    return;
  }

  const currentId = activeMembership?.organization?.id || "";
  const nameCounts = memberships.reduce((map, membership) => {
    const key = String(membership.organization?.name || "Untitled library").trim().toLowerCase();
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const optionsMarkup = memberships
    .map((membership) => {
      const selected = membership.organization?.id === currentId ? " selected" : "";
      const supportTag = membership.isSupportView ? " (Support view)" : "";
      const rawName = String(membership.organization?.name || "Untitled library");
      const key = rawName.trim().toLowerCase();
      const needsSuffix = (nameCounts.get(key) || 0) > 1;
      const idSuffix = String(membership.organization?.id || "").slice(0, 8);
      const displayName = needsSuffix && idSuffix ? `${rawName} (${idSuffix})` : rawName;
      return `<option value="${escapeHtml(membership.organization?.id || "")}"${selected}>${escapeHtml(displayName)}${supportTag}</option>`;
    })
    .join("");
  activeOrganizationSelect.innerHTML = optionsMarkup;
  libraryActiveOrganizationSelect.innerHTML = optionsMarkup;
  const activeName = activeMembership.organization?.name || "Untitled library";
  activeOrganizationName.textContent = activeName;
  libraryActiveOrganizationName.textContent = activeName;

  const roleLabel = isSupportView() ? "n3xra.com Support View" : formatRoleLabel(getActiveRole());
  activeMembershipRole.textContent = roleLabel;
  libraryActiveMembershipRole.textContent = roleLabel;
  const ownLibraries = memberships.filter((item) => item.organization?.owner_user_id === currentSession?.user?.id).length;
  const sharedCount = String(Math.max(memberships.length - ownLibraries, 0));
  sharedLibraryCount.textContent = sharedCount;
  librarySharedLibraryCount.textContent = sharedCount;
  const hasMany = hasMultipleLibraries();
  activeOrganizationSelect.disabled = !hasMany;
  libraryActiveOrganizationSelect.disabled = !hasMany;
  show(activeOrganizationSelect, hasMany);
  show(libraryActiveOrganizationSelect, hasMany);
  show(activeOrganizationName, !hasMany);
  show(libraryActiveOrganizationName, !hasMany);
}

function updateEmbedAccess() {
  const organization = getActiveOrganization();
  const enabled = hasEmbeddedAccess();
  show(embedAccessCard, enabled);

  if (!enabled || !organization) {
    setEmbedModalOpen(false);
    return;
  }

  const embedUrl = getEmbedUrl();
  embedPreviewUrlInput.value = embedUrl;
  embedCodeInput.value = `<iframe src="${embedUrl}" title="n3xra.com Embedded View" width="100%" height="820" style="border:0;border-radius:24px;"></iframe>`;
  openEmbedPreview.href = embedUrl;
}

function renderBillingPlans() {
  const organization = getActiveOrganization();
  if (!organization) return;
  const capabilities = getActiveCapabilities();

  const activePlanId = organization.subscription_tier || "free";
  const activePlan = getPlanConfig(activePlanId);
  const remaining = Math.max(getDocumentLimit() - documentsCache.length, 0);
  const currentPeriodEndLabel = formatBillingDate(organization.subscription_current_period_end);
  const statusLabel = titleCase(organization.account_status || "active");
  const isPaidPlan = activePlanId !== "free";

  currentPlanName.textContent = activePlan.name;
  currentPlanCopy.textContent = [
    `${organization.document_limit} documents`,
    `${organization.user_limit} users`,
    `${organization.storage_limit_mb} MB`,
    `${remaining} remaining`,
    isPaidPlan ? `Status: ${statusLabel}` : "",
    isPaidPlan && currentPeriodEndLabel ? `Renews ${currentPeriodEndLabel}` : "",
  ].filter(Boolean).join(" · ");
  show(manageBillingButton, isBillingEnabled() && Boolean(organization.stripe_customer_id || organization.stripe_subscription_id));
  updateEmbedAccess();

  billingPlanGrid.innerHTML = PLAN_ORDER.map((planId) => {
    const plan = getPlanConfig(planId);
    const isCurrent = planId === activePlanId;
    const isFreeTarget = planId === "free";
    const isPaidAccount = activePlanId !== "free";
    const buttonLabel = isCurrent
      ? "Current plan"
      : isPaidAccount
        ? (isFreeTarget ? "Cancel in portal" : "Change in portal")
        : (isFreeTarget ? "Included" : "Checkout");
    const badge = isCurrent ? '<span class="plan-badge">Current</span>' : "";
    const disabled = !capabilities.canManageBilling ? " disabled" : "";
    return `
      <article class="plan-card${isCurrent ? " is-current" : ""}">
        <div class="plan-card-head">
          <div>
            <p class="plan-name">${plan.name}</p>
            <p class="plan-price">${plan.priceLabel}</p>
          </div>
          ${badge}
        </div>
        <p class="plan-summary">${plan.summary}</p>
        <p class="plan-limit">${plan.documentLimit} documents · ${plan.userLimit} users · ${plan.storageLimitMb} MB</p>
        <ul class="plan-features">
          ${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
        </ul>
        <div class="actions">
          <button class="btn secondary" type="button" data-plan-id="${plan.id}"${disabled}${isCurrent ? " disabled" : ""}>${buttonLabel}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderProfile() {
  const organization = getActiveOrganization();
  const hasLibraryAccess = hasActiveLibraryAccess();
  const isFreePlan = isFreePlanExperience();
  const capabilities = getActiveCapabilities();
  const canSeeBilling = capabilities.canManageBilling;
  const canSeeLibrarySettings = !isFreePlan && capabilities.canManageLibrarySettings;
  const canSeeInviteManagement = !isFreePlan && capabilities.canManageInvites;
  const canSeeMemberManagement = !isFreePlan && capabilities.canManageMembers;
  const canSeePlanMeta = capabilities.canManageBilling || capabilities.canManageLibrarySettings;
  const canEditLibraryNameFromProfile = capabilities.canManageLibrarySettings;
  const canDeleteAccountNow = canDeleteOwnAccount();

  accountName.textContent = currentProfile?.full_name || currentSession?.user?.email || "-";
  accountEmail.textContent = currentSession?.user?.email || currentProfile?.email || "-";
  accountOrganization.textContent = organization?.name || "No active library";
  accountRole.textContent = hasLibraryAccess
    ? (isSupportView() ? "n3xra.com Support View" : formatRoleLabel(getActiveRole()))
    : "No library access";
  accountTier.textContent = organization ? formatPlanName(organization.subscription_tier || "free") : "-";
  accountStatus.textContent = organization ? titleCase(organization.account_status || "active") : "-";
  profileFullNameInput.value = currentProfile?.full_name || "";

  organizationNameInput.value = organization?.name || "";
  organizationPrimaryColorInput.value = organization?.branded_primary_color || "";
  organizationAccentColorInput.value = organization?.branded_accent_color || "";
  organizationPublicEmbedInput.checked = Boolean(organization?.public_embed_enabled);
  organizationKeywordSearchInput.checked = Boolean(organization?.keyword_search_enabled);
  organizationFilePreviewCardsInput.checked = Boolean(organization?.file_preview_cards_enabled);

  organizationNameInput.disabled = !capabilities.canManageLibrarySettings;
  organizationPrimaryColorInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationAccentColorInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationPublicEmbedInput.disabled = !capabilities.canManageLibrarySettings || !hasEmbeddedAccess() || isFreePlan;
  organizationKeywordSearchInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationFilePreviewCardsInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationSettingsSave.disabled = !capabilities.canManageLibrarySettings;
  openUploadModalButton.disabled = !capabilities.canUploadDocuments;
  uploadIsPublicInput.disabled = !capabilities.canUploadDocuments || !hasEmbeddedAccess();

  show(accountNoLibraryNotice, !hasLibraryAccess);
  show(accountLibraryContext, hasLibraryAccess);
  show(accountTierItem, canSeePlanMeta);
  show(accountStatusItem, canSeePlanMeta);
  show(libraryNoAccessNotice, !hasLibraryAccess);
  show(libraryContextPanel, hasLibraryAccess);
  show(billingSection, hasLibraryAccess && canSeeBilling);
  show(libraryAccessCard, hasLibraryAccess);
  show(libraryActionsGrid, hasLibraryAccess);
  show(librarySearchPanel, hasLibraryAccess);
  show(libraryRecentPanel, hasLibraryAccess);
  show(changePlanButton, capabilities.canManageBilling);
  show(organizationNameField, canEditLibraryNameFromProfile);
  show(organizationPrimaryColorField, !isFreePlan);
  show(organizationAccentColorField, !isFreePlan);
  show(organizationAdvancedSettings, !isFreePlan);
  show(redeemInviteToggle, hasLibraryAccess);
  show(redeemInviteBody, hasLibraryAccess && !redeemInviteBody.classList.contains("hidden"));
  show(inviteManagementToggle, canSeeInviteManagement);
  show(inviteManagementBody, canSeeInviteManagement && !inviteManagementBody.classList.contains("hidden"));
  show(memberManagementToggle, canSeeMemberManagement);
  show(memberManagementBody, canSeeMemberManagement && !memberManagementBody.classList.contains("hidden"));
  show(embedSettingsToggle, hasLibraryAccess && canSeeLibrarySettings);
  show(embedSettingsBody, hasLibraryAccess && canSeeLibrarySettings && !embedSettingsBody.classList.contains("hidden"));
  show(inviteManagementSection, canSeeInviteManagement);
  show(memberManagementSection, canSeeMemberManagement);
  show(uploadActionSlot, capabilities.canUploadDocuments);
  show(openDeleteAccountModalButton, canDeleteAccountNow);
  show(deleteAccountBlockedNote, !canDeleteAccountNow);
  libraryAccessCopy.textContent = isFreePlan
    ? "Join shared libraries from invite codes."
    : capabilities.canManageMembers
      ? "Join shared libraries and manage shared access for this library."
      : "Join shared libraries from invite codes.";
  if (!capabilities.canManageBilling) {
    setBillingPlanPickerOpen(false);
  }
  if (!canSeeInviteManagement) {
    setSectionToggleOpen(inviteManagementToggle, inviteManagementBody, false);
  }
  if (!canSeeMemberManagement) {
    setSectionToggleOpen(memberManagementToggle, memberManagementBody, false);
  }
  if (!(hasLibraryAccess && canSeeLibrarySettings)) {
    setSectionToggleOpen(embedSettingsToggle, embedSettingsBody, false);
  }

  Array.from(createInviteForm.elements).forEach((field) => {
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLButtonElement) {
      field.disabled = !capabilities.canManageInvites || isFreePlan;
    }
  });

  if (isFreePlan) {
    setSectionToggleOpen(embedSettingsToggle, embedSettingsBody, false);
  }

  renderBillingPlans();
  renderOrganizationSelector();
  show(platformAdminLink, isPlatformAdminEmail(currentSession.user.email));

  if (isSupportView()) {
    supportBanner.textContent = `Support view active for ${organization?.name || "this library"}. You are viewing this tenant through n3xra.com admin tools.`;
    show(supportBanner, true);
  } else {
    show(supportBanner, false);
  }
}

function updateYearFilterOptions() {
  const years = Array.from(new Set(documentsCache.map((doc) => String(doc.year || "").trim()).filter(Boolean))).sort((a, b) => Number(b) - Number(a));
  searchYearSelect.innerHTML = '<option value="all">All years</option>';
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    searchYearSelect.append(option);
  });
}

function renderDocuments() {
  const query = searchQueryInput.value.trim().toLowerCase();
  const selectedYear = searchYearSelect.value;

  docList.innerHTML = "";

  if (!query) {
    show(docEmpty, true);
    docEmpty.textContent = "Type a keyword to search your documents.";
    renderProfile();
    return;
  }

  const filtered = documentsCache.filter((doc) => {
    const yearMatch = selectedYear === "all" || String(doc.year || "") === selectedYear;
    if (!yearMatch) return false;
    const haystack = `${doc.title || ""} ${doc.original_filename || ""} ${doc.extracted_text || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  show(docEmpty, filtered.length === 0);
  if (filtered.length === 0) {
    docEmpty.textContent = "No documents match your search.";
  }

  filtered.forEach((doc) => {
    const metaBits = [
      escapeHtml(doc.original_filename || "Unknown file"),
      doc.year ? `Year ${escapeHtml(doc.year)}` : "",
      doc.month ? escapeHtml(doc.month) : "",
      doc.is_public ? "Public" : "Private",
      formatDate(doc.created_at),
    ].filter(Boolean);

    const card = document.createElement("article");
    card.className = "doc-card";
    card.innerHTML = `
      <div class="doc-meta">
        <div>
          <p class="doc-title">${escapeHtml(doc.title || doc.original_filename || "Untitled document")}</p>
          <p class="doc-subtitle">${metaBits.join(" · ")}</p>
        </div>
        <span class="doc-status">${escapeHtml(doc.status || "uploaded")}</span>
      </div>
      <p class="doc-snippet">${snippetFromText(doc.extracted_text || "", query)}</p>
      <div class="doc-actions">
        <button class="btn secondary" type="button" data-action="open" data-id="${doc.id}">Open file</button>
      </div>
    `;
    docList.append(card);
  });

  renderProfile();
}

function renderRecentFiles() {
  recentFilesList.innerHTML = "";
  const recent = [...documentsCache]
    .sort((a, b) => {
      const aScore = getDocumentDateScore(a);
      const bScore = getDocumentDateScore(b);

      if (aScore !== bScore) {
        if (aScore === null) return 1;
        if (bScore === null) return -1;
        return bScore - aScore;
      }

      const aCreatedAt = new Date(a.created_at || 0).getTime();
      const bCreatedAt = new Date(b.created_at || 0).getTime();
      return bCreatedAt - aCreatedAt;
    })
    .slice(0, 3);
  show(recentFilesEmpty, recent.length === 0);
  if (!recent.length) return;

  recent.forEach((doc) => {
    const item = document.createElement("article");
    item.className = "download-item recent-file-item";
    item.innerHTML = `
      <div>
        <p class="download-name">${escapeHtml(doc.title || doc.original_filename || "Untitled document")}</p>
        <p class="download-meta">${escapeHtml(doc.original_filename || "Unknown file")}${doc.year ? ` · ${escapeHtml(doc.year)}` : ""}${doc.month ? ` · ${escapeHtml(doc.month)}` : ""}${doc.is_public ? " · Public" : " · Private"}</p>
      </div>
      <div class="actions">
        <button class="btn secondary" type="button" data-action="open" data-id="${doc.id}">Open</button>
      </div>
    `;
    recentFilesList.append(item);
  });
}

function renderInvites() {
  inviteList.innerHTML = "";
  if (!inviteCache.length) {
    inviteList.innerHTML = '<tr><td colspan="5">No active invite codes.</td></tr>';
    return;
  }

  inviteCache.forEach((invite) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code class="inline">${escapeHtml(invite.code)}</code></td>
      <td>${escapeHtml(formatRoleLabel(invite.role))}</td>
      <td>${invite.redeemed_uses}/${invite.max_uses}</td>
      <td>${invite.expires_at ? escapeHtml(new Date(invite.expires_at).toLocaleString()) : "Never"}</td>
      <td><button class="btn secondary" type="button" data-action="delete-invite" data-invite-id="${invite.id}">Delete</button></td>
    `;
    inviteList.append(row);
  });
}

function renderMembers() {
  const capabilities = getActiveCapabilities();
  const canEdit = capabilities.canManageMembers;
  memberList.innerHTML = "";

  memberCache.forEach((member) => {
    const isOwner = member.user_id === getActiveOrganization()?.owner_user_id;
    const isSelf = member.user_id === currentSession?.user?.id;
    const canRemove = !isOwner && !isSelf;
    const row = document.createElement("tr");
    const effectiveRole = isOwner ? "billing_owner" : getMembershipRole(member);
    const roleOptions = MEMBERSHIP_ROLE_ORDER
      .map((role) => `<option value="${role}"${effectiveRole === role ? " selected" : ""}>${escapeHtml(formatRoleLabel(role))}</option>`)
      .join("");
    const roleSelect = isOwner
      ? escapeHtml(formatRoleLabel(effectiveRole))
      : canEdit
        ? `<select data-membership-id="${member.id}" data-current-role="${escapeHtml(effectiveRole)}">${roleOptions}${canRemove ? '<option value="__remove__">Remove user</option>' : ""}</select>`
        : escapeHtml(formatRoleLabel(effectiveRole));
    const action = roleSelect;

    row.innerHTML = `
      <td>${escapeHtml(member.profile?.full_name || "Unknown")}</td>
      <td>${escapeHtml(member.profile?.email || "")}</td>
      <td>${escapeHtml(formatRoleLabel(effectiveRole))}${isOwner ? " (Owner)" : ""}</td>
      <td>${action}</td>
    `;
    memberList.append(row);
  });

  if (!memberCache.length) {
    memberList.innerHTML = '<tr><td colspan="4">No members found.</td></tr>';
  }
}

async function loadDocuments() {
  const organization = getActiveOrganization();
  if (!organization) return;

  setStatus(docsStatus, "Loading documents...");
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, original_filename, storage_path, status, processing_error, extracted_text, year, month, is_public, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(docsStatus, error.message, "error");
    return;
  }

  documentsCache = Array.isArray(data) ? data : [];
  updateYearFilterOptions();
  renderDocuments();
  renderRecentFiles();
  setStatus(docsStatus, `${documentsCache.length} document${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function loadActiveOrganizationData() {
  if (!hasActiveLibraryAccess()) {
    documentsCache = [];
    inviteCache = [];
    memberCache = [];
    updateYearFilterOptions();
    renderDocuments();
    renderRecentFiles();
    renderInvites();
    renderMembers();
    renderProfile();
    setStatus(docsStatus, "");
    setStatus(createInviteStatus, "");
    setStatus(memberStatus, "");
    return;
  }

  renderProfile();
  await Promise.all([loadDocuments(), loadInvites(), loadMembers()]);
}

async function createSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60);
  if (error || !data?.signedUrl) {
    setStatus(docsStatus, error?.message || "Unable to create signed URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function createDownloadSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const downloadName = doc.original_filename || "download";
  const { data, error } = await supabase
    .storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60 * 60, { download: downloadName });
  if (error || !data?.signedUrl) {
    setStatus(docsStatus, error?.message || "Unable to create download URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function openFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const downloadSigned = await createDownloadSignedUrlForDocument(documentId);
  const { doc, signedUrl } = signed;

  fileModalTitle.textContent = doc.title || doc.original_filename || "File preview";
  fileModalFrame.src = buildPreviewUrl(doc, signedUrl);
  fileModalDownload.href = downloadSigned?.signedUrl || signedUrl;
  fileModalDownload.setAttribute("download", doc.original_filename || "download");
  fileModal.classList.add("is-open");
  fileModal.setAttribute("aria-hidden", "false");
}

function closeFileModal() {
  fileModal.classList.remove("is-open");
  fileModal.setAttribute("aria-hidden", "true");
  fileModalFrame.src = "";
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(contextStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("./login.html");
}

async function handleProfileSave(event) {
  event.preventDefault();
  setStatus(profileStatus, "Saving profile...");
  const organization = getActiveOrganization();
  const capabilities = getActiveCapabilities();

  const updates = {
    full_name: profileFullNameInput.value.trim() || null,
  };

  const [{ error: profileError }, organizationResult] = await Promise.all([
    supabase.from("profiles").update(updates).eq("id", currentSession.user.id),
    organization && capabilities.canManageLibrarySettings
      ? supabase
          .from("organizations")
          .update({
            name: organizationNameInput.value.trim() || organization.name,
          })
          .eq("id", organization.id)
          .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (profileError) {
    setStatus(profileStatus, profileError.message, "error");
    return;
  }
  if (organizationResult?.error) {
    setStatus(profileStatus, organizationResult.error.message, "error");
    return;
  }

  currentProfile = { ...(currentProfile || {}), ...updates };
  if (organizationResult?.data) {
    activeMembership.organization = organizationResult.data;
    memberships = memberships.map((membership) =>
      membership.organization?.id === organizationResult.data.id
        ? { ...membership, organization: organizationResult.data }
        : membership
    );
  }
  renderProfile();
  setStatus(profileStatus, "Profile updated.", "success");
}

async function handleOrganizationSettingsSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  const isFreePlan = isFreePlanExperience();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(organizationSettingsStatus, "You do not have permission to change embed settings.", "error");
    return;
  }

  const updates = isFreePlan
    ? {
        name: organizationNameInput.value.trim() || organization.name,
      }
    : {
        name: organizationNameInput.value.trim() || organization.name,
        branded_primary_color: organizationPrimaryColorInput.value.trim() || null,
        branded_accent_color: organizationAccentColorInput.value.trim() || null,
        public_embed_enabled: hasEmbeddedAccess() ? organizationPublicEmbedInput.checked : false,
        keyword_search_enabled: organizationKeywordSearchInput.checked,
        file_preview_cards_enabled: organizationFilePreviewCardsInput.checked,
      };

  setStatus(organizationSettingsStatus, "Saving embed settings...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
    .single();

  if (error) {
    setStatus(organizationSettingsStatus, error.message, "error");
    return;
  }

  activeMembership.organization = data;
  memberships = memberships.map((membership) =>
    membership.organization?.id === data.id ? { ...membership, organization: data } : membership
  );
  renderProfile();
  setStatus(organizationSettingsStatus, "Embed settings updated.", "success");
}

async function handlePlanChange(planId) {
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageBilling) {
    setStatus(billingStatus, "Only the account owner or n3xra.com admin can change plan tiers.", "error");
    return;
  }

  if (planId === "free" || organization.subscription_tier !== "free" || organization.stripe_customer_id) {
    setStatus(billingStatus, "Opening Stripe billing portal...");
    await openBillingFlow("create-portal-session", { organizationId: organization.id });
    return;
  }

  setStatus(billingStatus, "Opening Stripe checkout...");
  await openBillingFlow("create-checkout-session", {
    organizationId: organization.id,
    planId,
  });
}

async function handleRedeemInvite(event) {
  event.preventDefault();
  const code = redeemInviteCodeInput.value.trim();
  if (!code) {
    setStatus(redeemInviteStatus, "Enter an invite code first.", "error");
    return;
  }

  setStatus(redeemInviteStatus, "Redeeming invite code...");
  const { data, error } = await supabase.rpc("redeem_invite_code", { input_code: code });
  if (error) {
    setStatus(redeemInviteStatus, error.message, "error");
    return;
  }

  redeemInviteCodeInput.value = "";
  await bootstrapAccess();
  const nextOrganizationId = String(data?.organization_id || "");
  if (nextOrganizationId) {
    const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
    if (nextMembership) {
      activeMembership = nextMembership;
      setStoredActiveOrganizationId(nextOrganizationId);
    }
  }
  await loadActiveOrganizationData();
  setStatus(redeemInviteStatus, "Shared library added to your account.", "success");
}

async function handleCreateInvite(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;

  setStatus(createInviteStatus, "Creating invite code...");
  const maxUses = Number.parseInt(inviteMaxUsesInput.value.trim(), 10) || 1;
  const expiresAtValue = inviteExpiresAtInput.value.trim();
  let expiresAtIso = null;
  if (expiresAtValue) {
    const expiresAtDate = new Date(expiresAtValue);
    if (Number.isNaN(expiresAtDate.getTime())) {
      setStatus(createInviteStatus, "Expires at date/time is invalid.", "error");
      return;
    }
    expiresAtIso = expiresAtDate.toISOString();
  }
  const { data, error } = await supabase.rpc("create_organization_invite", {
    input_organization_id: organization.id,
    input_role: inviteRoleInput.value,
    input_max_uses: maxUses,
    input_expires_at: expiresAtIso,
  });

  if (error) {
    setStatus(createInviteStatus, error.message, "error");
    return;
  }

  const invite = Array.isArray(data) ? data[0] : data;
  let copiedToClipboard = false;
  if (invite?.code && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(invite.code);
      copiedToClipboard = true;
    } catch {
      copiedToClipboard = false;
    }
  }

  inviteMaxUsesInput.value = "1";
  inviteExpiresAtInput.value = getDefaultInviteExpiresAtValue();
  await loadInvites();
  if (invite?.code) {
    setStatus(
      createInviteStatus,
      copiedToClipboard
        ? `Invite code ${invite.code} created and copied.`
        : `Invite code ${invite.code} created.`,
      "success"
    );
    return;
  }

  setStatus(createInviteStatus, "Invite code created.", "success");
}

async function handleInviteAction(event) {
  const button = event.target.closest("button[data-action='delete-invite']");
  if (!button) return;
  const inviteId = button.getAttribute("data-invite-id");
  const organization = getActiveOrganization();
  if (!inviteId || !organization) return;

  if (!window.confirm("Delete this invite code? This cannot be undone.")) return;

  setStatus(createInviteStatus, "Deleting invite code...");
  button.disabled = true;
  const { error } = await supabase
    .from("organization_invites")
    .delete()
    .eq("id", inviteId)
    .eq("organization_id", organization.id);
  button.disabled = false;

  if (error) {
    setStatus(createInviteStatus, error.message, "error");
    return;
  }

  await loadInvites();
  setStatus(createInviteStatus, "Invite code deleted.", "success");
}

async function handleMemberRoleChange(event) {
  const select = event.target.closest("select[data-membership-id]");
  if (!select) return;

  const membershipId = select.getAttribute("data-membership-id");
  if (!membershipId) return;

  const nextRole = select.value;
  const currentRole = select.getAttribute("data-current-role") || "";

  if (nextRole === "__remove__") {
    if (!window.confirm("Remove this member's access to this library?")) {
      if (currentRole) select.value = currentRole;
      return;
    }

    setStatus(memberStatus, "Removing member...");
    select.disabled = true;
    const { error } = await supabase.rpc("remove_organization_member", {
      input_membership_id: membershipId,
    });
    select.disabled = false;

    if (error) {
      setStatus(memberStatus, error.message, "error");
      await loadMembers();
      return;
    }

    setStatus(memberStatus, "Member removed.", "success");
    await loadMembers();
    return;
  }

  setStatus(memberStatus, "Updating role...");
  const { error } = await supabase.rpc("update_membership_role", {
    input_membership_id: membershipId,
    input_role: nextRole,
  });

  if (error) {
    setStatus(memberStatus, error.message, "error");
    await loadMembers();
    return;
  }

  setStatus(memberStatus, "Role updated.", "success");
  await loadMembers();
}

async function createPersonalLibrary() {
  if (!canCreateOwnedLibrary()) {
    setStatus(contextStatus, "Upgrade a paid library before creating another personal library.", "error");
    return;
  }

  const suggestedName = getOwnedMemberships().length === 0 ? "Personal" : "New Library";
  const nameInput = window.prompt("Library name", suggestedName);
  if (nameInput === null) return;

  const nextName = nameInput.trim() || suggestedName;
  setStatus(contextStatus, "Creating library...");
  const { data, error } = await supabase.rpc("create_owned_organization", {
    input_organization_name: nextName,
  });

  if (error) {
    setStatus(contextStatus, error.message, "error");
    return;
  }

  const nextOrganizationId = String(data?.organization_id || "");
  await bootstrapAccess();
  if (nextOrganizationId) {
    const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
    if (nextMembership) {
      activeMembership = nextMembership;
      setStoredActiveOrganizationId(nextOrganizationId);
    }
  }
  await loadActiveOrganizationData();
  setStatus(contextStatus, `Library "${nextName}" created.`, "success");
}

async function deleteAccount() {
  setStatus(deleteAccountStatus, "Deleting account...");
  deleteAccountSubmit.disabled = true;
  deleteAccountCancel.disabled = true;

  const { data: refreshedSessionData } = await supabase.auth.refreshSession();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken =
    refreshedSessionData?.session?.access_token ||
    sessionData?.session?.access_token ||
    currentSession?.access_token ||
    "";
  const { supabaseUrl = "", supabaseAnonKey = "" } = getConfig();
  if (!accessToken) {
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, "Your session expired. Sign in again and retry.", "error");
    return;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, "Missing app config for delete-account request.", "error");
    return;
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
    });
  } catch (error) {
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, error instanceof Error ? error.message : "Unable to reach delete-account function.", "error");
    return;
  }

  let payload = null;
  let rawText = "";
  try {
    payload = await response.clone().json();
  } catch {
    try {
      rawText = await response.clone().text();
    } catch {
      rawText = "";
    }
  }

  if (!response.ok || payload?.error) {
    const errorMessage = String(payload?.error || rawText || "Unable to delete account.");
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, `${errorMessage} (HTTP ${response.status})`, "error");
    return;
  }

  await supabase.auth.signOut();
  window.location.replace("./login.html");
}

async function copyEmbedCode() {
  if (!embedCodeInput.value) return;
  try {
    await navigator.clipboard.writeText(embedCodeInput.value);
    setStatus(embedStatus, "Embed code copied.", "success");
  } catch {
    setStatus(embedStatus, "Unable to copy embed code on this device.", "error");
  }
}

async function uploadDocument(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;

  if (!getActiveCapabilities().canUploadDocuments) {
    setStatus(uploadStatus, "You do not have permission to upload into this library.", "error");
    return;
  }

  if (documentsCache.length >= getDocumentLimit()) {
    setStatus(uploadStatus, `This ${formatPlanName(organization.subscription_tier)} plan is limited to ${getDocumentLimit()} documents.`, "error");
    return;
  }

  resetUploadFeedback();
  const selectedFiles = collectUploadFiles();
  if (!selectedFiles.length) {
    setStatus(uploadStatus, "Choose at least one file or folder before uploading.", "error");
    return;
  }

  const remainingSlots = Math.max(getDocumentLimit() - documentsCache.length, 0);
  const files = selectedFiles.slice(0, remainingSlots);
  const skippedForLimit = Math.max(selectedFiles.length - files.length, 0);
  if (skippedForLimit > 0) {
    selectedFiles.slice(files.length).forEach((file) => {
      appendUploadResult(fileLabel(file), "skipped", "Plan limit reached.");
    });
  }

  if (!files.length) {
    setStatus(uploadStatus, `This ${formatPlanName(organization.subscription_tier)} plan is limited to ${getDocumentLimit()} documents.`, "error");
    return;
  }

  const manualTitle = uploadTitleInput.value.trim();
  const manualYear = uploadMode === "single" ? uploadYearInput.value.trim() : "";
  const manualMonth = uploadMode === "single" ? uploadMonthInput.value.trim() : "";
  const isPublic = uploadMode === "single" ? uploadIsPublicInput.checked : false;
  const submitButton = uploadForm.querySelector("button[type='submit']");
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = true;
  }

  let successCount = 0;
  const failedFiles = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const stepLabel = `[${index + 1}/${files.length}]`;
      const baseTitle = file.name.replace(/\.[^.]+$/, "");
      const title = uploadMode === "single" && manualTitle ? manualTitle : baseTitle;
      const inferred = inferYearMonthFromFilename(file.name);
      const year = uploadMode === "single" ? manualYear || inferred.year : inferred.year;
      const month = uploadMode === "single" ? manualMonth || inferred.month : inferred.month;
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const hasUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
      const uniqueToken = hasUuid ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const storagePath = `${organization.id}/${Date.now()}-${uniqueToken}-${safeFileName}`;

      setStatus(uploadStatus, `${stepLabel} Extracting ${fileLabel(file)}...`);
      let extractedText = "";
      try {
        extractedText = await extractTextFromFile(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Text extraction failed.";
        failedFiles.push(`${fileLabel(file)}: ${message}`);
        appendUploadResult(fileLabel(file), "failed", message);
        continue;
      }

      setStatus(uploadStatus, `${stepLabel} Uploading ${fileLabel(file)}...`);
      const { error: storageError } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: false });
      if (storageError) {
        failedFiles.push(`${fileLabel(file)}: ${storageError.message}`);
        appendUploadResult(fileLabel(file), "failed", storageError.message);
        continue;
      }

      const { error: insertError } = await insertDocumentRecord({
        organization_id: organization.id,
        title,
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        year,
        month,
        is_public: isPublic,
        status: "ready",
        processing_error: null,
        extracted_text: extractedText,
      }, currentSession.user.id);

      if (insertError) {
        await supabase.storage.from("documents").remove([storagePath]);
        failedFiles.push(`${fileLabel(file)}: ${insertError.message}`);
        appendUploadResult(fileLabel(file), "failed", insertError.message);
        continue;
      }

      successCount += 1;
      appendUploadResult(fileLabel(file), "uploaded", "Saved with extracted text.");
    }

    uploadForm.reset();
    if (successCount > 0) {
      await loadDocuments();
    }

    const summaryParts = [`Uploaded ${successCount} of ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}.`];
    if (skippedForLimit > 0) {
      summaryParts.push(`${skippedForLimit} skipped due to plan limit.`);
    }
    if (failedFiles.length > 0) {
      const failurePreview = failedFiles.slice(0, 3).join(" | ");
      const failureTail = failedFiles.length > 3 ? ` | +${failedFiles.length - 3} more failure(s)` : "";
      summaryParts.push(`Failed: ${failurePreview}${failureTail}`);
    }

    setStatus(uploadStatus, summaryParts.join(" "), failedFiles.length > 0 || skippedForLimit > 0 ? "error" : "success");
  } finally {
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = false;
    }
  }
}

async function handleDocumentAction(event) {
  const button = event.target.closest("button[data-action='open']");
  if (!button) return;
  const id = button.getAttribute("data-id");
  if (!id) return;
  await openFile(id);
}

async function handleOrganizationChange(nextOrganizationId) {
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;

  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);

  const params = new URLSearchParams(window.location.search);
  if (isSupportView()) {
    params.set("support_org", nextOrganizationId);
  } else {
    params.delete("support_org");
  }
  const nextQuery = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);

  await loadActiveOrganizationData();
}

async function init() {
  show(setupPanel, !hasConfig());
  show(dashboardPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login.html");
    return;
  }

  if (isPlatformAdminEmail(currentSession.user.email) && !getSupportOrganizationId()) {
    window.location.replace("./admin.html");
    return;
  }

  try {
    await bootstrapAccess();
  } catch (error) {
    show(setupPanel, false);
    show(dashboardPanel, true);
    showSection("account");
    setStatus(contextStatus, getErrorMessage(error, "Unable to load account context."), "error");
    return;
  }

  show(setupPanel, false);
  show(dashboardPanel, true);
  showSection(getInitialSection());
  inviteExpiresAtInput.value = getDefaultInviteExpiresAtValue();

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => showSection("account"));
  mobileMenuLibrary.addEventListener("click", () => showSection("library"));
  activeOrganizationSelect.addEventListener("change", async () => {
    await handleOrganizationChange(activeOrganizationSelect.value);
  });
  libraryActiveOrganizationSelect.addEventListener("change", async () => {
    await handleOrganizationChange(libraryActiveOrganizationSelect.value);
  });
  changePlanButton.addEventListener("click", () => setBillingPlanPickerOpen(billingPlanPicker.classList.contains("hidden")));
  manageBillingButton.addEventListener("click", async () => {
    const organization = getActiveOrganization();
    if (!organization) return;
    setStatus(billingStatus, "Opening Stripe billing portal...");
    await openBillingFlow("create-portal-session", { organizationId: organization.id });
  });
  billingPlanGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-plan-id]");
    if (!button) return;
    await handlePlanChange(button.getAttribute("data-plan-id"));
  });
  profileSettingsToggle.addEventListener("click", () => setProfileSettingsOpen(!profileSettingsModal.classList.contains("is-open")));
  profileSettingsClose.addEventListener("click", () => setProfileSettingsOpen(false));
  profileForm.addEventListener("submit", handleProfileSave);
  organizationSettingsForm.addEventListener("submit", handleOrganizationSettingsSave);
  redeemInviteToggle.addEventListener("click", () => setSectionToggleOpen(redeemInviteToggle, redeemInviteBody, redeemInviteBody.classList.contains("hidden")));
  inviteManagementToggle.addEventListener("click", () => setSectionToggleOpen(inviteManagementToggle, inviteManagementBody, inviteManagementBody.classList.contains("hidden")));
  memberManagementToggle.addEventListener("click", () => setSectionToggleOpen(memberManagementToggle, memberManagementBody, memberManagementBody.classList.contains("hidden")));
  embedSettingsToggle.addEventListener("click", () => setSectionToggleOpen(embedSettingsToggle, embedSettingsBody, embedSettingsBody.classList.contains("hidden")));
  redeemInviteForm.addEventListener("submit", handleRedeemInvite);
  createInviteForm.addEventListener("submit", handleCreateInvite);
  inviteList.addEventListener("click", handleInviteAction);
  memberList.addEventListener("change", handleMemberRoleChange);
  openDeleteAccountModalButton.addEventListener("click", () => setDeleteAccountModalOpen(true));
  deleteAccountCancel.addEventListener("click", () => setDeleteAccountModalOpen(false));
  deleteAccountSubmit.addEventListener("click", deleteAccount);
  openEmbedCardButton.addEventListener("click", () => setEmbedModalOpen(true));
  embedModalClose.addEventListener("click", () => setEmbedModalOpen(false));
  installAppClose.addEventListener("click", () => setInstallAppModalOpen(false));
  installAppDismiss.addEventListener("click", () => setInstallAppModalOpen(false));
  installAppAction.addEventListener("click", async () => {
    const pwaState = window.__n3xraPwa || {};
    if (typeof pwaState.promptInstall !== "function") return;

    setStatus(installAppStatus, "Opening install prompt...");
    try {
      const accepted = await pwaState.promptInstall();
      setInstallAppModalOpen(false);
      if (!accepted) {
        setStatus(billingStatus, "Install was dismissed. You can add N3XRA later from your browser menu.");
      }
    } catch (error) {
      setStatus(installAppStatus, getErrorMessage(error, "Unable to open the install prompt."), "error");
    }
  });
  window.addEventListener("n3xra:pwa-state", maybeShowInstallPrompt);
  copyEmbedCodeButton.addEventListener("click", copyEmbedCode);
  openUploadModalButton.addEventListener("click", () => {
    resetUploadFeedback();
    setUploadModalOpen(true);
  });
  uploadModalClose.addEventListener("click", () => {
    setUploadModalOpen(false);
    resetUploadFeedback();
  });
  uploadForm.addEventListener("submit", uploadDocument);
  uploadModeSingleButton.addEventListener("click", () => setUploadMode("single"));
  uploadModeBatchButton.addEventListener("click", () => setUploadMode("batch"));
  searchQueryInput.addEventListener("input", renderDocuments);
  searchYearSelect.addEventListener("change", renderDocuments);
  searchResetButton.addEventListener("click", () => {
    searchQueryInput.value = "";
    searchYearSelect.value = "all";
    renderDocuments();
  });
  docList.addEventListener("click", handleDocumentAction);
  recentFilesList.addEventListener("click", handleDocumentAction);
  fileModalClose.addEventListener("click", closeFileModal);
  fileModal.addEventListener("click", (event) => {
    if (event.target === fileModal) closeFileModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fileModal.classList.contains("is-open")) {
      closeFileModal();
      return;
    }
    if (event.key === "Escape" && profileSettingsModal.classList.contains("is-open")) {
      setProfileSettingsOpen(false);
      return;
    }
    if (event.key === "Escape" && deleteAccountModal.classList.contains("is-open")) {
      setDeleteAccountModalOpen(false);
      return;
    }
    if (event.key === "Escape" && embedModal.classList.contains("is-open")) {
      setEmbedModalOpen(false);
      return;
    }
    if (event.key === "Escape" && installAppModal.classList.contains("is-open")) {
      setInstallAppModalOpen(false);
      return;
    }
    if (event.key === "Escape" && uploadModal.classList.contains("is-open")) {
      setUploadModalOpen(false);
      return;
    }
    if (event.key === "Escape") closeMobileMenu();
  });
  document.addEventListener("click", (event) => {
    if (!mobileMenu.classList.contains("is-open")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (mobileMenu.contains(target) || mobileMenuToggle.contains(target)) return;
    closeMobileMenu();
  });

  shouldOfferInstallAfterLoad = consumePostLoginInstallFlag();
  try {
    await loadActiveOrganizationData();
    showBillingFlashFromUrl();
    maybeShowInstallPrompt();
  } catch (error) {
    setStatus(contextStatus, getErrorMessage(error, "Unable to load account context."), "error");
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      window.location.replace("./login.html");
    }
  });
}

setSectionToggleOpen(redeemInviteToggle, redeemInviteBody, false);
setSectionToggleOpen(inviteManagementToggle, inviteManagementBody, false);
setSectionToggleOpen(memberManagementToggle, memberManagementBody, false);
setSectionToggleOpen(embedSettingsToggle, embedSettingsBody, false);
setUploadMode("single");
init();
