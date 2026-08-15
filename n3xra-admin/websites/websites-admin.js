import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=2";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { renderPdfFirstPage } from "/shared/lib/file-preview.js";
import { confirmAdminAction, promptAdminText } from "/account/admin/admin-dialogs.js";
import { openAssetPreview } from "/client-portal/asset-preview-modal.js?v=1";
import { resolveWebsiteRepository, resolveWebsiteUrl } from "/client-portal/website-url.js";
import {
  humanizeWebsiteAssetFilename,
  safeWebsiteAssetFilename as safeFilename,
  uniqueWebsiteAssetKey,
  validateWebsiteAssetRename,
  websiteAssetKeyFromLabel,
} from "/shared/lib/website-asset-utils.js";
import {
  CDN_BROWSER_CACHE_SECONDS,
  canOptimizeCdnImage,
  prepareCdnImage,
} from "/shared/lib/cdn-image-optimizer.js";

const PRIVATE_BUCKET = "website-assets-private";
const PUBLIC_BUCKET = "website-assets-public";
const statusScreen = document.getElementById("portal-status");
const websiteSelect = document.getElementById("admin-website-select");
const summary = document.getElementById("admin-site-summary");
const siteName = document.getElementById("admin-site-name");
const siteStatus = document.getElementById("admin-site-status");
const siteMeta = document.getElementById("admin-site-meta");
const liveLink = document.getElementById("admin-live-link");
const assetToolbar = document.getElementById("admin-asset-toolbar");
const assetGrid = document.getElementById("admin-asset-grid");
const assetFolderList = document.getElementById("admin-asset-folders");
const assetSearch = document.getElementById("admin-asset-search");
const selectedAssetName = document.getElementById("admin-selected-asset-name");
const selectedAssetMeta = document.getElementById("admin-selected-asset-meta");
const selectedAssetActions = document.getElementById("admin-selected-asset-actions");
const emptyState = document.getElementById("admin-empty");
const refreshButton = document.getElementById("refresh-admin");
const approvePendingBatchButton = document.getElementById("approve-pending-batch");
const rejectPendingBatchButton = document.getElementById("reject-pending-batch");
const publishApprovedBatchButton = document.getElementById("publish-approved-batch");
const copyPublishedLinksButton = document.getElementById("copy-published-links");
const optimizePublishedBatchButton = document.getElementById("optimize-published-batch");
const clearAssetSelectionButton = document.getElementById("clear-asset-selection");
const downloadSelectedFilesButton = document.getElementById("download-selected-files");
const deleteSelectedFilesButton = document.getElementById("delete-selected-files");
const batchStatus = document.getElementById("admin-batch-status");
const siteForm = document.getElementById("site-form");
const siteFormStatus = document.getElementById("site-form-status");
const openSiteFormButton = document.getElementById("open-site-form");
const closeSiteFormButton = document.getElementById("close-site-form");
const editSiteButton = document.getElementById("edit-site");
const siteFormKicker = document.getElementById("site-form-kicker");
const siteFormTitle = document.getElementById("site-form-title");
const siteFormSubmit = document.getElementById("site-form-submit");
const siteNameInput = document.getElementById("site-name");
const siteSlugInput = document.getElementById("site-slug");
const siteLiveUrlInput = document.getElementById("site-live-url");
const siteRepositoryInput = document.getElementById("site-repository");
const accessPanel = document.getElementById("access-panel");
const memberForm = document.getElementById("member-form");
const memberEmail = document.getElementById("member-email");
const memberRole = document.getElementById("member-role");
const memberFormStatus = document.getElementById("member-form-status");
const memberList = document.getElementById("member-list");
const adminRequestList = document.getElementById("admin-request-list");
const projectLinkPanel = document.getElementById("project-link-panel");
const projectLinkCopy = document.getElementById("project-link-copy");
const projectLinkState = document.getElementById("project-link-state");
const projectLinkForm = document.getElementById("project-link-form");
const projectLinkStatus = document.getElementById("project-link-status");
const openProjectFormButton = document.getElementById("open-project-form");
const closeProjectFormButton = document.getElementById("close-project-form");
const projectClientAccount = document.getElementById("project-client-account");
const projectNameInput = document.getElementById("project-name");
const projectStatusInput = document.getElementById("project-status");
const projectStartDate = document.getElementById("project-start-date");
const projectLaunchDate = document.getElementById("project-launch-date");
const projectCreateProposal = document.getElementById("project-create-proposal");
const projectProposalTitleWrap = document.getElementById("project-proposal-title-wrap");
const projectProposalTitle = document.getElementById("project-proposal-title");
const projectOpenOnboarding = document.getElementById("project-open-onboarding");
const adminUploadForm = document.getElementById("admin-asset-upload-form");
const openAdminUploadButton = document.getElementById("open-admin-upload");
const closeAdminUploadButton = document.getElementById("close-admin-upload");
const adminUploadFiles = document.getElementById("admin-upload-files");
const adminUploadCategory = document.getElementById("admin-upload-category");
const adminUploadReplacementType = document.getElementById("admin-upload-replacement-type");
const adminUploadNote = document.getElementById("admin-upload-note");
const adminUploadStatus = document.getElementById("admin-upload-status");
const adminUploadSubmit = document.getElementById("admin-upload-submit");

let supabase;
let currentUser;
let websites = [];
let domains = [];
let repositories = [];
let selectedWebsite;
let assets = [];
let versions = [];
let selectedAssetCategory = "";
const selectedVersionIds = new Set();
let members = [];
let serviceRequests = [];
let selectedProject;
let projectProposals = [];
let projectOnboarding;
let toastTimer;
let editingWebsiteId = null;

function showStatus(message) {
  statusScreen.textContent = message;
  statusScreen.hidden = false;
}

function showToast(message, type = "success") {
  let toast = document.getElementById("portal-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "portal-toast";
    toast.className = "portal-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  window.clearTimeout(toastTimer);
  toast.className = `portal-toast is-${type} is-visible`;
  toast.innerHTML = `
    <span class="portal-toast-icon" aria-hidden="true">${type === "error" ? "!" : "✓"}</span>
    <span>${escapeHtml(message)}</span>
    <button type="button" aria-label="Dismiss notification">×</button>
  `;
  toast.querySelector("button")?.addEventListener("click", () => toast.classList.remove("is-visible"), { once: true });
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 5000);
}

function openLogin() {
  window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value = "") {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function assetFileType(version) {
  const extension = String(version?.original_filename || "").split(".").pop()?.toLowerCase() || "";
  const mime = String(version?.mime_type || "").toLowerCase();
  if (mime === "application/pdf" || extension === "pdf") return { label: "PDF", tone: "pdf" };
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg)$/.test(extension)) return { label: "IMG", tone: "image" };
  if (/^(docx?|txt|rtf|md)$/.test(extension)) return { label: "DOC", tone: "document" };
  return { label: (extension || "FILE").slice(0, 4).toUpperCase(), tone: "default" };
}

function assetFilePreviewMarkup(version, type) {
  return `<span class="website-asset-file-type is-${type.tone}" data-version-preview="${version.id}" aria-hidden="true"><img alt="" hidden><canvas hidden></canvas><span>${type.label}</span></span>`;
}

async function hydrateVersionPreviews() {
  const previews = Array.from(assetGrid?.querySelectorAll("[data-version-preview]") || []);
  await Promise.all(previews.map(async (preview) => {
    const version = versions.find((row) => row.id === preview.dataset.versionPreview);
    if (!version) return;
    const type = assetFileType(version);
    if (!['image', 'pdf'].includes(type.tone)) return;
    let url = version.public_url;
    if (!url) {
      const { data, error } = await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 600);
      if (error || !data?.signedUrl) return;
      url = data.signedUrl;
    }
    const image = preview.querySelector("img");
    const canvas = preview.querySelector("canvas");
    const fallback = preview.querySelector(":scope > span");
    if (!url || !preview.isConnected) return;
    if (type.tone === "pdf" && canvas) {
      try {
        await renderPdfFirstPage(url, canvas);
        if (!preview.isConnected) return;
        canvas.hidden = false;
        if (fallback) fallback.hidden = true;
        preview.classList.add("has-preview");
      } catch {
        // Keep the PDF badge when the first page cannot be rendered.
      }
      return;
    }
    if (!image) return;
    image.addEventListener("load", () => {
      if (!preview.isConnected) return;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
      preview.classList.add("has-preview");
    }, { once: true });
    image.src = url;
  }));
}

function assetTableHeader(versionIds = []) {
  const allSelected = versionIds.length > 0 && versionIds.every((id) => selectedVersionIds.has(id));
  return `<div class="website-assets-table-head is-selectable"><label class="website-asset-select"><input type="checkbox" data-select-all-versions${allSelected ? " checked" : ""} aria-label="Select all files in this folder"></label><span>File</span><span>Status</span><span>Modified</span><span>Size</span><span></span></div>`;
}

function assetCategory(asset) {
  return String(asset?.category || "Uncategorized").trim() || "Uncategorized";
}

function folderLabel(value) {
  const normalized = String(value || "Uncategorized").trim().toLowerCase().replaceAll("_", " ");
  const labels = { image: "Images", images: "Images", brand: "Brand assets", document: "Documents", documents: "Documents", video: "Videos", font: "Fonts", other: "Other files", uncategorized: "Uncategorized" };
  return labels[normalized] || normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setSiteFormStatus(message = "", isError = false) {
  if (!siteFormStatus) return;
  siteFormStatus.textContent = message;
  siteFormStatus.classList.toggle("is-error", isError);
}

function setMemberStatus(message = "", isError = false) {
  if (!memberFormStatus) return;
  memberFormStatus.textContent = message;
  memberFormStatus.classList.toggle("is-error", isError);
}

function setProjectStatus(message = "", isError = false) {
  if (!projectLinkStatus) return;
  projectLinkStatus.textContent = message;
  projectLinkStatus.classList.toggle("is-error", isError);
}

function renderWebsiteOptions() {
  websiteSelect.innerHTML = websites.length
    ? websites.map((site) => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join("")
    : '<option value="">No websites</option>';
}

function requestStatusLabel(status) {
  return String(status || "").replaceAll("_", " ");
}

function requestPlanLabel(plan) {
  return plan === "starter_plus" ? "Starter+" : plan === "advanced" ? "Advanced" : plan === "starter" ? "Starter" : "Not specified";
}

function renderServiceRequests() {
  adminRequestList.innerHTML = serviceRequests.map((request) => `
    <article class="portal-request-card portal-request-admin-card">
      <div>
        <p class="portal-kicker">${escapeHtml(requestStatusLabel(request.project_type))}</p>
        <h3>${escapeHtml(request.business_name)}</h3>
        <p><strong>${escapeHtml(request.contact_name)}</strong> · ${escapeHtml(request.contact_email)}</p>
        <p>${escapeHtml(request.primary_goal)}</p>
        <p>${(request.requested_pages || []).map(escapeHtml).join(" · ")}</p>
        <p><strong>Service plan:</strong> ${escapeHtml(requestPlanLabel(request.service_plan))}${request.service_plan_auto_applied ? " · Advanced applied automatically" : ""}</p>
        ${request.service_plan_reason ? `<p><strong>Plan fit:</strong> ${escapeHtml(request.service_plan_reason)}</p>` : ""}
      </div>
      <div class="portal-request-controls">
        <select data-request-status="${request.id}" aria-label="Request status">
          ${["submitted", "reviewing", "needs_info", "qualified", "declined", "converted", "archived"].map((status) =>
            `<option value="${status}"${request.status === status ? " selected" : ""}>${requestStatusLabel(status)}</option>`
          ).join("")}
        </select>
        <textarea rows="3" data-request-notes="${request.id}" placeholder="Private admin notes">${escapeHtml(request.admin_notes || "")}</textarea>
        <a class="portal-button" href="/n3xra-admin/proposals/?request=${encodeURIComponent(request.id)}">${request.proposal_id ? "Open proposal" : "Create proposal"}</a>
        <button class="portal-button portal-button-secondary" type="button" data-save-request="${request.id}">Save review</button>
      </div>
    </article>
  `).join("");
}

async function loadServiceRequests() {
  const { data, error } = await supabase.from("website_service_requests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  serviceRequests = data || [];
  const { data: proposalData, error: proposalError } = await supabase.from("website_proposals").select("id,request_id");
  if (proposalError) throw proposalError;
  const proposalByRequest = new Map((proposalData || []).map((proposal) => [proposal.request_id, proposal.id]));
  serviceRequests = serviceRequests.map((request) => ({ ...request, proposal_id: proposalByRequest.get(request.id) || "" }));
  renderServiceRequests();
}

async function saveServiceRequest(requestId) {
  const status = adminRequestList.querySelector(`[data-request-status="${requestId}"]`)?.value;
  const notes = adminRequestList.querySelector(`[data-request-notes="${requestId}"]`)?.value.trim();
  const { error } = await supabase.from("website_service_requests").update({
    status,
    admin_notes: notes || null,
    reviewed_by_user_id: currentUser.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);
  if (error) throw error;
  showToast("Website request updated.");
  await loadServiceRequests();
}

function renderSelectedWebsite() {
  if (!selectedWebsite) {
    summary.hidden = true;
    if (assetToolbar) assetToolbar.hidden = true;
    if (assetGrid) assetGrid.innerHTML = "";
    if (assetFolderList) assetFolderList.innerHTML = "";
    if (emptyState) emptyState.hidden = false;
    if (accessPanel) accessPanel.hidden = true;
    if (projectLinkPanel) projectLinkPanel.hidden = true;
    if (openAdminUploadButton) openAdminUploadButton.hidden = true;
    return;
  }

  summary.hidden = false;
  if (assetToolbar) assetToolbar.hidden = false;
  const websiteUrl = resolveWebsiteUrl(selectedWebsite, domains);
  const websiteRepository = resolveWebsiteRepository(selectedWebsite, repositories);
  siteName.textContent = selectedWebsite.name;
  siteStatus.textContent = `${selectedWebsite.status || "active"} website`;
  siteMeta.textContent = [websiteUrl, websiteRepository].filter(Boolean).join(" · ") || "No live URL, domain, or repository recorded.";
  liveLink.hidden = !websiteUrl;
  if (websiteUrl) liveLink.href = websiteUrl;
  if (editSiteButton) editSiteButton.hidden = !selectedWebsite;
  if (accessPanel) accessPanel.hidden = false;
  if (projectLinkPanel) projectLinkPanel.hidden = false;
  if (openAdminUploadButton) openAdminUploadButton.hidden = false;
}

function renderMembers() {
  memberList.innerHTML = members.map((member) => `
    <div class="portal-member-row">
      <div>
        <strong>${escapeHtml(member.name || member.email || "N3XRA client")}</strong>
        <p>${escapeHtml(member.email || member.user_id)} · ${escapeHtml(member.status)}</p>
      </div>
      <div class="portal-member-controls">
        <select class="portal-member-role" data-member-role="${member.id}" aria-label="Role for ${escapeHtml(member.email || "client")}">
          ${["owner", "editor", "viewer"].map((role) => `<option value="${role}"${member.role === role ? " selected" : ""}>${role[0].toUpperCase() + role.slice(1)}</option>`).join("")}
        </select>
        ${member.status === "active"
          ? `<button class="portal-button portal-button-secondary" type="button" data-member-status="revoked" data-member-id="${member.id}">Revoke</button>`
          : `<button class="portal-button portal-button-secondary" type="button" data-member-status="active" data-member-id="${member.id}">Restore</button>`}
      </div>
    </div>
  `).join("");
  renderProjectClientOptions();
}

function renderProjectClientOptions() {
  if (!projectClientAccount) return;
  const activeMembers = members.filter((member) => member.status === "active");
  projectClientAccount.innerHTML = activeMembers.length
    ? activeMembers.map((member) => `<option value="${member.user_id}">${escapeHtml(member.name || member.email || "N3XRA client")} · ${escapeHtml(member.role)}</option>`).join("")
    : '<option value="">Assign a client account first</option>';
  projectClientAccount.disabled = !activeMembers.length;
  const owner = activeMembers.find((member) => member.role === "owner");
  if (owner) projectClientAccount.value = owner.user_id;
}

function formatProjectLabel(value = "") {
  return String(value || "").replaceAll("_", " ");
}

function renderProjectLifecycle() {
  if (!projectLinkPanel || !selectedWebsite) return;
  projectLinkPanel.hidden = false;
  renderProjectClientOptions();

  if (!selectedProject) {
    projectLinkCopy.textContent = "Turn this managed website into a client project without recreating its history.";
    openProjectFormButton.hidden = false;
    projectLinkState.hidden = true;
    return;
  }

  projectLinkCopy.textContent = "This website is connected to one client project.";
  openProjectFormButton.hidden = true;
  projectLinkForm.hidden = true;
  projectLinkState.hidden = false;
  const latestProposal = projectProposals[0];
  projectLinkState.innerHTML = `
    <div>
      <p class="portal-kicker">${escapeHtml(formatProjectLabel(selectedProject.status))} project</p>
      <h4>${escapeHtml(selectedProject.name)}</h4>
      <p>${escapeHtml(selectedProject.progress_percent)}% complete · ${escapeHtml(formatProjectLabel(selectedProject.current_stage))}</p>
    </div>
    ${latestProposal ? "" : `
      <form class="portal-project-quick-form" data-project-proposal-form hidden>
        <label>
          Proposal title
          <input type="text" data-project-proposal-title maxlength="160" value="${escapeHtml(`New work for ${selectedWebsite.name}`)}" required>
        </label>
        <button class="portal-button" type="submit">Create draft</button>
        <button class="portal-button portal-button-secondary" type="button" data-cancel-project-proposal>Cancel</button>
      </form>
    `}
    <p class="portal-inline-status" data-project-action-status role="status"></p>
  `;

  if (currentUser) {
    writeWorkspaceContext("admin", currentUser.id, {
      websiteId: selectedWebsite.id,
      projectId: selectedProject.id,
      proposalId: latestProposal?.id || null,
      onboardingId: projectOnboarding?.id || null,
    });
  }
}

async function invokeAdmin(body) {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Website administration request failed.");
  return data;
}

async function invokeProjectAdmin(body) {
  const { data, error } = await supabase.functions.invoke("website-project-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Website project request failed.");
  return data;
}

async function loadMembers() {
  if (!selectedWebsite) {
    members = [];
    renderMembers();
    return;
  }
  const data = await invokeAdmin({ action: "list-website-members", websiteId: selectedWebsite.id });
  members = data.members || [];
  renderMembers();
  await loadProjectLifecycle();
}

async function loadProjectLifecycle() {
  selectedProject = undefined;
  projectProposals = [];
  projectOnboarding = undefined;
  if (!selectedWebsite || !projectLinkPanel) {
    renderProjectLifecycle();
    return;
  }

  const projectResult = await supabase
    .from("website_projects")
    .select("*")
    .eq("managed_website_id", selectedWebsite.id)
    .maybeSingle();
  if (projectResult.error) throw projectResult.error;
  selectedProject = projectResult.data || undefined;

  if (selectedProject) {
    const [proposalResult, onboardingResult] = await Promise.all([
      supabase.from("website_proposals").select("id,request_id,project_id,title,status,created_at").eq("project_id", selectedProject.id).order("created_at", { ascending: false }),
      supabase.from("website_onboardings").select("id,project_id,proposal_id,status").eq("project_id", selectedProject.id).maybeSingle(),
    ]);
    if (proposalResult.error) throw proposalResult.error;
    if (onboardingResult.error) throw onboardingResult.error;
    projectProposals = proposalResult.data || [];
    projectOnboarding = onboardingResult.data || undefined;
  }
  renderProjectLifecycle();
}

function versionActions(version, asset) {
  const actions = [];
  if (version.status === "pending_review") {
    actions.push(`<button data-version-action="approve" data-version-id="${version.id}">Approve</button>`);
    actions.push(`<button data-version-action="reject" data-version-id="${version.id}">Reject</button>`);
  }
  if (version.status === "approved" && String(version.mime_type || "").startsWith("image/")) {
    actions.push(`<button data-version-action="publish" data-version-id="${version.id}">Publish to CDN</button>`);
    if (canOptimizeCdnImage(asset, version)) {
      actions.push(`<button data-version-action="publish-original" data-version-id="${version.id}">Publish full quality</button>`);
    }
  }
  actions.push(`<button data-version-action="rename" data-version-id="${version.id}">Rename file</button>`);
  actions.push(`<button data-version-action="download" data-version-id="${version.id}">Download</button>`);
  if (version.public_url) {
    actions.push(`<button data-version-action="copy" data-version-id="${version.id}">Copy published URL</button>`);
  }
  if (version.public_url && canOptimizeCdnImage(asset, version)) {
    actions.push(`<button data-version-action="optimize" data-version-id="${version.id}">Optimize CDN file</button>`);
    actions.push(`<button data-version-action="restore-original" data-version-id="${version.id}">Use full-quality CDN file</button>`);
  } else if (version.public_url && String(version.mime_type || "").startsWith("image/")) {
    actions.push(`<button data-version-action="refresh-cdn" data-version-id="${version.id}">Refresh CDN cache</button>`);
  }
  actions.push(`<button class="is-danger" data-version-action="delete" data-version-id="${version.id}">Delete</button>`);
  return actions.join("");
}

function renderAssets() {
  renderAssetBatchActions();
  if (!selectedWebsite || !assets.length) {
    assetGrid.innerHTML = "";
    if (assetFolderList) assetFolderList.innerHTML = "";
    selectedAssetCategory = "";
    if (selectedAssetName) selectedAssetName.textContent = "Select a folder";
    if (selectedAssetMeta) selectedAssetMeta.textContent = "Choose a folder from the left.";
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = selectedWebsite
      ? "No assets have been added for this website."
      : "No managed websites are available yet.";
    return;
  }

  const categories = [...new Set(assets.map(assetCategory))].sort((left, right) => left.localeCompare(right));
  if (!categories.includes(selectedAssetCategory)) selectedAssetCategory = categories[0];
  const folderAssets = assets.filter((asset) => assetCategory(asset) === selectedAssetCategory);
  const query = String(assetSearch?.value || "").trim().toLowerCase();
  const visibleAssets = folderAssets.filter((asset) => [asset.label, asset.asset_key, asset.category].some((value) => String(value || "").toLowerCase().includes(query)));
  const folderVersions = versions.filter((version) => folderAssets.some((asset) => asset.id === version.asset_id));
  if (selectedAssetName) selectedAssetName.textContent = folderLabel(selectedAssetCategory);
  if (selectedAssetMeta) selectedAssetMeta.textContent = `${folderAssets.length} file${folderAssets.length === 1 ? "" : "s"} · ${folderVersions.length} version${folderVersions.length === 1 ? "" : "s"}`;
  if (assetFolderList) assetFolderList.innerHTML = categories.map((category) => {
    const categoryAssets = assets.filter((asset) => assetCategory(asset) === category);
    return `<button class="website-asset-folder${category === selectedAssetCategory ? " is-current" : ""}" type="button" data-select-category="${escapeHtml(category)}"><span class="website-asset-folder-icon" aria-hidden="true"></span><span><strong>${escapeHtml(folderLabel(category))}</strong><small>${categoryAssets.length} file${categoryAssets.length === 1 ? "" : "s"}</small></span><span class="website-asset-folder-count">${categoryAssets.length}</span></button>`;
  }).join("");
  emptyState.hidden = true;
  const rows = visibleAssets.flatMap((asset) => {
    const assetVersions = versions.filter((version) => version.asset_id === asset.id);
    if (!assetVersions.length) {
      return [`<article class="website-asset-version is-selectable"><span></span><div class="website-asset-file"><span class="website-asset-file-type" aria-hidden="true">FILE</span><span><strong>${escapeHtml(asset.label)}</strong><small>${escapeHtml(asset.asset_key)} · No versions uploaded</small></span></div><span class="website-asset-status">Empty</span><span class="website-asset-date">—</span><span class="website-asset-size">—</span><details class="website-asset-actions"><summary aria-label="Actions for ${escapeHtml(asset.label)}">•••</summary><div class="website-asset-action-menu"><button class="is-danger" data-delete-empty-asset="${asset.id}" type="button">Delete empty asset</button></div></details></article>`];
    }
    return assetVersions.map((version) => {
      const type = assetFileType(version);
      return `<article class="website-asset-version is-selectable${selectedVersionIds.has(version.id) ? " is-selected" : ""}" data-selectable-version="${version.id}"><label class="website-asset-select"><input type="checkbox" data-select-version="${version.id}"${selectedVersionIds.has(version.id) ? " checked" : ""} aria-label="Select ${escapeHtml(version.original_filename)}"></label><div class="website-asset-file">${assetFilePreviewMarkup(version, type)}<span><strong>${escapeHtml(version.original_filename)}</strong><small>${escapeHtml(asset.label)} · Version ${version.version_number}${version.change_note ? ` · ${escapeHtml(version.change_note)}` : ""}</small></span></div><span class="website-asset-status is-${escapeHtml(version.status)}">${escapeHtml(version.status.replaceAll("_", " "))}</span><time datetime="${escapeHtml(version.created_at)}">${formatDate(version.created_at)}</time><span class="website-asset-size">${formatBytes(version.size_bytes) || "—"}</span><details class="website-asset-actions"><summary aria-label="Actions for ${escapeHtml(version.original_filename)}">•••</summary><div class="website-asset-action-menu">${versionActions(version, asset)}</div></details></article>`;
    });
  });
  const visibleVersionIds = visibleAssets.flatMap((asset) => versions.filter((version) => version.asset_id === asset.id).map((version) => version.id));
  assetGrid.innerHTML = assetTableHeader(visibleVersionIds) + (rows.length ? rows.join("") : '<div class="website-assets-empty"><p>No files match this search.</p></div>');
  void hydrateVersionPreviews();
}

function renderAssetBatchActions() {
  if (!approvePendingBatchButton || !publishApprovedBatchButton || !copyPublishedLinksButton) return;
  const availableIds = new Set(versions.map((version) => version.id));
  [...selectedVersionIds].forEach((id) => { if (!availableIds.has(id)) selectedVersionIds.delete(id); });
  const selectedVersions = versions.filter((version) => selectedVersionIds.has(version.id));
  const pendingCount = selectedVersions.filter((version) => version.status === "pending_review").length;
  const approvedCount = getPublishableApprovedVersions().length;
  const publishedCount = getCurrentPublishedLinks().length;
  const refreshableCount = getRefreshablePublishedVersions().length;
  assetToolbar.hidden = selectedVersions.length === 0;
  clearAssetSelectionButton.hidden = selectedVersions.length === 0;
  downloadSelectedFilesButton.hidden = selectedVersions.length === 0;
  deleteSelectedFilesButton.hidden = selectedVersions.length === 0;
  batchStatus.textContent = `${selectedVersions.length} file${selectedVersions.length === 1 ? "" : "s"} selected`;
  approvePendingBatchButton.hidden = pendingCount === 0;
  approvePendingBatchButton.textContent = `Approve pending (${pendingCount})`;
  rejectPendingBatchButton.hidden = pendingCount === 0;
  rejectPendingBatchButton.textContent = `Reject pending (${pendingCount})`;
  downloadSelectedFilesButton.textContent = `Download selected (${selectedVersions.length})`;
  deleteSelectedFilesButton.textContent = `Delete selected (${selectedVersions.length})`;
  publishApprovedBatchButton.hidden = approvedCount === 0;
  publishApprovedBatchButton.textContent = `Publish approved (${approvedCount})`;
  copyPublishedLinksButton.hidden = publishedCount === 0;
  copyPublishedLinksButton.textContent = `Copy published links (${publishedCount})`;
  if (optimizePublishedBatchButton) {
    optimizePublishedBatchButton.hidden = refreshableCount === 0;
    optimizePublishedBatchButton.textContent = `Refresh CDN files (${refreshableCount})`;
  }
}

function getRefreshablePublishedVersions() {
  return versions.filter((version) => {
    if (!selectedVersionIds.has(version.id) || !version.public_url) return false;
    return String(version.mime_type || "").startsWith("image/");
  });
}

function getCurrentPublishedLinks() {
  return versions.filter((version) => selectedVersionIds.has(version.id) && version.public_url).map((version) => {
    const asset = assets.find((row) => row.id === version.asset_id);
    return { label: `${asset?.label || version.original_filename} · v${version.version_number}`, url: version.public_url };
  });
}

function getPublishableApprovedVersions() {
  const newestByAsset = new Map();
  versions.forEach((version) => {
    if (!selectedVersionIds.has(version.id)) return;
    if (version.status !== "approved" || !String(version.mime_type || "").startsWith("image/")) return;
    const current = newestByAsset.get(version.asset_id);
    if (!current || Number(version.version_number) > Number(current.version_number)) {
      newestByAsset.set(version.asset_id, version);
    }
  });
  return Array.from(newestByAsset.values());
}

function handleAssetSelection(event) {
  const selectAll = event.target.closest("[data-select-all-versions]");
  const selectVersion = event.target.closest("[data-select-version]");
  if (selectAll) {
    assetGrid.querySelectorAll("[data-select-version]").forEach((checkbox) => {
      if (selectAll.checked) selectedVersionIds.add(checkbox.dataset.selectVersion);
      else selectedVersionIds.delete(checkbox.dataset.selectVersion);
    });
    renderAssets();
    return;
  }
  if (!selectVersion) return;
  if (selectVersion.checked) selectedVersionIds.add(selectVersion.dataset.selectVersion);
  else selectedVersionIds.delete(selectVersion.dataset.selectVersion);
  renderAssets();
}

async function loadAssets() {
  if (!selectedWebsite) {
    assets = [];
    versions = [];
    renderSelectedWebsite();
    renderAssets();
    return;
  }

  const assetResult = await supabase.from("website_assets").select("*").eq("website_id", selectedWebsite.id).order("created_at");
  if (assetResult.error) throw assetResult.error;
  const assetIds = (assetResult.data || []).map((asset) => asset.id);
  const versionResult = assetIds.length
    ? await supabase.from("website_asset_versions").select("*").in("asset_id", assetIds).order("version_number", { ascending: false })
    : { data: [], error: null };
  if (versionResult.error) throw versionResult.error;
  assets = assetResult.data || [];
  versions = versionResult.data || [];
  renderSelectedWebsite();
  renderAssets();
}

function setAdminUploadStatus(message = "", isError = false) {
  if (!adminUploadStatus) return;
  adminUploadStatus.textContent = message;
  adminUploadStatus.classList.toggle("is-error", isError);
}

function openAdminUpload() {
  if (!adminUploadForm || !selectedWebsite) return;
  adminUploadForm.hidden = false;
  setAdminUploadStatus(`Images will be added to ${selectedWebsite.name}.`);
  adminUploadFiles?.focus();
}

function closeAdminUpload() {
  if (!adminUploadForm) return;
  adminUploadForm.hidden = true;
  adminUploadForm.reset();
  setAdminUploadStatus("");
}

async function uploadAdminImage(file, reservedKeys) {
  const isImage = String(file.type || "").startsWith("image/") || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name);
  if (!isImage) throw new Error(`${file.name} is not a supported image.`);

  const assetId = crypto.randomUUID();
  const label = humanizeWebsiteAssetFilename(file.name);
  const assetKey = uniqueWebsiteAssetKey(websiteAssetKeyFromLabel(label), reservedKeys);
  const storagePath = `${selectedWebsite.id}/${assetId}/v1-${crypto.randomUUID()}-${safeFilename(file.name)}`;
  let assetCreated = false;
  let objectUploaded = false;
  try {
    const { error: assetError } = await supabase.from("website_assets").insert({
      id: assetId,
      website_id: selectedWebsite.id,
      asset_key: assetKey,
      label,
      category: adminUploadCategory.value,
      replacement_type: adminUploadReplacementType.value,
      created_by_user_id: currentUser.id,
    });
    if (assetError) throw assetError;
    assetCreated = true;

    const uploadOptions = { cacheControl: "3600", upsert: false };
    if (file.type) uploadOptions.contentType = file.type;
    const { error: uploadError } = await supabase.storage.from(PRIVATE_BUCKET).upload(storagePath, file, uploadOptions);
    if (uploadError) throw uploadError;
    objectUploaded = true;

    const now = new Date().toISOString();
    const { error: versionError } = await supabase.from("website_asset_versions").insert({
      asset_id: assetId,
      version_number: 1,
      status: "approved",
      storage_bucket: PRIVATE_BUCKET,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      change_note: adminUploadNote.value.trim() || "Uploaded by N3XRA admin",
      uploaded_by_user_id: currentUser.id,
      approved_by_user_id: currentUser.id,
      approved_at: now,
    });
    if (versionError) throw versionError;
    reservedKeys.add(assetKey);
  } catch (error) {
    if (objectUploaded) await supabase.storage.from(PRIVATE_BUCKET).remove([storagePath]);
    if (assetCreated) await supabase.from("website_assets").delete().eq("id", assetId);
    throw error;
  }
}

async function uploadAdminImages(event) {
  event.preventDefault();
  if (!selectedWebsite) return;
  const selectedFiles = Array.from(adminUploadFiles?.files || []);
  if (!selectedFiles.length) {
    setAdminUploadStatus("Choose at least one image.", true);
    return;
  }
  adminUploadSubmit.disabled = true;
  const reservedKeys = new Set(assets.map((asset) => asset.asset_key));
  let uploadedCount = 0;
  try {
    for (const file of selectedFiles) {
      setAdminUploadStatus(`Uploading ${uploadedCount + 1} of ${selectedFiles.length}: ${file.name}`);
      await uploadAdminImage(file, reservedKeys);
      uploadedCount += 1;
    }
    showToast(`${uploadedCount} image${uploadedCount === 1 ? "" : "s"} added to ${selectedWebsite.name}.`);
    await loadAssets();
    closeAdminUpload();
  } catch (error) {
    if (uploadedCount) await loadAssets();
    setAdminUploadStatus(`${uploadedCount ? `${uploadedCount} uploaded. ` : ""}${error?.message || "The remaining images could not be uploaded."}`, true);
  } finally {
    adminUploadSubmit.disabled = false;
  }
}

async function selectWebsite(id) {
  closeAdminUpload();
  selectedWebsite = websites.find((site) => site.id === id) || websites[0];
  selectedAssetCategory = "";
  selectedVersionIds.clear();
  if (assetSearch) assetSearch.value = "";
  if (projectLinkForm) {
    projectLinkForm.hidden = true;
    setProjectStatus("");
  }
  if (selectedWebsite) websiteSelect.value = selectedWebsite.id;
  if (selectedWebsite && currentUser) {
    const previous = readWorkspaceContext("admin", currentUser.id);
    writeWorkspaceContext("admin", currentUser.id, {
      websiteId: selectedWebsite.id,
      name: selectedWebsite.name,
      ...(previous.websiteId && previous.websiteId !== selectedWebsite.id
        ? { projectId: null, requestId: null, proposalId: null, onboardingId: null }
        : {}),
    });
  }
  renderSelectedWebsite();
  const assetsView = document.body.classList.contains("admin-assets-view");
  await (assetsView ? loadAssets() : loadMembers());
}

async function assignMember(event) {
  event.preventDefault();
  if (!selectedWebsite) return;
  const submitButton = memberForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setMemberStatus("Assigning account…");
  try {
    await invokeAdmin({
      action: "assign-website-member",
      websiteId: selectedWebsite.id,
      email: memberEmail.value.trim(),
      role: memberRole.value,
    });
    memberForm.reset();
    setMemberStatus("Account assigned.");
    await loadMembers();
  } catch (error) {
    setMemberStatus(error?.message || "Unable to assign this account.", true);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleMemberAction(event) {
  const button = event.target.closest("[data-member-id]");
  if (!button) return;
  const membership = members.find((member) => member.id === button.dataset.memberId);
  const roleSelect = memberList.querySelector(`[data-member-role="${button.dataset.memberId}"]`);
  if (!membership || !roleSelect) return;
  button.disabled = true;
  setMemberStatus("Updating access…");
  try {
    await invokeAdmin({
      action: "update-website-member",
      membershipId: membership.id,
      role: roleSelect.value,
      status: button.dataset.memberStatus,
    });
    setMemberStatus(button.dataset.memberStatus === "active" ? "Access restored." : "Access revoked.");
    await loadMembers();
  } catch (error) {
    setMemberStatus(error?.message || "Unable to update access.", true);
  } finally {
    button.disabled = false;
  }
}

async function handleMemberRoleChange(event) {
  const select = event.target.closest("[data-member-role]");
  if (!select) return;
  const membership = members.find((member) => member.id === select.dataset.memberRole);
  if (!membership || membership.role === select.value) return;
  select.disabled = true;
  setMemberStatus("Updating role…");
  try {
    await invokeAdmin({
      action: "update-website-member",
      membershipId: membership.id,
      role: select.value,
      status: membership.status,
    });
    setMemberStatus("Role updated.");
    await loadMembers();
  } catch (error) {
    select.value = membership.role;
    setMemberStatus(error?.message || "Unable to update the role.", true);
  } finally {
    select.disabled = false;
  }
}

function openProjectForm() {
  const activeMembers = members.filter((member) => member.status === "active");
  if (!activeMembers.length) {
    setMemberStatus("Assign an active client account before creating the project.", true);
    memberEmail?.focus();
    return;
  }
  projectLinkForm.hidden = false;
  projectNameInput.value = selectedWebsite?.name || "";
  projectProposalTitle.value = selectedWebsite ? `New work for ${selectedWebsite.name}` : "";
  projectProposalTitleWrap.hidden = !projectCreateProposal.checked;
  setProjectStatus("");
  projectNameInput.focus();
}

async function createExistingWebsiteProject(event) {
  event.preventDefault();
  if (!selectedWebsite) return;
  const submitButton = projectLinkForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setProjectStatus("Creating project workspace…");
  try {
    const data = await invokeProjectAdmin({
      action: "create-existing-website-project",
      websiteId: selectedWebsite.id,
      clientUserId: projectClientAccount.value,
      name: projectNameInput.value.trim(),
      status: projectStatusInput.value,
      targetStartDate: projectStartDate.value || null,
      targetLaunchDate: projectLaunchDate.value || null,
      createProposal: projectCreateProposal.checked,
      proposalTitle: projectProposalTitle.value.trim(),
      openOnboarding: projectOpenOnboarding.checked,
    });
    projectLinkForm.reset();
    projectLinkForm.hidden = true;
    await loadProjectLifecycle();
    const warning = (data.warnings || []).filter(Boolean).join(" ");
    if (warning) showToast(warning, "error");
    else showToast("Existing website is now a client project.");
  } catch (error) {
    setProjectStatus(error?.message || "Unable to create this project.", true);
  } finally {
    submitButton.disabled = false;
  }
}

async function createProjectProposal(form) {
  if (!selectedProject) return;
  const titleInput = form.querySelector("[data-project-proposal-title]");
  const submitButton = form.querySelector('[type="submit"]');
  const actionStatus = projectLinkState.querySelector("[data-project-action-status]");
  submitButton.disabled = true;
  actionStatus.textContent = "Creating proposal draft…";
  actionStatus.classList.remove("is-error");
  try {
    await invokeProjectAdmin({
      action: "create-existing-website-proposal",
      projectId: selectedProject.id,
      proposalTitle: titleInput.value.trim(),
    });
    await loadProjectLifecycle();
    showToast("Proposal draft created.");
  } catch (error) {
    actionStatus.textContent = error?.message || "Unable to create the proposal.";
    actionStatus.classList.add("is-error");
    submitButton.disabled = false;
  }
}

async function openProjectOnboarding(button) {
  if (!selectedProject) return;
  const actionStatus = projectLinkState.querySelector("[data-project-action-status]");
  button.disabled = true;
  actionStatus.textContent = "Opening onboarding…";
  actionStatus.classList.remove("is-error");
  try {
    await invokeProjectAdmin({
      action: "open-existing-website-onboarding",
      projectId: selectedProject.id,
    });
    await loadProjectLifecycle();
    showToast("Onboarding is open for this project.");
  } catch (error) {
    actionStatus.textContent = error?.message || "Unable to open onboarding.";
    actionStatus.classList.add("is-error");
    button.disabled = false;
  }
}

function handleProjectLinkClick(event) {
  const showProposal = event.target.closest("[data-show-project-proposal]");
  const cancelProposal = event.target.closest("[data-cancel-project-proposal]");
  const openOnboarding = event.target.closest("[data-open-project-onboarding]");
  if (showProposal) {
    showProposal.hidden = true;
    const form = projectLinkState.querySelector("[data-project-proposal-form]");
    form.hidden = false;
    form.querySelector("input")?.focus();
  }
  if (cancelProposal) {
    const form = projectLinkState.querySelector("[data-project-proposal-form]");
    form.hidden = true;
    const showButton = projectLinkState.querySelector("[data-show-project-proposal]");
    if (showButton) showButton.hidden = false;
  }
  if (openOnboarding) void openProjectOnboarding(openOnboarding);
}

async function loadWebsites(preferredId) {
  const [websiteResult, domainResult, repositoryResult] = await Promise.all([
    supabase.from("client_websites").select("*").order("name"),
    supabase.from("website_domains").select("website_id,domain_name,is_primary").order("is_primary", { ascending: false }),
    supabase.from("website_repositories").select("website_id,full_name,created_at").order("created_at"),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  if (repositoryResult.error) throw repositoryResult.error;
  websites = websiteResult.data || [];
  domains = domainResult.data || [];
  repositories = repositoryResult.data || [];
  renderWebsiteOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("website")
    || readWorkspaceContext("admin", currentUser?.id).websiteId;
  await selectWebsite(websites.some((site) => site.id === requested) ? requested : websites[0]?.id);
}

async function updateVersionStatus(versionId, status) {
  const now = new Date().toISOString();
  const rejectionReason = status === "rejected"
    ? await promptAdminText("Add an optional note explaining why this file was rejected.", { title: "Reject file", inputLabel: "Rejection note", confirmLabel: "Reject file" })
    : null;
  if (status === "rejected" && rejectionReason === null) return;
  const values = status === "approved"
    ? { status, approved_by_user_id: currentUser.id, approved_at: now, rejection_reason: null }
    : { status, rejected_by_user_id: currentUser.id, rejected_at: now, rejection_reason: rejectionReason.trim() || null };
  const { error } = await supabase.from("website_asset_versions").update(values).eq("id", versionId);
  if (error) throw error;
  await loadAssets();
}

async function publishVersion(versionId, { reload = true, copyUrl = true, preserveOriginal = false } = {}) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  if (!version || !asset) throw new Error("This asset version is no longer available.");

  const publicPath = `${selectedWebsite.id}/${asset.id}/v${version.version_number}-${safeFilename(version.original_filename)}`;
  const cdnResult = await writeCdnObject(version, asset, publicPath, { preserveOriginal });

  const { data: urlData } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(publicPath);
  const publicUrl = urlData.publicUrl;
  const now = new Date().toISOString();
  const { error: versionError } = await supabase.from("website_asset_versions").update({
    status: "published",
    public_url: publicUrl,
    cdn_size_bytes: cdnResult.blob.size,
    cdn_mime_type: cdnResult.contentType,
    cdn_width: cdnResult.width,
    cdn_height: cdnResult.height,
    cdn_optimized: cdnResult.optimized,
    cdn_processed_at: now,
    published_by_user_id: currentUser.id,
    published_at: now,
  }).eq("id", version.id);
  if (versionError) throw versionError;

  const { error: assetError } = await supabase.from("website_assets").update({
    current_version_id: version.id,
    updated_at: now,
  }).eq("id", asset.id);
  if (assetError) throw assetError;
  if (reload) await loadAssets();
  if (!copyUrl) return publicUrl;
  let copied = false;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(publicUrl);
      copied = true;
    }
  } catch {
    copied = false;
  }
  const optimizationMessage = cdnResult.optimized ? ` Optimized from ${formatBytes(version.size_bytes)} to ${formatBytes(cdnResult.blob.size)}.` : "";
  showToast(copied ? `Published to the CDN and copied the URL.${optimizationMessage}` : `Published to the CDN.${optimizationMessage} Use Copy URL when you need the link.`);
}

async function writeCdnObject(version, asset, publicPath, { preserveOriginal = false } = {}) {
  const { data: original, error: downloadError } = await supabase.storage.from(PRIVATE_BUCKET).download(version.storage_path);
  if (downloadError || !original) throw downloadError || new Error("The private original could not be read.");

  let prepared;
  try {
    prepared = preserveOriginal
      ? { blob: original, contentType: version.mime_type || original.type || "application/octet-stream", width: null, height: null, optimized: false }
      : await prepareCdnImage(original, asset, version);
  } catch (error) {
    console.warn("CDN image optimization was skipped.", error);
    prepared = {
      blob: original,
      contentType: version.mime_type || original.type || "application/octet-stream",
      width: null,
      height: null,
      optimized: false,
    };
  }

  const { error: uploadError } = await supabase.storage.from(PUBLIC_BUCKET).upload(publicPath, prepared.blob, {
    cacheControl: CDN_BROWSER_CACHE_SECONDS,
    contentType: prepared.contentType,
    upsert: true,
  });
  if (uploadError) throw uploadError;
  return prepared;
}

async function optimizePublishedVersion(versionId, { reload = true, notify = true } = {}) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  const publicPath = publicStoragePath(version);
  if (!version || !asset || !publicPath) throw new Error("This published CDN file is no longer available.");

  const cdnResult = await writeCdnObject(version, asset, publicPath);
  const now = new Date().toISOString();
  const { error } = await supabase.from("website_asset_versions").update({
    cdn_size_bytes: cdnResult.blob.size,
    cdn_mime_type: cdnResult.contentType,
    cdn_width: cdnResult.width,
    cdn_height: cdnResult.height,
    cdn_optimized: cdnResult.optimized,
    cdn_processed_at: now,
  }).eq("id", version.id);
  if (error) throw error;

  if (notify) {
    const message = cdnResult.optimized
      ? `CDN file optimized from ${formatBytes(version.size_bytes)} to ${formatBytes(cdnResult.blob.size)}. The URL did not change.`
      : "The unchanged full-quality file now has refreshed long-term CDN caching at the same URL.";
    showToast(message);
  }
  if (reload) await loadAssets();
  return cdnResult;
}

async function restoreOriginalCdnVersion(versionId) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  const publicPath = publicStoragePath(version);
  if (!version || !asset || !publicPath) throw new Error("This published CDN file is no longer available.");
  if (!await confirmAdminAction("Use the private full-quality original at this existing CDN URL? The link will not change.", { title: "Use full-quality file", confirmLabel: "Use full quality" })) return;

  const cdnResult = await writeCdnObject(version, asset, publicPath, { preserveOriginal: true });
  const { error } = await supabase.from("website_asset_versions").update({
    cdn_size_bytes: cdnResult.blob.size,
    cdn_mime_type: cdnResult.contentType,
    cdn_width: null,
    cdn_height: null,
    cdn_optimized: false,
    cdn_processed_at: new Date().toISOString(),
  }).eq("id", version.id);
  if (error) throw error;
  showToast("The full-quality original now uses the same CDN URL.");
  await loadAssets();
}

async function optimizePublishedBatch() {
  const publishedVersions = getRefreshablePublishedVersions();
  if (!publishedVersions.length) return;
  if (!await confirmAdminAction(`Refresh ${publishedVersions.length} published image${publishedVersions.length === 1 ? "" : "s"} without changing any CDN links? Photos will be optimized; logos and brand files will remain unchanged.`, { title: "Refresh CDN files", confirmLabel: "Refresh files" })) return;

  optimizePublishedBatchButton.disabled = true;
  let optimizedCount = 0;
  try {
    for (const version of publishedVersions) {
      batchStatus.textContent = `Refreshing ${optimizedCount + 1} of ${publishedVersions.length}: ${version.original_filename}`;
      await optimizePublishedVersion(version.id, { reload: false, notify: false });
      optimizedCount += 1;
    }
    batchStatus.textContent = `${optimizedCount} CDN file${optimizedCount === 1 ? "" : "s"} refreshed without changing links.`;
    showToast(batchStatus.textContent);
    selectedVersionIds.clear();
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = `${optimizedCount ? `${optimizedCount} refreshed. ` : ""}${error?.message || "The remaining CDN files could not be refreshed."}`;
    showToast(batchStatus.textContent, "error");
    await loadAssets();
  } finally {
    optimizePublishedBatchButton.disabled = false;
  }
}

async function approvePendingBatch() {
  const pendingVersions = versions.filter((version) => selectedVersionIds.has(version.id) && version.status === "pending_review");
  if (!pendingVersions.length) return;
  if (!await confirmAdminAction(`Approve ${pendingVersions.length} pending file${pendingVersions.length === 1 ? "" : "s"} for ${selectedWebsite.name}?`, { title: "Approve selected files", confirmLabel: "Approve files" })) return;

  approvePendingBatchButton.disabled = true;
  publishApprovedBatchButton.disabled = true;
  batchStatus.textContent = `Approving ${pendingVersions.length} files…`;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from("website_asset_versions").update({
      status: "approved",
      approved_by_user_id: currentUser.id,
      approved_at: now,
      rejection_reason: null,
    }).in("id", pendingVersions.map((version) => version.id));
    if (error) throw error;
    batchStatus.textContent = `${pendingVersions.length} files approved.`;
    showToast(`${pendingVersions.length} pending file${pendingVersions.length === 1 ? "" : "s"} approved.`);
    selectedVersionIds.clear();
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = error?.message || "The pending files could not be approved.";
    showToast(batchStatus.textContent, "error");
  } finally {
    approvePendingBatchButton.disabled = false;
    publishApprovedBatchButton.disabled = false;
  }
}

async function rejectPendingBatch() {
  const pendingVersions = versions.filter((version) => selectedVersionIds.has(version.id) && version.status === "pending_review");
  if (!pendingVersions.length) return;
  const reason = await promptAdminText(`Reject ${pendingVersions.length} selected pending file${pendingVersions.length === 1 ? "" : "s"}. Add an optional reason.`, { title: "Reject selected files", inputLabel: "Rejection note", confirmLabel: "Reject files" });
  if (reason === null) return;

  rejectPendingBatchButton.disabled = true;
  batchStatus.textContent = `Rejecting ${pendingVersions.length} files…`;
  try {
    const { error } = await supabase.from("website_asset_versions").update({
      status: "rejected",
      rejected_by_user_id: currentUser.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason.trim() || null,
    }).in("id", pendingVersions.map((version) => version.id));
    if (error) throw error;
    selectedVersionIds.clear();
    showToast(`${pendingVersions.length} pending file${pendingVersions.length === 1 ? "" : "s"} rejected.`);
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = error?.message || "The selected files could not be rejected.";
    showToast(batchStatus.textContent, "error");
  } finally {
    rejectPendingBatchButton.disabled = false;
  }
}

async function publishApprovedBatch() {
  const approvedVersions = getPublishableApprovedVersions();
  if (!approvedVersions.length) return;
  if (!await confirmAdminAction(`Publish ${approvedVersions.length} approved image${approvedVersions.length === 1 ? "" : "s"} to the CDN for ${selectedWebsite.name}?`, { title: "Publish selected files", confirmLabel: "Publish files" })) return;

  approvePendingBatchButton.disabled = true;
  publishApprovedBatchButton.disabled = true;
  let publishedCount = 0;
  try {
    for (const version of approvedVersions) {
      batchStatus.textContent = `Publishing ${publishedCount + 1} of ${approvedVersions.length}: ${version.original_filename}`;
      await publishVersion(version.id, { reload: false, copyUrl: false });
      publishedCount += 1;
    }
    batchStatus.textContent = `${publishedCount} images published to the CDN.`;
    showToast(`${publishedCount} approved image${publishedCount === 1 ? "" : "s"} published to the CDN.`);
    selectedVersionIds.clear();
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = `${publishedCount ? `${publishedCount} published. ` : ""}${error?.message || "The remaining images could not be published."}`;
    showToast(batchStatus.textContent, "error");
    await loadAssets();
  } finally {
    approvePendingBatchButton.disabled = false;
    publishApprovedBatchButton.disabled = false;
  }
}

async function copyPublishedLinks() {
  const publishedLinks = getCurrentPublishedLinks();
  if (!publishedLinks.length) return;
  const list = publishedLinks
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((item) => `${item.label} — ${item.url}`)
    .join("\n");
  try {
    await navigator.clipboard.writeText(list);
    batchStatus.textContent = `${publishedLinks.length} published link${publishedLinks.length === 1 ? "" : "s"} copied.`;
    showToast(batchStatus.textContent);
  } catch {
    batchStatus.textContent = "The published links could not be copied. Check this browser’s clipboard permission.";
    showToast(batchStatus.textContent, "error");
  }
}

async function downloadVersion(version) {
  const url = await downloadUrlForVersion(version);
  window.open(url, "_blank", "noopener");
}

async function renameVersion(version) {
  const nextName = await promptAdminText(
    version.public_url
      ? "Change the filename shown in the workspace and used for downloads. The published URL will stay unchanged so live website links do not break."
      : "Change the filename shown in the workspace and used for downloads.",
    { title: "Rename file", inputLabel: "Filename", defaultValue: version.original_filename, confirmLabel: "Rename file" },
  );
  if (nextName === null) return;
  const filename = validateWebsiteAssetRename(nextName, version.original_filename);
  if (filename === version.original_filename) return;
  const { error } = await supabase.from("website_asset_versions").update({ original_filename: filename }).eq("id", version.id);
  if (error) throw error;
  showToast(`Renamed to ${filename}.`);
  await loadAssets();
}

async function openVersion(version) {
  const previewResult = version.public_url
    ? { data: { signedUrl: version.public_url }, error: null }
    : await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 600);
  if (previewResult.error || !previewResult.data?.signedUrl) throw previewResult.error || new Error("A preview link could not be created.");
  const downloadUrl = version.public_url || await downloadUrlForVersion(version);
  await openAssetPreview({ name: version.original_filename, mimeType: version.mime_type, url: previewResult.data.signedUrl, downloadUrl, kicker: "Websites · Files & Assets" });
}

async function downloadUrlForVersion(version) {
  if (!version.storage_bucket || !version.storage_path) {
    if (version.public_url) return version.public_url;
    throw new Error("The private original is no longer available.");
  }
  const { data, error } = await supabase.storage
    .from(version.storage_bucket)
    .createSignedUrl(version.storage_path, 600, { download: version.original_filename });
  if (error) throw error;
  return data.signedUrl;
}

async function downloadSelectedFiles() {
  const selectedVersions = versions.filter((version) => selectedVersionIds.has(version.id));
  if (!selectedVersions.length) return;
  if (selectedVersions.length > 5 && !await confirmAdminAction(`Download ${selectedVersions.length} selected files? Your browser may ask for permission to download multiple files.`, { title: "Download selected files", confirmLabel: "Start downloads" })) return;
  downloadSelectedFilesButton.disabled = true;
  batchStatus.textContent = `Preparing ${selectedVersions.length} downloads…`;
  try {
    const downloads = await Promise.all(selectedVersions.map(async (version) => ({ version, url: await downloadUrlForVersion(version) })));
    downloads.forEach(({ version, url }) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = version.original_filename;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    batchStatus.textContent = `${downloads.length} download${downloads.length === 1 ? "" : "s"} started.`;
  } catch (error) {
    batchStatus.textContent = error?.message || "The selected files could not be downloaded.";
    showToast(batchStatus.textContent, "error");
  } finally {
    downloadSelectedFilesButton.disabled = false;
  }
}

function publicStoragePath(version) {
  if (!version?.public_url) return "";
  try {
    const marker = `/storage/v1/object/public/${PUBLIC_BUCKET}/`;
    const pathname = new URL(version.public_url).pathname;
    return pathname.includes(marker) ? decodeURIComponent(pathname.split(marker)[1] || "") : "";
  } catch {
    return "";
  }
}

async function deleteVersionAsAdmin(version) {
  const asset = assets.find((row) => row.id === version.asset_id);
  if (!asset) throw new Error("This asset is no longer available.");
  const isPublished = version.status === "published" || Boolean(version.public_url) || asset.current_version_id === version.id;
  const warning = isPublished
    ? `Permanently delete the published file “${version.original_filename}”? It may already be used by the live website, and its URL will stop working.`
    : `Permanently delete “${version.original_filename}”? This cannot be undone.`;
  if (!await confirmAdminAction(warning, { title: isPublished ? "Delete published file" : "Delete file", confirmLabel: "Delete permanently" })) return;
  if (isPublished && !await confirmAdminAction("This file is published or currently selected. Its live URL will stop working.", { title: "Final confirmation", confirmLabel: "Delete published file" })) return;

  if (asset.current_version_id === version.id) {
    const { error: currentError } = await supabase.from("website_assets")
      .update({ current_version_id: null })
      .eq("id", asset.id);
    if (currentError) throw currentError;
  }

  const paths = [];
  if (version.storage_bucket && version.storage_path) {
    paths.push({ bucket: version.storage_bucket, path: version.storage_path });
  }
  const publishedPath = publicStoragePath(version);
  if (publishedPath) paths.push({ bucket: PUBLIC_BUCKET, path: publishedPath });
  for (const storedFile of paths) {
    const { error } = await supabase.storage.from(storedFile.bucket).remove([storedFile.path]);
    if (error) throw error;
  }

  const { error: versionError } = await supabase.from("website_asset_versions").delete().eq("id", version.id);
  if (versionError) throw versionError;
  const remainingVersions = versions.filter((row) => row.asset_id === asset.id && row.id !== version.id);
  if (!remainingVersions.length) {
    const { error: assetError } = await supabase.from("website_assets").delete().eq("id", asset.id);
    if (assetError) throw assetError;
  }
  showToast("File permanently deleted.");
  await loadAssets();
}

async function deleteSelectedFiles() {
  const selectedVersions = versions.filter((version) => selectedVersionIds.has(version.id));
  if (!selectedVersions.length) return;
  const selectedIds = new Set(selectedVersions.map((version) => version.id));
  const affectedAssets = assets.filter((asset) => selectedVersions.some((version) => version.asset_id === asset.id));
  const publishedVersions = selectedVersions.filter((version) => {
    const asset = assets.find((row) => row.id === version.asset_id);
    return version.status === "published" || Boolean(version.public_url) || asset?.current_version_id === version.id;
  });
  if (publishedVersions.length) {
    const confirmation = await promptAdminText(`This will permanently delete ${selectedVersions.length} selected file${selectedVersions.length === 1 ? "" : "s"}, including ${publishedVersions.length} published file${publishedVersions.length === 1 ? "" : "s"}. Their live URLs will stop working. Type DELETE to continue.`, { title: "Delete published files", inputLabel: "Type DELETE", confirmLabel: "Delete permanently" });
    if (confirmation !== "DELETE") return;
  } else if (!await confirmAdminAction(`Permanently delete ${selectedVersions.length} selected file${selectedVersions.length === 1 ? "" : "s"}? This cannot be undone.`, { title: "Delete selected files", confirmLabel: "Delete permanently" })) {
    return;
  }

  deleteSelectedFilesButton.disabled = true;
  batchStatus.textContent = `Deleting ${selectedVersions.length} files…`;
  try {
    const currentAssets = affectedAssets.filter((asset) => selectedIds.has(asset.current_version_id));
    if (currentAssets.length) {
      const { error } = await supabase.from("website_assets").update({ current_version_id: null }).in("id", currentAssets.map((asset) => asset.id));
      if (error) throw error;
    }

    const pathsByBucket = new Map();
    selectedVersions.forEach((version) => {
      if (version.storage_bucket && version.storage_path) {
        const paths = pathsByBucket.get(version.storage_bucket) || [];
        paths.push(version.storage_path);
        pathsByBucket.set(version.storage_bucket, paths);
      }
      const publishedPath = publicStoragePath(version);
      if (publishedPath) {
        const paths = pathsByBucket.get(PUBLIC_BUCKET) || [];
        paths.push(publishedPath);
        pathsByBucket.set(PUBLIC_BUCKET, paths);
      }
    });
    for (const [bucket, paths] of pathsByBucket) {
      const { error } = await supabase.storage.from(bucket).remove([...new Set(paths)]);
      if (error) throw error;
    }

    const { error: versionError } = await supabase.from("website_asset_versions").delete().in("id", [...selectedIds]);
    if (versionError) throw versionError;
    const emptyAssetIds = affectedAssets
      .filter((asset) => !versions.some((version) => version.asset_id === asset.id && !selectedIds.has(version.id)))
      .map((asset) => asset.id);
    if (emptyAssetIds.length) {
      const { error: assetError } = await supabase.from("website_assets").delete().in("id", emptyAssetIds);
      if (assetError) throw assetError;
    }
    selectedVersionIds.clear();
    showToast(`${selectedVersions.length} file${selectedVersions.length === 1 ? "" : "s"} permanently deleted.`);
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = error?.message || "The selected files could not be deleted.";
    showToast(batchStatus.textContent, "error");
  } finally {
    deleteSelectedFilesButton.disabled = false;
  }
}

async function deleteEmptyAssetAsAdmin(assetId) {
  const asset = assets.find((row) => row.id === assetId);
  const assetVersions = versions.filter((row) => row.asset_id === assetId);
  if (!asset || assetVersions.length || asset.current_version_id) {
    throw new Error("Only an empty, unused asset can be deleted here.");
  }
  if (!await confirmAdminAction(`Permanently delete the empty failed upload “${asset.label}”?`, { title: "Delete failed upload", confirmLabel: "Delete permanently" })) return;
  const { error } = await supabase.from("website_assets").delete().eq("id", asset.id);
  if (error) throw error;
  showToast("Empty failed upload deleted.");
  await loadAssets();
}

async function handleAssetAction(event) {
  const selectableRow = event.target.closest("[data-selectable-version]");
  if (selectableRow && !event.target.closest("input, label, button, a, summary, details")) {
    const version = versions.find((row) => row.id === selectableRow.dataset.selectableVersion);
    if (version) {
      try { await openVersion(version); }
      catch (error) { showToast(error?.message || "The file could not be opened.", "error"); }
    }
    return;
  }
  const menu = event.target.closest(".website-asset-actions");
  if (event.target.closest(".website-asset-actions > summary")) {
    document.querySelectorAll(".website-asset-actions[open]").forEach((item) => { if (item !== menu) item.removeAttribute("open"); });
  }
  const emptyAssetButton = event.target.closest("[data-delete-empty-asset]");
  if (emptyAssetButton) {
    emptyAssetButton.disabled = true;
    try {
      await deleteEmptyAssetAsAdmin(emptyAssetButton.dataset.deleteEmptyAsset);
    } catch (error) {
      showToast(error?.message || "This empty asset could not be deleted.", "error");
    } finally {
      emptyAssetButton.disabled = false;
    }
    return;
  }
  const button = event.target.closest("[data-version-action]");
  if (!button) return;
  const version = versions.find((row) => row.id === button.dataset.versionId);
  if (!version) return;
  menu?.removeAttribute("open");
  button.disabled = true;
  try {
    if (button.dataset.versionAction === "approve") await updateVersionStatus(version.id, "approved");
    if (button.dataset.versionAction === "reject") await updateVersionStatus(version.id, "rejected");
    if (button.dataset.versionAction === "publish") await publishVersion(version.id);
    if (button.dataset.versionAction === "publish-original") await publishVersion(version.id, { preserveOriginal: true });
    if (button.dataset.versionAction === "rename") await renameVersion(version);
    if (button.dataset.versionAction === "download") await downloadVersion(version);
    if (button.dataset.versionAction === "delete") await deleteVersionAsAdmin(version);
    if (button.dataset.versionAction === "copy") {
      await navigator.clipboard.writeText(version.public_url);
      button.textContent = "Copied";
    }
    if (button.dataset.versionAction === "optimize") await optimizePublishedVersion(version.id);
    if (button.dataset.versionAction === "refresh-cdn") await optimizePublishedVersion(version.id);
    if (button.dataset.versionAction === "restore-original") await restoreOriginalCdnVersion(version.id);
  } catch (error) {
    showToast(error?.message || "This action could not be completed.", "error");
  } finally {
    button.disabled = false;
  }
}

async function createWebsite(event) {
  event.preventDefault();
  const submitButton = siteForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setSiteFormStatus(editingWebsiteId ? "Saving website…" : "Creating website…");
  const slug = slugify(siteSlugInput.value);
  try {
    if (!slug) throw new Error("Enter a valid website slug.");
    const websiteValues = {
      name: siteNameInput.value.trim(),
      slug,
      live_url: siteLiveUrlInput.value.trim() || null,
      repository_full_name: siteRepositoryInput.value.trim() || null,
    };
    const query = editingWebsiteId
      ? supabase.from("client_websites").update(websiteValues).eq("id", editingWebsiteId).select().single()
      : supabase.from("client_websites").insert({ ...websiteValues, status: "active" }).select().single();
    const { data, error } = await query;
    if (error) throw error;
    siteForm.reset();
    editingWebsiteId = null;
    if (siteFormKicker) siteFormKicker.textContent = "New managed site";
    if (siteFormTitle) siteFormTitle.textContent = "Create website record";
    if (siteFormSubmit) siteFormSubmit.textContent = "Create website";
    setSiteFormStatus(data ? "Website saved." : "Website created.");
    await loadWebsites(data.id);
  } catch (error) {
    setSiteFormStatus(error?.message || "Unable to create this website.", true);
  } finally {
    submitButton.disabled = false;
  }
}

async function initWebsiteAdmin() {
  if (!hasConfig()) {
    document.body.classList.add("portal-denied");
    showStatus("Website administration is not connected yet.");
    return;
  }

  try {
    const context = await getAdminSession();
    if (!context.allowed) return;
    supabase = context.supabase;
    currentUser = context.user;

    await loadWebsites();
    document.body.classList.remove("portal-loading");
    statusScreen.hidden = true;

    websiteSelect?.addEventListener("change", () => selectWebsite(websiteSelect.value).catch((loadError) => showToast(loadError.message, "error")));
    refreshButton?.addEventListener("click", () => loadWebsites(selectedWebsite?.id).catch((loadError) => showToast(loadError.message, "error")));
    openAdminUploadButton?.addEventListener("click", openAdminUpload);
    closeAdminUploadButton?.addEventListener("click", closeAdminUpload);
    adminUploadForm?.addEventListener("submit", uploadAdminImages);
    adminUploadCategory?.addEventListener("change", () => {
      if (!adminUploadReplacementType) return;
      adminUploadReplacementType.value = adminUploadCategory.value === "social" ? "metadata" : "html_src";
    });
    copyPublishedLinksButton?.addEventListener("click", copyPublishedLinks);
    optimizePublishedBatchButton?.addEventListener("click", optimizePublishedBatch);
    approvePendingBatchButton?.addEventListener("click", approvePendingBatch);
    rejectPendingBatchButton?.addEventListener("click", rejectPendingBatch);
    publishApprovedBatchButton?.addEventListener("click", publishApprovedBatch);
    downloadSelectedFilesButton?.addEventListener("click", downloadSelectedFiles);
    deleteSelectedFilesButton?.addEventListener("click", deleteSelectedFiles);
    clearAssetSelectionButton?.addEventListener("click", () => {
      selectedVersionIds.clear();
      renderAssets();
    });
    assetGrid?.addEventListener("click", handleAssetAction);
    assetGrid?.addEventListener("change", handleAssetSelection);
    selectedAssetActions?.addEventListener("click", handleAssetAction);
    assetFolderList?.addEventListener("click", (event) => {
      const folder = event.target.closest("[data-select-category]");
      if (!folder) return;
      selectedAssetCategory = folder.dataset.selectCategory;
      selectedVersionIds.clear();
      if (assetSearch) assetSearch.value = "";
      renderAssets();
    });
    assetSearch?.addEventListener("input", renderAssets);
    adminRequestList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-save-request]");
      if (!button) return;
      button.disabled = true;
      saveServiceRequest(button.dataset.saveRequest)
        .catch((requestError) => showToast(requestError?.message || "Unable to update this request.", "error"))
        .finally(() => { button.disabled = false; });
    });
    memberForm?.addEventListener("submit", assignMember);
    memberList?.addEventListener("click", handleMemberAction);
    memberList?.addEventListener("change", handleMemberRoleChange);
    openProjectFormButton?.addEventListener("click", openProjectForm);
    closeProjectFormButton?.addEventListener("click", () => {
      projectLinkForm.hidden = true;
      setProjectStatus("");
    });
    projectCreateProposal?.addEventListener("change", () => {
      projectProposalTitleWrap.hidden = !projectCreateProposal.checked;
      if (projectCreateProposal.checked && !projectProposalTitle.value) {
        projectProposalTitle.value = selectedWebsite ? `New work for ${selectedWebsite.name}` : "";
      }
    });
    projectLinkForm?.addEventListener("submit", createExistingWebsiteProject);
    projectLinkState?.addEventListener("click", handleProjectLinkClick);
    projectLinkState?.addEventListener("submit", (event) => {
      const proposalForm = event.target.closest("[data-project-proposal-form]");
      if (!proposalForm) return;
      event.preventDefault();
      void createProjectProposal(proposalForm);
    });
    openSiteFormButton?.addEventListener("click", () => {
      editingWebsiteId = null;
      siteForm.reset();
      siteSlugInput.dataset.edited = "";
      if (siteFormKicker) siteFormKicker.textContent = "New managed site";
      if (siteFormTitle) siteFormTitle.textContent = "Create website record";
      if (siteFormSubmit) siteFormSubmit.textContent = "Create website";
      siteForm.hidden = false;
      siteNameInput.focus();
    });
    editSiteButton?.addEventListener("click", () => {
      if (!selectedWebsite) return;
      editingWebsiteId = selectedWebsite.id;
      siteNameInput.value = selectedWebsite.name || "";
      siteSlugInput.value = selectedWebsite.slug || "";
      siteSlugInput.dataset.edited = "true";
      siteLiveUrlInput.value = resolveWebsiteUrl(selectedWebsite, domains);
      siteRepositoryInput.value = resolveWebsiteRepository(selectedWebsite, repositories);
      if (siteFormKicker) siteFormKicker.textContent = "Existing managed site";
      if (siteFormTitle) siteFormTitle.textContent = "Edit website record";
      if (siteFormSubmit) siteFormSubmit.textContent = "Save website";
      siteForm.hidden = false;
      siteNameInput.focus();
    });
    closeSiteFormButton?.addEventListener("click", () => {
      editingWebsiteId = null;
      siteForm.hidden = true;
      setSiteFormStatus("");
    });
    siteNameInput?.addEventListener("input", () => {
      if (!siteSlugInput.dataset.edited) siteSlugInput.value = slugify(siteNameInput.value);
    });
    siteSlugInput?.addEventListener("input", () => {
      siteSlugInput.dataset.edited = siteSlugInput.value ? "true" : "";
    });
    siteForm?.addEventListener("submit", createWebsite);

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) openLogin();
    });
  } catch (error) {
    document.body.classList.add("portal-denied");
    showStatus(error?.message || "Website administration could not be opened.");
  }
}

initWebsiteAdmin();
