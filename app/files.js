import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { buildPreviewUrl, getDownloadFilename } from "./lib/document-links.js";
import { buildDocumentMetadata, getDocumentDisplayTitle } from "./lib/document-presenters.js";
import { closeFilePreviewModal, openFilePreviewModal } from "./lib/file-modal.js";
import {
  buildMembershipMap,
  dedupeMembershipsByOrganization,
  formatRoleLabel,
  getCapabilities,
  getMembershipRole,
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
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const filesNoAccessNotice = document.getElementById("files-no-access-notice");
const filesActiveOrganizationField = document.getElementById("files-active-organization-field");
const filesActiveMembershipField = document.getElementById("files-active-membership-field");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const documentCount = document.getElementById("document-count");
const filesRecordingsLink = document.getElementById("files-recordings-link");
const fileList = document.getElementById("file-list");
const fileEmpty = document.getElementById("file-empty");
const fileStatus = document.getElementById("file-status");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalFrame = document.getElementById("file-modal-frame");
const fileModalDownload = document.getElementById("file-modal-download");
const fileModalShare = document.getElementById("file-modal-share");
const fileModalEdit = document.getElementById("file-modal-edit");
const fileModalDelete = document.getElementById("file-modal-delete");
const fileModalClose = document.getElementById("file-modal-close");
const deleteConfirmModal = document.getElementById("delete-confirm-modal");
const deleteConfirmCopy = document.getElementById("delete-confirm-copy");
const deleteConfirmCancel = document.getElementById("delete-confirm-cancel");
const deleteConfirmSubmit = document.getElementById("delete-confirm-submit");
const fileEditModal = document.getElementById("file-edit-modal");
const fileEditClose = document.getElementById("file-edit-close");
const fileEditForm = document.getElementById("file-edit-form");
const fileEditTitle = document.getElementById("file-edit-title");
const fileEditYear = document.getElementById("file-edit-year");
const fileEditMonth = document.getElementById("file-edit-month");
const fileEditPublic = document.getElementById("file-edit-public");
const fileEditAiNote = document.getElementById("file-edit-ai-note");
const fileEditFilename = document.getElementById("file-edit-filename");
const fileEditSave = document.getElementById("file-edit-save");
const fileEditStatus = document.getElementById("file-edit-status");

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let documentsCache = [];
let pendingDeleteId = null;
let activeModalDocumentId = null;
let pendingEditId = null;

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

function closeFileActionMenus(exceptId = "") {
  fileList.querySelectorAll(".file-row-controls.is-open").forEach((controls) => {
    const toggle = controls.querySelector("[data-menu-toggle]");
    const row = controls.closest(".file-row");
    if (!toggle) return;
    if (exceptId && toggle.getAttribute("data-id") === exceptId) return;
    controls.classList.remove("is-open");
    row?.classList.remove("is-actions-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Action";
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function isMissingAiNoteSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("records_ai_note") && (message.includes("does not exist") || message.includes("schema cache"));
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

function getActiveOrganization() {
  return activeMembership?.organization || null;
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

function isFreePlanExperience() {
  return getActiveOrganization()?.subscription_tier === "free";
}

function hasMultipleLibraries() {
  return memberships.length > 1;
}

function renderOrganizationSelector() {
  if (!memberships.length || !getActiveOrganization()) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeMembershipRole.textContent = "No library access";
    documentCount.textContent = "0";
    activeOrganizationSelect.disabled = true;
    show(filesNoAccessNotice, true);
    show(filesActiveOrganizationField, false);
    show(filesActiveMembershipField, false);
    show(mobileMenuRecordingsLink, false);
    show(filesRecordingsLink, false);
    return;
  }

  const currentId = getActiveOrganization()?.id || "";
  activeOrganizationSelect.innerHTML = memberships
    .map((membership) => {
      const selected = membership.organization?.id === currentId ? " selected" : "";
      return `<option value="${escapeHtml(membership.organization?.id || "")}"${selected}>${escapeHtml(membership.organization?.name || "Untitled library")}</option>`;
    })
    .join("");
  activeMembershipRole.textContent = formatRoleLabel(getMembershipRole(activeMembership));
  const capabilities = getActiveCapabilities();
  fileModalDelete.disabled = !capabilities.canDeleteDocuments;
  show(filesNoAccessNotice, false);
  show(filesActiveOrganizationField, hasMultipleLibraries());
  show(filesActiveMembershipField, hasMultipleLibraries());
  show(mobileMenuRecordingsLink, capabilities.canUseRecordings);
  show(filesRecordingsLink, capabilities.canUseRecordings);
  activeOrganizationSelect.disabled = !hasMultipleLibraries();
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
        account_status,
        owner_user_id
      )
    `)
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  memberships = dedupeMembershipsByOrganization(buildMembershipMap(data || []));
  activeMembership = resolveActiveOrganization(memberships, String(bootstrapData?.active_organization_id || ""));
  if (activeMembership?.organization?.id) {
    setStoredActiveOrganizationId(activeMembership.organization.id);
  } else {
    setStoredActiveOrganizationId("");
  }
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("./login.html");
}

async function loadDocuments() {
  const organization = getActiveOrganization();
  if (!organization) {
    documentsCache = [];
    documentCount.textContent = "0";
    fileList.innerHTML = "";
    show(fileEmpty, false);
    setStatus(fileStatus, "");
    renderOrganizationSelector();
    return;
  }

  setStatus(fileStatus, "Loading files...");
  let { data, error } = await supabase
    .from("documents")
    .select("id, title, original_filename, storage_path, year, month, is_public, records_ai_note, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (error && isMissingAiNoteSchemaError(error)) {
    const fallback = await supabase
      .from("documents")
      .select("id, title, original_filename, storage_path, year, month, is_public, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }

  documentsCache = sortDocumentsNewestToOldest(Array.isArray(data) ? data : []);
  documentCount.textContent = String(documentsCache.length);
  renderFiles();
  setStatus(fileStatus, `${documentsCache.length} file${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

function renderFiles() {
  fileList.innerHTML = "";
  show(fileEmpty, documentsCache.length === 0);

  documentsCache.forEach((doc) => {
    const capabilities = getActiveCapabilities();
    const actionButtons = [];
    if (capabilities.canEditDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="edit" data-id="${doc.id}">Edit</button>`);
      actionButtons.push(`<button class="btn secondary" type="button" data-action="make-editable" data-id="${doc.id}">Make editable</button>`);
    }
    if (capabilities.canDownloadDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="download" data-id="${doc.id}">Download</button>`);
    }
    if (capabilities.canShareDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="share" data-id="${doc.id}">Share</button>`);
    }
    if (capabilities.canEditDocuments) {
      actionButtons.push(
        `<button class="btn secondary" type="button" data-action="toggle-public" data-id="${doc.id}">${doc.is_public ? "Make private" : "Make public"}</button>`
      );
    }
    if (capabilities.canDeleteDocuments) {
      actionButtons.push(`<button class="btn warn" type="button" data-action="delete" data-id="${doc.id}">Delete</button>`);
    }
    const item = document.createElement("article");
    const actionMenuId = `file-actions-${doc.id}`;
    item.className = "download-item file-row";
    item.setAttribute("data-open-id", doc.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
      <div class="file-row-main">
        <p class="download-name">${escapeHtml(getDocumentDisplayTitle(doc))}</p>
        <p class="download-meta">${escapeHtml(buildDocumentMetadata(doc, { includeVisibility: true, includeCreatedAt: false }))}</p>
      </div>
      <div class="file-row-controls">
        <button class="btn secondary file-row-menu-toggle" type="button" data-menu-toggle data-id="${doc.id}" aria-expanded="false" aria-controls="${actionMenuId}">Action</button>
        <div class="doc-actions file-row-actions" id="${actionMenuId}">
          ${actionButtons.join("")}
        </div>
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

async function createDownloadSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const downloadName = getDownloadFilename(doc);
  const { data, error } = await supabase
    .storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60 * 60, { download: downloadName });
  if (error || !data?.signedUrl) {
    setStatus(fileStatus, error?.message || "Unable to create download URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function openFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const downloadSigned = await createDownloadSignedUrlForDocument(documentId);
  const { doc, signedUrl } = signed;
  const capabilities = getActiveCapabilities();

  activeModalDocumentId = documentId;
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
  show(fileModalShare, capabilities.canShareDocuments);
  show(fileModalEdit, capabilities.canEditDocuments);
  show(fileModalDelete, capabilities.canDeleteDocuments);
}

async function downloadFile(documentId) {
  const signed = await createDownloadSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  const link = document.createElement("a");
  link.href = signedUrl;
  link.download = getDownloadFilename(doc);
  link.target = "_blank";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

function closeFileModal() {
  closeFilePreviewModal({ modal: fileModal, frame: fileModalFrame });
  activeModalDocumentId = null;
}

function openFileEditModal(documentId) {
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileStatus, "You do not have permission to edit this file.", "error");
    return;
  }
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;
  pendingEditId = documentId;
  fileEditTitle.value = doc.title || doc.original_filename || "";
  fileEditYear.value = doc.year || "";
  fileEditMonth.value = doc.month || "";
  fileEditPublic.checked = Boolean(doc.is_public);
  fileEditAiNote.value = doc.records_ai_note || "";
  fileEditFilename.textContent = doc.original_filename || "-";
  setStatus(fileEditStatus, "");
  fileEditSave.disabled = false;
  fileEditModal.classList.add("is-open");
  fileEditModal.setAttribute("aria-hidden", "false");
}

function closeFileEditModal() {
  pendingEditId = null;
  fileEditModal.classList.remove("is-open");
  fileEditModal.setAttribute("aria-hidden", "true");
  fileEditForm.reset();
  setStatus(fileEditStatus, "");
}

async function saveFileEdit(event) {
  event.preventDefault();
  if (!pendingEditId) return;
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileEditStatus, "You do not have permission to edit this file.", "error");
    return;
  }

  const doc = documentsCache.find((item) => item.id === pendingEditId);
  if (!doc) return;

  fileEditSave.disabled = true;
  setStatus(fileEditStatus, "Saving...");

  const updates = {
    title: fileEditTitle.value.trim() || doc.original_filename || "Untitled document",
    year: fileEditYear.value.trim() || null,
    month: fileEditMonth.value.trim() || null,
    is_public: fileEditPublic.checked,
    records_ai_note: fileEditAiNote.value.trim() || null,
  };

  const { error } = await supabase.from("documents").update(updates).eq("id", pendingEditId);
  if (error) {
    fileEditSave.disabled = false;
    setStatus(
      fileEditStatus,
      isMissingAiNoteSchemaError(error) ? "Run the Records AI settings schema before saving file AI notes." : error.message,
      "error"
    );
    return;
  }

  closeFileEditModal();
  setStatus(fileStatus, "File details updated.", "success");
  await loadDocuments();
}

function openDeleteConfirm(documentId) {
  if (!getActiveCapabilities().canDeleteDocuments) {
    setStatus(fileStatus, "You do not have permission to delete files in this library.", "error");
    return;
  }
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
  const { signedUrl } = signed;

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
  if (!getActiveCapabilities().canDeleteDocuments) {
    setStatus(fileStatus, "You do not have permission to delete files in this library.", "error");
    return;
  }

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
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileStatus, "You do not have permission to change file visibility.", "error");
    return;
  }

  const { error } = await supabase.from("documents").update({ is_public: !doc.is_public }).eq("id", documentId);
  if (error) {
    setStatus(fileStatus, error.message, "error");
    return;
  }

  setStatus(fileStatus, `Document is now ${doc.is_public ? "private" : "public"}.`, "success");
  await loadDocuments();
}

function textToTiptapDocument(text) {
  const paragraphs = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    type: "doc",
    content: paragraphs.length
      ? paragraphs.map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      }))
      : [{ type: "paragraph" }],
  };
}

async function makeFileEditable(documentId) {
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileStatus, "You do not have permission to create editable documents in this library.", "error");
    return;
  }

  setStatus(fileStatus, "Creating editable document...");
  const { data: sourceDoc, error: sourceError } = await supabase
    .from("documents")
    .select("id, organization_id, title, original_filename, extracted_text")
    .eq("id", documentId)
    .single();

  if (sourceError || !sourceDoc) {
    setStatus(fileStatus, sourceError?.message || "Unable to load source file text.", "error");
    return;
  }

  const contentJson = textToTiptapDocument(sourceDoc.extracted_text || "");
  const plainText = String(sourceDoc.extracted_text || "").trim();
  const title = sourceDoc.title || String(sourceDoc.original_filename || "Untitled document").replace(/\.[^.]+$/, "");
  const { data, error } = await supabase
    .from("app_documents")
    .insert({
      organization_id: sourceDoc.organization_id,
      source_document_id: sourceDoc.id,
      created_by_user_id: currentSession.user.id,
      title,
      content_json: contentJson,
      plain_text: plainText,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    const message = String(error.message || "").toLowerCase().includes("app_documents")
      ? "Run the app_documents migration before converting files to editable documents."
      : error.message;
    setStatus(fileStatus, message, "error");
    return;
  }

  window.location.href = `./documents.html?id=${encodeURIComponent(data.id)}`;
}

async function handleFileAction(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const menuToggle = target.closest("button[data-menu-toggle]");
  if (menuToggle) {
    const controls = menuToggle.closest(".file-row-controls");
    const row = menuToggle.closest(".file-row");
    const id = menuToggle.getAttribute("data-id") || "";
    const nextOpen = !controls?.classList.contains("is-open");
    closeFileActionMenus(nextOpen ? id : "");
    controls?.classList.toggle("is-open", nextOpen);
    row?.classList.toggle("is-actions-open", nextOpen);
    menuToggle.setAttribute("aria-expanded", String(nextOpen));
    menuToggle.textContent = nextOpen ? "Close" : "Action";
    return;
  }

  const button = target.closest("button[data-action]");
  if (button) {
    const action = button.getAttribute("data-action");
    const id = button.getAttribute("data-id");
    if (!id || !action) return;
    closeFileActionMenus();

    if (action === "edit") openFileEditModal(id);
    if (action === "download") await downloadFile(id);
    if (action === "share") await shareFile(id);
    if (action === "delete") openDeleteConfirm(id);
    if (action === "toggle-public") await togglePublic(id);
    if (action === "make-editable") await makeFileEditable(id);
    return;
  }

  const row = target.closest("[data-open-id]");
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

  show(setupPanel, false);
  show(filesPanel, true);
  setMenuActive("library");
  try {
    await bootstrapAccess();
    renderOrganizationSelector();
    await loadDocuments();
  } catch (error) {
    memberships = [];
    activeMembership = null;
    documentsCache = [];
    renderOrganizationSelector();
    fileList.innerHTML = "";
    show(fileEmpty, false);
    setStatus(fileStatus, error?.message || "Unable to load files.", "error");
  }

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
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button[data-action], button[data-menu-toggle]")) return;
    const row = target.closest("[data-open-id]");
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
  fileModalEdit.addEventListener("click", () => {
    if (!activeModalDocumentId) return;
    openFileEditModal(activeModalDocumentId);
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
  fileEditClose.addEventListener("click", closeFileEditModal);
  fileEditForm.addEventListener("submit", saveFileEdit);
  deleteConfirmModal.addEventListener("click", (event) => {
    if (event.target === deleteConfirmModal) closeDeleteConfirm();
  });
  fileEditModal.addEventListener("click", (event) => {
    if (event.target === fileEditModal) closeFileEditModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fileModal.classList.contains("is-open")) {
      closeFileModal();
      return;
    }
    if (event.key === "Escape" && fileEditModal.classList.contains("is-open")) {
      closeFileEditModal();
      return;
    }
    if (event.key === "Escape" && deleteConfirmModal.classList.contains("is-open")) {
      closeDeleteConfirm();
      return;
    }
    if (event.key === "Escape") closeFileActionMenus();
    if (event.key === "Escape") closeMobileMenu();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && !target.closest(".file-row-controls")) {
      closeFileActionMenus();
    }
    if (!mobileMenu.classList.contains("is-open")) return;
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
