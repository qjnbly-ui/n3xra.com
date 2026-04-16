import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import {
  buildMembershipMap,
  canManageLibrary,
  formatRoleLabel,
  isPlatformAdminEmail,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
} from "./lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const filesPanel = document.getElementById("files-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const filesActiveOrganizationField = document.getElementById("files-active-organization-field");
const filesActiveMembershipField = document.getElementById("files-active-membership-field");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const documentCount = document.getElementById("document-count");
const fileList = document.getElementById("file-list");
const fileEmpty = document.getElementById("file-empty");
const fileStatus = document.getElementById("file-status");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalFrame = document.getElementById("file-modal-frame");
const fileModalDownload = document.getElementById("file-modal-download");
const fileModalShare = document.getElementById("file-modal-share");
const fileModalDelete = document.getElementById("file-modal-delete");
const fileModalClose = document.getElementById("file-modal-close");
const deleteConfirmModal = document.getElementById("delete-confirm-modal");
const deleteConfirmCopy = document.getElementById("delete-confirm-copy");
const deleteConfirmCancel = document.getElementById("delete-confirm-cancel");
const deleteConfirmSubmit = document.getElementById("delete-confirm-submit");

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let documentsCache = [];
let pendingDeleteId = null;
let activeModalDocumentId = null;

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
  mobileMenu.classList.remove("is-open");
  mobileMenu.classList.add("hidden");
  mobileMenuToggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const nextOpen = !mobileMenu.classList.contains("is-open");
  mobileMenu.classList.toggle("is-open", nextOpen);
  mobileMenu.classList.toggle("hidden", !nextOpen);
  mobileMenuToggle.setAttribute("aria-expanded", String(nextOpen));
}

function setMenuActive(section) {
  mobileMenuAccount.classList.toggle("is-active", section === "account");
  mobileMenuLibrary.classList.toggle("is-active", section === "library");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPreviewUrl(doc, signedUrl) {
  const lowerName = String(doc?.original_filename || "").toLowerCase();
  if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
  }
  return signedUrl;
}

function getActiveOrganization() {
  return activeMembership?.organization || null;
}

function isFreePlanExperience() {
  return getActiveOrganization()?.subscription_tier === "free";
}

function hasMultipleLibraries() {
  return memberships.length > 1;
}

function renderOrganizationSelector() {
  const currentId = getActiveOrganization()?.id || "";
  activeOrganizationSelect.innerHTML = memberships
    .map((membership) => {
      const selected = membership.organization?.id === currentId ? " selected" : "";
      return `<option value="${escapeHtml(membership.organization?.id || "")}"${selected}>${escapeHtml(membership.organization?.name || "Untitled library")}</option>`;
    })
    .join("");
  activeMembershipRole.textContent = formatRoleLabel(activeMembership?.role || "viewer");
  fileModalDelete.disabled = !canManageLibrary(activeMembership?.role, isPlatformAdminEmail(currentSession.user.email));
  show(filesActiveOrganizationField, hasMultipleLibraries());
  show(filesActiveMembershipField, hasMultipleLibraries());
  activeOrganizationSelect.disabled = !hasMultipleLibraries();
}

async function bootstrapAccess() {
  const { error: bootstrapError } = await supabase.rpc("bootstrap_organization", {
    input_organization_name: null,
    input_invite_code: null,
  });
  if (bootstrapError) throw bootstrapError;

  const { data, error } = await supabase
    .from("organization_memberships")
    .select(`
      id,
      organization_id,
      role,
      organization:organizations(
        id,
        name,
        subscription_tier,
        account_status,
        owner_user_id
      )
    `)
    .order("created_at", { ascending: true });

  if (error) throw error;

  memberships = buildMembershipMap(data || []);
  activeMembership = resolveActiveOrganization(memberships);
  if (!activeMembership) throw new Error("No libraries available for this account.");
  setStoredActiveOrganizationId(activeMembership.organization.id);
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }
  window.location.replace("./login.html");
}

async function loadDocuments() {
  const organization = getActiveOrganization();
  if (!organization) return;

  setStatus(fileStatus, "Loading files...");
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, original_filename, storage_path, year, month, is_public, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }

  documentsCache = Array.isArray(data) ? data : [];
  documentCount.textContent = String(documentsCache.length);
  renderFiles();
  setStatus(fileStatus, `${documentsCache.length} file${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

function renderFiles() {
  fileList.innerHTML = "";
  show(fileEmpty, documentsCache.length === 0);

  documentsCache.forEach((doc) => {
    const canEdit = canManageLibrary(activeMembership?.role, isPlatformAdminEmail(currentSession.user.email));
    const item = document.createElement("article");
    item.className = "download-item file-row";
    item.setAttribute("data-open-id", doc.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
      <div class="file-row-main">
        <p class="download-name">${escapeHtml(doc.title || doc.original_filename || "Untitled document")}</p>
        <p class="download-meta">${escapeHtml(doc.original_filename || "Unknown file")}${doc.year ? ` · ${escapeHtml(doc.year)}` : ""}${doc.month ? ` · ${escapeHtml(doc.month)}` : ""}${doc.is_public ? " · Public" : " · Private"}</p>
      </div>
      <div class="doc-actions file-row-actions">
        <button class="btn secondary" type="button" data-action="download" data-id="${doc.id}">Download</button>
        <button class="btn secondary" type="button" data-action="share" data-id="${doc.id}">Share</button>
        <button class="btn secondary" type="button" data-action="toggle-public" data-id="${doc.id}"${canEdit ? "" : " disabled"}>${doc.is_public ? "Make private" : "Make public"}</button>
        <button class="btn warn" type="button" data-action="delete" data-id="${doc.id}"${canEdit ? "" : " disabled"}>Delete</button>
      </div>
    `;
    fileList.append(item);
  });
}

async function createSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60);
  if (error || !data?.signedUrl) {
    setStatus(fileStatus, error?.message || "Unable to create signed URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function openFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  activeModalDocumentId = documentId;
  fileModalTitle.textContent = doc.title || doc.original_filename || "File preview";
  fileModalFrame.src = buildPreviewUrl(doc, signedUrl);
  fileModalDownload.href = signedUrl;
  fileModalDownload.setAttribute("download", doc.original_filename || "download");
  fileModal.classList.add("is-open");
  fileModal.setAttribute("aria-hidden", "false");
}

async function downloadFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  const link = document.createElement("a");
  link.href = signedUrl;
  link.download = doc.original_filename || "download";
  link.target = "_blank";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

function closeFileModal() {
  fileModal.classList.remove("is-open");
  fileModal.setAttribute("aria-hidden", "true");
  fileModalFrame.src = "";
  activeModalDocumentId = null;
}

function openDeleteConfirm(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;

  pendingDeleteId = documentId;
  deleteConfirmCopy.textContent = `Delete "${doc.title || doc.original_filename || "this file"}"? This action cannot be undone.`;
  deleteConfirmModal.classList.add("is-open");
  deleteConfirmModal.setAttribute("aria-hidden", "false");
}

function closeDeleteConfirm() {
  pendingDeleteId = null;
  deleteConfirmModal.classList.remove("is-open");
  deleteConfirmModal.setAttribute("aria-hidden", "true");
}

async function shareFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  if (navigator.share) {
    try {
      await navigator.share({
        title: doc.title || doc.original_filename || "Shared file",
        text: `Shared from Records Database: ${doc.title || doc.original_filename || "File"}`,
        url: signedUrl,
      });
      setStatus(fileStatus, "Share sheet opened.", "success");
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(signedUrl);
    setStatus(fileStatus, "Share link copied to clipboard.", "success");
    return;
  }

  setStatus(fileStatus, "Sharing is not available on this device.", "error");
}

async function deleteFile(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;

  setStatus(fileStatus, "Deleting file...");
  deleteConfirmSubmit.disabled = true;
  deleteConfirmCancel.disabled = true;

  const { error: storageError } = await supabase.storage.from("documents").remove([doc.storage_path]);
  if (storageError) {
    deleteConfirmSubmit.disabled = false;
    deleteConfirmCancel.disabled = false;
    setStatus(fileStatus, storageError.message, "error");
    return;
  }

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", documentId);
  if (deleteError) {
    deleteConfirmSubmit.disabled = false;
    deleteConfirmCancel.disabled = false;
    setStatus(fileStatus, deleteError.message, "error");
    return;
  }

  deleteConfirmSubmit.disabled = false;
  deleteConfirmCancel.disabled = false;
  closeDeleteConfirm();
  closeFileModal();
  setStatus(fileStatus, "File deleted.", "success");
  await loadDocuments();
}

async function togglePublic(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;

  const { error } = await supabase.from("documents").update({ is_public: !doc.is_public }).eq("id", documentId);
  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }

  setStatus(fileStatus, `Document is now ${doc.is_public ? "private" : "public"}.`, "success");
  await loadDocuments();
}

async function handleFileAction(event) {
  const button = event.target.closest("button[data-action]");
  if (button) {
    const action = button.getAttribute("data-action");
    const id = button.getAttribute("data-id");
    if (!id || !action) return;

    if (action === "download") await downloadFile(id);
    if (action === "share") await shareFile(id);
    if (action === "delete") openDeleteConfirm(id);
    if (action === "toggle-public") await togglePublic(id);
    return;
  }

  const row = event.target.closest("[data-open-id]");
  if (!row) return;
  const id = row.getAttribute("data-open-id");
  if (!id) return;
  await openFile(id);
}

async function handleOrganizationChange() {
  const nextOrganizationId = activeOrganizationSelect.value;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;
  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);
  renderOrganizationSelector();
  await loadDocuments();
}

async function init() {
  show(setupPanel, !hasConfig());
  show(filesPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login.html");
    return;
  }

  if (isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("./admin.html");
    return;
  }

  await bootstrapAccess();

  show(setupPanel, false);
  show(filesPanel, true);
  setMenuActive("library");
  renderOrganizationSelector();
  await loadDocuments();

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.href = "./dashboard.html?section=account";
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.href = "./dashboard.html?section=library";
  });
  activeOrganizationSelect.addEventListener("change", handleOrganizationChange);
  fileList.addEventListener("click", handleFileAction);
  fileList.addEventListener("keydown", async (event) => {
    const row = event.target.closest("[data-open-id]");
    if (!row) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const id = row.getAttribute("data-open-id");
    if (!id) return;
    await openFile(id);
  });
  fileModalClose.addEventListener("click", closeFileModal);
  fileModalShare.addEventListener("click", async () => {
    if (!activeModalDocumentId) return;
    await shareFile(activeModalDocumentId);
  });
  fileModalDelete.addEventListener("click", () => {
    if (!activeModalDocumentId) return;
    openDeleteConfirm(activeModalDocumentId);
  });
  fileModal.addEventListener("click", (event) => {
    if (event.target === fileModal) closeFileModal();
  });
  deleteConfirmCancel.addEventListener("click", closeDeleteConfirm);
  deleteConfirmSubmit.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    await deleteFile(pendingDeleteId);
  });
  deleteConfirmModal.addEventListener("click", (event) => {
    if (event.target === deleteConfirmModal) closeDeleteConfirm();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fileModal.classList.contains("is-open")) {
      closeFileModal();
      return;
    }
    if (event.key === "Escape" && deleteConfirmModal.classList.contains("is-open")) {
      closeDeleteConfirm();
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
