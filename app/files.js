import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import JSZip from "https://esm.sh/jszip@3.10.1";
import mammoth from "https://esm.sh/mammoth@1.8.0/mammoth.browser";
import { createAppDocumentPdfObjectUrl, getAppDocumentPdfFilename } from "./lib/app-document-pdf.js";
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
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
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
const fileModalOpenEditable = document.getElementById("file-modal-open-editable");
const fileModalOriginal = document.getElementById("file-modal-original");
const fileModalEdit = document.getElementById("file-modal-edit");
const fileModalDelete = document.getElementById("file-modal-delete");
const fileModalClose = document.getElementById("file-modal-close");
const deleteConfirmModal = document.getElementById("delete-confirm-modal");
const deleteConfirmCopy = document.getElementById("delete-confirm-copy");
const deleteAssociatedOption = document.getElementById("delete-associated-option");
const deleteAssociatedInput = document.getElementById("delete-associated-data");
const deleteAssociatedSummary = document.getElementById("delete-associated-summary");
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
let activeModalObjectUrl = "";
let editableDocumentsBySourceId = new Map();
let pendingDeleteAssociations = {
  documentId: "",
  appDocuments: [],
  recordings: [],
};

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "status";
  if (tone) el.classList.add(tone);
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
  mobileMenuFilesLink?.classList.toggle("is-active", section === "files");
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

function consumeLinkedDocumentId() {
  const url = new URL(window.location.href);
  const documentId = url.searchParams.get("id") || "";
  if (!documentId) return "";

  url.searchParams.delete("id");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  return documentId;
}

function resetDeleteAssociations() {
  pendingDeleteAssociations = {
    documentId: "",
    appDocuments: [],
    recordings: [],
  };
  if (deleteAssociatedInput) {
    deleteAssociatedInput.checked = false;
  }
  show(deleteAssociatedOption, false);
  if (deleteAssociatedSummary) {
    deleteAssociatedSummary.textContent = "";
  }
}

function isIgnorableStorageDeleteError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not found") || message.includes("no such object") || message.includes("does not exist");
}

function formatDeleteAssociationSummary(associations) {
  const parts = [];
  const editableCount = associations.appDocuments.length;
  const recordingCount = associations.recordings.length;

  if (editableCount) {
    parts.push(`${editableCount} editable document${editableCount === 1 ? "" : "s"}`);
  }
  if (recordingCount) {
    parts.push(`${recordingCount} linked recording${recordingCount === 1 ? "" : "s"} and audio file${recordingCount === 1 ? "" : "s"}`);
  }
  if (!parts.length) return "";
  return `${parts.join(" and ")} will also be deleted. If unchecked, they stay in the app but lose this file link.`;
}

async function loadDeleteAssociations(documentId) {
  const [appDocumentsResult, recordingsResult] = await Promise.all([
    supabase
      .from("app_documents")
      .select("id, title, document_kind")
      .eq("source_document_id", documentId),
    supabase
      .from("meeting_recordings")
      .select("id, title, storage_path")
      .eq("document_id", documentId),
  ]);

  if (appDocumentsResult.error) throw appDocumentsResult.error;
  if (recordingsResult.error) throw recordingsResult.error;

  return {
    documentId,
    appDocuments: Array.isArray(appDocumentsResult.data) ? appDocumentsResult.data : [],
    recordings: Array.isArray(recordingsResult.data) ? recordingsResult.data : [],
  };
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

function getEditableDocumentForSource(sourceDocumentId) {
  return editableDocumentsBySourceId.get(sourceDocumentId) || null;
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
    editableDocumentsBySourceId = new Map();
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
  await loadEditableDocumentMap(organization.id);
  documentCount.textContent = String(documentsCache.length);
  renderFiles();
  setStatus(fileStatus, `${documentsCache.length} file${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function openLinkedDocumentFromUrl() {
  const documentId = consumeLinkedDocumentId();
  if (!documentId) return;
  if (!documentsCache.some((doc) => doc.id === documentId)) {
    setStatus(fileStatus, "That transcript file was not found in the active library.", "error");
    return;
  }
  await openFile(documentId, "source");
}

async function loadEditableDocumentMap(organizationId) {
  editableDocumentsBySourceId = new Map();
  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, source_document_id, status, updated_at, created_at")
    .eq("organization_id", organizationId)
    .eq("document_kind", "document")
    .not("source_document_id", "is", null)
    .order("updated_at", { ascending: false });

  if (error) {
    if (!isMissingAppDocumentsSchemaError(error)) setStatus(fileStatus, error.message, "error");
    return;
  }

  (Array.isArray(data) ? data : []).forEach((doc) => {
    if (doc.source_document_id && !editableDocumentsBySourceId.has(doc.source_document_id)) {
      editableDocumentsBySourceId.set(doc.source_document_id, doc);
    }
  });
}

function renderFiles() {
  fileList.innerHTML = "";
  show(fileEmpty, documentsCache.length === 0);

  documentsCache.forEach((doc) => {
    const capabilities = getActiveCapabilities();
    const editableDoc = getEditableDocumentForSource(doc.id);
    const actionButtons = [];
    if (capabilities.canEditDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="edit" data-id="${doc.id}">Edit details</button>`);
      actionButtons.push(
        editableDoc
          ? `<button class="btn secondary" type="button" data-action="open-preview" data-id="${doc.id}">Open</button>`
          : `<button class="btn secondary" type="button" data-action="make-editable" data-id="${doc.id}">Make editable</button>`
      );
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
        <p class="download-meta">${escapeHtml(buildDocumentMetadata(doc, { includeVisibility: true, includeCreatedAt: false }))}${editableDoc ? " · Editable version" : ""}</p>
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

async function openSourceFilePreview(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const downloadSigned = await createDownloadSignedUrlForDocument(documentId);
  const { doc, signedUrl } = signed;
  const capabilities = getActiveCapabilities();
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
  fileModalDownload.textContent = "Download original";
  show(fileModalShare, capabilities.canShareDocuments);
  fileModalShare.textContent = "Share";
  show(fileModalOpenEditable, Boolean(editableDoc));
  if (editableDoc) {
    fileModalOpenEditable.href = `./documents.html?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = capabilities.canEditDocuments ? "Edit document" : "Open";
  }
  show(fileModalOriginal, false);
  show(fileModalEdit, capabilities.canEditDocuments);
  show(fileModalDelete, capabilities.canDeleteDocuments);
}

async function openEditableFilePreview(documentId, editableDoc) {
  const sourceDoc = documentsCache.find((item) => item.id === documentId);
  if (!sourceDoc || !editableDoc) return false;
  const capabilities = getActiveCapabilities();

  activeModalDocumentId = documentId;
  setStatus(fileStatus, "Generating editable preview...");

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
          title: editableDoc.title || sourceDoc.title || sourceDoc.original_filename || "Editable document",
          original_filename: getAppDocumentPdfFilename(editableDoc),
        },
        previewUrl: objectUrl,
        fallbackUrl: objectUrl,
        downloadUrl: objectUrl,
      }
    );
    fileModalDownload.textContent = "Download PDF";
    show(fileModalShare, false);
    show(fileModalOpenEditable, true);
    fileModalOpenEditable.href = `./documents.html?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = capabilities.canEditDocuments ? "Edit document" : "Open";
    show(fileModalOriginal, true);
    show(fileModalEdit, capabilities.canEditDocuments);
    show(fileModalDelete, capabilities.canDeleteDocuments);
    setStatus(fileStatus, "");
    return true;
  } catch (error) {
    setStatus(fileStatus, error?.message || "Unable to generate editable preview.", "error");
    return false;
  }
}

async function openFile(documentId, preferredView = "auto") {
  const editableDoc = getEditableDocumentForSource(documentId);
  if (editableDoc && preferredView !== "source") {
    const opened = await openEditableFilePreview(documentId, editableDoc);
    if (opened) return;
  }
  await openSourceFilePreview(documentId);
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
  revokeActiveModalObjectUrl();
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

async function openDeleteConfirm(documentId) {
  if (!getActiveCapabilities().canDeleteDocuments) {
    setStatus(fileStatus, "You do not have permission to delete files in this library.", "error");
    return;
  }
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;

  pendingDeleteId = documentId;
  resetDeleteAssociations();
  deleteConfirmCopy.textContent = `Delete "${doc.title || doc.original_filename || "this file"}"? This action cannot be undone.`;
  deleteConfirmModal.classList.add("is-open");
  deleteConfirmModal.setAttribute("aria-hidden", "false");
  deleteConfirmSubmit.disabled = true;

  try {
    const associations = await loadDeleteAssociations(documentId);
    if (pendingDeleteId !== documentId) return;
    pendingDeleteAssociations = associations;
    const summary = formatDeleteAssociationSummary(pendingDeleteAssociations);
    show(deleteAssociatedOption, Boolean(summary));
    if (deleteAssociatedSummary) {
      deleteAssociatedSummary.textContent = summary;
    }
  } catch (error) {
    if (pendingDeleteId !== documentId) return;
    setStatus(fileStatus, getErrorMessage(error, "Unable to check linked file data."), "error");
  } finally {
    if (pendingDeleteId === documentId) {
      deleteConfirmSubmit.disabled = false;
    }
  }
}

function closeDeleteConfirm() {
  pendingDeleteId = null;
  resetDeleteAssociations();
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

async function deleteAssociatedFileData(documentId) {
  let associations = pendingDeleteAssociations.documentId === documentId
    ? pendingDeleteAssociations
    : await loadDeleteAssociations(documentId);

  const appDocumentIds = associations.appDocuments.map((item) => item.id).filter(Boolean);
  if (appDocumentIds.length) {
    const { error } = await supabase.from("app_documents").delete().in("id", appDocumentIds);
    if (error) throw error;
  }

  const recordingIds = associations.recordings.map((item) => item.id).filter(Boolean);
  if (recordingIds.length) {
    const recordingPaths = associations.recordings.map((item) => item.storage_path).filter(Boolean);
    if (recordingPaths.length) {
      const { error: recordingStorageError } = await supabase.storage.from("meeting-recordings").remove(recordingPaths);
      if (recordingStorageError && !isIgnorableStorageDeleteError(recordingStorageError)) throw recordingStorageError;
    }

    const { error } = await supabase.from("meeting_recordings").delete().in("id", recordingIds);
    if (error) throw error;
  }
}

async function deleteFile(documentId, options = {}) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return;
  if (!getActiveCapabilities().canDeleteDocuments) {
    setStatus(fileStatus, "You do not have permission to delete files in this library.", "error");
    return;
  }

  setStatus(fileStatus, "Deleting file...");
  deleteConfirmSubmit.disabled = true;
  deleteConfirmCancel.disabled = true;

  if (options.deleteAssociated) {
    try {
      setStatus(fileStatus, "Deleting linked data...");
      await deleteAssociatedFileData(documentId);
    } catch (error) {
      deleteConfirmSubmit.disabled = false;
      deleteConfirmCancel.disabled = false;
      setStatus(fileStatus, getErrorMessage(error, "Unable to delete linked file data."), "error");
      return;
    }
  }

  const { error: storageError } = await supabase.storage.from("documents").remove([doc.storage_path]);
  if (storageError && !isIgnorableStorageDeleteError(storageError)) {
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
  setStatus(fileStatus, options.deleteAssociated ? "File and linked data deleted." : "File deleted.", "success");
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

function elementChildren(element, localName = "") {
  return Array.from(element?.children || []).filter((child) => !localName || child.localName === localName);
}

function firstChild(element, localName) {
  return elementChildren(element, localName)[0] || null;
}

function descendants(element, localName) {
  return Array.from(element?.getElementsByTagName("*") || []).filter((child) => child.localName === localName);
}

function wordAttr(element, name) {
  if (!element) return "";
  return element.getAttribute(`w:${name}`) || element.getAttribute(name) || element.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name) || "";
}

function wordVal(element) {
  return wordAttr(element, "val");
}

function parseXml(xmlText, label) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(`Unable to read ${label}.`);
  return doc;
}

function documentBlockChildren(element) {
  const blocks = [];
  elementChildren(element).forEach((child) => {
    if (["p", "tbl"].includes(child.localName)) {
      blocks.push(child);
      return;
    }
    if (["customXml", "ins", "sdt", "sdtContent"].includes(child.localName)) {
      blocks.push(...documentBlockChildren(child));
    }
  });
  return blocks;
}

function isEnabledWordToggle(element) {
  if (!element) return false;
  const value = wordVal(element).toLowerCase();
  return !["0", "false", "off", "none"].includes(value);
}

function marksFromRunProperties(runProperties) {
  if (!runProperties) return [];
  const marks = [];
  if (isEnabledWordToggle(firstChild(runProperties, "b"))) marks.push({ type: "bold" });
  if (isEnabledWordToggle(firstChild(runProperties, "i"))) marks.push({ type: "italic" });
  const underline = firstChild(runProperties, "u");
  if (underline && !["none", "0", "false", "off"].includes(wordVal(underline).toLowerCase())) {
    marks.push({ type: "underline" });
  }
  const colorValue = wordVal(firstChild(runProperties, "color"));
  if (colorValue && !["auto", "none"].includes(colorValue.toLowerCase())) {
    marks.push({
      type: "textStyle",
      attrs: { color: colorValue.startsWith("#") ? colorValue : `#${colorValue}` },
    });
  }
  if (wordVal(firstChild(runProperties, "vertAlign")).toLowerCase() === "superscript") {
    marks.push({ type: "superscript" });
  }
  return marks;
}

function marksKey(marks = []) {
  return marks
    .map((mark) => `${mark.type}:${JSON.stringify(mark.attrs || {})}`)
    .sort()
    .join("|");
}

function pushTextNode(nodes, text, marks = []) {
  if (!text) return;
  const cleanMarks = marks.filter(Boolean);
  const last = nodes[nodes.length - 1];
  if (last?.type === "text" && marksKey(last.marks || []) === marksKey(cleanMarks)) {
    last.text += text;
    return;
  }
  const node = { type: "text", text };
  if (cleanMarks.length) node.marks = cleanMarks;
  nodes.push(node);
}

function pushHardBreak(nodes) {
  nodes.push({ type: "hardBreak" });
}

function parseRun(run) {
  const nodes = [];
  const marks = marksFromRunProperties(firstChild(run, "rPr"));
  Array.from(run.childNodes || []).forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE || child.localName === "rPr") return;
    if (child.localName === "t") pushTextNode(nodes, child.textContent || "", marks);
    if (child.localName === "tab") pushTextNode(nodes, "\t", marks);
    if (["br", "cr"].includes(child.localName)) pushHardBreak(nodes);
  });
  return nodes;
}

function parseInlineContent(element) {
  const nodes = [];
  Array.from(element?.childNodes || []).forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    if (child.localName === "r") {
      parseRun(child).forEach((node) => nodes.push(node));
      return;
    }
    if (["hyperlink", "smartTag", "sdt", "ins", "fldSimple"].includes(child.localName)) {
      parseInlineContent(child).forEach((node) => nodes.push(node));
    }
  });
  return nodes;
}

function paragraphAlignment(paragraphProperties) {
  const value = wordVal(firstChild(paragraphProperties, "jc")).toLowerCase();
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (["both", "distribute", "mediumKashida", "highKashida", "lowKashida"].includes(value)) return "justify";
  return "";
}

function headingLevelFromParagraph(paragraphProperties) {
  const style = wordVal(firstChild(paragraphProperties, "pStyle"));
  const styleMatch = style.match(/heading\s*([1-6])/i) || style.match(/^h([1-6])$/i);
  if (styleMatch) return Math.min(Number.parseInt(styleMatch[1], 10), 3);
  if (/^title$/i.test(style)) return 1;

  const outlineValue = wordVal(firstChild(paragraphProperties, "outlineLvl"));
  if (/^\d+$/.test(outlineValue)) {
    return Math.min(Number.parseInt(outlineValue, 10) + 1, 3);
  }

  return 0;
}

function listInfoFromParagraph(paragraphProperties, numberingMap) {
  const numPr = firstChild(paragraphProperties, "numPr");
  if (!numPr) return null;

  const numId = wordVal(firstChild(numPr, "numId"));
  const level = Number.parseInt(wordVal(firstChild(numPr, "ilvl")) || "0", 10) || 0;
  const format = numberingMap.get(`${numId}:${level}`) || numberingMap.get(`${numId}:0`) || "";
  const type = format.toLowerCase().includes("bullet") ? "bulletList" : "orderedList";
  return { type, level };
}

function parseParagraph(paragraph, numberingMap = new Map()) {
  const paragraphProperties = firstChild(paragraph, "pPr");
  const content = parseInlineContent(paragraph);
  const attrs = {};
  const textAlign = paragraphAlignment(paragraphProperties);
  if (textAlign) attrs.textAlign = textAlign;

  const headingLevel = headingLevelFromParagraph(paragraphProperties);
  const list = listInfoFromParagraph(paragraphProperties, numberingMap);
  const node = headingLevel && !list
    ? { type: "heading", attrs: { level: headingLevel, ...attrs } }
    : { type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}) };
  if (content.length) node.content = content;
  return { node, list };
}

function parseNumberingMap(numberingXml) {
  if (!numberingXml) return new Map();
  const numberingDoc = parseXml(numberingXml, "DOCX numbering");
  const abstractFormats = new Map();
  descendants(numberingDoc, "abstractNum").forEach((abstractNum) => {
    const abstractId = wordAttr(abstractNum, "abstractNumId");
    elementChildren(abstractNum, "lvl").forEach((level) => {
      const ilvl = wordAttr(level, "ilvl") || "0";
      abstractFormats.set(`${abstractId}:${ilvl}`, wordVal(firstChild(level, "numFmt")));
    });
  });

  const numberingMap = new Map();
  descendants(numberingDoc, "num").forEach((num) => {
    const numId = wordAttr(num, "numId");
    const abstractId = wordVal(firstChild(num, "abstractNumId"));
    for (const [key, format] of abstractFormats.entries()) {
      const [keyAbstractId, ilvl] = key.split(":");
      if (keyAbstractId === abstractId) numberingMap.set(`${numId}:${ilvl}`, format);
    }
  });
  return numberingMap;
}

function parseTableCell(cell, numberingMap) {
  const cellProperties = firstChild(cell, "tcPr");
  const colspan = Number.parseInt(wordVal(firstChild(cellProperties, "gridSpan")) || "1", 10) || 1;
  const width = Number.parseInt(wordAttr(firstChild(cellProperties, "tcW"), "w") || "", 10);
  const content = documentBlockChildren(cell)
    .map((block) => block.localName === "tbl" ? parseTable(block, numberingMap) : parseParagraph(block, numberingMap).node)
    .filter(Boolean);

  return {
    attrs: {
      colspan,
      rowspan: 1,
      colwidth: Number.isFinite(width) && width > 0 ? [Math.round(width / 15)] : null,
    },
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

function parseTable(table, numberingMap) {
  const rows = elementChildren(table, "tr").map((row) => {
    const isHeaderRow = Boolean(firstChild(firstChild(row, "trPr"), "tblHeader"));
    return {
      type: "tableRow",
      content: elementChildren(row, "tc").map((cell) => ({
        type: isHeaderRow ? "tableHeader" : "tableCell",
        ...parseTableCell(cell, numberingMap),
      })),
    };
  }).filter((row) => row.content.length);

  return rows.length ? { type: "table", content: rows } : null;
}

function flushList(content, activeList) {
  if (!activeList) return null;
  content.push({
    type: activeList.type,
    content: activeList.items,
  });
  return null;
}

function appendParagraphOrListItem(content, paragraphInfo, activeList) {
  if (!paragraphInfo.list) {
    flushList(content, activeList);
    return null;
  }

  const listKey = `${paragraphInfo.list.type}:${paragraphInfo.list.level}`;
  if (!activeList || activeList.key !== listKey) {
    activeList = flushList(content, activeList);
    activeList = { key: listKey, type: paragraphInfo.list.type, items: [] };
  }

  activeList.items.push({
    type: "listItem",
    content: [{ ...paragraphInfo.node, type: "paragraph" }],
  });
  return activeList;
}

async function parseDocxArrayBufferToTiptap(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX document body was not found.");

  const documentXml = await documentFile.async("string");
  const numberingXml = await zip.file("word/numbering.xml")?.async("string");
  let numberingMap = new Map();
  try {
    numberingMap = parseNumberingMap(numberingXml);
  } catch (error) {
    console.warn("DOCX numbering could not be read; continuing without list type details.", error);
  }
  const xmlDoc = parseXml(documentXml, "DOCX document");
  const body = descendants(xmlDoc, "body")[0];
  if (!body) throw new Error("DOCX document body was not readable.");

  const content = [];
  let activeList = null;

  documentBlockChildren(body).forEach((child) => {
    if (child.localName === "p") {
      activeList = appendParagraphOrListItem(content, parseParagraph(child, numberingMap), activeList);
      return;
    }

    if (child.localName === "tbl") {
      activeList = flushList(content, activeList);
      const table = parseTable(child, numberingMap);
      if (table) content.push(table);
    }
  });

  flushList(content, activeList);
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

async function parseDocxArrayBufferToHtml(arrayBuffer) {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = String(result?.value || "").trim();
  if (!html) throw new Error("DOCX HTML conversion produced no content.");
  return { html };
}

function plainTextFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  return (template.content.textContent || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromTiptapJson(node, parts = []) {
  if (!node || typeof node !== "object") return parts;
  if (node.type === "text" && node.text) parts.push(node.text);
  if (node.type === "hardBreak") parts.push("\n");
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => textFromTiptapJson(child, parts));
  }
  if (["paragraph", "heading", "listItem", "tableRow"].includes(node.type)) parts.push("\n");
  if (["tableCell", "tableHeader"].includes(node.type)) parts.push("\t");
  return parts;
}

function plainTextFromTiptapJson(contentJson) {
  return textFromTiptapJson(contentJson, [])
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\t+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isDocxDocument(doc) {
  return /\.docx$/i.test(doc?.original_filename || "") || /\.docx$/i.test(doc?.storage_path || "");
}

async function downloadDocumentArrayBuffer(doc) {
  if (!doc?.storage_path) throw new Error("Source file storage path is missing.");
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 10);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Unable to create a DOCX download URL.");

  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error(`Unable to download DOCX (${response.status}).`);
  return response.arrayBuffer();
}

async function convertSourceDocumentToTiptap(sourceDoc) {
  const fallback = textToTiptapDocument(sourceDoc.extracted_text || "");
  if (!isDocxDocument(sourceDoc)) {
    return {
      contentJson: fallback,
      plainText: String(sourceDoc.extracted_text || "").trim(),
    };
  }

  const errors = [];
  let arrayBuffer = null;
  try {
    setStatus(fileStatus, "Reading DOCX structure...");
    arrayBuffer = await downloadDocumentArrayBuffer(sourceDoc);
    const contentJson = await parseDocxArrayBufferToTiptap(arrayBuffer);
    const plainText = plainTextFromTiptapJson(contentJson);
    if (plainText || contentJson.content?.some((node) => node.type === "table")) {
      return { contentJson, plainText };
    }
  } catch (error) {
    errors.push(error?.message || "DOCX structure conversion failed.");
    console.warn("DOCX structure conversion failed.", error);
  }

  if (arrayBuffer) {
    try {
      setStatus(fileStatus, "Trying DOCX HTML conversion...");
      const contentJson = await parseDocxArrayBufferToHtml(arrayBuffer);
      const plainText = plainTextFromHtml(contentJson.html);
      if (plainText) return { contentJson, plainText };
    } catch (error) {
      errors.push(error?.message || "DOCX HTML conversion failed.");
      console.warn("DOCX HTML conversion failed.", error);
    }
  }

  throw new Error(`Could not convert this DOCX without losing its structure. ${errors.join(" ")}`.trim());
}

async function makeFileEditable(documentId) {
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileStatus, "You do not have permission to create editable documents in this library.", "error");
    return;
  }
  const existing = getEditableDocumentForSource(documentId);
  if (existing) {
    window.location.href = `./documents.html?id=${encodeURIComponent(existing.id)}`;
    return;
  }

  setStatus(fileStatus, "Creating editable document...");
  const { data: sourceDoc, error: sourceError } = await supabase
    .from("documents")
    .select("id, organization_id, title, original_filename, storage_path, extracted_text")
    .eq("id", documentId)
    .single();

  if (sourceError || !sourceDoc) {
    setStatus(fileStatus, sourceError?.message || "Unable to load source file text.", "error");
    return;
  }
  if (!isDocxDocument(sourceDoc) && !String(sourceDoc.extracted_text || "").trim()) {
    setStatus(fileStatus, "This file has no extracted text yet. Run OCR before making it editable.", "error");
    return;
  }

  let conversion = null;
  try {
    conversion = await convertSourceDocumentToTiptap(sourceDoc);
  } catch (error) {
    setStatus(fileStatus, error?.message || "Unable to convert this document.", "error");
    return;
  }
  setStatus(fileStatus, "Creating editable document...");
  const contentJson = conversion.contentJson;
  const plainText = conversion.plainText;
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
    if (action === "open-preview") await openFile(id);
    if (action === "download") await downloadFile(id);
    if (action === "share") await shareFile(id);
    if (action === "delete") void openDeleteConfirm(id);
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
  setMenuActive("files");
  try {
    await bootstrapAccess();
    renderOrganizationSelector();
    await loadDocuments();
    await openLinkedDocumentFromUrl();
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
  fileModalOriginal.addEventListener("click", async () => {
    if (!activeModalDocumentId) return;
    await openFile(activeModalDocumentId, "source");
  });
  fileModalEdit.addEventListener("click", () => {
    if (!activeModalDocumentId) return;
    openFileEditModal(activeModalDocumentId);
  });
  fileModalDelete.addEventListener("click", () => {
    if (!activeModalDocumentId) return;
    void openDeleteConfirm(activeModalDocumentId);
  });
  fileModal.addEventListener("click", (event) => {
    if (event.target === fileModal) closeFileModal();
  });
  deleteConfirmCancel.addEventListener("click", closeDeleteConfirm);
  deleteConfirmSubmit.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    await deleteFile(pendingDeleteId, { deleteAssociated: Boolean(deleteAssociatedInput?.checked) });
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
