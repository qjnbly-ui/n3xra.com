import JSZip from "https://esm.sh/jszip@3.10.1";
import { createAppDocumentPdfObjectUrl, getAppDocumentPdfFilename } from "./lib/app-document-pdf.js";
import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import { buildPreviewUrl, getDownloadFilename } from "./lib/document-links.js";
import { buildDocumentMetadata, getDocumentDisplayTitle } from "./lib/document-presenters.js";
import { closeFilePreviewModal, openFilePreviewModal } from "./lib/file-modal.js";
import { loadActivityLog, recordActivity } from "./lib/activity-log.js";
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
} from "/shared/lib/orgs.js";

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
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const accountSection = document.getElementById("account-section");
const librarySettingsCard = document.getElementById("library-settings-card");
const accountLibraryCard = document.getElementById("account-library-card");
const recordsHelpCard = document.getElementById("records-help-card");
const librarySection = document.getElementById("library-section");
const libraryActionsGrid = document.getElementById("library-actions-grid");
const accountLibraryContext = document.getElementById("account-library-context");
const libraryContextPanel = document.getElementById("library-context-panel");
const librarySearchPanel = document.getElementById("library-search-panel");
const libraryRecentPanel = document.getElementById("library-recent-panel");
const billingSection = document.getElementById("billing-section");
const libraryAccessCard = document.getElementById("library-access-card");
const supportAccessCard = document.getElementById("support-access-card");
const supportAccessForm = document.getElementById("support-access-form");
const supportAccessReason = document.getElementById("support-access-reason");
const supportScopeDocuments = document.getElementById("support-scope-documents");
const supportScopeRecordings = document.getElementById("support-scope-recordings");
const supportScopeDownloads = document.getElementById("support-scope-downloads");
const supportScopeChanges = document.getElementById("support-scope-changes");
const supportAccessGrantButton = document.getElementById("support-access-grant");
const supportAccessRevokeButton = document.getElementById("support-access-revoke");
const supportAccessStatus = document.getElementById("support-access-status");
const supportAuditList = document.getElementById("support-audit-list");
const supportAccessHeading = supportAccessCard?.querySelector(".panel-head h3") || null;
const supportAccessCopy = supportAccessCard?.querySelector(".panel-head p") || null;
const supportAccessTab = document.getElementById("admin-support-tab");
const libraryPanelCopy = document.querySelector("#admin-library-panel > .admin-panel-head p");
const storagePanelCopy = document.querySelector("#admin-storage-panel > .admin-panel-head p");
const storagePanelNotice = document.getElementById("account-storage-privacy-note");
const accountStorageTotalValue = document.getElementById("account-storage-total-value");
const accountStorageTotalCopy = document.getElementById("account-storage-total-copy");
const accountStorageTotalMeter = document.getElementById("account-storage-total-meter");
const accountStorageBreakdownGrid = document.getElementById("account-storage-breakdown-grid");
const accountStorageLargestList = document.getElementById("account-storage-largest-list");
const accountStorageSuggestionList = document.getElementById("account-storage-suggestion-list");
const accountStorageStatus = document.getElementById("account-storage-status");
const openStorageAccountViewButton = document.getElementById("open-storage-account-view");
const libraryProfileBody = document.getElementById("library-profile-body");
const libraryLogoForm = document.getElementById("library-logo-form");
const libraryLogoFileInput = document.getElementById("library-logo-file");
const libraryLogoUpload = document.getElementById("library-logo-upload");
const libraryLogoRemove = document.getElementById("library-logo-remove");
const libraryLogoStatus = document.getElementById("library-logo-status");
const accessSettingsBody = document.getElementById("access-settings-body");
const publishingSettingsBody = document.getElementById("publishing-settings-body");
const billingSettingsBody = document.getElementById("billing-settings-body");
const redeemInviteBody = document.getElementById("redeem-invite-body");
const inviteManagementBody = document.getElementById("invite-management-body");
const memberManagementBody = document.getElementById("member-management-body");
const embedSettingsBody = document.getElementById("embed-settings-body");
const organizationPrimaryColorField = document.getElementById("organization-primary-color-field");
const organizationAccentColorField = document.getElementById("organization-accent-color-field");
const libraryAccessCopy = document.getElementById("library-access-copy");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeOrganizationName = document.getElementById("active-organization-name");
const selectedLibraryLogoImage = document.getElementById("selected-library-logo-image");
const selectedLibraryLogoFallback = document.getElementById("selected-library-logo-fallback");
const selectedLibraryLogoCaption = document.getElementById("selected-library-logo-caption");
const activeMembershipRole = document.getElementById("active-membership-role");
const sharedLibraryCount = document.getElementById("shared-library-count");
const libraryActiveOrganizationSelect = document.getElementById("library-active-organization-select");
const libraryActiveOrganizationName = document.getElementById("library-active-organization-name");
const libraryContextLogoImage = document.getElementById("library-context-logo-image");
const libraryContextLogoFallback = document.getElementById("library-context-logo-fallback");
const libraryActiveMembershipRole = document.getElementById("library-active-membership-role");
const librarySharedLibraryCount = document.getElementById("library-shared-library-count");
const platformAdminLink = document.getElementById("platform-admin-link");
const uploadActionSlot = document.getElementById("upload-action-slot");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalFrame = document.getElementById("file-modal-frame");
const fileModalDownload = document.getElementById("file-modal-download");
const fileModalOpenEditable = document.getElementById("file-modal-open-editable");
const fileModalOriginal = document.getElementById("file-modal-original");
const fileModalClose = document.getElementById("file-modal-close");
const profileSettingsToggle = document.getElementById("profile-settings-toggle");
const profileSettingsModal = document.getElementById("profile-settings-modal");
const profileSettingsClose = document.getElementById("profile-settings-close");
const openDeleteAccountModalButton = document.getElementById("open-delete-account-modal");
const deleteAccountBlockedNote = document.getElementById("delete-account-blocked-note");
const deleteAccountModal = document.getElementById("delete-account-modal");
const appConfirmModal = document.getElementById("app-confirm-modal");
const appConfirmKicker = document.getElementById("app-confirm-kicker");
const appConfirmTitle = document.getElementById("app-confirm-title");
const appConfirmCopy = document.getElementById("app-confirm-copy");
const appConfirmCancel = document.getElementById("app-confirm-cancel");
const appConfirmOk = document.getElementById("app-confirm-ok");
const appInputModal = document.getElementById("app-input-modal");
const appInputKicker = document.getElementById("app-input-kicker");
const appInputTitle = document.getElementById("app-input-title");
const appInputLabel = document.getElementById("app-input-label");
const appInputValue = document.getElementById("app-input-value");
const appInputClose = document.getElementById("app-input-close");
const appInputForm = document.getElementById("app-input-form");
const appInputCancel = document.getElementById("app-input-cancel");
const appInputSubmit = document.getElementById("app-input-submit");
const inviteEmailModal = document.getElementById("invite-email-modal");
const inviteEmailModalClose = document.getElementById("invite-email-modal-close");
const inviteEmailForm = document.getElementById("invite-email-form");
const inviteEmailCodeInput = document.getElementById("invite-email-code");
const inviteEmailRecipientInput = document.getElementById("invite-email-recipient");
const inviteEmailNameInput = document.getElementById("invite-email-name");
const inviteEmailMessageInput = document.getElementById("invite-email-message");
const inviteEmailCancel = document.getElementById("invite-email-cancel");
const inviteEmailSubmit = document.getElementById("invite-email-submit");
const inviteEmailStatus = document.getElementById("invite-email-status");
const deleteAccountCancel = document.getElementById("delete-account-cancel");
const deleteRecordsSubmit = document.getElementById("delete-records-submit");
const deleteAccountSubmit = document.getElementById("delete-account-submit");
const deleteAccountStatus = document.getElementById("delete-account-status");
const openEmbedCardButton = document.getElementById("open-embed-card-button");
const embedAccessCard = document.getElementById("embed-access-card");
const embedModal = document.getElementById("embed-modal");
const embedModalClose = document.getElementById("embed-modal-close");
const embedPreviewUrlInput = document.getElementById("embed-preview-url");
const embedCodeInput = document.getElementById("embed-code");
const openEmbedPreview = document.getElementById("open-embed-preview");
const copyEmbedPreviewUrlButton = document.getElementById("copy-embed-preview-url");
const copyEmbedCodeButton = document.getElementById("copy-embed-code");
const embedStatus = document.getElementById("embed-status");
const openUploadModalButton = document.getElementById("open-upload-modal");
const uploadModal = document.getElementById("upload-modal");
const uploadModalClose = document.getElementById("upload-modal-close");
const accountName = document.getElementById("account-name");
const accountEmail = document.getElementById("account-email");
const accountTierItem = document.getElementById("account-tier-item");
const accountTier = document.getElementById("account-tier");
const accountStatusItem = document.getElementById("account-status-item");
const accountStatus = document.getElementById("account-status");
const recordsHelpForm = document.getElementById("records-help-form");
const recordsHelpToggle = document.getElementById("records-help-toggle");
const recordsHelpBody = document.getElementById("records-help-body");
const recordsHelpQuestion = document.getElementById("records-help-question");
const recordsHelpSubmit = document.getElementById("records-help-submit");
const recordsHelpStatus = document.getElementById("records-help-status");
const recordsHelpAnswer = document.getElementById("records-help-answer");
const currentPlanName = document.getElementById("current-plan-name");
const currentPlanCopy = document.getElementById("current-plan-copy");
const currentPlanNote = document.getElementById("current-plan-note");
const currentPlanUsage = document.createElement("div");
currentPlanUsage.className = "current-plan-usage";
currentPlanCopy?.insertAdjacentElement("afterend", currentPlanUsage);
const manageBillingButton = document.getElementById("manage-billing-button");
const changePlanButton = document.getElementById("change-plan-button");
const billingPlanPicker = document.getElementById("billing-plan-picker");
const billingCycleMonthlyButton = document.getElementById("billing-cycle-monthly");
const billingCycleYearlyButton = document.getElementById("billing-cycle-yearly");
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
const organizationSettingsSave = document.getElementById("organization-settings-save");
const organizationSettingsStatus = document.getElementById("organization-settings-status");
const phoneMeetingSettingsForm = document.getElementById("phone-meeting-settings-form");
const phoneMeetingFeatureEnabled = document.getElementById("phone-meeting-feature-enabled");
const phoneMeetingActivationStatus = document.getElementById("phone-meeting-activation-status");
const phoneMeetingPrimaryNumber = document.getElementById("phone-meeting-primary-number");
const phoneMeetingMonthlyMinutesLimit = document.getElementById("phone-meeting-monthly-minutes-limit");
const phoneMeetingAllowAccountAdmin = document.getElementById("phone-meeting-allow-account-admin");
const phoneMeetingAllowEditor = document.getElementById("phone-meeting-allow-editor");
const phoneMeetingRecordingNoticeEnabled = document.getElementById("phone-meeting-recording-notice-enabled");
const phoneMeetingRecordingNoticeText = document.getElementById("phone-meeting-recording-notice-text");
const phoneMeetingRetentionDays = document.getElementById("phone-meeting-retention-days");
const phoneMeetingSettingsSave = document.getElementById("phone-meeting-settings-save");
const phoneMeetingSettingsSummary = document.getElementById("phone-meeting-settings-summary");
const phoneMeetingUsageSummary = document.getElementById("phone-meeting-usage-summary");
const phoneMeetingSettingsStatus = document.getElementById("phone-meeting-settings-status");
const aiSettingsBody = document.getElementById("ai-settings-body");
const organizationAiSettingsForm = document.getElementById("organization-ai-settings-form");
const organizationAiContextInput = document.getElementById("organization-ai-context");
const organizationAiResponseStyleInput = document.getElementById("organization-ai-response-style");
const organizationDefaultMinutesStyleInput = document.getElementById("organization-default-minutes-style");
const organizationSpeakerDetectionEnabledInput = document.getElementById("organization-speaker-detection-enabled");
const organizationAiMemoryInput = document.getElementById("organization-ai-memory");
const organizationAiMemoryList = document.getElementById("organization-ai-memory-list");
const organizationAiMemoryNewInput = document.getElementById("organization-ai-memory-new");
const organizationAiMemoryAdd = document.getElementById("organization-ai-memory-add");
const organizationAiSettingsSave = document.getElementById("organization-ai-settings-save");
const organizationAiSettingsStatus = document.getElementById("organization-ai-settings-status");
const contactsSettingsBody = document.getElementById("contacts-settings-body");
const contactFormToggle = document.getElementById("contact-form-toggle");
const contactFormPanel = document.getElementById("contact-form-panel");
const contactForm = document.getElementById("contact-form");
const contactIdInput = document.getElementById("contact-id");
const contactNameInput = document.getElementById("contact-name");
const contactEmailInput = document.getElementById("contact-email");
const contactNotesInput = document.getElementById("contact-notes");
const contactSave = document.getElementById("contact-save");
const contactCancelEdit = document.getElementById("contact-cancel-edit");
const contactStatus = document.getElementById("contact-status");
const contactList = document.getElementById("contact-list");
const reviewSettingsBody = document.getElementById("review-settings-body");
const organizationReviewForm = document.getElementById("organization-review-form");
const organizationReviewRating = document.getElementById("organization-review-rating");
const organizationReviewText = document.getElementById("organization-review-text");
const organizationReviewMeta = document.getElementById("organization-review-meta");
const organizationReviewSave = document.getElementById("organization-review-save");
const organizationReviewStatus = document.getElementById("organization-review-status");
const libraryLogoPreviewImage = document.getElementById("library-logo-preview-image");
const libraryLogoPreviewFallback = document.getElementById("library-logo-preview-fallback");
const redeemInviteForm = document.getElementById("redeem-invite-form");
const redeemInviteCodeInput = document.getElementById("redeem-invite-code");
const redeemInviteStatus = document.getElementById("redeem-invite-status");
const additionalLibraryBody = document.getElementById("additional-library-body");
const additionalLibraryForm = document.getElementById("additional-library-form");
const additionalLibraryNote = document.getElementById("additional-library-note");
const additionalLibraryNameInput = document.getElementById("additional-library-name");
const additionalLibrarySave = document.getElementById("additional-library-save");
const additionalLibraryStatus = document.getElementById("additional-library-status");
const inviteManagementSection = document.getElementById("invite-management-section");
const memberManagementSection = document.getElementById("member-management-section");
const createInviteForm = document.getElementById("create-invite-form");
const inviteRoleInput = document.getElementById("invite-role");
const inviteMaxUsesInput = document.getElementById("invite-max-uses");
const inviteExpiresAtInput = document.getElementById("invite-expires-at");
const inviteRecipientEmailInput = document.getElementById("invite-recipient-email");
const inviteRecipientNameInput = document.getElementById("invite-recipient-name");
const inviteCustomMessageInput = document.getElementById("invite-custom-message");
const createInviteStatus = document.getElementById("create-invite-status");
const inviteList = document.getElementById("invite-list");
const memberList = document.getElementById("member-list");
const memberStatus = document.getElementById("member-status");
const voiceProfileList = document.getElementById("voice-profile-list");
const voiceProfileCount = document.getElementById("voice-profile-count");
const voiceDirectoryStatus = document.getElementById("voice-directory-status");
const voiceEnrollmentCard = document.getElementById("voice-enrollment-card");
const voiceEnrollmentClose = document.getElementById("voice-enrollment-close");
const voiceEnrollmentName = document.getElementById("voice-enrollment-name");
const voiceRecordStart = document.getElementById("voice-record-start");
const voiceRecordStop = document.getElementById("voice-record-stop");
const voiceRecordTimer = document.getElementById("voice-record-timer");
const voiceRecordPreview = document.getElementById("voice-record-preview");
const voiceProfileConsent = document.getElementById("voice-profile-consent");
const voiceProfileSubmit = document.getElementById("voice-profile-submit");
const voiceRecordAgain = document.getElementById("voice-record-again");
const voiceProfileStatus = document.getElementById("voice-profile-status");
const uploadForm = document.getElementById("upload-form");
const searchQueryLabel = document.getElementById("search-query-label");
const searchQueryInput = document.getElementById("search-query");
const searchYearField = document.getElementById("search-year-field");
const searchYearSelect = document.getElementById("search-year");
const searchResetButton = document.getElementById("search-reset");
const searchModeKeywordButton = document.getElementById("search-mode-keyword");
const searchModeAiButton = document.getElementById("search-mode-ai");
const aiSearchSubmitButton = document.getElementById("ai-search-submit");
const aiSearchAnswer = document.getElementById("ai-search-answer");
const aiMemoryModal = document.getElementById("ai-memory-modal");
const aiMemoryModalClose = document.getElementById("ai-memory-modal-close");
const aiMemoryForm = document.getElementById("ai-memory-form");
const aiMemorySuggestionInput = document.getElementById("ai-memory-suggestion");
const aiMemoryDismiss = document.getElementById("ai-memory-dismiss");
const aiMemorySave = document.getElementById("ai-memory-save");
const aiMemoryStatus = document.getElementById("ai-memory-status");
const uploadMetadataGrid = document.getElementById("upload-metadata-grid");
const uploadTitleInput = document.getElementById("upload-title");
const uploadTitleField = document.getElementById("upload-title-field");
const uploadYearInput = document.getElementById("upload-year");
const uploadMonthInput = document.getElementById("upload-month");
const uploadFileInput = document.getElementById("upload-file");
const uploadFileLabel = document.getElementById("upload-file-label");
const DEFAULT_PRIMARY_COLOR = "#176f66";
const DEFAULT_ACCENT_COLOR = "#ea9b3f";
const ORGANIZATION_ASSETS_BUCKET = "organization-assets";
const MAX_LIBRARY_LOGO_BYTES = 2 * 1024 * 1024;
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
const adminPanelsContainer = document.querySelector(".admin-panels");
if (supportAccessCard && adminPanelsContainer) {
  supportAccessCard.classList.remove("account-card");
  supportAccessCard.classList.add("admin-panel");
  supportAccessCard.setAttribute("role", "tabpanel");
  supportAccessCard.setAttribute("aria-labelledby", "admin-support-tab");
  supportAccessCard.setAttribute("data-admin-panel", "support");
  supportAccessCard.hidden = true;
  adminPanelsContainer.append(supportAccessCard);
}
const adminTabs = Array.from(document.querySelectorAll("[data-admin-tab]"));
const adminPanels = Array.from(document.querySelectorAll("[data-admin-panel]"));
const desktopAccountViewButtons = Array.from(document.querySelectorAll("[data-records-account-view]"));
const desktopAccountPageTitle = document.getElementById("records-desktop-page-title");
const desktopManageLibraryToggle = document.querySelector("[data-records-manage-toggle]");
const desktopManageLibraryMenu = document.querySelector("[data-records-manage-menu]");
const desktopManageLibraryIndicator = document.querySelector("[data-records-manage-indicator]");
const adminUsersInviteButton = document.getElementById("admin-users-invite");
const adminNewTemplateButton = document.getElementById("admin-new-template");
const adminTemplateList = document.getElementById("admin-template-list");
const adminTemplateEmpty = document.getElementById("admin-template-empty");
const adminTemplateStatus = document.getElementById("admin-template-status");
const activityList = document.getElementById("activity-list");
const activityStatus = document.getElementById("activity-status");
const activityActionFilter = document.getElementById("activity-action-filter");

let supabase = null;
let currentSession = null;
let currentProfile = null;
let memberships = [];
let activeMembership = null;
let documentsCache = [];
let editableDocumentsBySourceId = new Map();
let activeModalDocumentId = null;
let activeModalObjectUrl = "";
let searchMode = "keyword";
let inviteCache = [];
let memberCache = [];
let voiceProfileStatusMap = new Map();
let voiceMediaRecorder = null;
let voiceMediaStream = null;
let voiceRecordingChunks = [];
let voiceRecordingBlob = null;
let voiceRecordingObjectUrl = "";
let voiceRecordingStartedAt = 0;
let voiceRecordingDurationMs = 0;
let voiceRecordingTimerId = null;
let voiceRecordingGeneration = 0;
let contactCache = [];
let appTemplates = [];
let recordsAiUsageSummary = null;
let recordsUsageSummary = null;
let phoneMeetingSettingsCache = null;
let phoneMeetingUsageMinutes = 0;
let organizationReview = null;
let organizationLogoUrls = new Map();
let activityCache = [];
let activeSupportGrant = null;
let supportAuditCache = [];
let uploadMode = "single";
let selectedBillingCycle = "monthly";
let activeAdminTab = "users";
let adminTargetTimer = null;
const libraryAiSearchHistory = [];
const LIBRARY_AI_SEARCH_HISTORY_LIMIT = 8;
let lastAiSearchMatches = [];
let pendingAiMemorySuggestion = "";
let pendingConfirmResolve = null;
let pendingInviteEmailCode = "";
let pendingInputResolve = null;
const recordsHelpHistory = [];
const RECORDS_HELP_HISTORY_LIMIT = 8;
let pdfJsLibraryPromise = null;

function getSectionFromPath(pathname = window.location.pathname) {
  const normalized = String(pathname || "").replace(/\/+$/, "");
  if (normalized.endsWith("/app/account")) return "account";
  if (normalized.endsWith("/app/library")) return "library";
  if (normalized.endsWith("/n3xra-records/account")) return "account";
  if (normalized.endsWith("/n3xra-records/library")) return "library";
  return "";
}

function getSectionPath(section) {
  return section === "account" ? "/n3xra-records/account/" : "/n3xra-records/library/";
}

function buildSectionUrl(section) {
  const url = new URL(getSectionPath(section), window.location.href);
  const params = new URLSearchParams(window.location.search);
  params.delete("section");
  const query = params.toString();
  url.search = query ? `?${query}` : "";
  url.hash = window.location.hash;
  return `${url.pathname}${url.search}${url.hash}`;
}

function getInitialSection() {
  const pathSection = getSectionFromPath();
  if (pathSection) {
    return pathSection;
  }
  const params = new URLSearchParams(window.location.search);
  const explicitSection = params.get("section");
  if (explicitSection === "account" || explicitSection === "library") {
    return explicitSection;
  }
  return hasActiveLibraryAccess() ? "library" : "account";
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

function setRecordsHelpAnswer(message = "") {
  if (!recordsHelpAnswer) return;
  renderAnswerMarkup(recordsHelpAnswer, message);
}

function setAiSearchAnswer(message = "") {
  if (!aiSearchAnswer) return;
  renderAnswerMarkup(aiSearchAnswer, message);
}

function applyInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  return withItalic.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function parseTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = normalized.split("|").map((cell) => cell.trim());
  if (!cells.length || cells.every((cell) => !cell)) return null;
  return cells;
}

function isMarkdownTableDivider(line) {
  const cells = parseTableRow(line);
  if (!cells || !cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function isDividerLikeTableRow(cells) {
  if (!Array.isArray(cells) || !cells.length) return false;
  return cells.every((cell) => {
    const value = String(cell || "").trim();
    return !value || /^:?-{2,}:?$/.test(value);
  });
}

function normalizeHeaderCellLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[:\-\s]+$/g, "");
}

function isBogusTableHeaderLabel(value) {
  const label = normalizeHeaderCellLabel(value);
  return label === "table" || label === "trend table" || label === "data table" || label === "table header";
}

function isDescriptiveHeaderCell(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.length < 28) return false;
  return /table|summar|following|below|over the years|overview/i.test(text);
}

function rowLooksLikeYearValueRow(row) {
  if (!Array.isArray(row) || row.length < 2) return false;
  return /^\d{4}(?:\s*(?:-|to|and)\s*\d{4}| and beyond)?$/i.test(String(row[0] || "").trim());
}

function rowStartsWithMonthLikeValue(row) {
  if (!Array.isArray(row) || !row.length) return false;
  const value = String(row[0] || "").trim().toLowerCase();
  return /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/.test(value);
}

function isYearHeaderCell(value) {
  return normalizeHeaderCellLabel(value) === "year";
}

function isMonthHeaderCell(value) {
  return normalizeHeaderCellLabel(value) === "month";
}

function getMostCommonRowLength(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    if (!Array.isArray(row) || !row.length) return;
    counts.set(row.length, (counts.get(row.length) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

function fitRowToHeader(row, width) {
  const cells = Array.isArray(row) ? [...row] : [];
  if (cells.length === width) return cells;
  if (cells.length < width) return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
  if (width <= 1) return [cells.join(" | ")];
  return [...cells.slice(0, width - 1), cells.slice(width - 1).join(" | ")];
}

function normalizeRenderedTable(headerCells, rowCells) {
  let header = Array.isArray(headerCells) ? headerCells.map((cell) => String(cell || "").trim()) : [];
  let rows = Array.isArray(rowCells) ? rowCells.map((row) => row.map((cell) => String(cell || "").trim())) : [];
  if (!header.length) return { header, rows };

  const commonRowLength = getMostCommonRowLength(rows);
  const majorityYearLike = rows.length ? rows.filter((row) => rowLooksLikeYearValueRow(row)).length / rows.length : 0;
  const majorityMonthLike = rows.length ? rows.filter((row) => rowStartsWithMonthLikeValue(row)).length / rows.length : 0;
  const firstHeaderIsNoise = isBogusTableHeaderLabel(header[0]) || isDescriptiveHeaderCell(header[0]);

  if (firstHeaderIsNoise && header.length > 1) {
    if ((isYearHeaderCell(header[1]) && majorityYearLike >= 0.5) || (isMonthHeaderCell(header[1]) && majorityMonthLike >= 0.5)) {
      header = header.slice(1);
    } else if (commonRowLength && commonRowLength < header.length) {
      header = header.slice(header.length - commonRowLength);
    } else {
      header = header.slice(1);
    }
  }

  if (header.length > 1 && !isYearHeaderCell(header[0]) && isYearHeaderCell(header[1]) && majorityYearLike >= 0.5) {
    header = header.slice(1);
  }

  if (header.length > 1 && !isMonthHeaderCell(header[0]) && isMonthHeaderCell(header[1]) && majorityMonthLike >= 0.5) {
    header = header.slice(1);
  }

  const maxRowLength = Math.max(0, ...rows.map((row) => row.length));
  while (header.length < maxRowLength) {
    header.push(header.length === maxRowLength - 1 ? "Notes" : `Detail ${header.length + 1}`);
  }

  while (header.length > 2) {
    const col = header.length - 1;
    const headerLabel = normalizeHeaderCellLabel(header[col]);
    const filled = rows.reduce((count, row) => count + (String(row[col] || "").trim() ? 1 : 0), 0);
    if (filled > 0 || headerLabel === "notes") break;
    header.pop();
  }

  rows = rows.map((row) => fitRowToHeader(row, header.length));
  return { header, rows };
}

function renderAnswerMarkup(container, message = "") {
  if (!container) return;
  const raw = normalizeAiAnswerMarkdown(message);
  container.classList.toggle("hidden", !raw);
  if (!raw) {
    container.innerHTML = "";
    return;
  }

  const lines = raw.split(/\r?\n/);
  const html = [];
  let listItems = [];
  let listType = "";
  let tableRows = [];

  function flushList() {
    if (!listItems.length) return;
    const tag = listType === "ol" ? "ol" : "ul";
    html.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
    listItems = [];
    listType = "";
  }

  function flushTable() {
    if (tableRows.length < 2 || !isMarkdownTableDivider(tableRows[1])) {
      tableRows.forEach((row) => html.push(`<p>${applyInlineMarkdown(row)}</p>`));
      tableRows = [];
      return;
    }

    const parsedHeader = parseTableRow(tableRows[0]) || [];
    const parsedRows = tableRows
      .slice(2)
      .map(parseTableRow)
      .filter((row) => row && row.length && !isDividerLikeTableRow(row));
    const { header, rows: bodyRows } = normalizeRenderedTable(parsedHeader, parsedRows);
    if (!header.length) {
      tableRows = [];
      return;
    }
    const thead = `<thead><tr>${header.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    html.push(`<div class="ai-rich-table-wrap"><table class="ai-rich-table">${thead}${tbody}</table></div>`);
    tableRows = [];
  }

  lines.forEach((line) => {
    const value = line.trim();
    const isTableLine = value.includes("|");

    if (tableRows.length && !value) {
      return;
    }

    if (/^#{1,3}\s+/.test(value) && isTableLine) {
      flushList();
      if (tableRows.length) flushTable();
      const pipeIndex = value.indexOf("|");
      const headingPart = value.slice(0, pipeIndex).trim();
      let tablePart = `|${value.slice(pipeIndex + 1).trim()}`;
      if (headingPart) {
        const level = Math.min(3, headingPart.match(/^#+/)[0].length);
        html.push(`<h${level + 2} class="ai-answer-heading">${applyInlineMarkdown(headingPart.replace(/^#{1,3}\s+/, ""))}</h${level + 2}>`);
      }
      const headingLabel = headingPart.replace(/^#{1,3}\s+/, "").trim().toLowerCase();
      const cells = parseTableRow(tablePart);
      if (cells && cells.length > 1 && headingLabel.endsWith("table") && isBogusTableHeaderLabel(cells[0])) {
        tablePart = `| ${cells.slice(1).join(" | ")} |`;
      }
      if (tablePart.includes("|")) tableRows.push(tablePart);
      return;
    }

    if (tableRows.length) {
      if (value && isTableLine) {
        tableRows.push(value);
        return;
      }
      flushTable();
    }

    if (!value) {
      flushList();
      return;
    }
    if (isTableLine) {
      flushList();
      tableRows.push(value);
      return;
    }
    if (/^[-*]\s+/.test(value)) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(applyInlineMarkdown(value.replace(/^[-*]\s+/, "")));
      return;
    }
    if (/^\d+\.\s+/.test(value)) {
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(applyInlineMarkdown(value.replace(/^\d+\.\s+/, "").replace(/^\d+\.\s+/, "")));
      return;
    }
    if (/^#{1,3}\s+/.test(value)) {
      flushList();
      const level = Math.min(3, value.match(/^#+/)[0].length);
      html.push(`<h${level + 2} class="ai-answer-heading">${applyInlineMarkdown(value.replace(/^#{1,3}\s+/, ""))}</h${level + 2}>`);
      return;
    }
    flushList();
    html.push(`<p>${applyInlineMarkdown(value)}</p>`);
  });

  flushTable();
  flushList();
  container.innerHTML = html.join("");
}

function normalizeAiAnswerMarkdown(message = "") {
  let text = String(message || "").trim();
  if (!text) return "";

  // Ensure markdown headings and list markers start on their own lines.
  text = text
    .replace(/\s+(#{1,4}\s+)/g, "\n$1")
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    .replace(/\s+([*-]\s+)/g, "\n$1");

  // Split common "heading + paragraph" lines into a heading line and body line.
  text = text.replace(/^(#{1,4}\s+[A-Za-z][A-Za-z0-9/&' -]{2,42})\s+([A-Z][^\n]+)$/gm, "$1\n$2");

  // If table headers are provided inline, place each row on separate lines.
  text = text.replace(/\s+\|\s+---/g, "\n| ---");
  text = text.replace(/\s+\|\s+\|/g, " |\n| ");
  text = splitInlineTableFragments(text);

  return text.trim();
}

function splitInlineTableFragments(text) {
  return String(text || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const value = String(line || "").trim();
      if (!value.includes("|")) return [line];

      const firstPipeIndex = value.indexOf("|");
      const output = [];
      let tablePart = value;
      if (firstPipeIndex > 0) {
        const prefix = value.slice(0, firstPipeIndex).trim();
        if (prefix) output.push(prefix);
        tablePart = value.slice(firstPipeIndex).trim();
      }

      tablePart = tablePart
        .replace(/(\|\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?)\s*\|\s*(?=[^|\s])/g, "$1\n| ")
        .replace(/\|\s*\|\s*(?=[A-Za-z0-9$])/g, "|\n| ");

      const parts = tablePart.split(/\n/).map((part) => part.trim()).filter(Boolean);
      return [...output, ...parts];
    })
    .join("\n");
}

function resetLibraryAiSearchHistory() {
  libraryAiSearchHistory.splice(0, libraryAiSearchHistory.length);
}

function rememberLibraryAiSearchTurn(question, answer) {
  if (!question || !answer) return;
  libraryAiSearchHistory.push({ role: "user", content: question });
  libraryAiSearchHistory.push({ role: "assistant", content: answer });
  if (libraryAiSearchHistory.length > LIBRARY_AI_SEARCH_HISTORY_LIMIT) {
    libraryAiSearchHistory.splice(0, libraryAiSearchHistory.length - LIBRARY_AI_SEARCH_HISTORY_LIMIT);
  }
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function supportGrantIsActive(grant = activeSupportGrant) {
  return Boolean(grant && !grant.revoked_at && new Date(grant.expires_at).getTime() > Date.now());
}

function hasSupportScope(scope) {
  if (!isSupportView() || !supportGrantIsActive()) return false;
  const keys = {
    documents: "can_view_documents",
    recordings: "can_view_recordings",
    downloads: "can_download_files",
    changes: "can_change_content",
  };
  return Boolean(activeSupportGrant?.[keys[scope]]);
}

async function loadActiveSupportGrant() {
  activeSupportGrant = null;
  const organization = getActiveOrganization();
  if (!organization) return;
  await supabase.rpc("reconcile_records_support_expirations", { input_organization_id: organization.id });
  const { data, error } = await supabase
    .from("records_support_grants")
    .select("*")
    .eq("organization_id", organization.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  activeSupportGrant = data || null;
  if (!activeSupportGrant && isSupportView()) {
    const { data: emergency, error: emergencyError } = await supabase
      .from("records_emergency_access")
      .select("id, expires_at, reason")
      .eq("organization_id", organization.id)
      .eq("admin_user_id", currentSession.user.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (emergencyError) throw emergencyError;
    if (emergency) {
      activeSupportGrant = {
        ...emergency,
        emergency_access: true,
        can_view_documents: true,
        can_view_recordings: true,
        can_download_files: true,
        can_change_content: true,
      };
    }
  }
  if (isSupportView()) {
    activeMembership.role = activeSupportGrant?.can_change_content ? "editor" : "viewer";
  }
}

function formatSupportEvent(eventType) {
  return titleCase(String(eventType || "support activity").replaceAll("_", " "));
}

function renderSupportAccess() {
  const organization = getActiveOrganization();
  const canManage = Boolean(organization && !isSupportView() && getActiveCapabilities().canManageLibrarySettings);
  const supportMode = Boolean(organization && isSupportView());
  show(supportAccessCard, canManage || supportMode);
  show(supportAccessForm, canManage);
  if (supportAccessTab) supportAccessTab.textContent = supportMode ? "Support audit" : "N3XRA support access";
  if (supportAccessHeading) supportAccessHeading.textContent = supportMode ? "Support access audit" : "N3XRA support access";
  if (supportAccessCopy) supportAccessCopy.textContent = supportMode
    ? "Review the permanent access history for this organization. Customer content remains unavailable unless a temporary grant is active."
    : "Private Records content stays unavailable to N3XRA unless you grant temporary access.";
  if (!supportAccessCard || (!canManage && !supportMode)) return;
  const active = supportGrantIsActive();
  show(supportAccessGrantButton, canManage && !active);
  show(supportAccessRevokeButton, canManage && active);
  [supportAccessReason, supportScopeDocuments, supportScopeRecordings, supportScopeDownloads, supportScopeChanges]
    .filter(Boolean).forEach((field) => { field.disabled = active; });
  if (active) {
    supportScopeDocuments.checked = Boolean(activeSupportGrant.can_view_documents);
    supportScopeRecordings.checked = Boolean(activeSupportGrant.can_view_recordings);
    supportScopeDownloads.checked = Boolean(activeSupportGrant.can_download_files);
    supportScopeChanges.checked = Boolean(activeSupportGrant.can_change_content);
    setStatus(supportAccessStatus, `Access is active until ${formatActivityDate(activeSupportGrant.expires_at)}.`, "success");
  } else {
    setStatus(supportAccessStatus, "N3XRA cannot access this library's private content.");
  }
  if (supportAuditList) {
    supportAuditList.innerHTML = supportAuditCache.length ? supportAuditCache.map((item) => `
      <tr><td>${escapeHtml(formatActivityDate(item.created_at))}</td><td>${escapeHtml(formatSupportEvent(item.event_type))}</td><td>${escapeHtml(item.actor_email || "Customer")}</td><td>${escapeHtml(item.resource_type || "Library")}</td></tr>
    `).join("") : '<tr><td colspan="4">No support access has been recorded.</td></tr>';
  }
}

async function loadSupportAudit() {
  const organization = getActiveOrganization();
  const canReview = Boolean(organization && (isSupportView() || getActiveCapabilities().canManageLibrarySettings));
  if (!canReview) {
    supportAuditCache = [];
    renderSupportAccess();
    return;
  }
  const { data, error } = await supabase.from("records_support_audit_log")
    .select("event_type, actor_email, resource_type, resource_id, reason, created_at")
    .eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  supportAuditCache = data || [];
  renderSupportAccess();
}

async function handleSupportAccessGrant(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  const scopes = {
    can_view_documents: Boolean(supportScopeDocuments?.checked),
    can_view_recordings: Boolean(supportScopeRecordings?.checked),
    can_download_files: Boolean(supportScopeDownloads?.checked),
    can_change_content: Boolean(supportScopeChanges?.checked),
  };
  if (!Object.values(scopes).some(Boolean)) {
    setStatus(supportAccessStatus, "Choose at least one type of access.", "error");
    return;
  }
  supportAccessGrantButton.disabled = true;
  setStatus(supportAccessStatus, "Granting temporary access...");
  const { error } = await supabase.from("records_support_grants").insert({
    organization_id: organization.id,
    granted_by_user_id: currentSession.user.id,
    reason: supportAccessReason.value.trim() || "Customer-requested support",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...scopes,
  });
  supportAccessGrantButton.disabled = false;
  if (error) { setStatus(supportAccessStatus, error.message, "error"); return; }
  await loadActiveSupportGrant();
  await loadSupportAudit();
}

async function handleSupportAccessRevoke() {
  if (!supportGrantIsActive()) return;
  supportAccessRevokeButton.disabled = true;
  const now = new Date().toISOString();
  const { error } = await supabase.from("records_support_grants").update({
    revoked_at: now, revoked_by_user_id: currentSession.user.id,
  }).eq("id", activeSupportGrant.id).is("revoked_at", null);
  supportAccessRevokeButton.disabled = false;
  if (error) { setStatus(supportAccessStatus, error.message, "error"); return; }
  activeSupportGrant = null;
  await loadSupportAudit();
}

async function recordSupportEvent(eventType, resourceType = null, resourceId = null) {
  if (!isSupportView() || !supportGrantIsActive()) return;
  await supabase.rpc("record_records_support_event", {
    input_organization_id: getActiveOrganization()?.id,
    input_event_type: eventType,
    input_resource_type: resourceType,
    input_resource_id: resourceId,
    input_reason: null,
    input_metadata: {},
  });
}

function setAdminTab(tabName) {
  const visibleTabs = adminTabs.filter((tab) => !tab.classList.contains("hidden"));
  const target = visibleTabs.find((tab) => tab.getAttribute("data-admin-tab") === tabName) || visibleTabs[0] || null;
  activeAdminTab = target?.getAttribute("data-admin-tab") || "";

  adminTabs.forEach((tab) => {
    const isActive = tab.getAttribute("data-admin-tab") === activeAdminTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  adminPanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-admin-panel") === activeAdminTab;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (activeAdminTab === "activity") {
    void loadActivityLogForActiveOrganization();
  }
}

function updateAdminTabs(availability = {}) {
  adminTabs.forEach((tab) => {
    const name = tab.getAttribute("data-admin-tab") || "";
    const visible = Boolean(availability[name]);
    show(tab, visible);
    tab.disabled = !visible;
    const desktopViewButton = desktopAccountViewButtons.find((button) => button.getAttribute("data-records-account-view") === name);
    if (desktopViewButton) desktopViewButton.hidden = !visible;
  });

  const hasVisibleTab = adminTabs.some((tab) => !tab.classList.contains("hidden"));
  if (!hasVisibleTab) {
    adminPanels.forEach((panel) => {
      panel.classList.remove("is-active");
      panel.hidden = true;
    });
    activeAdminTab = "";
    return;
  }

  if (!availability[activeAdminTab]) {
    activeAdminTab = adminTabs.find((tab) => !tab.classList.contains("hidden"))?.getAttribute("data-admin-tab") || "";
  }
  setAdminTab(activeAdminTab);
}

const desktopAccountViewLabels = {
  profile: "Profile",
  users: "Users",
  voice: "Voice profiles",
  contacts: "Contacts",
  templates: "Templates",
  access: "Invites & access",
  support: "N3XRA support access",
  library: "Library settings",
  phone: "Phone Meetings",
  ai: "AI settings",
  billing: "Billing",
  storage: "Storage",
  activity: "Audit activity",
};

const desktopManageLibraryViews = new Set([
  "users",
  "voice",
  "contacts",
  "templates",
  "access",
  "support",
  "library",
  "phone",
  "ai",
  "billing",
  "storage",
  "activity",
]);

function getRequestedDesktopAccountView() {
  const view = new URLSearchParams(window.location.search).get("view") || "profile";
  return Object.hasOwn(desktopAccountViewLabels, view) ? view : "profile";
}

function updateDesktopAccountViewUrl(view) {
  const url = new URL(window.location.href);
  if (view === "profile") {
    url.searchParams.delete("view");
  } else {
    url.searchParams.set("view", view);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function setManageLibraryOpen(isOpen) {
  if (!desktopManageLibraryToggle) return;
  desktopManageLibraryToggle.setAttribute("aria-expanded", String(isOpen));
  desktopManageLibraryToggle.classList.toggle("records-desktop-nav-parent-active", isOpen);
  if (desktopManageLibraryMenu) desktopManageLibraryMenu.hidden = !isOpen;
  if (desktopManageLibraryIndicator) desktopManageLibraryIndicator.textContent = isOpen ? "−" : "+";
}

function setDesktopAccountView(view = "profile") {
  if (!window.matchMedia("(min-width: 981px)").matches) return;
  if (!Object.hasOwn(desktopAccountViewLabels, view)) view = "profile";
  const isProfile = view === "profile";
  const isAdminView = Boolean(view && !isProfile);
  const isManageView = desktopManageLibraryViews.has(view);

  document.body.classList.toggle("desktop-account-admin-view", isAdminView);
  document.body.classList.toggle("desktop-account-contacts-view", view === "contacts");
  document.body.classList.toggle("desktop-account-users-view", view === "users");
  document.body.classList.toggle(
    "desktop-account-secondary-view",
    ["voice", "templates", "access", "support", "library", "phone", "ai", "billing", "storage", "activity"].includes(view),
  );

  if (isProfile && accountSection && profileSettingsModal && !accountSection.contains(profileSettingsModal)) {
    accountSection.append(profileSettingsModal);
  }
  if (profileSettingsModal) profileSettingsModal.setAttribute("aria-hidden", isProfile ? "false" : "true");

  show(librarySettingsCard, isProfile);
  show(accountLibraryCard, isAdminView);
  show(recordsHelpCard, false);
  show(accountNoLibraryNotice, isProfile);
  show(libraryAccessCard, isAdminView);
  if (isAdminView) setAdminTab(view);

  desktopAccountViewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-records-account-view") === view);
  });
  setManageLibraryOpen(isManageView);
  if (desktopAccountPageTitle) desktopAccountPageTitle.textContent = desktopAccountViewLabels[view] || "Account";
  updateDesktopAccountViewUrl(view);
  if (view === "storage") {
    renderAccountStorageUsage();
    if (getActiveOrganization()?.id && !recordsUsageSummary) {
      loadRecordsAiUsage();
    }
  }
}

function formatActivityAction(actionType) {
  const labels = {
    upload: "Upload",
    delete: "Delete",
    visibility_change: "Visibility",
    invite_sent: "Invite sent",
    invite_redeemed: "Invite redeemed",
    ai_search_used: "AI Search",
    billing_change: "Billing",
    record_transfer: "Record moved",
  };
  return labels[actionType] || titleCase(String(actionType || "").replace(/_/g, " "));
}

function formatActivityDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderActivityLog() {
  if (!activityList) return;
  if (!activityCache.length) {
    activityList.innerHTML = '<tr><td colspan="5">No activity has been recorded for this library yet.</td></tr>';
    return;
  }

  activityList.innerHTML = activityCache
    .map((item) => {
      const actor = item.actor_name || item.actor_email || "Unknown";
      const target = item.target_label || item.target_type || "Library";
      return `
        <tr>
          <td>${escapeHtml(formatActivityDate(item.created_at))}</td>
          <td><span class="activity-action-pill">${escapeHtml(formatActivityAction(item.action_type))}</span></td>
          <td>${escapeHtml(actor)}</td>
          <td>${escapeHtml(target)}</td>
          <td>${escapeHtml(item.summary || "")}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadActivityLogForActiveOrganization() {
  const organization = getActiveOrganization();
  if (!activityList || !organization || !getActiveCapabilities().canManageLibrarySettings) {
    activityCache = [];
    renderActivityLog();
    setStatus(activityStatus, "");
    return;
  }

  try {
    setStatus(activityStatus, "Loading activity...");
    activityCache = await loadActivityLog(supabase, organization.id, {
      actionType: activityActionFilter?.value || "all",
      limit: 100,
    });
    renderActivityLog();
    setStatus(activityStatus, activityCache.length ? "" : "No matching activity found.");
  } catch (error) {
    activityCache = [];
    renderActivityLog();
    setStatus(activityStatus, getErrorMessage(error, "Unable to load activity."), "error");
  }
}

async function recordRecordsActivity(activity = {}) {
  const organization = getActiveOrganization();
  if (!organization) return null;
  const result = await recordActivity(supabase, currentSession, {
    organizationId: organization.id,
    ...activity,
  });
  if (result && activeAdminTab === "activity") {
    await loadActivityLogForActiveOrganization();
  }
  return result;
}

function openAdminDisclosure(section) {
  if (section instanceof HTMLDetailsElement) {
    section.open = true;
  }
}

function highlightAdminSection(section) {
  if (!section) return;
  section.classList.add("is-targeted");
  if (adminTargetTimer) window.clearTimeout(adminTargetTimer);
  adminTargetTimer = window.setTimeout(() => {
    section.classList.remove("is-targeted");
    adminTargetTimer = null;
  }, 1600);
}

function openInviteCodesFromUsers() {
  setAdminTab("access");
  openAdminDisclosure(inviteManagementBody);
  window.setTimeout(() => {
    inviteManagementBody?.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightAdminSection(inviteManagementBody);
    const fieldToFocus = inviteRecipientEmailInput?.disabled ? inviteRoleInput : inviteRecipientEmailInput;
    fieldToFocus?.focus({ preventScroll: true });
  }, 0);
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

function getEdgeFunctionErrorMessage(error, fallback) {
  const raw = getErrorMessage(error, fallback);
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to send a request to the edge function")
    || lower.includes("functions fetch failed")
    || lower.includes("failed to fetch")
    || lower.includes("network")
  ) {
    return "Invite email service is not reachable. Deploy `send-records-invite` and set `RESEND_API_KEY` in Supabase secrets.";
  }
  return raw;
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
  mobileMenuFilesLink?.classList.toggle("is-active", section === "files");
  mobileMenuMessagesLink?.classList.toggle("is-active", section === "messages");
}

function showSection(section) {
  const isAccount = section === "account";
  accountSection.hidden = !isAccount;
  librarySection.hidden = isAccount;
  setMenuActive(section);
  window.history.replaceState({}, "", buildSectionUrl(section));
  if (!isAccount) {
    setProfileSettingsOpen(false);
    setBillingPlanPickerOpen(false);
    setDeleteAccountModalOpen(false);
    setEmbedModalOpen(false);
    setAiMemoryModalOpen(false);
  }
  if (isAccount) {
    setUploadModalOpen(false);
    setAiMemoryModalOpen(false);
    setDesktopAccountView(getRequestedDesktopAccountView());
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
    deleteRecordsSubmit.disabled = false;
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
  }
}

function setAppConfirmModalOpen(isOpen) {
  if (!appConfirmModal) return;
  appConfirmModal.classList.toggle("is-open", isOpen);
  appConfirmModal.setAttribute("aria-hidden", String(!isOpen));
}

function confirmAction({
  title = "Are you sure?",
  message = "Please confirm to continue.",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  kicker = "Confirm action",
  danger = true,
} = {}) {
  if (!appConfirmModal) return Promise.resolve(false);
  if (appConfirmKicker) appConfirmKicker.textContent = kicker;
  if (appConfirmTitle) appConfirmTitle.textContent = title;
  if (appConfirmCopy) appConfirmCopy.textContent = message;
  if (appConfirmCancel) appConfirmCancel.textContent = cancelLabel;
  if (appConfirmOk) {
    appConfirmOk.textContent = confirmLabel;
    appConfirmOk.classList.toggle("btn-delete-solid", danger);
    appConfirmOk.classList.toggle("btn", true);
    appConfirmOk.classList.toggle("secondary", !danger);
  }
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
    setAppConfirmModalOpen(true);
  });
}

function setAppInputModalOpen(isOpen) {
  if (!appInputModal) return;
  appInputModal.classList.toggle("is-open", isOpen);
  appInputModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen && appInputValue) {
    appInputValue.value = "";
  }
}

function requestTextInput({
  title = "Enter a value",
  label = "Value",
  initialValue = "",
  submitLabel = "Continue",
  kicker = "Input required",
} = {}) {
  if (!appInputModal || !appInputValue) return Promise.resolve(null);
  if (appInputKicker) appInputKicker.textContent = kicker;
  if (appInputTitle) appInputTitle.textContent = title;
  if (appInputLabel) appInputLabel.textContent = label;
  if (appInputSubmit) appInputSubmit.textContent = submitLabel;
  appInputValue.value = initialValue;
  setAppInputModalOpen(true);
  window.setTimeout(() => appInputValue.focus(), 0);
  return new Promise((resolve) => {
    pendingInputResolve = resolve;
  });
}

function resolveTextInput(value) {
  if (pendingInputResolve) {
    pendingInputResolve(value);
  }
  pendingInputResolve = null;
  setAppInputModalOpen(false);
}

function resolveConfirm(value) {
  if (pendingConfirmResolve) {
    pendingConfirmResolve(Boolean(value));
  }
  pendingConfirmResolve = null;
  setAppConfirmModalOpen(false);
}

function setEmbedModalOpen(isOpen) {
  embedModal.classList.toggle("is-open", isOpen);
  embedModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) setStatus(embedStatus, "");
}

function setAiMemoryModalOpen(isOpen) {
  if (!aiMemoryModal) return;
  aiMemoryModal.classList.toggle("is-open", isOpen);
  aiMemoryModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    pendingAiMemorySuggestion = "";
    if (aiMemorySuggestionInput) aiMemorySuggestionInput.value = "";
    setStatus(aiMemoryStatus, "");
    if (aiMemorySave) aiMemorySave.disabled = false;
    if (aiMemoryDismiss) aiMemoryDismiss.disabled = false;
  }
}

function setInviteEmailModalOpen(isOpen) {
  if (!inviteEmailModal) return;
  inviteEmailModal.classList.toggle("is-open", isOpen);
  inviteEmailModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    pendingInviteEmailCode = "";
    if (inviteEmailCodeInput) inviteEmailCodeInput.value = "";
    if (inviteEmailRecipientInput) inviteEmailRecipientInput.value = "";
    if (inviteEmailNameInput) inviteEmailNameInput.value = "";
    if (inviteEmailMessageInput) inviteEmailMessageInput.value = "";
    setStatus(inviteEmailStatus, "");
    if (inviteEmailSubmit) inviteEmailSubmit.disabled = false;
    if (inviteEmailCancel) inviteEmailCancel.disabled = false;
    if (inviteEmailModalClose) inviteEmailModalClose.disabled = false;
  }
}

function openInviteEmailModal(inviteCode) {
  pendingInviteEmailCode = String(inviteCode || "").trim();
  if (!pendingInviteEmailCode) return;
  if (inviteEmailCodeInput) inviteEmailCodeInput.value = pendingInviteEmailCode;
  setStatus(inviteEmailStatus, "");
  setInviteEmailModalOpen(true);
}

async function sendInviteEmailForCode(organization, inviteCode, recipientEmail, recipientName, customMessage) {
  const inviteLink = buildInviteSignupUrl(inviteCode, recipientEmail);
  const { data: sendResult, error: sendError } = await supabase.functions.invoke("send-records-invite", {
    body: {
      organizationId: organization.id,
      inviteCode,
      recipientEmail,
      recipientName,
      customMessage,
      inviteLink,
    },
  });

  if (sendError || sendResult?.error) {
    throw new Error(getEdgeFunctionErrorMessage(sendError || { message: sendResult?.error }, "Unable to send invite email."));
  }
}

async function handleInviteEmailSubmit(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  const inviteCode = pendingInviteEmailCode || String(inviteEmailCodeInput?.value || "").trim();
  const recipientEmail = String(inviteEmailRecipientInput?.value || "").trim();
  const recipientName = String(inviteEmailNameInput?.value || "").trim();
  const customMessage = String(inviteEmailMessageInput?.value || "").trim();
  if (!inviteCode || !recipientEmail) {
    setStatus(inviteEmailStatus, "Invite code and recipient email are required.", "error");
    return;
  }

  setStatus(inviteEmailStatus, "Sending invite email...");
  if (inviteEmailSubmit) inviteEmailSubmit.disabled = true;
  if (inviteEmailCancel) inviteEmailCancel.disabled = true;
  if (inviteEmailModalClose) inviteEmailModalClose.disabled = true;
  try {
    await sendInviteEmailForCode(organization, inviteCode, recipientEmail, recipientName, customMessage);
    setStatus(createInviteStatus, `Invite email sent to ${recipientEmail}.`, "success");
    setInviteEmailModalOpen(false);
  } catch (error) {
    setStatus(inviteEmailStatus, getErrorMessage(error, "Unable to send invite email."), "error");
    if (inviteEmailSubmit) inviteEmailSubmit.disabled = false;
    if (inviteEmailCancel) inviteEmailCancel.disabled = false;
    if (inviteEmailModalClose) inviteEmailModalClose.disabled = false;
  }
}

function setBillingPlanPickerOpen(isOpen) {
  billingPlanPicker.classList.toggle("hidden", !isOpen);
  changePlanButton.setAttribute("aria-expanded", String(isOpen));
  changePlanButton.textContent = isOpen ? "Hide plans" : "Change plan";
}

function setBillingCycle(cycle) {
  selectedBillingCycle = cycle === "yearly" ? "yearly" : "monthly";
  billingCycleMonthlyButton.classList.toggle("is-active", selectedBillingCycle === "monthly");
  billingCycleYearlyButton.classList.toggle("is-active", selectedBillingCycle === "yearly");
  billingCycleMonthlyButton.setAttribute("aria-pressed", String(selectedBillingCycle === "monthly"));
  billingCycleYearlyButton.setAttribute("aria-pressed", String(selectedBillingCycle === "yearly"));
  if (!billingPlanPicker.classList.contains("hidden")) {
    renderBillingPlans();
  }
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

function sanitizeExtractedText(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const xmlTagHits = (raw.match(/<w:[a-z0-9]+/gi) || []).length;
  if (xmlTagHits < 4) return cleanWhitespace(raw);
  return cleanWhitespace(
    raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:lt|gt|amp|quot|apos);/gi, " ")
  );
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function fileLabel(file) {
  return file.webkitRelativePath || file.name;
}

const LARGE_UPLOAD_WARNING_BYTES = 100 * 1024 * 1024;
const VERY_LARGE_UPLOAD_WARNING_BYTES = 500 * 1024 * 1024;
const STORAGE_HEAVY_MEDIA_EXTENSIONS = new Set(["wav", "aiff", "aif", "flac", "mov", "mp4", "m4v", "webm", "mkv"]);
const STORAGE_FRIENDLY_AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac"]);

function getFileExtension(file) {
  const name = String(file?.name || "");
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function formatUploadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

function getUploadStorageReminder(files) {
  const selected = Array.isArray(files) ? files : [];
  if (!selected.length) return "";

  const largestFile = selected.reduce((largest, file) => (file.size > (largest?.size || 0) ? file : largest), null);
  const heavyMediaFile = selected.find((file) => STORAGE_HEAVY_MEDIA_EXTENSIONS.has(getFileExtension(file)));
  const friendlyAudioFile = selected.find((file) => STORAGE_FRIENDLY_AUDIO_EXTENSIONS.has(getFileExtension(file)) && file.size >= LARGE_UPLOAD_WARNING_BYTES);
  const totalBytes = selected.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

  if (heavyMediaFile) {
    return `Storage reminder: ${fileLabel(heavyMediaFile)} is ${formatUploadSize(heavyMediaFile.size)}. For speech recordings, export AAC/M4A or MP3 at 64-128 kbps before uploading. It usually stays clear and can use 10-20x less storage than WAV, AIFF, FLAC, or large video files.`;
  }

  if (friendlyAudioFile) {
    return `Storage reminder: ${fileLabel(friendlyAudioFile)} is ${formatUploadSize(friendlyAudioFile.size)}. That can be normal for a long recording, but 64-128 kbps speech audio usually keeps voices clear while preserving storage.`;
  }

  if (largestFile?.size >= VERY_LARGE_UPLOAD_WARNING_BYTES) {
    return `Storage reminder: ${fileLabel(largestFile)} is ${formatUploadSize(largestFile.size)}. Consider compressing, splitting, or exporting a lower-size copy before uploading so this library's storage lasts longer.`;
  }

  if (totalBytes >= VERY_LARGE_UPLOAD_WARNING_BYTES || largestFile?.size >= LARGE_UPLOAD_WARNING_BYTES) {
    return `Storage reminder: selected files total ${formatUploadSize(totalBytes)}. Compress large scans, photos, or recordings before uploading when a smaller clear copy will work.`;
  }

  return "";
}

function updateUploadStorageReminder() {
  const reminder = getUploadStorageReminder(collectUploadFiles());
  setStatus(uploadStatus, reminder, reminder ? "notice" : "");
}

function sanitizeStorageFileName(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function getLibraryInitials(name) {
  const words = String(name || "Library")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return initials || "N";
}

function getActiveLibraryLogoUrl() {
  const path = getActiveOrganization()?.logo_storage_path;
  return path ? organizationLogoUrls.get(path) || "" : "";
}

function renderLogoElement(imageEl, fallbackEl, organization) {
  if (!imageEl || !fallbackEl) return;
  const logoUrl = getActiveLibraryLogoUrl();
  const hasLogo = Boolean(logoUrl);
  imageEl.src = hasLogo ? logoUrl : "";
  imageEl.alt = hasLogo ? `${organization?.name || "Library"} logo` : "";
  fallbackEl.textContent = getLibraryInitials(organization?.name);
  show(imageEl, hasLogo);
  show(fallbackEl, !hasLogo);
}

function renderLibraryLogo() {
  const organization = getActiveOrganization();
  renderLogoElement(selectedLibraryLogoImage, selectedLibraryLogoFallback, organization);
  renderLogoElement(libraryContextLogoImage, libraryContextLogoFallback, organization);
  renderLogoElement(libraryLogoPreviewImage, libraryLogoPreviewFallback, organization);
  if (selectedLibraryLogoCaption) {
    selectedLibraryLogoCaption.textContent = organization?.logo_storage_path ? "Custom library logo" : "";
    selectedLibraryLogoCaption.style.display = organization?.logo_storage_path ? "" : "none";
  }
  if (libraryLogoRemove) {
    libraryLogoRemove.disabled = !organization?.logo_storage_path || !getActiveCapabilities().canManageLibrarySettings;
  }
  if (libraryLogoUpload) {
    libraryLogoUpload.disabled = !getActiveCapabilities().canManageLibrarySettings;
  }
  if (libraryLogoFileInput) {
    libraryLogoFileInput.disabled = !getActiveCapabilities().canManageLibrarySettings;
  }
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
  const supported = '<code class="inline">.pdf</code>, <code class="inline">.docx</code>, <code class="inline">.txt</code>, <code class="inline">.md</code>, <code class="inline">.csv</code>, <code class="inline">.json</code>, <code class="inline">.html</code>.';
  const pdfNote = 'PDFs with selectable text become searchable. Scanned PDFs upload as records but need OCR before search or editing.';
  const legacyDocNote = 'Legacy <code class="inline">.doc</code> files must be converted to <code class="inline">.docx</code> before upload.';
  const storageNote = 'For large scans or recordings, upload a compressed clear copy when possible. Speech recordings are usually clear as AAC/M4A or MP3 at 64-128 kbps, while uncompressed WAV can use 10-20x more storage.';
  if (isBatch) {
    return `Supported in this pass: ${supported} ${pdfNote} Batch mode reads both file selection and folder import and auto-detects year/month from filenames when available (private by default). ${legacyDocNote} ${storageNote}`;
  }
  return `Supported in this pass: ${supported} ${pdfNote} ${legacyDocNote} ${storageNote}`;
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

function mergeActiveOrganizationUpdate(update) {
  if (!update?.id || !activeMembership?.organization) return;
  const nextOrganization = {
    ...activeMembership.organization,
    ...update,
  };
  activeMembership.organization = nextOrganization;
  memberships = memberships.map((membership) =>
    membership.organization?.id === update.id
      ? { ...membership, organization: { ...membership.organization, ...update } }
      : membership
  );
}

function trimOrNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function normalizeAiMemoryText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 700);
}

function parseAiMemoryItems(value) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((line) => normalizeAiMemoryText(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")))
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index);
}

function serializeAiMemoryItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeAiMemoryText)
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index)
    .map((item) => `- ${item}`)
    .join("\n");
}

function appendAiMemory(existingMemory, memoryItem) {
  const item = normalizeAiMemoryText(memoryItem);
  if (!item) return String(existingMemory || "").trim();
  return serializeAiMemoryItems([...parseAiMemoryItems(existingMemory), item]);
}

function getAiMemoryItemsFromInput() {
  return parseAiMemoryItems(organizationAiMemoryInput?.value || "");
}

function setAiMemoryItems(items) {
  if (organizationAiMemoryInput) {
    organizationAiMemoryInput.value = serializeAiMemoryItems(items);
  }
  renderAiMemoryBubbles();
}

async function saveAiMemoryItems(items, successMessage = "AI memory updated.") {
  const organization = getActiveOrganization();
  if (!organization) return false;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(organizationAiSettingsStatus, "You do not have permission to update AI memory.", "error");
    return false;
  }

  const nextMemory = serializeAiMemoryItems(items);
  setAiMemoryItems(items);
  setStatus(organizationAiSettingsStatus, "Saving AI memory...");

  const { data, error } = await supabase
    .from("organizations")
    .update({ records_ai_memory: nextMemory || null })
    .eq("id", organization.id)
    .select("id, records_ai_memory")
    .single();

  if (error) {
    setStatus(
      organizationAiSettingsStatus,
      isMissingAiSettingsSchemaError(error)
        ? "Run the Records AI settings schema before saving AI memory."
        : error.message,
      "error"
    );
    renderProfile();
    return false;
  }

  mergeActiveOrganizationUpdate(data);
  renderProfile();
  setStatus(organizationAiSettingsStatus, successMessage, "success");
  return true;
}

function renderAiMemoryBubbles() {
  if (!organizationAiMemoryList) return;
  const canEdit = getActiveCapabilities().canManageLibrarySettings;
  const items = getAiMemoryItemsFromInput();
  if (!items.length) {
    organizationAiMemoryList.innerHTML = '<p class="ai-memory-empty">No saved memories yet.</p>';
    return;
  }

  organizationAiMemoryList.innerHTML = items.map((item, index) => `
    <article class="ai-memory-bubble" data-memory-index="${index}">
      <p>${escapeHtml(item)}</p>
      <div class="ai-memory-actions">
        <button type="button" data-memory-action="edit"${canEdit ? "" : " disabled"}>Edit</button>
        <button type="button" data-memory-action="delete"${canEdit ? "" : " disabled"}>Delete</button>
      </div>
    </article>
  `).join("");
}

async function addAiMemoryFromInput() {
  if (!organizationAiMemoryNewInput) return;
  const item = normalizeAiMemoryText(organizationAiMemoryNewInput.value);
  if (!item) return;
  const saved = await saveAiMemoryItems([...getAiMemoryItemsFromInput(), item], "AI memory added.");
  if (!saved) return;
  organizationAiMemoryNewInput.value = "";
}

async function handleAiMemoryBubbleAction(event) {
  const button = event.target.closest("button[data-memory-action]");
  if (!button || !organizationAiMemoryList?.contains(button)) return;
  if (!getActiveCapabilities().canManageLibrarySettings) return;

  const bubble = button.closest("[data-memory-index]");
  const index = Number.parseInt(bubble?.getAttribute("data-memory-index") || "", 10);
  const items = getAiMemoryItemsFromInput();
  if (!Number.isInteger(index) || !items[index]) return;

  const action = button.getAttribute("data-memory-action");
  if (action === "cancel") {
    renderAiMemoryBubbles();
    return;
  }

  if (action === "save") {
    const editInput = bubble.querySelector(".ai-memory-edit-input");
    const normalized = normalizeAiMemoryText(editInput?.value || "");
    if (!normalized) {
      items.splice(index, 1);
    } else {
      items[index] = normalized;
    }
    await saveAiMemoryItems(items, normalized ? "AI memory updated." : "AI memory deleted.");
    return;
  }

  if (action === "delete") {
    items.splice(index, 1);
    await saveAiMemoryItems(items, "AI memory deleted.");
    return;
  }

  if (action === "edit") {
    bubble.classList.add("is-editing");
    bubble.innerHTML = `
      <input class="ai-memory-edit-input" type="text" maxlength="700" value="${escapeHtml(items[index])}">
      <div class="ai-memory-actions">
        <button type="button" data-memory-action="save">Save</button>
        <button type="button" data-memory-action="cancel">Cancel</button>
      </div>
    `;
    const editInput = bubble.querySelector(".ai-memory-edit-input");
    editInput?.focus();
    editInput?.select();
  }
}

function handleAiMemoryBubbleKeydown(event) {
  const input = event.target.closest(".ai-memory-edit-input");
  if (!input || !organizationAiMemoryList?.contains(input)) return;
  if (event.key !== "Enter" && event.key !== "Escape") return;
  event.preventDefault();
  const bubble = input.closest("[data-memory-index]");
  const action = event.key === "Enter" ? "save" : "cancel";
  bubble?.querySelector(`button[data-memory-action="${action}"]`)?.click();
}

function isMissingAiSettingsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (message.includes("records_ai_context") || message.includes("records_ai_response_style") || message.includes("records_ai_memory") || message.includes("records_default_minutes_style") || message.includes("records_speaker_detection_enabled")) &&
    (message.includes("does not exist") || message.includes("schema cache"))
  );
}

function isMissingAiNoteSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("records_ai_note") && (message.includes("does not exist") || message.includes("schema cache"));
}

function isMissingReviewsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("reviews") && (message.includes("does not exist") || message.includes("schema cache"));
}

function isMissingRecordsPeopleLinkSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (
      message.includes("linked_user_id")
      || message.includes("recipient_email")
      || message.includes("recipient_name")
      || message.includes("source_contact_id")
    )
    && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  );
}

function getActiveRole() {
  return getMembershipRole(activeMembership);
}

async function getFreshAccessToken() {
  const { data: refreshedSessionData } = await supabase.auth.refreshSession();
  const { data: sessionData } = await supabase.auth.getSession();
  return (
    refreshedSessionData?.session?.access_token ||
    sessionData?.session?.access_token ||
    currentSession?.access_token ||
    ""
  );
}

function getActiveCapabilities() {
  return getCapabilities(
    activeMembership,
    currentSession?.user?.id || "",
    isSupportView() ? false : isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function getEditableDocumentForSource(sourceDocumentId) {
  return editableDocumentsBySourceId.get(sourceDocumentId) || null;
}

function getEffectiveDocument(doc) {
  const editableDoc = getEditableDocumentForSource(doc?.id);
  if (!editableDoc) return doc;
  return {
    ...doc,
    editable_document_id: editableDoc.id,
    title: editableDoc.title || doc?.title || "",
    original_filename: getAppDocumentPdfFilename(editableDoc),
    extracted_text: editableDoc.plain_text || doc?.extracted_text || "",
  };
}

function getEffectiveDocumentSearchText(doc) {
  const editableDoc = getEditableDocumentForSource(doc?.id);
  return editableDoc?.plain_text || doc?.extracted_text || "";
}

function isMissingAppDocumentsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("app_documents") && (message.includes("does not exist") || message.includes("schema cache"));
}

function revokeActiveModalObjectUrl() {
  if (!activeModalObjectUrl) return;
  URL.revokeObjectURL(activeModalObjectUrl);
  activeModalObjectUrl = "";
}

function getRecordsHelpDisplayContext() {
  const viewportWidth = Math.max(0, Math.round(Number(window.innerWidth) || 0));
  const viewportHeight = Math.max(0, Math.round(Number(window.innerHeight) || 0));
  const isDesktop =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 981px)").matches
      : viewportWidth >= 981;

  return {
    displayMode: isDesktop ? "desktop" : "mobile",
    viewportWidth,
    viewportHeight,
  };
}

async function handleRecordsHelpSubmit(event) {
  event?.preventDefault();
  if (!recordsHelpQuestion || !recordsHelpSubmit) return;

  const question = recordsHelpQuestion.value.trim();
  if (!question) {
    setStatus(recordsHelpStatus, "Enter a Records question first.", "error");
    return;
  }

  const organization = getActiveOrganization();
  recordsHelpSubmit.disabled = true;
  setStatus(recordsHelpStatus, "Checking Records help...");
  setRecordsHelpAnswer("");

  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

    const response = await fetch("/api/records-help", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        question,
        history: recordsHelpHistory,
        context: {
        organizationId: organization?.id || "",
        libraryName: organization?.name || "",
        role: formatRoleLabel(getActiveRole()),
        plan: organization ? formatPlanName(organization.subscription_tier || "free") : "",
        currentPath: window.location.pathname,
        ...getRecordsHelpDisplayContext(),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Records help is unavailable right now.");

    const answer = String(data.answer || "").trim();
    if (data?.usage?.organizationId) {
      updateRecordsUsageWithAiSummary(data.usage);
      renderBillingPlans();
    }
    setRecordsHelpAnswer(answer);
    setStatus(recordsHelpStatus, answer ? "" : "No answer returned.", answer ? "" : "error");

    if (answer) {
      recordsHelpHistory.push({ role: "user", content: question });
      recordsHelpHistory.push({ role: "assistant", content: answer });
      if (recordsHelpHistory.length > RECORDS_HELP_HISTORY_LIMIT) {
        recordsHelpHistory.splice(0, recordsHelpHistory.length - RECORDS_HELP_HISTORY_LIMIT);
      }
      recordsHelpQuestion.value = "";
    }
  } catch (error) {
    setStatus(recordsHelpStatus, getErrorMessage(error, "Unable to ask Records help."), "error");
  } finally {
    recordsHelpSubmit.disabled = false;
  }
}

function hasActiveLibraryAccess() {
  return Boolean(getActiveOrganization());
}

function getOwnedMemberships() {
  const currentUserId = currentSession?.user?.id || "";
  return memberships.filter((membership) => membership?.organization?.owner_user_id === currentUserId && !membership?.isSupportView);
}

function hasPaidOwnedLibraries() {
  return getOwnedMemberships().some((membership) => {
    const tier = String(membership?.organization?.subscription_tier || "");
    const status = String(membership?.organization?.account_status || "active");
    const cancelAtPeriodEnd = Boolean(membership?.organization?.cancel_at_period_end);
    return ["starter", "organization"].includes(tier) && !["canceled", "suspended"].includes(status) && !cancelAtPeriodEnd;
  });
}

function hasFreeOwnedLibrary() {
  return getOwnedMemberships().some((membership) => {
    const tier = String(membership?.organization?.subscription_tier || "free");
    const status = String(membership?.organization?.account_status || "active");
    return tier === "free" && !["canceled", "suspended"].includes(status);
  });
}

function canCreateOwnedLibrary() {
  const ownedMemberships = getOwnedMemberships();
  return ownedMemberships.length === 0 || (hasPaidOwnedLibraries() && !hasFreeOwnedLibrary());
}

function getCreateOwnedLibraryBlockedMessage() {
  if (hasFreeOwnedLibrary()) {
    return "Upgrade or remove your existing Free library before creating another library.";
  }
  return "Upgrade one owned library to Starter or Organization before creating another library.";
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

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatStorageLimit(valueMb) {
  const mb = Number(valueMb || 0);
  if (mb >= 1024 && mb % 1024 === 0) return `${formatWholeNumber(mb / 1024)} GB`;
  return `${formatWholeNumber(mb)} MB`;
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

function formatStorageItemDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderStorageBreakdownCard(label, value, detail) {
  return `
    <div class="storage-breakdown-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderStorageLargestItem(item) {
  return `
    <div class="storage-item">
      <div class="storage-item-main">
        <span class="storage-type-badge">${escapeHtml(item.type || "File")}</span>
        <strong>${escapeHtml(item.name || "Stored file")}</strong>
        <p>${escapeHtml([formatStorageBytes(item.sizeBytes), formatStorageItemDate(item.createdAt)].filter(Boolean).join(" · "))}</p>
      </div>
      ${item.href ? `<a class="btn secondary button-link" href="${escapeHtml(item.href)}">Open</a>` : ""}
    </div>
  `;
}

function renderStorageSuggestion(item) {
  return `
    <div class="storage-suggestion">
      <strong>${escapeHtml(item.name || "Stored file")}</strong>
      <p>${escapeHtml(item.suggestion || "Review this item for possible cleanup.")}</p>
      <span>${escapeHtml(formatStorageBytes(item.sizeBytes))}</span>
    </div>
  `;
}

function setAccountStorageStatus(message = "", tone = "") {
  if (!accountStorageStatus) return;
  accountStorageStatus.textContent = message;
  accountStorageStatus.className = "status";
  if (tone) accountStorageStatus.classList.add(tone);
}

function renderAccountStorageUsage() {
  if (!accountStorageTotalValue || !accountStorageBreakdownGrid) return;
  const organization = getActiveOrganization();
  const usage = recordsUsageSummary?.organizationId === organization?.id ? recordsUsageSummary : null;

  if (!organization?.id) {
    accountStorageTotalValue.textContent = "0 B used";
    accountStorageTotalCopy.textContent = "Select or join a library to review its storage.";
    accountStorageTotalMeter.style.width = "0%";
    accountStorageBreakdownGrid.innerHTML = "";
    accountStorageLargestList.innerHTML = '<p class="empty">No active library.</p>';
    accountStorageSuggestionList.innerHTML = '<p class="empty">Storage suggestions will appear after a library is selected.</p>';
    setAccountStorageStatus("");
    return;
  }

  if (!usage) {
    accountStorageTotalValue.textContent = "Loading...";
    accountStorageTotalCopy.textContent = "Loading storage usage for this library.";
    accountStorageTotalMeter.style.width = "0%";
    accountStorageBreakdownGrid.innerHTML = "";
    accountStorageLargestList.innerHTML = '<p class="empty">Loading largest items...</p>';
    accountStorageSuggestionList.innerHTML = '<p class="empty">Loading suggestions...</p>';
    setAccountStorageStatus("Loading storage usage...");
    return;
  }

  const storageMetric = usage.metrics?.storage || { used: 0, limit: 0, remaining: 0, percent: 0 };
  const details = usage.storageDetails || {};
  const breakdown = details.breakdown || {};
  const supportMode = isSupportView();
  const largestItems = supportMode || !Array.isArray(details.largestItems) ? [] : details.largestItems;
  const suggestions = supportMode || !Array.isArray(details.suggestions) ? [] : details.suggestions;

  accountStorageTotalValue.textContent = `${formatStorageBytes(storageMetric.used)} used`;
  accountStorageTotalCopy.textContent = `${formatStorageBytes(storageMetric.remaining)} remaining of ${formatStorageBytes(storageMetric.limit)}. ${formatWholeNumber(breakdown.trackedFileCount)} stored item${Number(breakdown.trackedFileCount) === 1 ? "" : "s"} are counted here.`;
  accountStorageTotalMeter.style.width = `${Math.max(0, Math.min(100, Number(storageMetric.percent || 0)))}%`;
  accountStorageBreakdownGrid.innerHTML = [
    renderStorageBreakdownCard("Uploaded files", formatStorageBytes(breakdown.uploadedFilesBytes), "PDFs, documents, scans, images, and source files."),
    renderStorageBreakdownCard("Meeting recordings", formatStorageBytes(breakdown.meetingRecordingsBytes), "Stored audio or video attached to meeting notes."),
    renderStorageBreakdownCard("Transcript sources", formatStorageBytes(breakdown.transcriptSourceBytes), "Source files linked to meeting transcripts."),
    renderStorageBreakdownCard("App documents", `${formatWholeNumber(breakdown.appDocumentsCount)} docs`, "Text documents are tracked for limits but use minimal file storage."),
  ].join("");

  accountStorageLargestList.innerHTML = supportMode
    ? '<p class="empty">File details are hidden during N3XRA support access.</p>'
    : largestItems.length
      ? largestItems.map(renderStorageLargestItem).join("")
      : '<p class="empty">No stored files are using measurable storage yet.</p>';

  accountStorageSuggestionList.innerHTML = supportMode
    ? '<p class="empty">Cleanup details are hidden during N3XRA support access.</p>'
    : suggestions.length
      ? suggestions.map(renderStorageSuggestion).join("")
      : '<p class="empty">No large cleanup candidates found. Storage usage looks healthy right now.</p>';

  setAccountStorageStatus("");
}

function getUsageMetric(summary, key, fallbackUsed = 0, fallbackLimit = 0) {
  const metric = summary?.metrics?.[key];
  if (metric) return metric;
  const used = Math.max(0, Number(fallbackUsed || 0));
  const limit = Math.max(0, Number(fallbackLimit || 0));
  return {
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    over: limit > 0 && used > limit,
    percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
  };
}

function renderUsageItem({ label, value, detail = "", percent = 0, over = false, actionHref = "", actionLabel = "" }) {
  return `
    <div class="usage-item${over ? " is-over" : ""}">
      <div class="usage-item-head">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
      <div class="usage-meter" aria-hidden="true">
        <span style="width: ${Math.max(0, Math.min(100, Number(percent || 0)))}%"></span>
      </div>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
      ${actionHref && actionLabel ? `<a class="usage-item-action" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>` : ""}
    </div>
  `;
}

function updateRecordsUsageWithAiSummary(aiUsage) {
  if (!aiUsage?.organizationId) return;
  recordsAiUsageSummary = aiUsage;
  if (!recordsUsageSummary || recordsUsageSummary.organizationId !== aiUsage.organizationId) return;
  const requestLimit = Math.max(0, Number(aiUsage.requestLimit || recordsUsageSummary.limits?.aiRequests || 0));
  const tokenLimit = Math.max(0, Number(aiUsage.tokenLimit || recordsUsageSummary.limits?.aiTokens || 0));
  const requestCount = Math.max(0, Number(aiUsage.requestCount || 0));
  const tokenCount = Math.max(0, Number(aiUsage.tokenCount || 0));
  recordsUsageSummary = {
    ...recordsUsageSummary,
    limits: {
      ...recordsUsageSummary.limits,
      aiRequests: requestLimit,
      aiTokens: tokenLimit,
    },
    used: {
      ...recordsUsageSummary.used,
      aiRequests: requestCount,
      aiTokens: tokenCount,
    },
    metrics: {
      ...recordsUsageSummary.metrics,
      aiRequests: getUsageMetric(null, "", requestCount, requestLimit),
      aiTokens: getUsageMetric(null, "", tokenCount, tokenLimit),
    },
    periodStart: aiUsage.periodStart || recordsUsageSummary.periodStart,
    periodEnd: aiUsage.periodEnd || recordsUsageSummary.periodEnd,
  };
}

function getStorageUploadBlockMessage(files) {
  const organization = getActiveOrganization();
  const summary = recordsUsageSummary?.organizationId === organization?.id ? recordsUsageSummary : null;
  if (!summary?.metrics?.storage) return "";
  const uploadBytes = (Array.isArray(files) ? files : []).reduce((sum, file) => sum + Math.max(0, Number(file.size || 0)), 0);
  if (!uploadBytes) return "";
  const storage = summary.metrics.storage;
  if (storage.limit > 0 && storage.used + uploadBytes > storage.limit) {
    return `This upload would exceed the ${formatStorageBytes(storage.limit)} storage limit for this ${formatPlanName(organization.subscription_tier)} plan. ${formatStorageBytes(storage.remaining)} remains; selected files total ${formatStorageBytes(uploadBytes)}.`;
  }
  return "";
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
    setStatus(billingStatus, "Stripe billing is not enabled in shared/config.js yet.", "error");
    return false;
  }

  const { data: refreshedSessionData } = await supabase.auth.refreshSession();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken =
    refreshedSessionData?.session?.access_token ||
    sessionData?.session?.access_token ||
    currentSession?.access_token ||
    "";
  const { supabaseUrl = "", supabaseAnonKey = "" } = getConfig();

  if (!accessToken) {
    setStatus(billingStatus, "Your session expired. Sign in again and retry.", "error");
    return false;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    setStatus(billingStatus, "Missing app config for Stripe billing request.", "error");
    return false;
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/stripe-billing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action,
        ...payload,
      }),
    });
  } catch (error) {
    setStatus(billingStatus, error instanceof Error ? error.message : "Unable to reach Stripe billing function.", "error");
    return false;
  }

  let data = null;
  let rawText = "";
  try {
    data = await response.clone().json();
  } catch {
    try {
      rawText = await response.clone().text();
    } catch {
      rawText = "";
    }
  }

  if (!response.ok || data?.error) {
    const errorMessage = String(data?.error || rawText || "Unable to start Stripe billing.");
    setStatus(billingStatus, `${errorMessage} (HTTP ${response.status})`, "error");
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

function buildInviteSignupUrl(inviteCode, recipientEmail = "") {
  const code = String(inviteCode || "").trim();
  if (!code) return "";
  const url = new URL("/n3xra-records/login", window.location.origin);
  url.searchParams.set("signup", "invite");
  url.searchParams.set("invite", code);
  if (recipientEmail) {
    url.searchParams.set("email", recipientEmail.trim());
  }
  return url.toString();
}

function buildSiblingPageUrl(pageName) {
  const currentUrl = new URL(window.location.href);
  const currentPath = currentUrl.pathname;
  const siblingPath = currentPath.replace(/[^/]*$/, pageName);
  return new URL(siblingPath, currentUrl.origin);
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function normalizeOptionalAccentColor(value) {
  const normalized = normalizeHexColor(value, DEFAULT_ACCENT_COLOR);
  return normalized === DEFAULT_ACCENT_COLOR ? null : normalized;
}

function getEmbedUrl() {
  const organization = getActiveOrganization();
  if (!organization) return "";
  const embedUrl = buildSiblingPageUrl("embed");
  embedUrl.searchParams.set("org", organization.id);
  return embedUrl.href;
}

function getPublicLibraryUrl() {
  const organization = getActiveOrganization();
  if (!organization) return "";
  if (!organization.slug) return getEmbedUrl();
  return new URL(`/library/${encodeURIComponent(organization.slug)}`, window.location.origin).href;
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

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

function createPdfNeedsOcrError() {
  const error = new Error("No selectable text found. This PDF is likely scanned and needs OCR before search or editing.");
  error.code = "pdf-needs-ocr";
  return error;
}

function isPdfNeedsOcrError(error) {
  return error?.code === "pdf-needs-ocr";
}

async function getPdfJsLibrary() {
  if (!pdfJsLibraryPromise) {
    pdfJsLibraryPromise = import("https://esm.sh/pdfjs-dist@4.10.38/build/pdf.mjs").then((module) => {
      module.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
      return module;
    });
  }
  return pdfJsLibraryPromise;
}

async function extractPdfText(file) {
  const pdfjsLib = await getPdfJsLibrary();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items || [])
        .map((item) => String(item?.str || "").trim())
        .filter(Boolean)
        .join(" ");
      if (pageText) pageTexts.push(pageText);
      page.cleanup?.();
    }
  } finally {
    await pdf.destroy?.();
  }

  const text = cleanWhitespace(pageTexts.join("\n\n"));
  if (!text || text.length < 12) throw createPdfNeedsOcrError();
  return text;
}

async function extractTextFromFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) return extractDocxText(file);
  if (isPdfFile(file)) return extractPdfText(file);
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
  throw new Error("Unsupported file type. Use .pdf, .docx, .txt, .md, .csv, .json, or .html.");
}

function snippetFromText(text, query) {
  const safeText = sanitizeExtractedText(text);
  if (!safeText) return "No extracted text yet.";
  if (!query) return `${safeText.slice(0, 220).trim()}${safeText.length > 220 ? "..." : ""}`;

  const lower = safeText.toLowerCase();
  const q = query.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return `${safeText.slice(0, 220).trim()}${safeText.length > 220 ? "..." : ""}`;

  const start = Math.max(0, index - 80);
  const end = Math.min(safeText.length, index + q.length + 120);
  const snippet = safeText.slice(start, end).trim();
  const relativeIndex = index - start;
  const before = escapeHtml(snippet.slice(0, relativeIndex));
  const match = escapeHtml(snippet.slice(relativeIndex, relativeIndex + q.length));
  const after = escapeHtml(snippet.slice(relativeIndex + q.length));
  const prefix = start > 0 ? "... " : "";
  const suffix = end < safeText.length ? " ..." : "";
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAiEvidenceTerms() {
  const stopWords = new Set([
    "about", "after", "also", "and", "any", "are", "ask", "can", "create", "draft", "for", "from", "give", "have",
    "how", "into", "make", "more", "need", "only", "please", "show", "summarize", "table", "tell", "that", "the",
    "this", "use", "using", "what", "when", "where", "which", "with", "you", "your",
  ]);
  const queryTerms = String(searchQueryInput?.value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !stopWords.has(word));
  return Array.from(new Set(queryTerms)).slice(0, 10);
}

function highlightedAiEvidenceSnippet(text) {
  const safeText = sanitizeExtractedText(text);
  if (!safeText) return "No excerpt available.";

  const terms = getAiEvidenceTerms();
  const lower = safeText.toLowerCase();
  const matchedTerm = terms.find((term) => lower.includes(term));
  const index = matchedTerm ? lower.indexOf(matchedTerm) : 0;
  const start = Math.max(0, index - 170);
  const end = Math.min(safeText.length, index + 520);
  let snippet = safeText.slice(start, end).trim();
  if (start > 0) snippet = `... ${snippet}`;
  if (end < safeText.length) snippet = `${snippet} ...`;

  let escaped = escapeHtml(snippet);
  terms.forEach((term) => {
    escaped = escaped.replace(new RegExp(`\\b(${escapeRegExp(term)})\\b`, "gi"), "<mark>$1</mark>");
  });
  return escaped;
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

function sortDocumentsNewestToOldest(docs) {
  return [...docs].sort((a, b) => {
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
  });
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
          cancel_at_period_end,
          billing_cycle,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          subscription_current_period_end,
          branded_primary_color,
          branded_accent_color,
          records_default_minutes_style,
          records_speaker_detection_enabled
        )
      `)
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (profileError) throw profileError;
  if (membershipError) throw membershipError;

  if (!profileData) {
    currentProfile = {
      id: currentSession.user.id,
      email: currentSession.user.email || null,
      full_name: currentSession.user.user_metadata?.full_name || null,
    };
  } else {
    currentProfile = profileData;
  }
  memberships = dedupeMembershipsByOrganization(buildMembershipMap(membershipData || []));

  if (supportOrgId && isPlatformAdminEmail(currentSession.user.email)) {
    const { data: supportOrg, error: supportError } = await supabase
      .from("organizations")
      .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, cancel_at_period_end, billing_cycle, branded_primary_color, branded_accent_color, records_default_minutes_style, records_speaker_detection_enabled, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
      .eq("id", supportOrgId)
      .maybeSingle();

    if (supportError) throw supportError;
    if (supportOrg) {
      memberships = [
        {
          id: `support-${supportOrg.id}`,
          organization_id: supportOrg.id,
          role: "viewer",
          permissions: { support_view: true },
          organization: supportOrg,
          isSupportView: true,
        },
      ];
    }
  } else {
    memberships = sortMemberships(memberships);
  }

  const bootstrapOrgId = String(bootstrapData?.active_organization_id || "");
  const preferredOrgId = supportOrgId || bootstrapOrgId;
  activeMembership = resolveActiveOrganization(memberships, preferredOrgId, { preferStored: !supportOrgId });
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

  let { data, error } = await supabase
    .from("organization_invites")
    .select("id, code, role, max_uses, redeemed_uses, expires_at, is_disabled, recipient_email, recipient_name, source_contact_id, created_at")
    .eq("organization_id", activeMembership.organization.id)
    .order("created_at", { ascending: false });

  if (error && isMissingRecordsPeopleLinkSchemaError(error)) {
    const fallback = await supabase
      .from("organization_invites")
      .select("id, code, role, max_uses, redeemed_uses, expires_at, is_disabled, created_at")
      .eq("organization_id", activeMembership.organization.id)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

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
  renderVoiceProfiles();
  await loadVoiceProfiles();
}

async function loadVoiceProfiles() {
  const organizationId = getActiveOrganization()?.id;
  const accessToken = currentSession?.access_token;
  if (!voiceProfileList || !organizationId || !accessToken || isSupportView()) {
    voiceProfileStatusMap = new Map();
    renderVoiceProfiles();
    return;
  }

  try {
    const response = await fetch(`/api/records-voice-profile?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to load voice profiles.");
    voiceProfileStatusMap = new Map(
      (Array.isArray(data.profiles) ? data.profiles : []).map((profile) => [profile.userId, profile]),
    );
    setStatus(voiceDirectoryStatus, "");
    renderVoiceProfiles();
  } catch (error) {
    voiceProfileStatusMap = new Map();
    renderVoiceProfiles();
    setStatus(voiceDirectoryStatus, getErrorMessage(error, "Unable to load voice profiles."), "error");
  }
}

async function loadContacts() {
  if (!activeMembership) return;

  let { data, error } = await supabase
    .from("organization_contacts")
    .select("id, full_name, email, notes, linked_user_id, created_at, updated_at")
    .eq("organization_id", activeMembership.organization.id)
    .order("full_name", { ascending: true });

  if (error && isMissingRecordsPeopleLinkSchemaError(error)) {
    const fallback = await supabase
      .from("organization_contacts")
      .select("id, full_name, email, notes, created_at, updated_at")
      .eq("organization_id", activeMembership.organization.id)
      .order("full_name", { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    const message = String(error.message || "").toLowerCase();
    setStatus(
      contactStatus,
      message.includes("organization_contacts") && (message.includes("does not exist") || message.includes("schema cache"))
        ? "Run the contacts migration before managing contacts."
        : error.message,
      "error"
    );
    contactCache = [];
    renderContacts();
    return;
  }

  contactCache = Array.isArray(data) ? data : [];
  renderContacts();
}

function normalizePhoneMeetingNumber(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed.replace(/[\s().-]/g, "") : null;
}

function getPhoneMeetingAllowedRoles() {
  return [
    phoneMeetingAllowAccountAdmin?.checked ? "account_admin" : "",
    phoneMeetingAllowEditor?.checked ? "editor" : "",
  ].filter(Boolean);
}

function formatPhoneMeetingStatus(value) {
  const status = String(value || "not_configured").replace(/_/g, " ");
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function renderPhoneMeetingSettings() {
  const settings = phoneMeetingSettingsCache;
  const platformAdmin = Boolean(getActiveCapabilities().isPlatformAdmin);
  const canManageSettings = Boolean(getActiveCapabilities().canManageLibrarySettings);
  const allowed = Array.isArray(settings?.allowed_start_roles) ? settings.allowed_start_roles : ["account_admin", "editor"];
  const isEnabled = Boolean(settings?.feature_enabled);
  const activation = String(settings?.activation_status || "not_configured");
  const number = settings?.primary_phone_number || "No number assigned";
  const limit = settings?.monthly_minutes_limit;

  if (phoneMeetingFeatureEnabled) phoneMeetingFeatureEnabled.checked = isEnabled;
  if (phoneMeetingActivationStatus) phoneMeetingActivationStatus.value = activation;
  if (phoneMeetingPrimaryNumber) phoneMeetingPrimaryNumber.value = settings?.primary_phone_number || "";
  if (phoneMeetingMonthlyMinutesLimit) phoneMeetingMonthlyMinutesLimit.value = limit ?? "";
  if (phoneMeetingAllowAccountAdmin) phoneMeetingAllowAccountAdmin.checked = allowed.includes("account_admin");
  if (phoneMeetingAllowEditor) phoneMeetingAllowEditor.checked = allowed.includes("editor");
  if (phoneMeetingRecordingNoticeEnabled) phoneMeetingRecordingNoticeEnabled.checked = settings?.recording_notice_enabled !== false;
  if (phoneMeetingRecordingNoticeText) phoneMeetingRecordingNoticeText.value = settings?.recording_notice_text || "This call may be recorded for meeting notes.";
  if (phoneMeetingRetentionDays) phoneMeetingRetentionDays.value = settings?.default_retention_days || 30;

  if (phoneMeetingSettingsSummary) {
    phoneMeetingSettingsSummary.textContent = `${isEnabled ? "Enabled" : "Disabled"} · ${formatPhoneMeetingStatus(activation)} · ${number}`;
  }
  if (phoneMeetingUsageSummary) {
    const usageText = `${phoneMeetingUsageMinutes} ${phoneMeetingUsageMinutes === 1 ? "minute" : "minutes"} recorded this month`;
    phoneMeetingUsageSummary.textContent = limit === null || limit === undefined || limit === ""
      ? `${usageText}. No monthly limit is set.`
      : `${usageText} of ${limit} allowed.`;
  }

  [
    phoneMeetingFeatureEnabled,
    phoneMeetingActivationStatus,
    phoneMeetingPrimaryNumber,
  ].forEach((field) => {
    if (field) field.disabled = !platformAdmin;
  });

  [
    phoneMeetingMonthlyMinutesLimit,
    phoneMeetingAllowAccountAdmin,
    phoneMeetingAllowEditor,
    phoneMeetingRecordingNoticeEnabled,
    phoneMeetingRecordingNoticeText,
    phoneMeetingRetentionDays,
    phoneMeetingSettingsSave,
  ].forEach((field) => {
    if (field) field.disabled = !canManageSettings;
  });
}

async function loadPhoneMeetingSettingsForActiveOrganization() {
  const organization = getActiveOrganization();
  phoneMeetingSettingsCache = null;
  phoneMeetingUsageMinutes = 0;
  if (!organization?.id || !supabase) {
    renderPhoneMeetingSettings();
    return;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [settingsResult, usageResult] = await Promise.all([
    supabase
      .from("organization_phone_meeting_settings")
      .select("feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days, allowed_start_roles, monthly_minutes_limit, usage_billing_status, updated_at")
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("phone_meeting_usage_events")
      .select("quantity")
      .eq("organization_id", organization.id)
      .eq("event_type", "call_minute")
      .gte("occurred_at", monthStart.toISOString()),
  ]);

  if (!settingsResult.error) phoneMeetingSettingsCache = settingsResult.data || null;
  if (!usageResult.error) {
    phoneMeetingUsageMinutes = (usageResult.data || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
  }
  renderPhoneMeetingSettings();
}

async function handlePhoneMeetingSettingsSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization?.id) return;
  const capabilities = getActiveCapabilities();
  if (!capabilities.canManageLibrarySettings) {
    setStatus(phoneMeetingSettingsStatus, "Only a library owner or account administrator can update these Phone Meetings settings.", "error");
    return;
  }

  const primaryPhoneNumber = normalizePhoneMeetingNumber(phoneMeetingPrimaryNumber?.value);
  if (capabilities.isPlatformAdmin && primaryPhoneNumber && !/^\+[1-9][0-9]{7,14}$/.test(primaryPhoneNumber)) {
    setStatus(phoneMeetingSettingsStatus, "Use a full phone number starting with + and country code.", "error");
    return;
  }
  const retentionDays = Number(phoneMeetingRetentionDays?.value || 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    setStatus(phoneMeetingSettingsStatus, "Retention target must be between 1 and 3,650 days.", "error");
    return;
  }
  const limitInput = String(phoneMeetingMonthlyMinutesLimit?.value || "").trim();
  const monthlyMinutesLimit = limitInput ? Number(limitInput) : null;
  if (monthlyMinutesLimit !== null && (!Number.isInteger(monthlyMinutesLimit) || monthlyMinutesLimit < 0)) {
    setStatus(phoneMeetingSettingsStatus, "Monthly minute limit must be a whole number or left blank.", "error");
    return;
  }
  const noticeText = String(phoneMeetingRecordingNoticeText?.value || "").trim();
  if (phoneMeetingRecordingNoticeEnabled?.checked && !noticeText) {
    setStatus(phoneMeetingSettingsStatus, "Enter the recording notice that callers will hear.", "error");
    return;
  }

  const updates = {
    action: "update_settings",
    organization_id: organization.id,
    allowed_start_roles: getPhoneMeetingAllowedRoles(),
    recording_notice_enabled: Boolean(phoneMeetingRecordingNoticeEnabled?.checked),
    recording_notice_text: noticeText || "This call may be recorded for meeting notes.",
    default_retention_days: retentionDays,
    monthly_minutes_limit: monthlyMinutesLimit,
  };
  if (capabilities.isPlatformAdmin) {
    Object.assign(updates, {
      feature_enabled: Boolean(phoneMeetingFeatureEnabled?.checked),
      activation_status: String(phoneMeetingActivationStatus?.value || "not_configured"),
      primary_phone_number: primaryPhoneNumber,
    });
  }
  setStatus(phoneMeetingSettingsStatus, "Saving Phone Meetings settings…");
  const { data, error } = await supabase.functions.invoke("twilio-phone-meetings", { body: updates });
  if (error) {
    setStatus(phoneMeetingSettingsStatus, error.message, "error");
    return;
  }
  phoneMeetingSettingsCache = data;
  renderPhoneMeetingSettings();
  setStatus(phoneMeetingSettingsStatus, "Phone Meetings settings saved.", "success");
}

async function loadAppTemplates() {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canManageTemplates) {
    appTemplates = [];
    renderAdminTemplates();
    return;
  }

  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, status, updated_at, created_at")
    .eq("organization_id", organization.id)
    .eq("document_kind", "template")
    .order("updated_at", { ascending: false });

  if (error) {
    appTemplates = [];
    const message = isMissingAppDocumentsSchemaError(error)
      ? "Run the app_documents migration before managing templates."
      : error.message;
    setStatus(adminTemplateStatus, message, "error");
    renderAdminTemplates();
    return;
  }

  appTemplates = Array.isArray(data) ? data : [];
  renderAdminTemplates();
}

async function loadRecordsAiUsage() {
  const organization = getActiveOrganization();
  recordsAiUsageSummary = null;
  recordsUsageSummary = null;
  if (!organization?.id) return;

  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) return;
    const response = await fetch(`/api/records-usage?organizationId=${encodeURIComponent(organization.id)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    recordsUsageSummary = data?.usage || null;
    if (recordsUsageSummary?.organizationId) {
      recordsAiUsageSummary = {
        organizationId: recordsUsageSummary.organizationId,
        planId: recordsUsageSummary.planId,
        planName: recordsUsageSummary.planName,
        periodStart: recordsUsageSummary.periodStart,
        periodEnd: recordsUsageSummary.periodEnd,
        requestCount: recordsUsageSummary.used?.aiRequests || 0,
        requestLimit: recordsUsageSummary.limits?.aiRequests || 0,
        requestsRemaining: recordsUsageSummary.metrics?.aiRequests?.remaining || 0,
        tokenCount: recordsUsageSummary.used?.aiTokens || 0,
        tokenLimit: recordsUsageSummary.limits?.aiTokens || 0,
        tokensRemaining: recordsUsageSummary.metrics?.aiTokens?.remaining || 0,
      };
    }
  } catch (_error) {
    recordsAiUsageSummary = null;
    recordsUsageSummary = null;
    phoneMeetingSettingsCache = null;
    phoneMeetingUsageMinutes = 0;
  }

  renderAccountStorageUsage();
  renderBillingPlans();
}

async function loadOrganizationAiSettings() {
  const organization = getActiveOrganization();
  if (!organization?.id || !getActiveCapabilities().canManageLibrarySettings) return;

  const { data, error } = await supabase
    .from("organizations")
    .select("id, records_ai_context, records_ai_response_style, records_ai_memory, records_default_minutes_style, records_speaker_detection_enabled")
    .eq("id", organization.id)
    .maybeSingle();

  if (error) {
    if (isMissingAiSettingsSchemaError(error)) {
      setStatus(organizationAiSettingsStatus, "Run the Records AI settings schema before saving library AI guidance.", "error");
      return;
    }
    setStatus(organizationAiSettingsStatus, error.message, "error");
    return;
  }

  if (data) {
    mergeActiveOrganizationUpdate(data);
    renderProfile();
  }
}

function renderOrganizationReviewForm() {
  if (!organizationReviewRating || !organizationReviewText || !organizationReviewMeta || !organizationReviewSave) return;
  const capabilities = getActiveCapabilities();
  const canManageReview = hasActiveLibraryAccess() && capabilities.canManageLibrarySettings;
  organizationReviewRating.disabled = !canManageReview;
  organizationReviewText.disabled = !canManageReview;
  organizationReviewSave.disabled = !canManageReview;

  organizationReviewRating.value = String(organizationReview?.rating || 5);
  organizationReviewText.value = organizationReview?.review_text || "";
  organizationReviewSave.textContent = organizationReview?.id ? "Update review" : "Save review";
  const dateLabel = formatBillingDate(organizationReview?.updated_at || organizationReview?.created_at);
  organizationReviewMeta.textContent = organizationReview?.id
    ? `Published${dateLabel ? ` · Updated ${dateLabel}` : ""}`
    : "No review yet";
}

async function loadOrganizationReview() {
  const organization = getActiveOrganization();
  organizationReview = null;
  if (!organization?.id) {
    renderOrganizationReviewForm();
    return;
  }

  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, review_text, reviewer_name_snapshot, organization_name_snapshot, status, created_at, updated_at")
    .eq("app", "records")
    .eq("review_target_type", "organization")
    .eq("review_target_id", organization.id)
    .maybeSingle();

  if (error) {
    if (isMissingReviewsSchemaError(error)) {
      setStatus(organizationReviewStatus, "Run the reviews schema before saving library reviews.", "error");
      renderOrganizationReviewForm();
      return;
    }
    setStatus(organizationReviewStatus, error.message, "error");
    renderOrganizationReviewForm();
    return;
  }

  organizationReview = data || null;
  renderOrganizationReviewForm();
  setStatus(organizationReviewStatus, "");
}

async function loadActiveOrganizationLogo() {
  const organization = getActiveOrganization();
  if (!organization?.id) {
    renderLibraryLogo();
    return;
  }

  let path = organization.logo_storage_path || "";
  if (typeof organization.logo_storage_path === "undefined") {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, logo_storage_path")
      .eq("id", organization.id)
      .maybeSingle();

    if (error) {
      renderLibraryLogo();
      return;
    }

    if (data) {
      mergeActiveOrganizationUpdate(data);
      path = data.logo_storage_path || "";
    }
  }

  if (!path) {
    renderLibraryLogo();
    return;
  }

  if (organizationLogoUrls.has(path)) {
    renderLibraryLogo();
    return;
  }

  const { data, error } = await supabase
    .storage
    .from(ORGANIZATION_ASSETS_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    setStatus(libraryLogoStatus, error?.message || "Unable to load library logo.", "error");
    renderLibraryLogo();
    return;
  }

  organizationLogoUrls.set(path, data.signedUrl);
  renderLibraryLogo();
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
    embedPreviewUrlInput.value = "";
    embedCodeInput.value = "";
    openEmbedPreview.href = "/n3xra-records/embed.html";
    setEmbedModalOpen(false);
    return;
  }

  const embedUrl = getEmbedUrl();
  const publicUrl = getPublicLibraryUrl();
  embedPreviewUrlInput.value = publicUrl;
  embedCodeInput.value = `<iframe src="${embedUrl}" title="n3xra.com Embedded View" width="100%" height="820" style="border:0;border-radius:24px;"></iframe>`;
  openEmbedPreview.href = publicUrl;
}

function renderBillingPlans() {
  const organization = getActiveOrganization();
  if (!organization) return;
  const capabilities = getActiveCapabilities();

  const activePlanId = organization.subscription_tier || "free";
  const activeBillingCycle = activePlanId === "free"
    ? selectedBillingCycle
    : (organization.billing_cycle === "yearly" ? "yearly" : "monthly");
  const activePlan = getPlanConfig(activePlanId);
  const currentPeriodEndLabel = formatBillingDate(organization.subscription_current_period_end);
  const accountStatus = organization.account_status || "active";
  const cancelsAtPeriodEnd = Boolean(organization.cancel_at_period_end);
  const statusLabel = titleCase(accountStatus);
  const isPaidPlan = activePlanId !== "free";
  const periodLabel = cancelsAtPeriodEnd || accountStatus === "canceled" ? "Ends" : "Renews";
  const usage = recordsUsageSummary?.organizationId === organization.id ? recordsUsageSummary : null;
  const documentMetric = getUsageMetric(usage, "documents", documentsCache.length, organization.document_limit);
  const userMetric = getUsageMetric(usage, "users", memberCache.length || 1, organization.user_limit);
  const storageMetric = getUsageMetric(usage, "storage", 0, Number(organization.storage_limit_mb || 0) * 1024 * 1024);
  const aiMetric = getUsageMetric(usage, "aiRequests", recordsAiUsageSummary?.requestCount || 0, activePlan.aiMonthlyRequestLimit);
  const sourceDocuments = usage?.used?.sourceDocuments ?? documentsCache.length;
  const appDocuments = usage?.used?.appDocuments ?? 0;
  const recordings = usage?.used?.recordings ?? 0;
  const hasCurrentAiUsage = Boolean(usage) || recordsAiUsageSummary?.organizationId === organization.id;
  const aiUsageLabel = hasCurrentAiUsage
    ? `${formatWholeNumber(aiMetric.used)}/${formatWholeNumber(aiMetric.limit)} AI requests this month`
    : `${formatWholeNumber(activePlan.aiMonthlyRequestLimit)} AI requests/month`;
  const billingNote = cancelsAtPeriodEnd
    ? (currentPeriodEndLabel
        ? `Cancellation scheduled. Access remains active until ${currentPeriodEndLabel}.`
        : "Cancellation scheduled. Access remains active until the current billing period ends.")
    : (isPaidPlan && currentPeriodEndLabel
        ? `${periodLabel} ${currentPeriodEndLabel}.`
        : "");

  currentPlanName.textContent = activePlan.name;
  currentPlanCopy.textContent = [
    usage ? "Usage is tracked across files, app documents, meeting recordings, users, and Records AI." : "Usage tracking loads with your library.",
    isPaidPlan ? `${titleCase(activeBillingCycle)} billing` : "",
    isPaidPlan ? `Status: ${statusLabel}` : "",
    cancelsAtPeriodEnd ? "Cancels at end of billing cycle" : "",
    isPaidPlan && currentPeriodEndLabel ? `${periodLabel} ${currentPeriodEndLabel}` : "",
  ].filter(Boolean).join(" · ");
  currentPlanUsage.innerHTML = [
    renderUsageItem({
      label: "Files",
      value: `${formatWholeNumber(documentMetric.used)}/${formatWholeNumber(documentMetric.limit)}`,
      detail: `${formatWholeNumber(documentMetric.remaining)} remaining${appDocuments ? ` · ${formatWholeNumber(appDocuments)} app docs` : ""}`,
      percent: documentMetric.percent,
      over: documentMetric.over,
    }),
    renderUsageItem({
      label: "Storage",
      value: `${formatStorageBytes(storageMetric.used)}/${formatStorageBytes(storageMetric.limit)}`,
      detail: `${formatStorageBytes(storageMetric.remaining)} remaining · ${formatStorageBytes(usage?.used?.recordingStorageBytes || 0)} recordings`,
      percent: storageMetric.percent,
      over: storageMetric.over,
      actionHref: "/n3xra-records/storage.html",
      actionLabel: "View in Storage",
    }),
    renderUsageItem({
      label: "Users",
      value: `${formatWholeNumber(userMetric.used)}/${formatWholeNumber(userMetric.limit)}`,
      detail: `${formatWholeNumber(userMetric.remaining)} seats remaining`,
      percent: userMetric.percent,
      over: userMetric.over,
    }),
    renderUsageItem({
      label: "AI",
      value: hasCurrentAiUsage
        ? `${formatWholeNumber(aiMetric.used)}/${formatWholeNumber(aiMetric.limit)}`
        : aiUsageLabel,
      detail: hasCurrentAiUsage ? `${formatWholeNumber(aiMetric.remaining)} requests remaining this month` : "Monthly usage loads from the server",
      percent: aiMetric.percent,
      over: aiMetric.over,
    }),
    renderUsageItem({
      label: "Meetings",
      value: formatWholeNumber(recordings),
      detail: `${formatWholeNumber(sourceDocuments)} uploaded source file${sourceDocuments === 1 ? "" : "s"}`,
      percent: 0,
      over: false,
    }),
  ].join("");
  if (currentPlanNote) {
    currentPlanNote.textContent = billingNote;
    show(currentPlanNote, Boolean(billingNote));
  }
  show(manageBillingButton, isBillingEnabled() && Boolean(organization.stripe_customer_id || organization.stripe_subscription_id));
  updateEmbedAccess();

  billingPlanGrid.innerHTML = PLAN_ORDER.map((planId) => {
    const plan = getPlanConfig(planId, selectedBillingCycle);
    const isCurrent = planId === activePlanId && (planId === "free" || selectedBillingCycle === activeBillingCycle);
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
            ${plan.priceNote ? `<p class="plan-price-note">${escapeHtml(plan.priceNote)}</p>` : ""}
          </div>
          ${badge}
        </div>
        <p class="plan-summary">${plan.summary}</p>
        <p class="plan-limit">${formatWholeNumber(plan.documentLimit)} documents · ${formatWholeNumber(plan.userLimit)} users · ${formatStorageLimit(plan.storageLimitMb)} · ${formatWholeNumber(plan.aiMonthlyRequestLimit)} AI requests</p>
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
  const isOrganizationPlan = (organization?.subscription_tier || "free") === "organization";
  const capabilities = getActiveCapabilities();
  const canSeeBilling = capabilities.canManageBilling;
  const canSeeLibraryProfileSettings = hasLibraryAccess && capabilities.canManageLibrarySettings;
  const canSeeLibrarySettings = !isFreePlan && capabilities.canManageLibrarySettings;
  const canSeeInviteManagement = isOrganizationPlan && capabilities.canManageInvites;
  const canSeeMemberManagement = isOrganizationPlan && capabilities.canManageMembers;
  const canSeeContactsSettings = capabilities.canManageMembers;
  const canManageContacts = capabilities.canManageMembers;
  const canSeeEmbedSettings = hasLibraryAccess && isOrganizationPlan && canSeeLibrarySettings;
  const canSeeAccessSettings = hasLibraryAccess;
  const canSeePublishingSettings = canSeeEmbedSettings;
  const supportMode = isSupportView();
  const canSeeVoiceProfiles = hasLibraryAccess && !supportMode;
  const canSeeBillingSettings = hasLibraryAccess && (canSeeBilling || supportMode);
  const canSeeReviewSettings = hasLibraryAccess && capabilities.canManageLibrarySettings;
  const canSeeTemplateSettings = hasLibraryAccess && capabilities.canManageTemplates;
  const canSeeLibraryAdminTab = canSeeLibraryProfileSettings || canSeePublishingSettings || canSeeReviewSettings || supportMode;
  const canSeePhoneMeetings = hasLibraryAccess && (capabilities.canManageLibrarySettings || supportMode);
  const canSeeAiAdminTab = hasLibraryAccess && canSeeLibrarySettings;
  const canCreateAdditionalLibrary = canCreateOwnedLibrary();
  const canSeePlanMeta = capabilities.canManageBilling || capabilities.canManageLibrarySettings || supportMode;
  const canEditLibraryNameFromProfile = capabilities.canManageLibrarySettings;
  const canDeleteAccountNow = canDeleteOwnAccount();

  accountName.textContent = currentProfile?.full_name || currentSession?.user?.email || "-";
  accountEmail.textContent = currentSession?.user?.email || currentProfile?.email || "-";
  accountTier.textContent = organization ? formatPlanName(organization.subscription_tier || "free") : "-";
  accountStatus.textContent = organization
    ? (organization.cancel_at_period_end
        ? "Cancels at end of billing cycle"
        : titleCase(organization.account_status || "active"))
    : "-";
  profileFullNameInput.value = currentProfile?.full_name || "";

  organizationNameInput.value = organization?.name || "";
  organizationPrimaryColorInput.value = normalizeHexColor(organization?.branded_primary_color, DEFAULT_PRIMARY_COLOR);
  organizationAccentColorInput.value = normalizeHexColor(organization?.branded_accent_color, DEFAULT_ACCENT_COLOR);
  organizationAiContextInput.value = organization?.records_ai_context || "";
  organizationAiResponseStyleInput.value = organization?.records_ai_response_style || "";
  organizationDefaultMinutesStyleInput.value = ["brief", "standard", "detailed"].includes(organization?.records_default_minutes_style)
    ? organization.records_default_minutes_style
    : "standard";
  if (organizationSpeakerDetectionEnabledInput) {
    organizationSpeakerDetectionEnabledInput.checked = organization?.records_speaker_detection_enabled !== false;
  }
  organizationAiMemoryInput.value = organization?.records_ai_memory || "";
  renderLibraryLogo();
  renderAiMemoryBubbles();

  organizationNameInput.disabled = !capabilities.canManageLibrarySettings;
  organizationPrimaryColorInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationAccentColorInput.disabled = !capabilities.canManageLibrarySettings || isFreePlan;
  organizationSettingsSave.disabled = !capabilities.canManageLibrarySettings;
  if (libraryLogoFileInput) libraryLogoFileInput.disabled = !capabilities.canManageLibrarySettings;
  if (libraryLogoUpload) libraryLogoUpload.disabled = !capabilities.canManageLibrarySettings;
  if (libraryLogoRemove) libraryLogoRemove.disabled = !organization?.logo_storage_path || !capabilities.canManageLibrarySettings;
  organizationAiContextInput.disabled = !capabilities.canManageLibrarySettings;
  organizationAiResponseStyleInput.disabled = !capabilities.canManageLibrarySettings;
  organizationDefaultMinutesStyleInput.disabled = !capabilities.canManageLibrarySettings;
  if (organizationSpeakerDetectionEnabledInput) {
    organizationSpeakerDetectionEnabledInput.disabled = !capabilities.canManageLibrarySettings;
  }
  organizationAiMemoryInput.disabled = !capabilities.canManageLibrarySettings;
  organizationAiMemoryNewInput.disabled = !capabilities.canManageLibrarySettings;
  organizationAiMemoryAdd.disabled = !capabilities.canManageLibrarySettings;
  organizationAiSettingsSave.disabled = !capabilities.canManageLibrarySettings;
  contactNameInput.disabled = !canManageContacts;
  contactEmailInput.disabled = !canManageContacts;
  contactNotesInput.disabled = !canManageContacts;
  contactSave.disabled = !canManageContacts;
  contactCancelEdit.disabled = !canManageContacts;
  renderOrganizationReviewForm();
  additionalLibraryNameInput.disabled = !canCreateAdditionalLibrary;
  additionalLibrarySave.disabled = !canCreateAdditionalLibrary;
  additionalLibraryNote.textContent = canCreateAdditionalLibrary
    ? "This creates a separate library with its own plan, users, documents, settings, and billing controls."
    : getCreateOwnedLibraryBlockedMessage();
  if (openUploadModalButton) openUploadModalButton.disabled = !capabilities.canUploadDocuments;
  if (uploadIsPublicInput) uploadIsPublicInput.disabled = !capabilities.canUploadDocuments || !hasEmbeddedAccess();

  show(accountNoLibraryNotice, !hasLibraryAccess);
  const shouldShowProfileSummary = !supportMode
    && (
      !window.matchMedia("(min-width: 981px)").matches
      || getRequestedDesktopAccountView() === "profile"
    );
  show(librarySettingsCard, shouldShowProfileSummary);
  show(accountLibraryContext, hasLibraryAccess);
  show(accountTierItem, canSeePlanMeta);
  show(accountStatusItem, canSeePlanMeta);
  show(libraryNoAccessNotice, !hasLibraryAccess);
  show(libraryContextPanel, hasLibraryAccess);
  show(billingSection, canSeeBillingSettings);
  show(libraryAccessCard, hasLibraryAccess);
  show(libraryActionsGrid, hasLibraryAccess);
  show(librarySearchPanel, hasLibraryAccess);
  show(libraryRecentPanel, hasLibraryAccess);
  show(changePlanButton, capabilities.canManageBilling);
  show(organizationNameField, canEditLibraryNameFromProfile);
  show(organizationPrimaryColorField, !isFreePlan);
  show(organizationAccentColorField, !isFreePlan);
  show(libraryProfileBody, canSeeLibraryProfileSettings || supportMode);
  show(aiSettingsBody, canSeeAiAdminTab);
  show(contactsSettingsBody, canSeeContactsSettings);
  show(accessSettingsBody, canSeeAccessSettings);
  show(publishingSettingsBody, canSeePublishingSettings);
  show(billingSettingsBody, canSeeBillingSettings);
  show(reviewSettingsBody, canSeeReviewSettings);
  show(redeemInviteBody, hasLibraryAccess);
  show(additionalLibraryBody, hasLibraryAccess);
  show(inviteManagementBody, canSeeInviteManagement);
  show(memberManagementBody, canSeeMemberManagement);
  show(embedSettingsBody, canSeeEmbedSettings);
  show(inviteManagementSection, canSeeInviteManagement);
  show(memberManagementSection, canSeeMemberManagement);
  show(uploadActionSlot, capabilities.canUploadDocuments);
  show(mobileMenuMessagesLink, capabilities.canShareDocuments);
  show(mobileMenuRecordingsLink, capabilities.canUseRecordings);
  show(openDeleteAccountModalButton, canDeleteAccountNow);
  show(deleteAccountBlockedNote, !canDeleteAccountNow);
  libraryAccessCopy.textContent = capabilities.canManageLibrarySettings
    ? "Manage users, contacts, templates, support access, library profile, AI, and billing for this library."
    : supportMode
      ? "Review this organization’s safe account settings and support-access history. Private content unlocks only through a temporary grant."
      : "Join shared libraries from invite codes and review available settings.";
  if (libraryPanelCopy) libraryPanelCopy.textContent = supportMode
    ? "Review the organization’s non-confidential library identity and feature configuration. Changes require customer permission."
    : "Control the library name, logo, colors, public records view, and review.";
  if (storagePanelCopy) storagePanelCopy.textContent = supportMode
    ? "Review storage totals and limit health without exposing filenames or customer content."
    : "See what is using Records storage and where cleanup would help most.";
  show(storagePanelNotice, supportMode);
  updateAdminTabs({
    users: canSeeMemberManagement,
    voice: canSeeVoiceProfiles,
    contacts: canSeeContactsSettings,
    templates: canSeeTemplateSettings,
    access: canSeeAccessSettings,
    support: capabilities.canManageLibrarySettings || supportMode,
    library: canSeeLibraryAdminTab,
    phone: canSeePhoneMeetings,
    ai: canSeeAiAdminTab,
    billing: canSeeBillingSettings,
    storage: capabilities.canManageLibrarySettings || supportMode,
    activity: capabilities.canManageLibrarySettings,
  });
  renderAdminTemplates();
  renderPhoneMeetingSettings();
  if (!capabilities.canManageBilling) {
    setBillingPlanPickerOpen(false);
  }

  Array.from(createInviteForm.elements).forEach((field) => {
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLButtonElement) {
      field.disabled = !canSeeInviteManagement;
    }
  });

  renderBillingPlans();
  renderAccountStorageUsage();
  renderOrganizationSelector();
  show(platformAdminLink, isPlatformAdminEmail(currentSession.user.email));

  if (isSupportView()) {
    const scopes = [
      hasSupportScope("documents") ? "documents" : "",
      hasSupportScope("recordings") ? "recordings and transcripts" : "",
      hasSupportScope("downloads") ? "downloads" : "",
      hasSupportScope("changes") ? "changes" : "",
    ].filter(Boolean);
    supportBanner.textContent = scopes.length
      ? `Support view active for ${organization?.name || "this library"}. ${activeSupportGrant?.emergency_access ? "Audited emergency access" : "Customer-granted access"}: ${scopes.join(", ")}.`
      : `Support view active for ${organization?.name || "this library"}. Private customer content is not available without a temporary grant.`;
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

function getDocumentStatusLabel(doc) {
  const status = doc?.status || "uploaded";
  const processingError = String(doc?.processing_error || "").toLowerCase();
  if (status === "failed" && processingError.includes("ocr")) return "Needs OCR";
  return status;
}

function renderDocuments() {
  if (searchMode === "ai") {
    renderAiSearchIdle();
    return;
  }

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
    const effectiveDoc = getEffectiveDocument(doc);
    const haystack = `${effectiveDoc.title || ""} ${doc.original_filename || ""} ${doc.records_ai_note || ""} ${sanitizeExtractedText(getEffectiveDocumentSearchText(doc))}`.toLowerCase();
    return haystack.includes(query);
  });

  show(docEmpty, filtered.length === 0);
  if (filtered.length === 0) {
    docEmpty.textContent = "No documents match your search.";
  }

  filtered.forEach((doc) => {
    const effectiveDoc = getEffectiveDocument(doc);
    const card = document.createElement("article");
    card.className = "doc-card";
    card.innerHTML = `
      <div class="doc-meta">
        <div>
          <p class="doc-title">${escapeHtml(getDocumentDisplayTitle(effectiveDoc))}</p>
          <p class="doc-subtitle">${escapeHtml(buildDocumentMetadata(doc, { includeVisibility: true, includeYearLabel: true, createdAtWithTime: true }))}</p>
        </div>
        <span class="doc-status">${escapeHtml(getDocumentStatusLabel(doc))}</span>
      </div>
      <p class="doc-snippet">${snippetFromText(getEffectiveDocumentSearchText(doc), query)}</p>
      <div class="doc-actions">
        <button class="btn secondary" type="button" data-action="open" data-id="${doc.id}">Open</button>
      </div>
    `;
    docList.append(card);
  });

  renderProfile();
}

function renderAiSearchIdle() {
  docList.innerHTML = "";
  show(docEmpty, true);
  docEmpty.textContent = "Ask AI Search for summaries, tables, plans, drafts, and file-based answers.";
  renderProfile();
}

function renderAiSearchMatches(matches = []) {
  docList.innerHTML = "";
  show(docEmpty, matches.length === 0);
  if (!matches.length) {
    docEmpty.textContent = "AI Search did not suggest a specific file.";
    return;
  }

  const sourceLabel = document.createElement("p");
  sourceLabel.className = "ai-search-sources-label";
  sourceLabel.textContent = "Source files AI Search used";
  docList.append(sourceLabel);

  matches.forEach((doc) => {
    const card = document.createElement("article");
    card.className = "doc-card ai-search-card";
    card.innerHTML = `
      <div class="doc-meta">
        <div>
          <p class="doc-title">${escapeHtml(doc.title || doc.original_filename || "Untitled file")}</p>
          <p class="doc-subtitle">${escapeHtml(buildDocumentMetadata(doc, { includeVisibility: true, includeYearLabel: true, createdAtWithTime: true }))}</p>
        </div>
        <span class="doc-status">${doc.is_public ? "public" : "private"}</span>
      </div>
      <div class="ai-evidence">
        <p class="ai-evidence-label">Highlighted excerpt sent to AI</p>
        <p class="doc-snippet">${highlightedAiEvidenceSnippet(doc.snippet || "")}</p>
      </div>
      <div class="doc-actions">
        <button class="btn secondary" type="button" data-action="open" data-id="${escapeHtml(doc.id)}">Open</button>
      </div>
    `;
    docList.append(card);
  });
}

function setSearchMode(mode) {
  searchMode = mode === "ai" ? "ai" : "keyword";
  const isAiMode = searchMode === "ai";

  searchModeKeywordButton?.classList.toggle("is-active", !isAiMode);
  searchModeAiButton?.classList.toggle("is-active", isAiMode);
  searchModeKeywordButton?.setAttribute("aria-pressed", String(!isAiMode));
  searchModeAiButton?.setAttribute("aria-pressed", String(isAiMode));
  show(aiSearchSubmitButton, isAiMode);
  show(searchYearField, !isAiMode);
  show(searchResetButton, !isAiMode);

  if (searchQueryLabel) {
    searchQueryLabel.textContent = isAiMode ? "Ask AI anything about these files" : "Keyword or phrase";
  }
  if (searchQueryInput) {
    searchQueryInput.placeholder = isAiMode
      ? "Summarize this topic, draft a post, build a table, or answer from records..."
      : "budget, grant, zoning, executive session";
  }
  if (isAiMode && searchYearSelect) {
    searchYearSelect.value = "all";
  }

  if (isAiMode) {
    if (lastAiSearchMatches.length) {
      renderAiSearchMatches(lastAiSearchMatches);
    } else {
      renderAiSearchIdle();
    }
  } else {
    renderDocuments();
  }
}

function handleAiMemorySuggestion(suggestion) {
  const memoryText = normalizeAiMemoryText(suggestion?.text || suggestion);
  if (!memoryText) return;

  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(docsStatus, "AI memory suggestion not saved. Only a library settings manager can update saved AI memory.", "error");
    return;
  }

  pendingAiMemorySuggestion = memoryText;
  if (aiMemorySuggestionInput) aiMemorySuggestionInput.value = memoryText;
  setStatus(aiMemoryStatus, "");
  setAiMemoryModalOpen(true);
}

async function handleAiMemorySave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(aiMemoryStatus, "You do not have permission to update AI memory.", "error");
    return;
  }

  const memoryText = normalizeAiMemoryText(aiMemorySuggestionInput?.value || pendingAiMemorySuggestion);
  if (!memoryText) {
    setStatus(aiMemoryStatus, "Enter memory text before saving.", "error");
    return;
  }

  if (aiMemorySave) aiMemorySave.disabled = true;
  if (aiMemoryDismiss) aiMemoryDismiss.disabled = true;
  setStatus(aiMemoryStatus, "Checking current AI memory...");

  const { data: currentAiSettings, error: loadError } = await supabase
    .from("organizations")
    .select("id, records_ai_memory")
    .eq("id", organization.id)
    .single();

  if (loadError) {
    if (aiMemorySave) aiMemorySave.disabled = false;
    if (aiMemoryDismiss) aiMemoryDismiss.disabled = false;
    setStatus(
      aiMemoryStatus,
      isMissingAiSettingsSchemaError(loadError)
        ? "Run the Records AI settings schema before saving AI memory."
        : loadError.message,
      "error"
    );
    return;
  }

  const currentMemory = currentAiSettings?.records_ai_memory || organization.records_ai_memory || "";
  const nextMemory = appendAiMemory(currentMemory, memoryText);
  if (nextMemory === String(currentMemory || "").trim()) {
    mergeActiveOrganizationUpdate({ id: organization.id, records_ai_memory: currentMemory });
    renderProfile();
    setAiMemoryModalOpen(false);
    setStatus(docsStatus, "That memory already appears to be saved.", "success");
    return;
  }

  setStatus(aiMemoryStatus, "Saving AI memory...");

  const { data, error } = await supabase
    .from("organizations")
    .update({ records_ai_memory: nextMemory })
    .eq("id", organization.id)
    .select("id, records_ai_memory")
    .single();

  if (error) {
    if (aiMemorySave) aiMemorySave.disabled = false;
    if (aiMemoryDismiss) aiMemoryDismiss.disabled = false;
    setStatus(
      aiMemoryStatus,
      isMissingAiSettingsSchemaError(error)
        ? "Run the Records AI settings schema before saving AI memory."
        : error.message,
      "error"
    );
    return;
  }

  mergeActiveOrganizationUpdate(data);
  renderProfile();
  setAiMemoryModalOpen(false);
  setStatus(docsStatus, "Saved to library AI memory.", "success");
}

async function handleAiSearchSubmit() {
  const question = searchQueryInput.value.trim();
  const organization = getActiveOrganization();

  if (!question) {
    setStatus(docsStatus, "Enter a question for AI Search.", "error");
    return;
  }

  if (!organization) {
    setStatus(docsStatus, "Choose an active library first.", "error");
    return;
  }

  aiSearchSubmitButton.disabled = true;
  setStatus(docsStatus, "AI Search is reviewing visible files...");
  setAiSearchAnswer("");
  docList.innerHTML = "";
  show(docEmpty, false);

  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

    const response = await fetch("/api/records-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        question,
        history: libraryAiSearchHistory,
        organizationId: organization.id,
        year: "all",
        context: {
          libraryName: organization.name || "",
          role: formatRoleLabel(getActiveRole()),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "AI Search is unavailable right now.");

    const answer = String(data.answer || "").trim();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const memorySuggestion = data.memorySuggestion?.text ? data.memorySuggestion : null;
    lastAiSearchMatches = matches;
    const shouldShowSources = data.showSources !== false;
    if (data?.usage?.organizationId) {
      updateRecordsUsageWithAiSummary(data.usage);
      renderBillingPlans();
    }
    await recordRecordsActivity({
      actionType: "ai_search_used",
      targetType: "ai_search",
      summary: "Used AI Search.",
      metadata: {
        matchCount: matches.length,
        hasAnswer: Boolean(answer),
        requestCount: data?.usage?.requestCount,
        tokenCount: data?.usage?.tokenCount,
      },
    });
    setAiSearchAnswer(answer);
    if (answer) {
      rememberLibraryAiSearchTurn(question, answer);
    }
    if (shouldShowSources) {
      renderAiSearchMatches(matches);
    } else {
      docList.innerHTML = "";
      show(docEmpty, false);
    }
    setStatus(docsStatus, answer ? "" : "No AI answer returned.", answer ? "" : "error");
    if (memorySuggestion) {
      handleAiMemorySuggestion(memorySuggestion);
    }
  } catch (error) {
    setStatus(docsStatus, getErrorMessage(error, "Unable to run AI Search."), "error");
    renderAiSearchIdle();
  } finally {
    aiSearchSubmitButton.disabled = false;
  }
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
    const editableDoc = getEditableDocumentForSource(doc.id);
    const item = document.createElement("article");
    const effectiveDoc = getEffectiveDocument(doc);
    item.className = "download-item recent-file-item";
    item.innerHTML = `
      <div>
        <p class="download-name">${escapeHtml(getDocumentDisplayTitle(effectiveDoc))}</p>
        <p class="download-meta">${escapeHtml(buildDocumentMetadata(doc, { includeVisibility: true, includeCreatedAt: false }))}</p>
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
    inviteList.innerHTML = '<tr><td colspan="6">No active invitations.</td></tr>';
    return;
  }

  inviteCache.forEach((invite) => {
    const row = document.createElement("tr");
    const recipientName = String(invite.recipient_name || "").trim();
    const recipientEmail = String(invite.recipient_email || "").trim();
    const recipient = recipientEmail
      ? `${recipientName ? `<strong>${escapeHtml(recipientName)}</strong><br>` : ""}<a href="mailto:${escapeHtml(recipientEmail)}">${escapeHtml(recipientEmail)}</a>`
      : '<span class="records-person-status">Shareable code</span>';
    row.innerHTML = `
      <td><code class="inline">${escapeHtml(invite.code)}</code></td>
      <td>${recipient}</td>
      <td>${escapeHtml(formatRoleLabel(invite.role))}</td>
      <td>${invite.redeemed_uses}/${invite.max_uses}</td>
      <td>${invite.expires_at ? escapeHtml(new Date(invite.expires_at).toLocaleString()) : "Never"}</td>
      <td>
        <button class="btn secondary" type="button" data-action="copy-invite-link" data-invite-code="${escapeHtml(invite.code)}">Copy link</button>
        <button class="btn secondary" type="button" data-action="email-invite-link" data-invite-code="${escapeHtml(invite.code)}">Email</button>
        <button class="btn secondary" type="button" data-action="delete-invite" data-invite-id="${invite.id}">Delete</button>
      </td>
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

function renderVoiceProfiles() {
  if (!voiceProfileList) return;
  voiceProfileList.innerHTML = "";
  const enrolledCount = memberCache.filter((member) => voiceProfileStatusMap.get(member.user_id)?.status === "enrolled").length;
  if (voiceProfileCount) voiceProfileCount.textContent = `${enrolledCount} of ${memberCache.length} ready`;

  memberCache.forEach((member) => {
    const isOwner = member.user_id === getActiveOrganization()?.owner_user_id;
    const isSelf = member.user_id === currentSession?.user?.id;
    const effectiveRole = isOwner ? "billing_owner" : getMembershipRole(member);
    const profile = voiceProfileStatusMap.get(member.user_id) || { status: "not_enrolled" };
    const statusLabels = {
      enrolled: "Enrolled",
      processing: "Processing",
      failed: "Needs another recording",
      revoked: "Removed",
      not_enrolled: "Not enrolled",
    };
    let action = '<button class="btn secondary voice-profile-enroll" type="button" disabled>Waiting for member</button>';
    if (isSelf) {
      if (profile.status === "processing") {
        action = '<button class="btn secondary voice-profile-enroll" type="button" disabled>Processing…</button>';
      } else if (profile.status === "enrolled") {
        action = '<button class="btn secondary voice-profile-enroll" type="button" data-action="voice-enroll">Record again</button><button class="btn secondary voice-profile-remove" type="button" data-action="voice-remove">Remove</button>';
      } else {
        action = `<button class="btn secondary voice-profile-enroll" type="button" data-action="voice-enroll">${profile.status === "failed" ? "Try again" : "Set up voice"}</button>`;
      }
    }
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(member.profile?.full_name || "Unknown member")}</strong>
        ${isSelf ? '<span class="voice-profile-you">You</span>' : ""}
      </td>
      <td>${escapeHtml(member.profile?.email || "")}</td>
      <td>${escapeHtml(formatRoleLabel(effectiveRole))}${isOwner ? " (Owner)" : ""}</td>
      <td><span class="voice-profile-status is-${escapeHtml(profile.status)}">${escapeHtml(statusLabels[profile.status] || "Not enrolled")}</span></td>
      <td><div class="voice-profile-actions">${action}</div></td>
    `;
    voiceProfileList.append(row);
  });

  if (!memberCache.length) {
    voiceProfileList.innerHTML = '<tr><td colspan="5">No workspace members found.</td></tr>';
  }
}

function updateVoiceEnrollmentSubmitState() {
  if (!voiceProfileSubmit) return;
  voiceProfileSubmit.disabled = !voiceRecordingBlob
    || voiceRecordingDurationMs < 6000
    || !voiceProfileConsent?.checked;
}

function releaseVoiceMediaStream() {
  if (voiceRecordingTimerId) window.clearInterval(voiceRecordingTimerId);
  voiceRecordingTimerId = null;
  if (voiceMediaStream) voiceMediaStream.getTracks().forEach((track) => track.stop());
  voiceMediaStream = null;
  voiceMediaRecorder = null;
  show(voiceRecordStop, false);
  if (voiceRecordStart) voiceRecordStart.disabled = false;
}

function resetVoiceRecording({ clearStatus = true } = {}) {
  voiceRecordingGeneration += 1;
  if (voiceMediaRecorder?.state === "recording") voiceMediaRecorder.stop();
  releaseVoiceMediaStream();
  voiceRecordingChunks = [];
  voiceRecordingBlob = null;
  voiceRecordingDurationMs = 0;
  voiceRecordingStartedAt = 0;
  if (voiceRecordingObjectUrl) URL.revokeObjectURL(voiceRecordingObjectUrl);
  voiceRecordingObjectUrl = "";
  if (voiceRecordPreview) {
    voiceRecordPreview.removeAttribute("src");
    voiceRecordPreview.load();
  }
  show(voiceRecordPreview, false);
  if (voiceRecordTimer) voiceRecordTimer.textContent = "0:00";
  if (voiceRecordAgain) voiceRecordAgain.disabled = true;
  if (voiceRecordStart) {
    voiceRecordStart.disabled = false;
    voiceRecordStart.textContent = "Start recording";
  }
  if (clearStatus) setStatus(voiceProfileStatus, "");
  updateVoiceEnrollmentSubmitState();
}

function setVoiceEnrollmentOpen(isOpen) {
  show(voiceEnrollmentCard, isOpen);
  if (isOpen) {
    if (voiceEnrollmentName) voiceEnrollmentName.textContent = currentProfile?.full_name || "a N3XRA Records member";
    resetVoiceRecording();
    voiceProfileConsent.checked = false;
    voiceEnrollmentCard?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  resetVoiceRecording();
}

function preferredVoiceRecordingType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus(voiceProfileStatus, "Voice recording is not supported in this browser.", "error");
    return;
  }
  resetVoiceRecording();
  const recordingGeneration = voiceRecordingGeneration;
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (recordingGeneration !== voiceRecordingGeneration) {
      mediaStream.getTracks().forEach((track) => track.stop());
      return;
    }
    voiceMediaStream = mediaStream;
    const mimeType = preferredVoiceRecordingType();
    const mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    voiceMediaRecorder = mediaRecorder;
    voiceRecordingChunks = [];
    const recordingChunks = [];
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      if (recordingGeneration !== voiceRecordingGeneration) return;
      voiceRecordingChunks = recordingChunks;
      voiceRecordingDurationMs = Math.max(0, Date.now() - voiceRecordingStartedAt);
      const recordingType = mediaRecorder.mimeType || mimeType || "audio/webm";
      voiceRecordingBlob = new Blob(recordingChunks, { type: recordingType });
      releaseVoiceMediaStream();
      if (voiceRecordingDurationMs < 6000) {
        setStatus(voiceProfileStatus, "Please record at least 6 seconds and read the complete script.", "error");
      } else {
        voiceRecordingObjectUrl = URL.createObjectURL(voiceRecordingBlob);
        voiceRecordPreview.src = voiceRecordingObjectUrl;
        show(voiceRecordPreview, true);
        setStatus(voiceProfileStatus, "Recording ready. Listen once, then confirm consent to continue.", "success");
      }
      if (voiceRecordAgain) voiceRecordAgain.disabled = false;
      if (voiceRecordStart) voiceRecordStart.textContent = "Record again";
      updateVoiceEnrollmentSubmitState();
    }, { once: true });
    voiceRecordingStartedAt = Date.now();
    mediaRecorder.start(250);
    voiceRecordStart.disabled = true;
    show(voiceRecordStop, true);
    setStatus(voiceProfileStatus, "Recording… read the complete script in your normal voice.");
    voiceRecordingTimerId = window.setInterval(() => {
      const elapsedSeconds = Math.min(20, Math.floor((Date.now() - voiceRecordingStartedAt) / 1000));
      if (voiceRecordTimer) voiceRecordTimer.textContent = `0:${String(elapsedSeconds).padStart(2, "0")}`;
      if (elapsedSeconds >= 20 && mediaRecorder.state === "recording") mediaRecorder.stop();
    }, 250);
  } catch (error) {
    releaseVoiceMediaStream();
    setStatus(voiceProfileStatus, getErrorMessage(error, "Microphone access is required to record your voice profile."), "error");
  }
}

function stopVoiceRecording() {
  if (voiceMediaRecorder?.state === "recording") voiceMediaRecorder.stop();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read the recording.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function waitForVoiceEnrollment() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    await loadVoiceProfiles();
    const current = voiceProfileStatusMap.get(currentSession?.user?.id);
    if (current?.status === "enrolled") return current;
    if (current?.status === "failed") throw new Error(current.error || "Voice-profile creation failed. Please record another sample.");
  }
  return null;
}

async function submitVoiceEnrollment() {
  if (!voiceRecordingBlob || !voiceProfileConsent?.checked || !currentSession?.access_token) return;
  voiceProfileSubmit.disabled = true;
  voiceRecordAgain.disabled = true;
  setStatus(voiceProfileStatus, "Securely creating your voice profile…");
  try {
    const audioBase64 = await blobToBase64(voiceRecordingBlob);
    const response = await fetch("/api/records-voice-profile", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: getActiveOrganization()?.id,
        audioBase64,
        audioType: voiceRecordingBlob.type,
        consent: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to create the voice profile.");
    setStatus(voiceProfileStatus, "Voice sample received. Finishing secure enrollment…");
    const enrolled = await waitForVoiceEnrollment();
    if (enrolled) {
      setStatus(voiceProfileStatus, "Your voice profile is ready.", "success");
      return;
    }
    setStatus(voiceProfileStatus, "Your voice profile is still processing. You can close this panel and check again shortly.");
  } catch (error) {
    setStatus(voiceProfileStatus, getErrorMessage(error, "Unable to create the voice profile."), "error");
  } finally {
    voiceRecordAgain.disabled = false;
    updateVoiceEnrollmentSubmitState();
  }
}

async function removeOwnVoiceProfile() {
  const confirmed = window.confirm("Remove your voice profile? Future meetings will no longer identify you by voice until you enroll again.");
  if (!confirmed || !currentSession?.access_token) return;
  setStatus(voiceDirectoryStatus, "Removing your voice profile…");
  try {
    const response = await fetch("/api/records-voice-profile", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organizationId: getActiveOrganization()?.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to remove the voice profile.");
    setVoiceEnrollmentOpen(false);
    await loadVoiceProfiles();
    setStatus(voiceDirectoryStatus, "Your voice profile was removed.", "success");
  } catch (error) {
    setStatus(voiceDirectoryStatus, getErrorMessage(error, "Unable to remove the voice profile."), "error");
  }
}

function handleVoiceProfileAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "voice-enroll") setVoiceEnrollmentOpen(true);
  if (button.dataset.action === "voice-remove") void removeOwnVoiceProfile();
}

function setContactFormOpen(isOpen, shouldFocus = false) {
  show(contactFormPanel, isOpen);
  if (contactFormToggle) {
    contactFormToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
    contactFormToggle.textContent = isOpen ? "Hide form" : "New contact";
  }
  if (isOpen && shouldFocus) {
    window.setTimeout(() => contactNameInput?.focus(), 0);
  }
}

function resetContactForm({ keepOpen = false, clearStatus = false } = {}) {
  if (!contactForm) return;
  contactForm.reset();
  contactIdInput.value = "";
  contactSave.textContent = "Add contact";
  show(contactCancelEdit, false);
  setContactFormOpen(keepOpen, keepOpen);
  if (clearStatus) setStatus(contactStatus, "");
}

function toggleContactForm() {
  const nextOpen = contactFormPanel?.classList.contains("hidden");
  resetContactForm({ keepOpen: Boolean(nextOpen), clearStatus: true });
}

function renderContacts() {
  if (!contactList) return;
  const capabilities = getActiveCapabilities();
  const canManageContacts = capabilities.canManageMembers;
  const canInviteContacts = capabilities.canManageInvites && (getActiveOrganization()?.subscription_tier || "free") === "organization";
  const membersByEmail = new Map(
    memberCache
      .map((member) => [String(member.profile?.email || "").trim().toLowerCase(), member])
      .filter(([email]) => Boolean(email))
  );
  const memberUserIds = new Set(memberCache.map((member) => String(member.user_id || "")).filter(Boolean));

  contactList.innerHTML = "";
  if (!contactCache.length) {
    contactList.innerHTML = '<tr><td colspan="5">No contacts yet.</td></tr>';
    return;
  }

  contactCache.forEach((contact) => {
    const contactEmail = String(contact.email || "").trim().toLowerCase();
    const isWorkspaceMember = memberUserIds.has(String(contact.linked_user_id || "")) || membersByEmail.has(contactEmail);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(contact.full_name || "Unnamed contact")}</td>
      <td><a href="mailto:${escapeHtml(contact.email || "")}">${escapeHtml(contact.email || "")}</a></td>
      <td><span class="records-person-status${isWorkspaceMember ? " is-member" : ""}">${isWorkspaceMember ? "Workspace member" : "Contact only"}</span></td>
      <td>${escapeHtml(contact.notes || "")}</td>
      <td>
        <button class="btn secondary" type="button" data-contact-action="edit" data-contact-id="${escapeHtml(contact.id)}"${canManageContacts ? "" : " disabled"}>Edit</button>
        <button class="btn secondary" type="button" data-contact-action="invite" data-contact-id="${escapeHtml(contact.id)}"${canInviteContacts && !isWorkspaceMember ? "" : " disabled"}>${isWorkspaceMember ? "Workspace member" : "Invite as user"}</button>
        <button class="btn secondary" type="button" data-contact-action="delete" data-contact-id="${escapeHtml(contact.id)}"${canManageContacts ? "" : " disabled"}>Delete</button>
      </td>
    `;
    contactList.append(row);
  });
}

function renderAdminTemplates() {
  if (!adminTemplateList) return;
  const canManageTemplates = getActiveCapabilities().canManageTemplates;
  adminTemplateList.innerHTML = "";
  show(adminNewTemplateButton, canManageTemplates);
  show(adminTemplateEmpty, appTemplates.length === 0);

  if (!appTemplates.length) {
    return;
  }

  appTemplates.forEach((template) => {
    const item = document.createElement("div");
    item.className = "admin-template-row";
    item.innerHTML = `
      <div>
        <p class="admin-template-title">${escapeHtml(template.title || "Untitled template")}</p>
        <p class="admin-template-meta">${escapeHtml(titleCase(template.status || "draft"))} · ${escapeHtml(new Date(template.updated_at || template.created_at).toLocaleDateString())}</p>
      </div>
      <div class="actions">
        <button class="btn secondary" type="button" data-template-action="edit" data-template-id="${escapeHtml(template.id)}">Edit</button>
        <button class="btn secondary" type="button" data-template-action="delete" data-template-id="${escapeHtml(template.id)}">Delete</button>
      </div>
    `;
    adminTemplateList.append(item);
  });
}

async function handleAdminTemplateAction(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-template-action]") : null;
  if (!button) return;
  const action = button.getAttribute("data-template-action") || "";
  const templateId = button.getAttribute("data-template-id") || "";
  const template = appTemplates.find((item) => item.id === templateId);
  if (!template) return;

  if (action === "edit") {
    window.location.href = `/n3xra-records/documents.html?id=${encodeURIComponent(template.id)}`;
    return;
  }

  if (action !== "delete") return;
  const ok = await confirmAction({
    kicker: "Delete template",
    title: "Remove this reusable template?",
    message: "Existing documents created from this template will stay. Users will no longer be able to create new documents from it.",
    confirmLabel: "Delete",
  });
  if (!ok) return;

  button.disabled = true;
  setStatus(adminTemplateStatus, "Deleting template...");
  const { error } = await supabase
    .from("app_documents")
    .delete()
    .eq("id", template.id)
    .eq("document_kind", "template");

  if (error) {
    button.disabled = false;
    setStatus(adminTemplateStatus, error.message, "error");
    return;
  }

  setStatus(adminTemplateStatus, "Template deleted.", "success");
  await loadAppTemplates();
}

async function loadDocuments() {
  const organization = getActiveOrganization();
  if (!organization) return;

  setStatus(docsStatus, "Loading documents...");
  let { data, error } = await supabase
    .from("documents")
    .select("id, title, original_filename, storage_path, status, processing_error, extracted_text, records_ai_note, year, month, is_public, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (error && isMissingAiNoteSchemaError(error)) {
    const fallback = await supabase
      .from("documents")
      .select("id, title, original_filename, storage_path, status, processing_error, extracted_text, year, month, is_public, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    setStatus(docsStatus, error.message, "error");
    return;
  }

  documentsCache = sortDocumentsNewestToOldest(Array.isArray(data) ? data : []);
  await loadEditableDocumentMap(organization.id);
  updateYearFilterOptions();
  renderDocuments();
  renderRecentFiles();
  setStatus(docsStatus, `${documentsCache.length} document${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function loadEditableDocumentMap(organizationId) {
  editableDocumentsBySourceId = new Map();
  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, source_document_id, plain_text, status, updated_at, created_at")
    .eq("organization_id", organizationId)
    .eq("document_kind", "document")
    .not("source_document_id", "is", null)
    .order("updated_at", { ascending: false });

  if (error) {
    if (!isMissingAppDocumentsSchemaError(error)) setStatus(docsStatus, error.message, "error");
    return;
  }

  (Array.isArray(data) ? data : []).forEach((doc) => {
    if (doc.source_document_id && !editableDocumentsBySourceId.has(doc.source_document_id)) {
      editableDocumentsBySourceId.set(doc.source_document_id, doc);
    }
  });
}

async function loadActiveOrganizationData() {
  if (!hasActiveLibraryAccess()) {
    documentsCache = [];
    editableDocumentsBySourceId = new Map();
    inviteCache = [];
    memberCache = [];
    voiceProfileStatusMap = new Map();
    contactCache = [];
    appTemplates = [];
    recordsAiUsageSummary = null;
    recordsUsageSummary = null;
    organizationReview = null;
    activityCache = [];
    resetLibraryAiSearchHistory();
    updateYearFilterOptions();
    renderDocuments();
    renderRecentFiles();
    renderInvites();
    renderMembers();
    renderVoiceProfiles();
    renderContacts();
    renderAdminTemplates();
    renderActivityLog();
    renderPhoneMeetingSettings();
    renderProfile();
    setStatus(docsStatus, "");
    setStatus(createInviteStatus, "");
    setStatus(memberStatus, "");
    setStatus(adminTemplateStatus, "");
    return;
  }

  await loadActiveSupportGrant();
  renderProfile();
  renderSupportAccess();
  const supportMode = isSupportView();
  const tasks = [loadRecordsAiUsage(), loadActiveOrganizationLogo(), loadPhoneMeetingSettingsForActiveOrganization()];
  if (!supportMode || hasSupportScope("documents")) tasks.push(loadDocuments(), loadAppTemplates());
  if (!supportMode) tasks.push(loadInvites(), loadMembers(), loadContacts(), loadOrganizationAiSettings(), loadOrganizationReview());
  await Promise.all(tasks);
  await loadSupportAudit();
  renderContacts();
  if (activeAdminTab === "activity") {
    await loadActivityLogForActiveOrganization();
  }
}

async function createSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60);
  if (error || !data?.signedUrl) {
    setStatus(docsStatus, error?.message || "Unable to create signed URL.", "error");
    return null;
  }

  await recordSupportEvent("signed_link_created", "document", documentId);

  return { doc, signedUrl: data.signedUrl };
}

async function createDownloadSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;
  if (isSupportView() && !hasSupportScope("downloads")) return null;

  const downloadName = getDownloadFilename(doc);
  const { data, error } = await supabase
    .storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60 * 60, { download: downloadName });
  if (error || !data?.signedUrl) {
    setStatus(docsStatus, error?.message || "Unable to create download URL.", "error");
    return null;
  }

  await recordSupportEvent("signed_link_created", "document", documentId);

  return { doc, signedUrl: data.signedUrl };
}

async function openSourceFilePreview(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const downloadSigned = !isSupportView() || hasSupportScope("downloads")
    ? await createDownloadSignedUrlForDocument(documentId)
    : null;
  const { doc, signedUrl } = signed;
  const editableDoc = getEditableDocumentForSource(documentId);

  activeModalDocumentId = documentId;
  revokeActiveModalObjectUrl();
  openFilePreviewModal(
    {
      modal: fileModal,
      title: fileModalTitle,
      frame: fileModalFrame,
      downloadLink: fileModalDownload,
    },
    {
      doc,
      previewUrl: buildPreviewUrl(doc, signedUrl),
      fallbackUrl: signedUrl,
      downloadUrl: downloadSigned?.signedUrl || signedUrl,
    }
  );
  fileModalDownload.textContent = "Download";
  show(fileModalDownload, !isSupportView() || hasSupportScope("downloads"));
  show(fileModalOpenEditable, Boolean(editableDoc));
  if (editableDoc) {
    fileModalOpenEditable.href = `/n3xra-records/documents.html?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = getActiveCapabilities().canEditDocuments ? "Edit" : "Open";
  }
  show(fileModalOriginal, false);
}

async function openEditableFilePreview(documentId, editableDoc) {
  const sourceDoc = documentsCache.find((item) => item.id === documentId);
  if (!sourceDoc || !editableDoc) return false;

  activeModalDocumentId = documentId;
  setStatus(docsStatus, "Generating PDF preview...");

  try {
    const objectUrl = await createAppDocumentPdfObjectUrl({
      config: getConfig(),
      accessToken: await getFreshAccessToken(),
      documentId: editableDoc.id,
    });
    revokeActiveModalObjectUrl();
    activeModalObjectUrl = objectUrl;
    openFilePreviewModal(
      {
        modal: fileModal,
        title: fileModalTitle,
        frame: fileModalFrame,
        downloadLink: fileModalDownload,
      },
      {
        doc: {
          title: editableDoc.title || sourceDoc.title || sourceDoc.original_filename || "Document",
          original_filename: getAppDocumentPdfFilename(editableDoc),
        },
        previewUrl: objectUrl,
        fallbackUrl: objectUrl,
        downloadUrl: objectUrl,
      }
    );
    fileModalDownload.textContent = "Download PDF";
    show(fileModalOpenEditable, true);
    fileModalOpenEditable.href = `/n3xra-records/documents.html?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = getActiveCapabilities().canEditDocuments ? "Edit" : "Open";
    show(fileModalOriginal, true);
    setStatus(docsStatus, "");
    return true;
  } catch (error) {
    setStatus(docsStatus, error?.message || "Unable to generate document preview.", "error");
    return false;
  }
}

async function openFile(documentId, preferredView = "auto") {
  await recordSupportEvent("content_viewed", "document", documentId);
  const editableDoc = getEditableDocumentForSource(documentId);
  if (editableDoc && preferredView !== "source") {
    const opened = await openEditableFilePreview(documentId, editableDoc);
    if (opened) return;
  }
  await openSourceFilePreview(documentId);
}

function closeFileModal() {
  closeFilePreviewModal({ modal: fileModal, frame: fileModalFrame });
  revokeActiveModalObjectUrl();
  activeModalDocumentId = null;
}

async function handleSignout() {
  await recordSupportEvent("session_ended", "organization", getActiveOrganization()?.id);
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(contextStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("/n3xra-records/login");
}

async function handleProfileSave(event) {
  event.preventDefault();
  setStatus(profileStatus, "Saving profile...");
  const organization = getActiveOrganization();
  const capabilities = getActiveCapabilities();

  const updates = {
    id: currentSession.user.id,
    email: currentSession.user.email || currentProfile?.email || null,
    full_name: profileFullNameInput.value.trim() || null,
  };

  const [{ error: profileError }, organizationResult] = await Promise.all([
    supabase
      .from("profiles")
      .update({
        email: updates.email,
        full_name: updates.full_name,
      })
      .eq("id", currentSession.user.id),
    organization && capabilities.canManageLibrarySettings
      ? supabase
          .from("organizations")
          .update({
            name: organizationNameInput.value.trim() || organization.name,
          })
          .eq("id", organization.id)
          .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, cancel_at_period_end, billing_cycle, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
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

  currentProfile = {
    ...(currentProfile || {}),
    id: updates.id,
    email: updates.email,
    full_name: updates.full_name,
  };
  if (organizationResult?.data) {
    mergeActiveOrganizationUpdate(organizationResult.data);
  }
  renderProfile();
  setStatus(profileStatus, "Profile updated.", "success");
}

async function handleOrganizationAiSettingsSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(organizationAiSettingsStatus, "You do not have permission to change AI settings.", "error");
    return;
  }

  organizationAiSettingsSave.disabled = true;
  setStatus(organizationAiSettingsStatus, "Saving AI settings...");

  const updates = {
    records_ai_context: trimOrNull(organizationAiContextInput.value),
    records_ai_response_style: trimOrNull(organizationAiResponseStyleInput.value),
    records_ai_memory: trimOrNull(organizationAiMemoryInput.value),
    records_default_minutes_style: ["brief", "standard", "detailed"].includes(organizationDefaultMinutesStyleInput.value)
      ? organizationDefaultMinutesStyleInput.value
      : "standard",
    records_speaker_detection_enabled: organizationSpeakerDetectionEnabledInput?.checked !== false,
  };

  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, records_ai_context, records_ai_response_style, records_ai_memory, records_default_minutes_style, records_speaker_detection_enabled")
    .single();

  organizationAiSettingsSave.disabled = false;
  if (error) {
    setStatus(
      organizationAiSettingsStatus,
      isMissingAiSettingsSchemaError(error)
        ? "Run the Records AI settings schema before saving library AI guidance."
        : error.message,
      "error"
    );
    return;
  }

  mergeActiveOrganizationUpdate(data);
  renderProfile();
  setStatus(organizationAiSettingsStatus, "AI settings updated.", "success");
}

async function handleOrganizationReviewSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(organizationReviewStatus, "You do not have permission to update this library review.", "error");
    return;
  }

  const rating = Number.parseInt(organizationReviewRating.value || "5", 10);
  const reviewText = organizationReviewText.value.trim();
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    setStatus(organizationReviewStatus, "Choose a rating from 1 to 5 stars.", "error");
    return;
  }
  if (reviewText.length < 10) {
    setStatus(organizationReviewStatus, "Add a short review before saving.", "error");
    organizationReviewText.focus();
    return;
  }

  organizationReviewSave.disabled = true;
  setStatus(organizationReviewStatus, "Saving review...");

  const payload = {
    app: "records",
    review_target_type: "organization",
    review_target_id: organization.id,
    organization_id: organization.id,
    user_id: currentSession.user.id,
    rating,
    review_text: reviewText,
    reviewer_name_snapshot: currentProfile?.full_name || currentSession.user.email || "N3XRA Records user",
    organization_name_snapshot: organization.name || "N3XRA Records library",
    status: "published",
  };

  const { data, error } = await supabase
    .from("reviews")
    .upsert(payload, { onConflict: "app,review_target_type,review_target_id" })
    .select("id, rating, review_text, reviewer_name_snapshot, organization_name_snapshot, status, created_at, updated_at")
    .single();

  organizationReviewSave.disabled = false;
  if (error) {
    setStatus(
      organizationReviewStatus,
      isMissingReviewsSchemaError(error) ? "Run the reviews schema before saving library reviews." : error.message,
      "error"
    );
    return;
  }

  organizationReview = data;
  renderOrganizationReviewForm();
  setStatus(organizationReviewStatus, "Review saved.", "success");
}

async function handleOrganizationSettingsSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  const isFreePlan = isFreePlanExperience();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(organizationSettingsStatus, "You do not have permission to change library profile settings.", "error");
    return;
  }

  const updates = isFreePlan
    ? {
        name: organizationNameInput.value.trim() || organization.name,
      }
    : {
        name: organizationNameInput.value.trim() || organization.name,
        branded_primary_color: normalizeHexColor(organizationPrimaryColorInput.value, DEFAULT_PRIMARY_COLOR),
        branded_accent_color: normalizeOptionalAccentColor(organizationAccentColorInput.value),
        public_embed_enabled: hasEmbeddedAccess(),
        keyword_search_enabled: true,
        file_preview_cards_enabled: true,
      };

  setStatus(organizationSettingsStatus, "Saving library profile...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, cancel_at_period_end, billing_cycle, branded_primary_color, branded_accent_color, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_current_period_end")
    .single();

  if (error) {
    setStatus(organizationSettingsStatus, error.message, "error");
    return;
  }

  mergeActiveOrganizationUpdate(data);
  renderProfile();
  setStatus(organizationSettingsStatus, "Library profile updated.", "success");
}

function getLibraryLogoValidationError(file) {
  if (!file) return "Choose a transparent PNG logo first.";
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  if (!isPng) return "Use a PNG file for the library logo.";
  if (file.size > MAX_LIBRARY_LOGO_BYTES) return "Library logo must be 2 MB or smaller.";
  return "";
}

async function handleLibraryLogoUpload(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(libraryLogoStatus, "You do not have permission to change the library logo.", "error");
    return;
  }

  const file = libraryLogoFileInput?.files?.[0] || null;
  const validationError = getLibraryLogoValidationError(file);
  if (validationError) {
    setStatus(libraryLogoStatus, validationError, "error");
    return;
  }

  const oldPath = organization.logo_storage_path || "";
  const safeFileName = sanitizeStorageFileName(file.name || "library-logo.png");
  const storagePath = `${organization.id}/logos/${Date.now()}-${safeFileName}`;

  libraryLogoUpload.disabled = true;
  libraryLogoRemove.disabled = true;
  setStatus(libraryLogoStatus, "Uploading library logo...");

  const { error: uploadError } = await supabase.storage.from(ORGANIZATION_ASSETS_BUCKET).upload(storagePath, file, {
    contentType: "image/png",
    upsert: false,
  });

  if (uploadError) {
    libraryLogoUpload.disabled = false;
    renderLibraryLogo();
    setStatus(libraryLogoStatus, uploadError.message, "error");
    return;
  }

  const { data, error: updateError } = await supabase
    .from("organizations")
    .update({ logo_storage_path: storagePath })
    .eq("id", organization.id)
    .select("id, logo_storage_path")
    .single();

  if (updateError) {
    await supabase.storage.from(ORGANIZATION_ASSETS_BUCKET).remove([storagePath]);
    libraryLogoUpload.disabled = false;
    renderLibraryLogo();
    setStatus(libraryLogoStatus, updateError.message, "error");
    return;
  }

  if (oldPath && oldPath !== storagePath) {
    await supabase.storage.from(ORGANIZATION_ASSETS_BUCKET).remove([oldPath]);
    organizationLogoUrls.delete(oldPath);
  }
  libraryLogoFileInput.value = "";
  mergeActiveOrganizationUpdate(data);
  organizationLogoUrls.delete(storagePath);
  await loadActiveOrganizationLogo();
  renderProfile();
  setStatus(libraryLogoStatus, "Library logo updated.", "success");
}

async function handleLibraryLogoRemove() {
  const organization = getActiveOrganization();
  if (!organization?.logo_storage_path) return;
  if (!getActiveCapabilities().canManageLibrarySettings) {
    setStatus(libraryLogoStatus, "You do not have permission to remove the library logo.", "error");
    return;
  }

  const oldPath = organization.logo_storage_path;
  libraryLogoUpload.disabled = true;
  libraryLogoRemove.disabled = true;
  setStatus(libraryLogoStatus, "Removing library logo...");

  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_storage_path: null })
    .eq("id", organization.id)
    .select("id, logo_storage_path")
    .single();

  if (error) {
    renderLibraryLogo();
    setStatus(libraryLogoStatus, error.message, "error");
    return;
  }

  await supabase.storage.from(ORGANIZATION_ASSETS_BUCKET).remove([oldPath]);
  organizationLogoUrls.delete(oldPath);
  mergeActiveOrganizationUpdate(data);
  renderProfile();
  setStatus(libraryLogoStatus, "Library logo removed.", "success");
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
    await recordRecordsActivity({
      actionType: "billing_change",
      targetType: "billing",
      targetLabel: formatPlanName(organization.subscription_tier),
      summary: "Opened billing portal.",
      metadata: {
        currentPlan: organization.subscription_tier,
        requestedPlan: planId,
        billingCycle: selectedBillingCycle,
      },
    });
    await openBillingFlow("create-portal-session", { organizationId: organization.id });
    return;
  }

  setStatus(billingStatus, "Opening Stripe checkout...");
  await recordRecordsActivity({
    actionType: "billing_change",
    targetType: "billing",
    targetLabel: formatPlanName(planId),
    summary: `Started checkout for ${formatPlanName(planId)}.`,
    metadata: {
      currentPlan: organization.subscription_tier,
      requestedPlan: planId,
      billingCycle: selectedBillingCycle,
    },
  });
  await openBillingFlow("create-checkout-session", {
    organizationId: organization.id,
    planId,
    billingCycle: selectedBillingCycle,
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
  await recordRecordsActivity({
    actionType: "invite_redeemed",
    targetType: "invite",
    summary: "Redeemed an invite code.",
    metadata: {
      codePrefix: code.slice(0, 8),
    },
  });
  setStatus(redeemInviteStatus, "Shared library added to your account.", "success");
}

async function handleCreateAdditionalLibrary(event) {
  event.preventDefault();
  if (!canCreateOwnedLibrary()) {
    setStatus(additionalLibraryStatus, getCreateOwnedLibraryBlockedMessage(), "error");
    return;
  }

  const suggestedName = getOwnedMemberships().length === 0 ? "Personal" : "New Library";
  const nextName = additionalLibraryNameInput.value.trim() || suggestedName;

  additionalLibrarySave.disabled = true;
  setStatus(additionalLibraryStatus, "Creating library...");

  const { data, error } = await supabase.rpc("create_owned_organization", {
    input_organization_name: nextName,
  });

  additionalLibrarySave.disabled = false;
  if (error) {
    setStatus(additionalLibraryStatus, error.message, "error");
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
  additionalLibraryNameInput.value = "";
  await loadActiveOrganizationData();
  setStatus(additionalLibraryStatus, `Library "${nextName}" created.`, "success");
}

async function saveInviteRecipientMetadata(inviteId, {
  recipientEmail = "",
  recipientName = "",
  sourceContactId = null,
} = {}) {
  if (!inviteId) return { supported: true, error: null };

  const { error } = await supabase
    .from("organization_invites")
    .update({
      recipient_email: recipientEmail.trim().toLowerCase() || null,
      recipient_name: recipientName.trim() || null,
      source_contact_id: sourceContactId || null,
    })
    .eq("id", inviteId);

  if (error && isMissingRecordsPeopleLinkSchemaError(error)) {
    return { supported: false, error: null };
  }

  return { supported: true, error };
}

async function handleCreateInvite(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  const submitAction = event.submitter?.dataset?.action || "create-only";
  const shouldSendEmail = submitAction === "create-send";
  const recipientEmail = inviteRecipientEmailInput?.value.trim() || "";
  const recipientName = inviteRecipientNameInput?.value.trim() || "";
  const customMessage = inviteCustomMessageInput?.value.trim() || "";

  if (shouldSendEmail && !recipientEmail) {
    setStatus(createInviteStatus, "Enter a recipient email to send this invite.", "error");
    return;
  }

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
  if (invite?.id && recipientEmail) {
    const metadataResult = await saveInviteRecipientMetadata(invite.id, {
      recipientEmail,
      recipientName,
    });
    if (metadataResult.error) {
      await loadInvites();
      setStatus(
        createInviteStatus,
        `Invite code ${invite.code || ""} was created, but the recipient could not be recorded: ${metadataResult.error.message}`,
        "error"
      );
      return;
    }
  }

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
  let emailSent = false;
  if (shouldSendEmail && invite?.code) {
    setStatus(createInviteStatus, "Sending invite email...");
    const inviteLink = buildInviteSignupUrl(invite.code, recipientEmail);
    const { data: sendResult, error: sendError } = await supabase.functions.invoke("send-records-invite", {
      body: {
        organizationId: organization.id,
        inviteCode: invite.code,
        recipientEmail,
        recipientName,
        customMessage,
        inviteLink,
      },
    });
    if (sendError || sendResult?.error) {
      setStatus(
        createInviteStatus,
        getEdgeFunctionErrorMessage(sendError || { message: sendResult?.error }, "Unable to send invite email."),
        "error"
      );
      await loadInvites();
      return;
    }
    emailSent = true;
    if (inviteRecipientEmailInput) inviteRecipientEmailInput.value = "";
    if (inviteRecipientNameInput) inviteRecipientNameInput.value = "";
    if (inviteCustomMessageInput) inviteCustomMessageInput.value = "";
    await recordRecordsActivity({
      actionType: "invite_sent",
      targetType: "invite",
      targetId: invite.id,
      targetLabel: recipientEmail,
      summary: `Sent invite to ${recipientEmail}.`,
      metadata: {
        role: inviteRoleInput.value,
        maxUses,
        expiresAt: expiresAtIso,
      },
    });
  }

  await loadInvites();
  if (invite?.code) {
    const inviteLink = buildInviteSignupUrl(invite.code);
    setStatus(
      createInviteStatus,
      emailSent
        ? `Invite code ${invite.code} created and emailed.`
        : copiedToClipboard
          ? `Invite code ${invite.code} created and copied. Link: ${inviteLink}`
          : `Invite code ${invite.code} created.`,
      "success"
    );
    return;
  }

  setStatus(createInviteStatus, "Invite code created.", "success");
}

async function handleContactSave(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!getActiveCapabilities().canManageMembers) {
    setStatus(contactStatus, "You do not have permission to manage contacts.", "error");
    return;
  }

  const contactId = contactIdInput.value.trim();
  const payload = {
    full_name: contactNameInput.value.trim(),
    email: contactEmailInput.value.trim().toLowerCase(),
    notes: contactNotesInput.value.trim() || null,
  };

  if (!payload.full_name || !payload.email) {
    setStatus(contactStatus, "Name and email are required.", "error");
    return;
  }

  const { data: existingContacts, error: duplicateError } = await supabase
    .from("organization_contacts")
    .select("id, full_name, email")
    .eq("organization_id", organization.id);
  if (duplicateError) {
    setStatus(contactStatus, duplicateError.message, "error");
    return;
  }
  const duplicateContact = (existingContacts || []).find(
    (contact) => contact.id !== contactId
      && String(contact.email || "").trim().toLowerCase() === payload.email
  );
  if (duplicateContact) {
    setStatus(
      contactStatus,
      `${duplicateContact.full_name || "A contact"} already uses this email address.`,
      "error"
    );
    return;
  }

  const matchingMember = memberCache.find(
    (member) => String(member.profile?.email || "").trim().toLowerCase() === payload.email
  );
  payload.linked_user_id = matchingMember?.user_id || null;

  contactSave.disabled = true;
  setStatus(contactStatus, contactId ? "Updating contact..." : "Adding contact...");

  const query = contactId
    ? supabase
        .from("organization_contacts")
        .update(payload)
        .eq("id", contactId)
        .eq("organization_id", organization.id)
    : supabase
        .from("organization_contacts")
        .insert({
          ...payload,
          organization_id: organization.id,
          created_by_user_id: currentSession.user.id,
        });

  const { error } = await query;
  contactSave.disabled = false;
  if (error) {
    setStatus(
      contactStatus,
      error.code === "23505" ? "A contact with this email address already exists." : error.message,
      "error"
    );
    return;
  }

  resetContactForm();
  await loadContacts();
  setStatus(contactStatus, contactId ? "Contact updated." : "Contact added.", "success");
}

async function inviteContactAsUser(contact) {
  const organization = getActiveOrganization();
  if (!organization || !contact) return;
  if (!getActiveCapabilities().canManageInvites) {
    setStatus(contactStatus, "You do not have permission to invite users.", "error");
    return;
  }

  setStatus(contactStatus, `Creating invite for ${contact.email}...`);
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + 7);
  expiresAtDate.setHours(23, 59, 0, 0);

  const { data, error } = await supabase.rpc("create_organization_invite", {
    input_organization_id: organization.id,
    input_role: "viewer",
    input_max_uses: 1,
    input_expires_at: expiresAtDate.toISOString(),
  });

  if (error) {
    setStatus(contactStatus, error.message, "error");
    return;
  }

  const invite = Array.isArray(data) ? data[0] : data;
  if (!invite?.code) {
    setStatus(contactStatus, "Invite code could not be created.", "error");
    return;
  }

  const metadataResult = await saveInviteRecipientMetadata(invite.id, {
    recipientEmail: contact.email,
    recipientName: contact.full_name || "",
    sourceContactId: contact.id,
  });
  if (metadataResult.error) {
    await loadInvites();
    setStatus(
      contactStatus,
      `The invite was created, but it could not be linked to this contact: ${metadataResult.error.message}`,
      "error"
    );
    return;
  }

  try {
    setStatus(contactStatus, `Sending invite to ${contact.email}...`);
    await sendInviteEmailForCode(
      organization,
      invite.code,
      contact.email,
      contact.full_name || "",
      `You have been invited to join ${organization.name || "this library"} on N3XRA Records.`
    );
    await recordRecordsActivity({
      actionType: "invite_sent",
      targetType: "contact",
      targetId: contact.id,
      targetLabel: contact.email,
      summary: `Sent invite to ${contact.email}.`,
      metadata: {
        role: "viewer",
        source: "contact",
      },
    });
    await loadInvites();
    setStatus(
      contactStatus,
      `Invite sent to ${contact.email}. Manage it under Invites & access.`,
      "success"
    );
  } catch (error) {
    await loadInvites();
    setStatus(contactStatus, getErrorMessage(error, "Invite code was created, but the email failed to send."), "error");
  }
}

async function handleContactAction(event) {
  const button = event.target.closest("button[data-contact-action]");
  if (!button) return;
  const contact = contactCache.find((item) => item.id === button.getAttribute("data-contact-id"));
  if (!contact) return;
  const action = button.getAttribute("data-contact-action");

  if (action === "edit") {
    contactIdInput.value = contact.id;
    contactNameInput.value = contact.full_name || "";
    contactEmailInput.value = contact.email || "";
    contactNotesInput.value = contact.notes || "";
    contactSave.textContent = "Save contact";
    show(contactCancelEdit, true);
    setContactFormOpen(true, true);
    return;
  }

  if (action === "invite") {
    await inviteContactAsUser(contact);
    return;
  }

  if (action !== "delete") return;
  if (!(await confirmAction({
    title: "Delete this contact?",
    message: "This removes the contact from saved document recipients. It does not remove any user access.",
    confirmLabel: "Delete",
    kicker: "Contacts",
    danger: true,
  }))) return;

  const organization = getActiveOrganization();
  if (!organization) return;
  button.disabled = true;
  setStatus(contactStatus, "Deleting contact...");
  const { error } = await supabase
    .from("organization_contacts")
    .delete()
    .eq("id", contact.id)
    .eq("organization_id", organization.id);
  button.disabled = false;
  if (error) {
    setStatus(contactStatus, error.message, "error");
    return;
  }
  if (contactIdInput.value === contact.id) resetContactForm();
  await loadContacts();
  setStatus(contactStatus, "Contact deleted.", "success");
}

async function handleInviteAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.getAttribute("data-action");
  const inviteId = button.getAttribute("data-invite-id");
  const inviteCode = button.getAttribute("data-invite-code") || "";
  const organization = getActiveOrganization();
  if (!organization) return;

  if (action === "copy-invite-link") {
    const inviteLink = buildInviteSignupUrl(inviteCode);
    if (!inviteLink) return;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(inviteLink);
        setStatus(createInviteStatus, "Invite link copied.", "success");
        return;
      } catch {
        // fall through and print link
      }
    }
    setStatus(createInviteStatus, inviteLink, "success");
    return;
  }

  if (action === "email-invite-link") {
    if (!inviteCode) return;
    openInviteEmailModal(inviteCode);
    return;
  }

  if (action !== "delete-invite" || !inviteId) return;

  if (!(await confirmAction({
    title: "Delete this invite code?",
    message: "This cannot be undone.",
    confirmLabel: "Delete",
    kicker: "Invite codes",
    danger: true,
  }))) return;

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
    if (!(await confirmAction({
      title: "Remove this member?",
      message: "This removes their access to the library.",
      confirmLabel: "Remove",
      kicker: "Shared access",
      danger: true,
    }))) {
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
    await loadRecordsAiUsage();
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
  await loadRecordsAiUsage();
}

async function createPersonalLibrary() {
  if (!canCreateOwnedLibrary()) {
    setStatus(contextStatus, getCreateOwnedLibraryBlockedMessage(), "error");
    return;
  }

  const suggestedName = getOwnedMemberships().length === 0 ? "Personal" : "New Library";
  const nameInput = await requestTextInput({
    title: "Create library",
    label: "Library name",
    initialValue: suggestedName,
    submitLabel: "Create",
    kicker: "Library setup",
  });
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

async function deleteAccount(scope = "full") {
  const isAppOnly = String(scope) === "app";
  setStatus(deleteAccountStatus, isAppOnly ? "Deleting Records account..." : "Deleting entire account...");
  deleteRecordsSubmit.disabled = true;
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
    deleteRecordsSubmit.disabled = false;
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, "Your session expired. Sign in again and retry.", "error");
    return;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    deleteRecordsSubmit.disabled = false;
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
      body: JSON.stringify(isAppOnly ? { scope: "app", app: "records" } : {}),
    });
  } catch (error) {
    deleteRecordsSubmit.disabled = false;
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
    deleteRecordsSubmit.disabled = false;
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, `${errorMessage} (HTTP ${response.status})`, "error");
    return;
  }

  if (isAppOnly) {
    await supabase.auth.signOut();
    window.location.replace("/n3xra-records/login");
    return;
  }

  await supabase.auth.signOut();
  window.location.replace("/n3xra-records/login");
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

async function copyPublicEmbedUrl() {
  const value = embedPreviewUrlInput.value || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(embedStatus, "Public page link copied.", "success");
  } catch {
    setStatus(embedStatus, "Unable to copy public page link on this device.", "error");
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

  if (recordsUsageSummary?.organizationId !== organization.id) {
    await loadRecordsAiUsage();
  }
  const storageBlockMessage = getStorageUploadBlockMessage(files);
  if (storageBlockMessage) {
    setStatus(uploadStatus, storageBlockMessage, "error");
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
  let needsOcrCount = 0;
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
      const safeFileName = sanitizeStorageFileName(file.name);
      const hasUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
      const uniqueToken = hasUuid ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const storagePath = `${organization.id}/${Date.now()}-${uniqueToken}-${safeFileName}`;

      setStatus(uploadStatus, `${stepLabel} Extracting ${fileLabel(file)}...`);
      let extractedText = "";
      let documentStatus = "ready";
      let processingError = null;
      let uploadTone = "uploaded";
      let uploadMessage = "Saved with extracted text.";
      try {
        extractedText = await extractTextFromFile(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Text extraction failed.";
        if (isPdfFile(file) && isPdfNeedsOcrError(error)) {
          documentStatus = "failed";
          processingError = message;
          uploadTone = "needs-ocr";
          uploadMessage = "Uploaded. OCR is needed before this PDF can be searched or edited.";
          needsOcrCount += 1;
        } else {
          failedFiles.push(`${fileLabel(file)}: ${message}`);
          appendUploadResult(fileLabel(file), "failed", message);
          continue;
        }
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
        status: documentStatus,
        processing_error: processingError,
        extracted_text: extractedText,
      }, currentSession.user.id);

      if (insertError) {
        await supabase.storage.from("documents").remove([storagePath]);
        failedFiles.push(`${fileLabel(file)}: ${insertError.message}`);
        appendUploadResult(fileLabel(file), "failed", insertError.message);
        continue;
      }

      await recordRecordsActivity({
        actionType: "upload",
        targetType: "document",
        targetLabel: title,
        summary: `Uploaded ${fileLabel(file)}.`,
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
          isPublic,
          status: documentStatus,
        },
      });
      successCount += 1;
      appendUploadResult(fileLabel(file), uploadTone, uploadMessage);
    }

    uploadForm.reset();
    if (successCount > 0) {
      await loadDocuments();
      await loadRecordsAiUsage();
    }

    const summaryParts = [`Uploaded ${successCount} of ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}.`];
    if (skippedForLimit > 0) {
      summaryParts.push(`${skippedForLimit} skipped due to plan limit.`);
    }
    if (needsOcrCount > 0) {
      summaryParts.push(`${needsOcrCount} PDF${needsOcrCount === 1 ? "" : "s"} need OCR before search or editing.`);
    }
    if (failedFiles.length > 0) {
      const failurePreview = failedFiles.slice(0, 3).join(" | ");
      const failureTail = failedFiles.length > 3 ? ` | +${failedFiles.length - 3} more failure(s)` : "";
      summaryParts.push(`Failed: ${failurePreview}${failureTail}`);
    }

    setStatus(uploadStatus, summaryParts.join(" "), failedFiles.length > 0 || skippedForLimit > 0 || needsOcrCount > 0 ? "error" : "success");
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

  if (isSupportView() && supportGrantIsActive()) {
    await recordSupportEvent("session_ended", "organization", getActiveOrganization()?.id);
  }

  if (nextOrganizationId !== activeMembership?.organization?.id) {
    resetLibraryAiSearchHistory();
  }
  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);

  const params = new URLSearchParams(window.location.search);
  if (isSupportView()) {
    params.set("support_org", nextOrganizationId);
  } else {
    params.delete("support_org");
  }
  params.delete("section");
  const nextQuery = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);

  activeSupportGrant = null;
  await loadActiveOrganizationData();
}

async function init() {
  show(setupPanel, !hasConfig());
  show(dashboardPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/n3xra-records/login");
    return;
  }

  if (isPlatformAdminEmail(currentSession.user.email) && !getSupportOrganizationId()) {
    window.location.replace("/n3xra-admin/records");
    return;
  }

  try {
    await bootstrapAccess();
    await loadActiveSupportGrant();
    if (isSupportView() && supportGrantIsActive()) {
      await recordSupportEvent("session_started", "organization", getActiveOrganization()?.id);
    }
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
  billingCycleMonthlyButton.addEventListener("click", () => setBillingCycle("monthly"));
  billingCycleYearlyButton.addEventListener("click", () => setBillingCycle("yearly"));
  billingPlanGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-plan-id]");
    if (!button) return;
    await handlePlanChange(button.getAttribute("data-plan-id"));
  });
  profileSettingsToggle.addEventListener("click", () => setProfileSettingsOpen(!profileSettingsModal.classList.contains("is-open")));
  profileSettingsClose.addEventListener("click", () => setProfileSettingsOpen(false));
  profileForm.addEventListener("submit", handleProfileSave);
  recordsHelpToggle?.addEventListener("click", () => setSectionToggleOpen(recordsHelpToggle, recordsHelpBody, recordsHelpBody.classList.contains("hidden")));
  recordsHelpForm?.addEventListener("submit", handleRecordsHelpSubmit);
  supportAccessForm?.addEventListener("submit", handleSupportAccessGrant);
  supportAccessRevokeButton?.addEventListener("click", handleSupportAccessRevoke);
  libraryLogoForm?.addEventListener("submit", handleLibraryLogoUpload);
  libraryLogoRemove?.addEventListener("click", handleLibraryLogoRemove);
  organizationAiSettingsForm?.addEventListener("submit", handleOrganizationAiSettingsSave);
  contactForm?.addEventListener("submit", handleContactSave);
  contactFormToggle?.addEventListener("click", toggleContactForm);
  contactCancelEdit?.addEventListener("click", () => {
    resetContactForm({ clearStatus: true });
  });
  contactList?.addEventListener("click", handleContactAction);
  adminTabs.forEach((tab) => {
    tab.addEventListener("click", () => setAdminTab(tab.getAttribute("data-admin-tab") || ""));
  });
  desktopAccountViewButtons.forEach((button) => {
    button.addEventListener("click", () => setDesktopAccountView(button.getAttribute("data-records-account-view") || ""));
  });
  if (document.body.classList.contains("records-account-page")) {
    desktopManageLibraryToggle?.addEventListener("click", () => {
      const isOpen = desktopManageLibraryToggle.getAttribute("aria-expanded") === "true";
      setManageLibraryOpen(!isOpen);
    });
  }
  openStorageAccountViewButton?.addEventListener("click", () => {
    if (window.matchMedia("(min-width: 981px)").matches) {
      setDesktopAccountView("storage");
      return;
    }
    window.location.href = "/n3xra-records/storage.html";
  });
  activityActionFilter?.addEventListener("change", loadActivityLogForActiveOrganization);
  adminUsersInviteButton?.addEventListener("click", openInviteCodesFromUsers);
  adminNewTemplateButton?.addEventListener("click", () => {
    window.location.href = "/n3xra-records/documents.html?new=template";
  });
  adminTemplateList?.addEventListener("click", handleAdminTemplateAction);
  organizationReviewForm?.addEventListener("submit", handleOrganizationReviewSave);
  organizationAiMemoryAdd?.addEventListener("click", addAiMemoryFromInput);
  organizationAiMemoryNewInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addAiMemoryFromInput();
  });
  organizationAiMemoryList?.addEventListener("click", handleAiMemoryBubbleAction);
  organizationAiMemoryList?.addEventListener("keydown", handleAiMemoryBubbleKeydown);
  organizationSettingsForm.addEventListener("submit", handleOrganizationSettingsSave);
  phoneMeetingSettingsForm?.addEventListener("submit", handlePhoneMeetingSettingsSave);
  additionalLibraryForm?.addEventListener("submit", handleCreateAdditionalLibrary);
  redeemInviteForm.addEventListener("submit", handleRedeemInvite);
  createInviteForm.addEventListener("submit", handleCreateInvite);
  inviteList.addEventListener("click", handleInviteAction);
  memberList.addEventListener("change", handleMemberRoleChange);
  voiceProfileList?.addEventListener("click", handleVoiceProfileAction);
  voiceEnrollmentClose?.addEventListener("click", () => setVoiceEnrollmentOpen(false));
  voiceRecordStart?.addEventListener("click", startVoiceRecording);
  voiceRecordStop?.addEventListener("click", stopVoiceRecording);
  voiceRecordAgain?.addEventListener("click", startVoiceRecording);
  voiceProfileConsent?.addEventListener("change", updateVoiceEnrollmentSubmitState);
  voiceProfileSubmit?.addEventListener("click", submitVoiceEnrollment);
  openDeleteAccountModalButton.addEventListener("click", () => setDeleteAccountModalOpen(true));
  deleteAccountCancel.addEventListener("click", () => setDeleteAccountModalOpen(false));
  deleteRecordsSubmit.addEventListener("click", () => deleteAccount("app"));
  deleteAccountSubmit.addEventListener("click", () => deleteAccount("full"));
  openEmbedCardButton.addEventListener("click", () => setEmbedModalOpen(true));
  embedModalClose.addEventListener("click", () => setEmbedModalOpen(false));
  aiMemoryModalClose?.addEventListener("click", () => setAiMemoryModalOpen(false));
  aiMemoryDismiss?.addEventListener("click", () => setAiMemoryModalOpen(false));
  aiMemoryForm?.addEventListener("submit", handleAiMemorySave);
  copyEmbedPreviewUrlButton.addEventListener("click", copyPublicEmbedUrl);
  copyEmbedCodeButton.addEventListener("click", copyEmbedCode);
  openUploadModalButton?.addEventListener("click", () => {
    resetUploadFeedback();
    setUploadModalOpen(true);
  });
  uploadModalClose?.addEventListener("click", () => {
    setUploadModalOpen(false);
    resetUploadFeedback();
  });
  uploadForm?.addEventListener("submit", uploadDocument);
  uploadFileInput?.addEventListener("change", updateUploadStorageReminder);
  uploadFolderInput?.addEventListener("change", updateUploadStorageReminder);
  uploadModeSingleButton?.addEventListener("click", () => setUploadMode("single"));
  uploadModeBatchButton?.addEventListener("click", () => setUploadMode("batch"));
  searchModeKeywordButton?.addEventListener("click", () => setSearchMode("keyword"));
  searchModeAiButton?.addEventListener("click", () => setSearchMode("ai"));
  aiSearchSubmitButton?.addEventListener("click", handleAiSearchSubmit);
  searchQueryInput.addEventListener("input", () => {
    if (searchMode === "keyword") {
      renderDocuments();
      return;
    }
    setStatus(docsStatus, "");
  });
  searchQueryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && searchMode === "ai") {
      event.preventDefault();
      handleAiSearchSubmit();
    }
  });
  searchYearSelect.addEventListener("change", () => {
    if (searchMode === "keyword") {
      renderDocuments();
      return;
    }
    setStatus(docsStatus, "");
  });
  searchResetButton.addEventListener("click", () => {
    searchQueryInput.value = "";
    searchYearSelect.value = "all";
    setAiSearchAnswer("");
    lastAiSearchMatches = [];
    if (searchMode === "keyword") {
      renderDocuments();
    } else {
      renderAiSearchIdle();
      setStatus(docsStatus, "");
    }
  });
  docList.addEventListener("click", handleDocumentAction);
  recentFilesList.addEventListener("click", handleDocumentAction);
  fileModalClose.addEventListener("click", closeFileModal);
  fileModalDownload?.addEventListener("click", () => {
    if (activeModalDocumentId) void recordSupportEvent("file_downloaded", "document", activeModalDocumentId);
  });
  fileModalOriginal.addEventListener("click", async () => {
    if (!activeModalDocumentId) return;
    await openFile(activeModalDocumentId, "source");
  });
  fileModal.addEventListener("click", (event) => {
    if (event.target === fileModal) closeFileModal();
  });
  aiMemoryModal?.addEventListener("click", (event) => {
    if (event.target === aiMemoryModal) setAiMemoryModalOpen(false);
  });
  inviteEmailForm?.addEventListener("submit", handleInviteEmailSubmit);
  inviteEmailCancel?.addEventListener("click", () => setInviteEmailModalOpen(false));
  inviteEmailModalClose?.addEventListener("click", () => setInviteEmailModalOpen(false));
  inviteEmailModal?.addEventListener("click", (event) => {
    if (event.target === inviteEmailModal) setInviteEmailModalOpen(false);
  });
  appConfirmCancel?.addEventListener("click", () => resolveConfirm(false));
  appConfirmOk?.addEventListener("click", () => resolveConfirm(true));
  appInputForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    resolveTextInput(String(appInputValue?.value || ""));
  });
  appInputCancel?.addEventListener("click", () => resolveTextInput(null));
  appInputClose?.addEventListener("click", () => resolveTextInput(null));
  appInputModal?.addEventListener("click", (event) => {
    if (event.target === appInputModal) resolveTextInput(null);
  });
  appConfirmModal?.addEventListener("click", (event) => {
    if (event.target === appConfirmModal) resolveConfirm(false);
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
    if (event.key === "Escape" && uploadModal.classList.contains("is-open")) {
      setUploadModalOpen(false);
      return;
    }
    if (event.key === "Escape" && aiMemoryModal?.classList.contains("is-open")) {
      setAiMemoryModalOpen(false);
      return;
    }
    if (event.key === "Escape" && inviteEmailModal?.classList.contains("is-open")) {
      setInviteEmailModalOpen(false);
      return;
    }
    if (event.key === "Escape" && appConfirmModal?.classList.contains("is-open")) {
      resolveConfirm(false);
      return;
    }
    if (event.key === "Escape" && appInputModal?.classList.contains("is-open")) {
      resolveTextInput(null);
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

  try {
    await loadActiveOrganizationData();
    showBillingFlashFromUrl();
  } catch (error) {
    setStatus(contextStatus, getErrorMessage(error, "Unable to load account context."), "error");
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      window.location.replace("/n3xra-records/login");
    }
  });
  window.addEventListener("pagehide", () => {
    if (isSupportView() && supportGrantIsActive()) void recordSupportEvent("session_ended", "organization", getActiveOrganization()?.id);
  });
}

setUploadMode("single");
setBillingCycle("monthly");
init();
