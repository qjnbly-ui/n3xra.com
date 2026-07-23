import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const PRIVATE_BUCKET = "website-assets-private";
const PUBLIC_BUCKET = "website-assets-public";
const statusScreen = document.getElementById("portal-status");
const websiteSelect = document.getElementById("admin-website-select");
const summary = document.getElementById("admin-site-summary");
const siteName = document.getElementById("admin-site-name");
const siteStatus = document.getElementById("admin-site-status");
const siteMeta = document.getElementById("admin-site-meta");
const liveLink = document.getElementById("admin-live-link");
const clientView = document.getElementById("admin-client-view");
const assetToolbar = document.getElementById("admin-asset-toolbar");
const assetGrid = document.getElementById("admin-asset-grid");
const emptyState = document.getElementById("admin-empty");
const refreshButton = document.getElementById("refresh-admin");
const approvePendingBatchButton = document.getElementById("approve-pending-batch");
const publishApprovedBatchButton = document.getElementById("publish-approved-batch");
const copyPublishedLinksButton = document.getElementById("copy-published-links");
const batchStatus = document.getElementById("admin-batch-status");
const siteForm = document.getElementById("site-form");
const siteFormStatus = document.getElementById("site-form-status");
const openSiteFormButton = document.getElementById("open-site-form");
const closeSiteFormButton = document.getElementById("close-site-form");
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

let supabase;
let currentUser;
let websites = [];
let selectedWebsite;
let assets = [];
let versions = [];
let members = [];
let serviceRequests = [];
let selectedProject;
let projectProposals = [];
let projectOnboarding;
let toastTimer;

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

function safeFilename(value = "asset") {
  const parts = String(value).split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  return `${slugify(parts.join(".")) || "asset"}${extension}`;
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

function renderServiceRequests() {
  adminRequestList.innerHTML = serviceRequests.map((request) => `
    <article class="portal-request-card portal-request-admin-card">
      <div>
        <p class="portal-kicker">${escapeHtml(requestStatusLabel(request.project_type))}</p>
        <h3>${escapeHtml(request.business_name)}</h3>
        <p><strong>${escapeHtml(request.contact_name)}</strong> · ${escapeHtml(request.contact_email)}</p>
        <p>${escapeHtml(request.primary_goal)}</p>
        <p>${(request.requested_pages || []).map(escapeHtml).join(" · ")}</p>
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
    if (emptyState) emptyState.hidden = false;
    if (accessPanel) accessPanel.hidden = true;
    if (projectLinkPanel) projectLinkPanel.hidden = true;
    return;
  }

  summary.hidden = false;
  if (assetToolbar) assetToolbar.hidden = false;
  siteName.textContent = selectedWebsite.name;
  siteStatus.textContent = `${selectedWebsite.status || "active"} website`;
  siteMeta.textContent = [selectedWebsite.live_url, selectedWebsite.repository_full_name].filter(Boolean).join(" · ") || "No live URL or repository recorded.";
  liveLink.hidden = !selectedWebsite.live_url;
  if (selectedWebsite.live_url) liveLink.href = selectedWebsite.live_url;
  clientView.href = `/client-portal/?website=${encodeURIComponent(selectedWebsite.id)}`;
  if (accessPanel) accessPanel.hidden = false;
  if (projectLinkPanel) projectLinkPanel.hidden = false;
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
    <div class="portal-card-actions">
      <a class="portal-button portal-button-secondary" href="/n3xra-admin/projects/?project=${encodeURIComponent(selectedProject.id)}">Open Progress</a>
      ${latestProposal
        ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/proposals/?proposal=${encodeURIComponent(latestProposal.id)}">Open Proposal</a>`
        : `<button class="portal-button portal-button-secondary" type="button" data-show-project-proposal>Create proposal</button>`}
      ${projectOnboarding
        ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/onboarding/?onboarding=${encodeURIComponent(projectOnboarding.id)}">Open Onboarding</a>`
        : `<button class="portal-button portal-button-secondary" type="button" data-open-project-onboarding>Open onboarding</button>`}
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

function versionActions(version) {
  const actions = [];
  if (version.status === "pending_review") {
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="approve" data-version-id="${version.id}">Approve</button>`);
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="reject" data-version-id="${version.id}">Reject</button>`);
  }
  if (version.status === "approved" && String(version.mime_type || "").startsWith("image/")) {
    actions.push(`<button class="portal-button" data-version-action="publish" data-version-id="${version.id}">Publish to CDN</button>`);
  }
  actions.push(`<button class="portal-button portal-button-secondary" data-version-action="download" data-version-id="${version.id}">Download</button>`);
  if (version.public_url) {
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="copy" data-version-id="${version.id}">Copy URL</button>`);
  }
  return actions.join("");
}

async function hydrateAssetPreviews() {
  const previews = Array.from(assetGrid.querySelectorAll("[data-preview-version]"));
  await Promise.all(previews.map(async (preview) => {
    const version = versions.find((row) => row.id === preview.dataset.previewVersion);
    if (!version || !String(version.mime_type || "").startsWith("image/")) return;
    let url = version.public_url;
    if (!url) {
      const { data, error } = await supabase.storage
        .from(version.storage_bucket)
        .createSignedUrl(version.storage_path, 600);
      if (error) return;
      url = data.signedUrl;
    }
    const image = preview.querySelector("img");
    const fallback = preview.querySelector(".portal-asset-preview-fallback");
    if (!image || !url) return;
    image.addEventListener("load", () => {
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    }, { once: true });
    image.src = url;
  }));
}

function renderAssets() {
  renderAssetBatchActions();
  if (!selectedWebsite || !assets.length) {
    assetGrid.innerHTML = "";
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = selectedWebsite
      ? "No assets have been added for this website."
      : "No managed websites are available yet.";
    return;
  }

  emptyState.hidden = true;
  assetGrid.innerHTML = assets.map((asset) => {
    const assetVersions = versions.filter((version) => version.asset_id === asset.id);
    const previewVersion = assetVersions.find((version) => String(version.mime_type || "").startsWith("image/"));
    return `
      <article class="portal-asset-card">
        <div class="portal-asset-preview"${previewVersion ? ` data-preview-version="${previewVersion.id}"` : ""}>
          <img alt="" hidden>
          <div class="portal-asset-preview-fallback">${escapeHtml(asset.category || "asset")}</div>
        </div>
        <div class="portal-asset-body">
          <div class="portal-asset-head">
            <div>
              <p class="portal-kicker">${escapeHtml(asset.category || "asset")}</p>
              <h3>${escapeHtml(asset.label)}</h3>
              <p><code>${escapeHtml(asset.asset_key)}</code> · ${escapeHtml((asset.replacement_type || "download_only").replaceAll("_", " "))}</p>
            </div>
            <span class="portal-badge">${assetVersions.length} version${assetVersions.length === 1 ? "" : "s"}</span>
          </div>
          <div class="portal-version-list">
            ${assetVersions.length ? assetVersions.map((version) => `
              <div class="portal-version">
                <div>
                  <strong>Version ${version.version_number}</strong>
                  <span class="portal-badge portal-status-${escapeHtml(version.status)}">${escapeHtml(version.status.replaceAll("_", " "))}</span>
                  <p>${escapeHtml(version.original_filename)}${version.size_bytes ? ` · ${formatBytes(version.size_bytes)}` : ""}</p>
                  <p>${formatDate(version.created_at)}${version.change_note ? ` · ${escapeHtml(version.change_note)}` : ""}</p>
                </div>
                <div class="portal-card-actions">${versionActions(version)}</div>
              </div>
            `).join("") : "<p>No versions uploaded.</p>"}
          </div>
        </div>
      </article>
    `;
  }).join("");
  void hydrateAssetPreviews();
}

function renderAssetBatchActions() {
  if (!approvePendingBatchButton || !publishApprovedBatchButton || !copyPublishedLinksButton) return;
  const pendingCount = versions.filter((version) => version.status === "pending_review").length;
  const approvedCount = getPublishableApprovedVersions().length;
  const publishedCount = getCurrentPublishedLinks().length;
  approvePendingBatchButton.hidden = pendingCount === 0;
  approvePendingBatchButton.textContent = `Approve pending (${pendingCount})`;
  publishApprovedBatchButton.hidden = approvedCount === 0;
  publishApprovedBatchButton.textContent = `Publish approved (${approvedCount})`;
  copyPublishedLinksButton.hidden = publishedCount === 0;
  copyPublishedLinksButton.textContent = `Copy published links (${publishedCount})`;
}

function getCurrentPublishedLinks() {
  return assets.flatMap((asset) => {
    const version = versions.find((row) => row.id === asset.current_version_id && row.public_url);
    return version ? [{ label: asset.label, url: version.public_url }] : [];
  });
}

function getPublishableApprovedVersions() {
  const newestByAsset = new Map();
  versions.forEach((version) => {
    if (version.status !== "approved" || !String(version.mime_type || "").startsWith("image/")) return;
    const current = newestByAsset.get(version.asset_id);
    if (!current || Number(version.version_number) > Number(current.version_number)) {
      newestByAsset.set(version.asset_id, version);
    }
  });
  return Array.from(newestByAsset.values());
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

async function selectWebsite(id) {
  selectedWebsite = websites.find((site) => site.id === id) || websites[0];
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
  const { data, error } = await supabase.from("client_websites").select("*").order("name");
  if (error) throw error;
  websites = data || [];
  renderWebsiteOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("website")
    || readWorkspaceContext("admin", currentUser?.id).websiteId;
  await selectWebsite(websites.some((site) => site.id === requested) ? requested : websites[0]?.id);
}

async function updateVersionStatus(versionId, status) {
  const now = new Date().toISOString();
  const values = status === "approved"
    ? { status, approved_by_user_id: currentUser.id, approved_at: now, rejection_reason: null }
    : { status, rejected_by_user_id: currentUser.id, rejected_at: now, rejection_reason: window.prompt("Optional rejection note:") || null };
  const { error } = await supabase.from("website_asset_versions").update(values).eq("id", versionId);
  if (error) throw error;
  await loadAssets();
}

async function publishVersion(versionId, { reload = true, copyUrl = true } = {}) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  if (!version || !asset) throw new Error("This asset version is no longer available.");

  const publicPath = `${selectedWebsite.id}/${asset.id}/v${version.version_number}-${safeFilename(version.original_filename)}`;
  const { error: copyError } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .copy(version.storage_path, publicPath, { destinationBucket: PUBLIC_BUCKET });
  if (copyError && !/already exists|duplicate/i.test(copyError.message || "")) throw copyError;

  const { data: urlData } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(publicPath);
  const publicUrl = urlData.publicUrl;
  const now = new Date().toISOString();
  const { error: versionError } = await supabase.from("website_asset_versions").update({
    status: "published",
    public_url: publicUrl,
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
  showToast(copied ? "Published to the CDN and copied the URL." : "Published to the CDN. Use Copy URL when you need the link.");
}

async function approvePendingBatch() {
  const pendingVersions = versions.filter((version) => version.status === "pending_review");
  if (!pendingVersions.length) return;
  if (!window.confirm(`Approve ${pendingVersions.length} pending file${pendingVersions.length === 1 ? "" : "s"} for ${selectedWebsite.name}?`)) return;

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
    await loadAssets();
  } catch (error) {
    batchStatus.textContent = error?.message || "The pending files could not be approved.";
    showToast(batchStatus.textContent, "error");
  } finally {
    approvePendingBatchButton.disabled = false;
    publishApprovedBatchButton.disabled = false;
  }
}

async function publishApprovedBatch() {
  const approvedVersions = getPublishableApprovedVersions();
  if (!approvedVersions.length) return;
  if (!window.confirm(`Publish ${approvedVersions.length} approved image${approvedVersions.length === 1 ? "" : "s"} to the CDN for ${selectedWebsite.name}?`)) return;

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
  if (version.public_url) {
    window.open(version.public_url, "_blank", "noopener");
    return;
  }
  const { data, error } = await supabase.storage
    .from(version.storage_bucket)
    .createSignedUrl(version.storage_path, 600, { download: version.original_filename });
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener");
}

async function handleAssetAction(event) {
  const button = event.target.closest("[data-version-action]");
  if (!button) return;
  const version = versions.find((row) => row.id === button.dataset.versionId);
  if (!version) return;
  button.disabled = true;
  try {
    if (button.dataset.versionAction === "approve") await updateVersionStatus(version.id, "approved");
    if (button.dataset.versionAction === "reject") await updateVersionStatus(version.id, "rejected");
    if (button.dataset.versionAction === "publish") await publishVersion(version.id);
    if (button.dataset.versionAction === "download") await downloadVersion(version);
    if (button.dataset.versionAction === "copy") {
      await navigator.clipboard.writeText(version.public_url);
      button.textContent = "Copied";
    }
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
  setSiteFormStatus("Creating website…");
  const slug = slugify(siteSlugInput.value);
  try {
    if (!slug) throw new Error("Enter a valid website slug.");
    const { data, error } = await supabase.from("client_websites").insert({
      name: siteNameInput.value.trim(),
      slug,
      live_url: siteLiveUrlInput.value.trim() || null,
      repository_full_name: siteRepositoryInput.value.trim() || null,
      status: "active",
    }).select().single();
    if (error) throw error;
    siteForm.reset();
    setSiteFormStatus("Website created.");
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

  supabase = createBrowserSupabase();
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.user) {
      openLogin();
      return;
    }
    currentUser = sessionData.session.user;

    if (!await verifyPlatformAdmin(supabase, currentUser)) {
      document.body.classList.add("portal-denied");
      showStatus("You do not have access to website administration.");
      return;
    }

    await loadWebsites();
    document.body.classList.remove("portal-loading");
    statusScreen.hidden = true;

    websiteSelect?.addEventListener("change", () => selectWebsite(websiteSelect.value).catch((loadError) => showToast(loadError.message, "error")));
    refreshButton?.addEventListener("click", () => loadWebsites(selectedWebsite?.id).catch((loadError) => showToast(loadError.message, "error")));
    copyPublishedLinksButton?.addEventListener("click", copyPublishedLinks);
    approvePendingBatchButton?.addEventListener("click", approvePendingBatch);
    publishApprovedBatchButton?.addEventListener("click", publishApprovedBatch);
    assetGrid?.addEventListener("click", handleAssetAction);
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
      siteForm.hidden = false;
      siteNameInput.focus();
    });
    closeSiteFormButton?.addEventListener("click", () => {
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
