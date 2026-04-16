import JSZip from "https://esm.sh/jszip@3.10.1";
import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { PLAN_ORDER, getPlanConfig, formatPlanName } from "./lib/plan-config.js";
import {
  buildMembershipMap,
  canManageBilling,
  canManageLibrary,
  canManageMembers,
  formatRoleLabel,
  isPlatformAdminEmail,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
  titleCase,
} from "./lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const supportBanner = document.getElementById("support-banner");
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
const accountLibraryContext = document.getElementById("account-library-context");
const libraryAccessCard = document.getElementById("library-access-card");
const librarySettingsSection = document.getElementById("library-settings-section");
const organizationPrimaryColorField = document.getElementById("organization-primary-color-field");
const organizationAccentColorField = document.getElementById("organization-accent-color-field");
const organizationAdvancedSettings = document.getElementById("organization-advanced-settings");
const libraryAccessCopy = document.getElementById("library-access-copy");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const sharedLibraryCount = document.getElementById("shared-library-count");
const platformAdminLink = document.getElementById("platform-admin-link");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalFrame = document.getElementById("file-modal-frame");
const fileModalDownload = document.getElementById("file-modal-download");
const fileModalClose = document.getElementById("file-modal-close");
const profileSettingsToggle = document.getElementById("profile-settings-toggle");
const profileSettingsModal = document.getElementById("profile-settings-modal");
const profileSettingsClose = document.getElementById("profile-settings-close");
const openDeleteAccountModalButton = document.getElementById("open-delete-account-modal");
const deleteAccountModal = document.getElementById("delete-account-modal");
const deleteAccountCancel = document.getElementById("delete-account-cancel");
const deleteAccountSubmit = document.getElementById("delete-account-submit");
const deleteAccountStatus = document.getElementById("delete-account-status");
const openEmbedModalButton = document.getElementById("open-embed-modal");
const openEmbedCardButton = document.getElementById("open-embed-card-button");
const embedAccessCard = document.getElementById("embed-access-card");
const embedModal = document.getElementById("embed-modal");
const embedModalClose = document.getElementById("embed-modal-close");
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
const accountTier = document.getElementById("account-tier");
const accountStatus = document.getElementById("account-status");
const currentPlanName = document.getElementById("current-plan-name");
const currentPlanCopy = document.getElementById("current-plan-copy");
const changePlanButton = document.getElementById("change-plan-button");
const billingPlanPicker = document.getElementById("billing-plan-picker");
const billingPlanGrid = document.getElementById("billing-plan-grid");
const profileForm = document.getElementById("profile-form");
const profileFullNameInput = document.getElementById("profile-full-name");
const profileStatus = document.getElementById("profile-status");
const organizationSettingsForm = document.getElementById("organization-settings-form");
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
const uploadTitleInput = document.getElementById("upload-title");
const uploadYearInput = document.getElementById("upload-year");
const uploadMonthInput = document.getElementById("upload-month");
const uploadFileInput = document.getElementById("upload-file");
const uploadIsPublicInput = document.getElementById("upload-is-public");
const docList = document.getElementById("doc-list");
const docEmpty = document.getElementById("doc-empty");

let supabase = null;
let currentSession = null;
let currentProfile = null;
let memberships = [];
let activeMembership = null;
let documentsCache = [];
let inviteCache = [];
let memberCache = [];

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

function setBillingPlanPickerOpen(isOpen) {
  billingPlanPicker.classList.toggle("hidden", !isOpen);
  changePlanButton.setAttribute("aria-expanded", String(isOpen));
  changePlanButton.textContent = isOpen ? "Hide plans" : "Change plan";
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

function getActiveOrganization() {
  return activeMembership?.organization || null;
}

function getActiveRole() {
  return activeMembership?.role || "";
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

function getPlanLimits(planId) {
  const plan = getPlanConfig(planId);
  return {
    document_limit: plan.documentLimit,
    user_limit: plan.userLimit,
    storage_limit_mb: plan.storageLimitMb,
    public_embed_enabled: plan.embedAllowed && organizationPublicEmbedInput.checked,
  };
}

function getEmbedUrl() {
  const organization = getActiveOrganization();
  if (!organization) return "";
  return new URL(`./embed.html?org=${encodeURIComponent(organization.id)}`, window.location.href).href;
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

function sortMemberships(items) {
  const roleOrder = {
    account_owner: 0,
    account_admin: 1,
    editor: 2,
    viewer: 3,
  };

  return [...items].sort((a, b) => {
    const aSupport = a.isSupportView ? 0 : 1;
    const bSupport = b.isSupportView ? 0 : 1;
    if (aSupport !== bSupport) return aSupport - bSupport;
    const aRank = roleOrder[a.role] ?? 99;
    const bRank = roleOrder[b.role] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.organization?.name || "").localeCompare(String(b.organization?.name || ""));
  });
}

async function bootstrapAccess() {
  const supportOrgId = getSupportOrganizationId();
  const { error: bootstrapError } = await supabase.rpc("bootstrap_organization", {
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
      .order("created_at", { ascending: true }),
  ]);

  if (profileError) throw profileError;
  if (membershipError) throw membershipError;

  currentProfile = profileData || null;
  memberships = buildMembershipMap(membershipData || []);

  if (supportOrgId && isPlatformAdminEmail(currentSession.user.email)) {
    const { data: supportOrg, error: supportError } = await supabase
      .from("organizations")
      .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color")
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

  activeMembership = resolveActiveOrganization(memberships, supportOrgId);
  if (!activeMembership) {
    throw new Error("No organization memberships were found for this account.");
  }

  setStoredActiveOrganizationId(activeMembership.organization.id);
}

async function loadInvites() {
  if (!activeMembership) return;
  if (!canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))) {
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
  const currentId = activeMembership?.organization?.id || "";
  activeOrganizationSelect.innerHTML = memberships
    .map((membership) => {
      const selected = membership.organization?.id === currentId ? " selected" : "";
      const supportTag = membership.isSupportView ? " (Support view)" : "";
      return `<option value="${escapeHtml(membership.organization?.id || "")}"${selected}>${escapeHtml(membership.organization?.name || "Untitled library")}${supportTag}</option>`;
    })
    .join("");

  activeMembershipRole.textContent = isSupportView() ? "Master Admin Support View" : formatRoleLabel(getActiveRole());
  const ownLibraries = memberships.filter((item) => item.role === "account_owner").length;
  sharedLibraryCount.textContent = String(Math.max(memberships.length - ownLibraries, 0));
  activeOrganizationSelect.disabled = !hasMultipleLibraries();
}

function updateEmbedAccess() {
  const organization = getActiveOrganization();
  const enabled = hasEmbeddedAccess();
  show(openEmbedModalButton, enabled);
  show(embedAccessCard, enabled);

  if (!enabled || !organization) {
    setEmbedModalOpen(false);
    return;
  }

  const embedUrl = getEmbedUrl();
  embedPreviewUrlInput.value = embedUrl;
  embedCodeInput.value = `<iframe src="${embedUrl}" title="Records Database Embedded View" width="100%" height="820" style="border:0;border-radius:24px;"></iframe>`;
  openEmbedPreview.href = embedUrl;
}

function renderBillingPlans() {
  const organization = getActiveOrganization();
  if (!organization) return;

  const activePlanId = organization.subscription_tier || "free";
  const activePlan = getPlanConfig(activePlanId);
  const remaining = Math.max(getDocumentLimit() - documentsCache.length, 0);

  currentPlanName.textContent = activePlan.name;
  currentPlanCopy.textContent = `${organization.document_limit} documents · ${organization.user_limit} users · ${organization.storage_limit_mb} MB · ${remaining} remaining`;
  updateEmbedAccess();

  billingPlanGrid.innerHTML = PLAN_ORDER.map((planId) => {
    const plan = getPlanConfig(planId);
    const isCurrent = planId === activePlanId;
    const badge = isCurrent ? '<span class="plan-badge">Current</span>' : "";
    const disabled = !canManageBilling(getActiveRole(), isPlatformAdminEmail(currentSession.user.email)) ? " disabled" : "";
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
          <button class="btn secondary" type="button" data-plan-id="${plan.id}"${disabled}>${isCurrent ? "Current plan" : "Switch plan"}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderProfile() {
  const organization = getActiveOrganization();
  const isFreePlan = isFreePlanExperience();
  const showLibrarySwitcher = hasMultipleLibraries();
  const canEditSettings = canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email));
  const canEditLibrary = canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email));
  const canUpload = canManageLibrary(getActiveRole(), isPlatformAdminEmail(currentSession.user.email));

  accountName.textContent = currentProfile?.full_name || currentSession?.user?.email || "-";
  accountEmail.textContent = currentSession?.user?.email || currentProfile?.email || "-";
  accountOrganization.textContent = organization?.name || "-";
  accountRole.textContent = isSupportView() ? "Master Admin Support View" : formatRoleLabel(getActiveRole());
  accountTier.textContent = formatPlanName(organization?.subscription_tier || "free");
  accountStatus.textContent = titleCase(organization?.account_status || "active");
  profileFullNameInput.value = currentProfile?.full_name || "";

  organizationNameInput.value = organization?.name || "";
  organizationPrimaryColorInput.value = organization?.branded_primary_color || "";
  organizationAccentColorInput.value = organization?.branded_accent_color || "";
  organizationPublicEmbedInput.checked = Boolean(organization?.public_embed_enabled);
  organizationKeywordSearchInput.checked = Boolean(organization?.keyword_search_enabled);
  organizationFilePreviewCardsInput.checked = Boolean(organization?.file_preview_cards_enabled);

  organizationNameInput.disabled = !canEditLibrary;
  organizationPrimaryColorInput.disabled = !canEditLibrary || isFreePlan;
  organizationAccentColorInput.disabled = !canEditLibrary || isFreePlan;
  organizationPublicEmbedInput.disabled = !canEditLibrary || !hasEmbeddedAccess() || isFreePlan;
  organizationKeywordSearchInput.disabled = !canEditLibrary || isFreePlan;
  organizationFilePreviewCardsInput.disabled = !canEditLibrary || isFreePlan;
  organizationSettingsSave.disabled = !canEditLibrary;
  openUploadModalButton.disabled = !canUpload;
  uploadIsPublicInput.disabled = !canUpload || !hasEmbeddedAccess();

  show(accountLibraryContext, showLibrarySwitcher);
  show(libraryAccessCard, true);
  show(librarySettingsSection, !isFreePlan);
  show(changePlanButton, canManageBilling(getActiveRole(), isPlatformAdminEmail(currentSession.user.email)));
  show(organizationPrimaryColorField, !isFreePlan);
  show(organizationAccentColorField, !isFreePlan);
  show(organizationAdvancedSettings, !isFreePlan);
  show(inviteManagementSection, !isFreePlan);
  show(memberManagementSection, !isFreePlan);
  libraryAccessCopy.textContent = isFreePlan
    ? "Redeem invite codes for shared libraries."
    : "Redeem invite codes and manage access for this library.";
  if (!canManageBilling(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))) {
    setBillingPlanPickerOpen(false);
  }

  Array.from(createInviteForm.elements).forEach((field) => {
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLButtonElement) {
      field.disabled = !canEditSettings || isFreePlan;
    }
  });

  renderBillingPlans();
  renderOrganizationSelector();
  show(platformAdminLink, isPlatformAdminEmail(currentSession.user.email));

  if (isSupportView()) {
    supportBanner.textContent = `Support view active for ${organization?.name || "this library"}. You are viewing this tenant as Master Admin.`;
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

function renderInvites() {
  inviteList.innerHTML = "";
  if (!inviteCache.length) {
    inviteList.innerHTML = '<tr><td colspan="4">No active invite codes.</td></tr>';
    return;
  }

  inviteCache.forEach((invite) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code class="inline">${escapeHtml(invite.code)}</code></td>
      <td>${escapeHtml(formatRoleLabel(invite.role))}</td>
      <td>${invite.redeemed_uses}/${invite.max_uses}</td>
      <td>${invite.expires_at ? escapeHtml(new Date(invite.expires_at).toLocaleString()) : "Never"}</td>
    `;
    inviteList.append(row);
  });
}

function renderMembers() {
  const canEdit = canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email));
  memberList.innerHTML = "";

  memberCache.forEach((member) => {
    const isOwner = member.user_id === getActiveOrganization()?.owner_user_id;
    const row = document.createElement("tr");
    const options = ["account_owner", "account_admin", "editor", "viewer"]
      .map((role) => `<option value="${role}"${member.role === role ? " selected" : ""}>${escapeHtml(formatRoleLabel(role))}</option>`)
      .join("");
    const action = canEdit
      ? `<select data-membership-id="${member.id}"${isOwner ? " disabled" : ""}>${options}</select>`
      : escapeHtml(formatRoleLabel(member.role));

    row.innerHTML = `
      <td>${escapeHtml(member.profile?.full_name || "Unknown")}</td>
      <td>${escapeHtml(member.profile?.email || "")}</td>
      <td>${escapeHtml(formatRoleLabel(member.role))}${isOwner ? " (Owner)" : ""}</td>
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
  setStatus(docsStatus, `${documentsCache.length} document${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function loadActiveOrganizationData() {
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

async function openFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  fileModalTitle.textContent = doc.title || doc.original_filename || "File preview";
  fileModalFrame.src = buildPreviewUrl(doc, signedUrl);
  fileModalDownload.href = signedUrl;
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
  const { error } = await supabase.auth.signOut();
  if (error) {
    setStatus(contextStatus, error.message, "error");
    return;
  }
  window.location.replace("./login.html");
}

async function handleProfileSave(event) {
  event.preventDefault();
  setStatus(profileStatus, "Saving profile...");
  const organization = getActiveOrganization();

  const updates = {
    full_name: profileFullNameInput.value.trim() || null,
  };

  const [{ error: profileError }, organizationResult] = await Promise.all([
    supabase.from("profiles").update(updates).eq("id", currentSession.user.id),
    organization && canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))
      ? supabase
          .from("organizations")
          .update({
            name: organizationNameInput.value.trim() || organization.name,
          })
          .eq("id", organization.id)
          .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color")
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
  if (!canManageMembers(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))) {
    setStatus(organizationSettingsStatus, "You do not have permission to change library settings.", "error");
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

  setStatus(organizationSettingsStatus, "Saving library settings...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color")
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
  setStatus(organizationSettingsStatus, "Library settings updated.", "success");
}

async function handlePlanChange(planId) {
  const organization = getActiveOrganization();
  if (!organization) return;
  if (!canManageBilling(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))) {
    setStatus(contextStatus, "Only the account owner or Master Admin can change plan tiers.", "error");
    return;
  }

  const limits = getPlanLimits(planId);
  const updates = {
    subscription_tier: planId,
    document_limit: limits.document_limit,
    user_limit: limits.user_limit,
    storage_limit_mb: limits.storage_limit_mb,
    public_embed_enabled: limits.public_embed_enabled,
  };

  setStatus(contextStatus, "Updating plan...");
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", organization.id)
    .select("id, name, slug, owner_user_id, subscription_tier, account_status, document_limit, storage_limit_mb, user_limit, public_embed_enabled, public_embed_token, transcript_preview_enabled, keyword_search_enabled, file_preview_cards_enabled, hosted_public_portal_enabled, branded_primary_color, branded_accent_color")
    .single();

  if (error) {
    setStatus(contextStatus, error.message, "error");
    return;
  }

  activeMembership.organization = data;
  memberships = memberships.map((membership) =>
    membership.organization?.id === data.id ? { ...membership, organization: data } : membership
  );
  renderProfile();
  setStatus(contextStatus, "Plan updated.", "success");
}

async function handleRedeemInvite(event) {
  event.preventDefault();
  const code = redeemInviteCodeInput.value.trim();
  if (!code) {
    setStatus(redeemInviteStatus, "Enter an invite code first.", "error");
    return;
  }

  setStatus(redeemInviteStatus, "Redeeming invite code...");
  const { error } = await supabase.rpc("redeem_invite_code", { input_code: code });
  if (error) {
    setStatus(redeemInviteStatus, error.message, "error");
    return;
  }

  redeemInviteCodeInput.value = "";
  await bootstrapAccess();
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
  const { data, error } = await supabase.rpc("create_organization_invite", {
    input_organization_id: organization.id,
    input_role: inviteRoleInput.value,
    input_max_uses: maxUses,
    input_expires_at: expiresAtValue || null,
  });

  if (error) {
    setStatus(createInviteStatus, error.message, "error");
    return;
  }

  const invite = Array.isArray(data) ? data[0] : data;
  if (invite?.code && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(invite.code);
  }

  inviteMaxUsesInput.value = "1";
  inviteExpiresAtInput.value = "";
  setStatus(createInviteStatus, invite?.code ? `Invite code ${invite.code} created and copied.` : "Invite code created.", "success");
  await loadInvites();
}

async function handleMemberRoleChange(event) {
  const select = event.target.closest("select[data-membership-id]");
  if (!select) return;

  const membershipId = select.getAttribute("data-membership-id");
  if (!membershipId) return;

  const nextRole = select.value;
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

async function deleteAccount() {
  setStatus(deleteAccountStatus, "Deleting account...");
  deleteAccountSubmit.disabled = true;
  deleteAccountCancel.disabled = true;

  const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
  if (error || data?.error) {
    deleteAccountSubmit.disabled = false;
    deleteAccountCancel.disabled = false;
    setStatus(deleteAccountStatus, error?.message || data?.error || "Unable to delete account.", "error");
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

  if (!canManageLibrary(getActiveRole(), isPlatformAdminEmail(currentSession.user.email))) {
    setStatus(uploadStatus, "You do not have permission to upload into this library.", "error");
    return;
  }

  if (documentsCache.length >= getDocumentLimit()) {
    setStatus(uploadStatus, `This ${formatPlanName(organization.subscription_tier)} plan is limited to ${getDocumentLimit()} documents.`, "error");
    return;
  }

  const file = uploadFileInput.files?.[0];
  if (!file) {
    setStatus(uploadStatus, "Choose a file before uploading.", "error");
    return;
  }

  const storagePath = `${organization.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const title = uploadTitleInput.value.trim() || file.name.replace(/\.[^.]+$/, "");

  setStatus(uploadStatus, "Extracting text in browser...");
  let extractedText = "";
  try {
    extractedText = await extractTextFromFile(file);
  } catch (error) {
    setStatus(uploadStatus, error instanceof Error ? error.message : "Text extraction failed.", "error");
    return;
  }

  setStatus(uploadStatus, "Uploading file...");
  const { error: storageError } = await supabase.storage.from("documents").upload(storagePath, file, { upsert: false });
  if (storageError) {
    setStatus(uploadStatus, storageError.message, "error");
    return;
  }

  const { error: insertError } = await supabase.from("documents").insert({
    organization_id: organization.id,
    uploaded_by_user_id: currentSession.user.id,
    title,
    original_filename: file.name,
    storage_path: storagePath,
    mime_type: file.type || null,
    file_size: file.size,
    year: uploadYearInput.value.trim() || null,
    month: uploadMonthInput.value.trim() || null,
    is_public: uploadIsPublicInput.checked,
    status: "ready",
    processing_error: null,
    extracted_text: extractedText,
  });

  if (insertError) {
    setStatus(uploadStatus, insertError.message, "error");
    return;
  }

  uploadForm.reset();
  setStatus(uploadStatus, "Document uploaded.", "success");
  await loadDocuments();
}

async function handleDocumentAction(event) {
  const button = event.target.closest("button[data-action='open']");
  if (!button) return;
  const id = button.getAttribute("data-id");
  if (!id) return;
  await openFile(id);
}

async function handleOrganizationChange() {
  const nextOrganizationId = activeOrganizationSelect.value;
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
    setStatus(contextStatus, error instanceof Error ? error.message : "Unable to load account context.", "error");
    return;
  }

  show(setupPanel, false);
  show(dashboardPanel, true);
  showSection(getInitialSection());
  await loadActiveOrganizationData();

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => showSection("account"));
  mobileMenuLibrary.addEventListener("click", () => showSection("library"));
  activeOrganizationSelect.addEventListener("change", handleOrganizationChange);
  changePlanButton.addEventListener("click", () => setBillingPlanPickerOpen(billingPlanPicker.classList.contains("hidden")));
  billingPlanGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-plan-id]");
    if (!button) return;
    await handlePlanChange(button.getAttribute("data-plan-id"));
  });
  profileSettingsToggle.addEventListener("click", () => setProfileSettingsOpen(!profileSettingsModal.classList.contains("is-open")));
  profileSettingsClose.addEventListener("click", () => setProfileSettingsOpen(false));
  profileForm.addEventListener("submit", handleProfileSave);
  organizationSettingsForm.addEventListener("submit", handleOrganizationSettingsSave);
  redeemInviteForm.addEventListener("submit", handleRedeemInvite);
  createInviteForm.addEventListener("submit", handleCreateInvite);
  memberList.addEventListener("change", handleMemberRoleChange);
  openDeleteAccountModalButton.addEventListener("click", () => setDeleteAccountModalOpen(true));
  deleteAccountCancel.addEventListener("click", () => setDeleteAccountModalOpen(false));
  deleteAccountSubmit.addEventListener("click", deleteAccount);
  openEmbedModalButton.addEventListener("click", () => setEmbedModalOpen(true));
  openEmbedCardButton.addEventListener("click", () => setEmbedModalOpen(true));
  embedModalClose.addEventListener("click", () => setEmbedModalOpen(false));
  copyEmbedCodeButton.addEventListener("click", copyEmbedCode);
  openUploadModalButton.addEventListener("click", () => setUploadModalOpen(true));
  uploadModalClose.addEventListener("click", () => setUploadModalOpen(false));
  uploadForm.addEventListener("submit", uploadDocument);
  searchQueryInput.addEventListener("input", renderDocuments);
  searchYearSelect.addEventListener("change", renderDocuments);
  searchResetButton.addEventListener("click", () => {
    searchQueryInput.value = "";
    searchYearSelect.value = "all";
    renderDocuments();
  });
  docList.addEventListener("click", handleDocumentAction);
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

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      window.location.replace("./login.html");
    }
  });
}

init();
