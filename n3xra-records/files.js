import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import JSZip from "https://esm.sh/jszip@3.10.1";
import mammoth from "https://esm.sh/mammoth@1.8.0/mammoth.browser";
import { createAppDocumentPdfObjectUrl, getAppDocumentPdfFilename } from "./lib/app-document-pdf.js";
import { buildPreviewUrl, getDownloadFilename } from "./lib/document-links.js";
import { buildDocumentMetadata, getDocumentDisplayTitle } from "./lib/document-presenters.js";
import { closeFilePreviewModal, openFilePreviewModal } from "./lib/file-modal.js";
import { getPlanConfig, formatPlanName } from "./lib/plan-config.js";
import {
  buildMembershipMap,
  dedupeMembershipsByOrganization,
  formatRoleLabel,
  getCapabilities,
  getMembershipRole,
  isPlatformAdminEmail,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
} from "/shared/lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const filesPanel = document.getElementById("files-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const filesNoAccessNotice = document.getElementById("files-no-access-notice");
const filesActiveOrganizationField = document.getElementById("files-active-organization-field");
const filesActiveMembershipField = document.getElementById("files-active-membership-field");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const documentCount = document.getElementById("document-count");
const filesActionsGrid = document.getElementById("files-actions-grid");
const filesUploadActionSlot = document.getElementById("files-upload-action-slot");
const filesOpenUploadModalButton = document.getElementById("files-open-upload-modal");
const filesRecordingsLink = document.getElementById("files-recordings-link");
const filesFilterBar = document.getElementById("files-filter-bar");
const fileList = document.getElementById("file-list");
const fileEmpty = document.getElementById("file-empty");
const fileStatus = document.getElementById("file-status");
const uploadStatus = document.getElementById("upload-status");
const uploadModal = document.getElementById("upload-modal");
const uploadModalClose = document.getElementById("upload-modal-close");
const uploadForm = document.getElementById("upload-form");
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
let uploadedDocumentsCache = [];
let referenceDocumentsCache = [];
let pendingDeleteId = null;
let activeModalDocumentId = null;
let activeModalDocumentType = "uploaded";
let pendingEditId = null;
let activeModalObjectUrl = "";
let editableDocumentsBySourceId = new Map();
let uploadMode = "single";
let fileTypeFilter = "all";
let pdfJsLibraryPromise = null;
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
  mobileMenuMessagesLink?.classList.toggle("is-active", section === "messages");
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
    parts.push(`${editableCount} linked document${editableCount === 1 ? "" : "s"}`);
  }
  if (recordingCount) {
    parts.push(`${recordingCount} linked meeting note${recordingCount === 1 ? "" : "s"} and audio file${recordingCount === 1 ? "" : "s"}`);
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

function sanitizeStorageFileName(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function getDocumentLimit() {
  return Number(getActiveOrganization()?.document_limit || getPlanConfig(getActiveOrganization()?.subscription_tier).documentLimit);
}

function hasEmbeddedAccess() {
  return getActiveOrganization()?.subscription_tier === "organization";
}

function setUploadModalOpen(isOpen) {
  uploadModal.classList.toggle("is-open", isOpen);
  uploadModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) resetUploadFeedback();
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

function clearUploadResults() {
  uploadResults.innerHTML = "";
}

function appendUploadResult(label, tone, message) {
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
  const pdfNote = "PDFs with selectable text become searchable. Scanned PDFs upload as records but need OCR before search or editing.";
  const legacyDocNote = 'Legacy <code class="inline">.doc</code> files must be converted to <code class="inline">.docx</code> before upload.';
  if (isBatch) {
    return `Supported in this pass: ${supported} ${pdfNote} Batch mode reads both file selection and folder import and auto-detects year/month from filenames when available (private by default). ${legacyDocNote}`;
  }
  return `Supported in this pass: ${supported} ${pdfNote} ${legacyDocNote}`;
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

function getDocumentCreatedAtScore(doc) {
  return new Date(doc?.created_at || doc?.updated_at || 0).getTime();
}

function sortFileRowsNewestToOldest(rows) {
  return [...rows].sort((a, b) => {
    const aDateScore = getDocumentDateScore(a);
    const bDateScore = getDocumentDateScore(b);
    if (aDateScore !== bDateScore) {
      if (aDateScore === null) return 1;
      if (bDateScore === null) return -1;
      return bDateScore - aDateScore;
    }
    return getDocumentCreatedAtScore(b) - getDocumentCreatedAtScore(a);
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

function getFileRowById(id) {
  return documentsCache.find((item) => item.id === id) || null;
}

function getUploadedDocumentById(id) {
  return uploadedDocumentsCache.find((item) => item.id === id) || null;
}

function isReferenceFileRow(doc) {
  return doc?.record_type === "agenda" || doc?.record_type === "supporting_document";
}

function getReferenceTypeLabel(type) {
  if (type === "agenda") return "Agenda";
  if (type === "supporting_document") return "Supporting document";
  return "Document";
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
    show(filesActionsGrid, false);
    show(mobileMenuRecordingsLink, false);
    show(mobileMenuMessagesLink, false);
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
  filesOpenUploadModalButton.disabled = !capabilities.canUploadDocuments;
  uploadIsPublicInput.disabled = !capabilities.canUploadDocuments || !hasEmbeddedAccess();
  show(filesNoAccessNotice, false);
  show(filesActiveOrganizationField, hasMultipleLibraries());
  show(filesActiveMembershipField, hasMultipleLibraries());
  show(filesActionsGrid, true);
  show(filesUploadActionSlot, capabilities.canUploadDocuments);
  show(mobileMenuMessagesLink, capabilities.canShareDocuments);
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
        document_limit,
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
  window.location.replace("/n3xra-records/login");
}

async function loadDocuments() {
  const organization = getActiveOrganization();
  if (!organization) {
    documentsCache = [];
    uploadedDocumentsCache = [];
    referenceDocumentsCache = [];
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

  uploadedDocumentsCache = sortDocumentsNewestToOldest(Array.isArray(data) ? data : [])
    .map((doc) => ({ ...doc, record_type: "uploaded" }));
  referenceDocumentsCache = await loadReferencedAppDocuments(organization.id);
  documentsCache = sortFileRowsNewestToOldest([...uploadedDocumentsCache, ...referenceDocumentsCache]);
  await loadEditableDocumentMap(organization.id);
  documentCount.textContent = String(documentsCache.length);
  renderFiles();
  setStatus(fileStatus, `${documentsCache.length} item${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function loadReferencedAppDocuments(organizationId) {
  const { data, error } = await supabase
    .from("meeting_recording_references")
    .select(`
      app_document_id,
      reference_type,
      sort_order,
      created_at,
      app_document:app_documents(
        id,
        organization_id,
        title,
        document_kind,
        status,
        source_document_id,
        updated_at,
        created_at
      )
    `)
    .order("reference_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("meeting_recording_references") && (message.includes("does not exist") || message.includes("schema cache"))) {
      return [];
    }
    throw error;
  }

  const byDocumentId = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const appDocument = Array.isArray(row.app_document) ? row.app_document[0] : row.app_document;
    if (!appDocument || appDocument.organization_id !== organizationId || appDocument.document_kind === "template") return;
    const existing = byDocumentId.get(appDocument.id);
    const nextType = row.reference_type === "agenda" ? "agenda" : "supporting_document";
    const referenceType = existing?.record_type === "agenda" || nextType === "agenda" ? "agenda" : "supporting_document";
    byDocumentId.set(appDocument.id, {
      id: appDocument.id,
      title: appDocument.title || "Untitled document",
      original_filename: getAppDocumentPdfFilename(appDocument),
      year: "",
      month: "",
      is_public: false,
      status: appDocument.status || "draft",
      created_at: appDocument.created_at || row.created_at,
      updated_at: appDocument.updated_at || appDocument.created_at || row.created_at,
      source_document_id: appDocument.source_document_id || null,
      record_type: referenceType,
    });
  });

  return Array.from(byDocumentId.values());
}

async function openLinkedDocumentFromUrl() {
  const documentId = consumeLinkedDocumentId();
  if (!documentId) return;
  const doc = getFileRowById(documentId);
  if (!doc) {
    setStatus(fileStatus, "That transcript file was not found in the active library.", "error");
    return;
  }
  await openFile(documentId, doc.record_type === "uploaded" ? "source" : "auto");
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
  const visibleDocuments = documentsCache.filter((doc) => {
    if (fileTypeFilter === "all") return true;
    return doc.record_type === fileTypeFilter;
  });
  show(fileEmpty, visibleDocuments.length === 0);

  visibleDocuments.forEach((doc) => {
    const capabilities = getActiveCapabilities();
    const isReference = isReferenceFileRow(doc);
    const editableDoc = isReference ? doc : getEditableDocumentForSource(doc.id);
    const displayDoc = editableDoc && !isReference
      ? { ...doc, title: editableDoc.title || doc.title, original_filename: getAppDocumentPdfFilename(editableDoc) }
      : doc;
    const actionButtons = [];
    if (isReference) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="open-preview" data-id="${doc.id}">Open</button>`);
      actionButtons.push(`<button class="btn secondary" type="button" data-action="open-builder" data-id="${doc.id}">${capabilities.canEditDocuments ? "Edit" : "Document Builder"}</button>`);
      actionButtons.push(`<button class="btn secondary" type="button" data-action="download" data-id="${doc.id}">Download PDF</button>`);
    } else if (capabilities.canEditDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="edit" data-id="${doc.id}">Edit details</button>`);
      actionButtons.push(
        editableDoc
          ? `<button class="btn secondary" type="button" data-action="open-preview" data-id="${doc.id}">Open</button>`
          : `<button class="btn secondary" type="button" data-action="make-editable" data-id="${doc.id}">Edit</button>`
      );
    }
    if (!isReference && capabilities.canDownloadDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="download" data-id="${doc.id}">Download</button>`);
    }
    if (!isReference && capabilities.canShareDocuments) {
      actionButtons.push(`<button class="btn secondary" type="button" data-action="share" data-id="${doc.id}">Share</button>`);
    }
    if (!isReference && capabilities.canEditDocuments) {
      actionButtons.push(
        `<button class="btn secondary" type="button" data-action="toggle-public" data-id="${doc.id}">${doc.is_public ? "Make private" : "Make public"}</button>`
      );
    }
    if (!isReference && capabilities.canDeleteDocuments) {
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
        <p class="download-name">${escapeHtml(getDocumentDisplayTitle(displayDoc))}</p>
        <p class="download-meta">${escapeHtml(buildFileRowMetadata(doc))}</p>
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

function buildFileRowMetadata(doc) {
  if (isReferenceFileRow(doc)) {
    const parts = [getReferenceTypeLabel(doc.record_type)];
    if (doc.status) parts.push(cleanWhitespace(doc.status).replaceAll("_", " "));
    return parts.join(" · ");
  }
  return buildDocumentMetadata(doc, { includeVisibility: true, includeCreatedAt: false });
}

async function createSignedUrlForDocument(documentId) {
  const doc = getUploadedDocumentById(documentId);
  if (!doc) return null;

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60);
  if (error || !data?.signedUrl) {
    setStatus(fileStatus, error?.message || "Unable to create signed URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function createDownloadSignedUrlForDocument(documentId) {
  const doc = getUploadedDocumentById(documentId);
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
  activeModalDocumentType = "uploaded";
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
  show(fileModalShare, capabilities.canShareDocuments);
  fileModalShare.textContent = "Share";
  show(fileModalOpenEditable, Boolean(editableDoc));
  if (editableDoc) {
    fileModalOpenEditable.href = `./documents?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = capabilities.canEditDocuments ? "Edit" : "Open";
  }
  show(fileModalOriginal, false);
  show(fileModalEdit, capabilities.canEditDocuments);
  show(fileModalDelete, capabilities.canDeleteDocuments);
}

async function openEditableFilePreview(documentId, editableDoc) {
  const sourceDoc = getUploadedDocumentById(documentId);
  if (!sourceDoc || !editableDoc) return false;
  const capabilities = getActiveCapabilities();

  activeModalDocumentId = documentId;
  activeModalDocumentType = "uploaded";
  setStatus(fileStatus, "Generating PDF preview...");

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
    show(fileModalShare, false);
    show(fileModalOpenEditable, true);
    fileModalOpenEditable.href = `./documents?id=${encodeURIComponent(editableDoc.id)}`;
    fileModalOpenEditable.textContent = capabilities.canEditDocuments ? "Edit" : "Open";
    show(fileModalOriginal, true);
    show(fileModalEdit, capabilities.canEditDocuments);
    show(fileModalDelete, capabilities.canDeleteDocuments);
    setStatus(fileStatus, "");
    return true;
  } catch (error) {
    setStatus(fileStatus, error?.message || "Unable to generate document preview.", "error");
    return false;
  }
}

async function openReferenceDocumentPreview(documentId) {
  const doc = referenceDocumentsCache.find((item) => item.id === documentId);
  if (!doc) return false;
  const capabilities = getActiveCapabilities();

  activeModalDocumentId = documentId;
  activeModalDocumentType = doc.record_type;
  setStatus(fileStatus, "Generating PDF preview...");

  try {
    const objectUrl = await createAppDocumentPdfObjectUrl({
      config: getConfig(),
      accessToken: await getFreshAccessToken(),
      documentId: doc.id,
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
          title: doc.title || "Untitled document",
          original_filename: getAppDocumentPdfFilename(doc),
        },
        previewUrl: objectUrl,
        fallbackUrl: objectUrl,
        downloadUrl: objectUrl,
      }
    );
    fileModalDownload.textContent = "Download PDF";
    show(fileModalShare, false);
    show(fileModalOpenEditable, true);
    fileModalOpenEditable.href = `./documents?id=${encodeURIComponent(doc.id)}`;
    fileModalOpenEditable.textContent = capabilities.canEditDocuments ? "Edit" : "Open";
    show(fileModalOriginal, false);
    show(fileModalEdit, false);
    show(fileModalDelete, false);
    setStatus(fileStatus, "");
    return true;
  } catch (error) {
    setStatus(fileStatus, error?.message || "Unable to generate document preview.", "error");
    return false;
  }
}

async function openFile(documentId, preferredView = "auto") {
  const row = getFileRowById(documentId);
  if (isReferenceFileRow(row)) {
    await openReferenceDocumentPreview(documentId);
    return;
  }
  const editableDoc = getEditableDocumentForSource(documentId);
  if (editableDoc && preferredView !== "source") {
    const opened = await openEditableFilePreview(documentId, editableDoc);
    if (opened) return;
  }
  await openSourceFilePreview(documentId);
}

async function downloadFile(documentId) {
  const row = getFileRowById(documentId);
  if (isReferenceFileRow(row)) {
    let objectUrl = "";
    try {
      objectUrl = await createAppDocumentPdfObjectUrl({
        config: getConfig(),
        accessToken: await getFreshAccessToken(),
        documentId,
      });
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getAppDocumentPdfFilename(row);
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      setStatus(fileStatus, error?.message || "Unable to download PDF.", "error");
    } finally {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
    return;
  }

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
  activeModalDocumentType = "uploaded";
}

function openFileEditModal(documentId) {
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(fileStatus, "You do not have permission to edit this file.", "error");
    return;
  }
  const doc = getUploadedDocumentById(documentId);
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

  const doc = getUploadedDocumentById(pendingEditId);
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
  const doc = getUploadedDocumentById(documentId);
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
  const doc = getUploadedDocumentById(documentId);
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
  const doc = getUploadedDocumentById(documentId);
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
    setStatus(fileStatus, "You do not have permission to create documents in this library.", "error");
    return;
  }
  const existing = getEditableDocumentForSource(documentId);
  if (existing) {
    window.location.href = `./documents?id=${encodeURIComponent(existing.id)}`;
    return;
  }

  setStatus(fileStatus, "Creating document...");
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
    setStatus(fileStatus, "This file has no extracted text yet. Run OCR before editing it.", "error");
    return;
  }

  let conversion = null;
  try {
    conversion = await convertSourceDocumentToTiptap(sourceDoc);
  } catch (error) {
    setStatus(fileStatus, error?.message || "Unable to convert this document.", "error");
    return;
  }
  setStatus(fileStatus, "Creating document...");
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
      ? "Run the app_documents migration before converting files to documents."
      : error.message;
    setStatus(fileStatus, message, "error");
    return;
  }

  window.location.href = `./documents?id=${encodeURIComponent(data.id)}`;
}

async function uploadDocument(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  if (!organization) return;

  if (!getActiveCapabilities().canUploadDocuments) {
    setStatus(uploadStatus, "You do not have permission to upload into this library.", "error");
    return;
  }

  if (uploadedDocumentsCache.length >= getDocumentLimit()) {
    setStatus(uploadStatus, `This ${formatPlanName(organization.subscription_tier)} plan is limited to ${getDocumentLimit()} documents.`, "error");
    return;
  }

  resetUploadFeedback();
  const selectedFiles = collectUploadFiles();
  if (!selectedFiles.length) {
    setStatus(uploadStatus, "Choose at least one file or folder before uploading.", "error");
    return;
  }

  const remainingSlots = Math.max(getDocumentLimit() - uploadedDocumentsCache.length, 0);
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
        extracted_text: sanitizeExtractedText(extractedText),
      }, currentSession.user.id);

      if (insertError) {
        await supabase.storage.from("documents").remove([storagePath]);
        failedFiles.push(`${fileLabel(file)}: ${insertError.message}`);
        appendUploadResult(fileLabel(file), "failed", insertError.message);
        continue;
      }

      successCount += 1;
      appendUploadResult(fileLabel(file), uploadTone, uploadMessage);
    }

    uploadForm.reset();
    if (successCount > 0) {
      await loadDocuments();
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
    if (action === "open-builder") window.location.href = `./documents?id=${encodeURIComponent(id)}`;
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

function setFileTypeFilter(nextFilter) {
  fileTypeFilter = ["all", "uploaded", "agenda", "supporting_document"].includes(nextFilter) ? nextFilter : "all";
  filesFilterBar?.querySelectorAll("[data-file-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-file-filter") === fileTypeFilter);
  });
  renderFiles();
}

async function init() {
  show(setupPanel, !hasConfig());
  show(filesPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/n3xra-records/login");
    return;
  }

  if (isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("/n3xra-admin/records");
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
    uploadedDocumentsCache = [];
    referenceDocumentsCache = [];
    renderOrganizationSelector();
    fileList.innerHTML = "";
    show(fileEmpty, false);
    setStatus(fileStatus, error?.message || "Unable to load files.", "error");
  }

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.href = "/n3xra-records/account";
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.href = "/n3xra-records/library";
  });
  filesOpenUploadModalButton.addEventListener("click", () => {
    resetUploadFeedback();
    setUploadModalOpen(true);
  });
  filesFilterBar?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-file-filter]");
    if (!button) return;
    setFileTypeFilter(button.getAttribute("data-file-filter") || "all");
  });
  uploadModalClose.addEventListener("click", () => setUploadModalOpen(false));
  uploadModal.addEventListener("click", (event) => {
    if (event.target === uploadModal) setUploadModalOpen(false);
  });
  uploadForm.addEventListener("submit", uploadDocument);
  uploadModeSingleButton.addEventListener("click", () => setUploadMode("single"));
  uploadModeBatchButton.addEventListener("click", () => setUploadMode("batch"));
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
    if (event.key === "Escape" && uploadModal.classList.contains("is-open")) {
      setUploadModalOpen(false);
      return;
    }
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
  setUploadMode("single");
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
      window.location.replace("/n3xra-records/login");
    }
  });
}

init();
