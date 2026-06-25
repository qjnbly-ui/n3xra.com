import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
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
import {
  applyRecordingSuggestions,
  dismissRecordingSuggestion,
  getOpenSuggestionIndexes,
  getSuggestionStatus,
  getSuggestionText,
  isSuggestionResolved,
} from "./lib/recording-suggestions.js";
import { createAppDocumentPdfObjectUrl } from "./lib/app-document-pdf.js";

const setupPanel = document.getElementById("setup-panel");
const recordingsPanel = document.getElementById("recordings-panel");
const recordingsNoAccessNotice = document.getElementById("recordings-no-access-notice");
const recordingsContextPanel = document.getElementById("recordings-context-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeOrganizationName = document.getElementById("active-organization-name");
const activeMembershipRole = document.getElementById("active-membership-role");
const recordingCount = document.getElementById("recording-count");
const newRecordingAction = document.getElementById("new-recording-action");
const recordPanelToggle = document.getElementById("record-panel-toggle");
const recordPanelBody = document.getElementById("record-panel-body");
const recordingTitleInput = document.getElementById("recording-title");
const recordingTemplateSelect = document.getElementById("recording-template-select");
const recordingNotesInput = document.getElementById("recording-notes");
const recordingReferenceSelect = document.getElementById("recording-reference-select");
const recordingReferenceType = document.getElementById("recording-reference-type");
const recordingReferenceAdd = document.getElementById("recording-reference-add");
const recordingReferenceList = document.getElementById("recording-reference-list");
const recordingReferenceEmpty = document.getElementById("recording-reference-empty");
const recordingFileInput = document.getElementById("recording-file-input");
const recordingFileCopy = document.getElementById("recording-file-copy");
const recorderStateLabel = document.getElementById("recorder-state-label");
const recorderStateCopy = document.getElementById("recorder-state-copy");
const recordingDuration = document.getElementById("recording-duration");
const uploadStateValue = document.getElementById("upload-state-value");
const uploadProgressShell = document.getElementById("upload-progress-shell");
const uploadProgressCopy = document.getElementById("upload-progress-copy");
const startRecordingButton = document.getElementById("start-recording-button");
const uploadRecordingButton = document.getElementById("upload-recording-button");
const pauseRecordingButton = document.getElementById("pause-recording-button");
const stopRecordingButton = document.getElementById("stop-recording-button");
const saveRecordingButton = document.getElementById("save-recording-button");
const scanHandwrittenNoteButton = document.getElementById("scan-handwritten-note-button");
const handwrittenNoteInput = document.getElementById("handwritten-note-input");
const recordingDetailScanHandwrittenNoteButton = document.getElementById("recording-detail-scan-handwritten-note-button");
const recordingDetailHandwrittenNoteInput = document.getElementById("recording-detail-handwritten-note-input");
const recordingStatus = document.getElementById("recording-status");
const recordingsList = document.getElementById("recordings-list");
const recordingsEmpty = document.getElementById("recordings-empty");
const recordingsListStatus = document.getElementById("recordings-list-status");
const recordingDetailModal = document.getElementById("recording-detail-modal");
const recordingDetailClose = document.getElementById("recording-detail-close");
const recordingDetailTabs = Array.from(document.querySelectorAll("[data-recording-detail-tab]"));
const recordingDetailTabPanels = Array.from(document.querySelectorAll("[data-recording-detail-panel]"));
const recordingUploadModal = document.getElementById("recording-upload-modal");
const recordingUploadClose = document.getElementById("recording-upload-close");
const recordingUploadKicker = document.getElementById("recording-upload-kicker");
const recordingUploadTitle = document.getElementById("recording-upload-title");
const recordingUploadNote = document.getElementById("recording-upload-note");
const recordingUploadSubmit = document.getElementById("recording-upload-submit");
const recordingUploadStatus = document.getElementById("recording-upload-status");
const recordingDetailTitle = document.getElementById("recording-detail-title");
const recordingDetailStatus = document.getElementById("recording-detail-status");
const recordingDetailTranscriptStatus = document.getElementById("recording-detail-transcript-status");
const recordingDetailTemplate = document.getElementById("recording-detail-template");
const recordingDetailAiStatus = document.getElementById("recording-detail-ai-status");
const recordingDetailStartedAt = document.getElementById("recording-detail-started-at");
const recordingDetailEndedAt = document.getElementById("recording-detail-ended-at");
const recordingDetailDuration = document.getElementById("recording-detail-duration");
const recordingDetailSize = document.getElementById("recording-detail-size");
const recordingDetailPlayer = document.getElementById("recording-detail-player");
const recordingDetailNotes = document.getElementById("recording-detail-notes");
const recordingDetailReferenceSelect = document.getElementById("recording-detail-reference-select");
const recordingDetailReferenceType = document.getElementById("recording-detail-reference-type");
const recordingDetailReferenceAdd = document.getElementById("recording-detail-reference-add");
const recordingDetailReferencePicker = document.getElementById("recording-detail-reference-picker");
const recordingDetailReferenceList = document.getElementById("recording-detail-reference-list");
const recordingDetailReferenceEmpty = document.getElementById("recording-detail-reference-empty");
const recordingDetailReferencePreview = document.getElementById("recording-detail-reference-preview");
const recordingDetailReferencePreviewType = document.getElementById("recording-detail-reference-preview-type");
const recordingDetailReferencePreviewTitle = document.getElementById("recording-detail-reference-preview-title");
const recordingDetailReferencePreviewOpen = document.getElementById("recording-detail-reference-preview-open");
const recordingDetailReferenceFrame = document.getElementById("recording-detail-reference-frame");
const recordingDetailAiDraftPreview = document.getElementById("recording-detail-ai-draft-preview");
const recordingAiReviewPanel = document.getElementById("recording-ai-review-panel");
const recordingAiSuggestions = document.getElementById("recording-ai-suggestions");
const recordingAiConflicts = document.getElementById("recording-ai-conflicts");
const recordingDetailTranscriptCopy = document.getElementById("recording-detail-transcript-copy");
const recordingDetailTranscriptText = document.getElementById("recording-detail-transcript-text");
const recordingDetailPlay = document.getElementById("recording-detail-play");
const recordingDetailTranscribe = document.getElementById("recording-detail-transcribe");
const recordingDetailRetry = document.getElementById("recording-detail-retry");
const recordingDetailAiReview = document.getElementById("recording-detail-ai-review");
const recordingDetailAiDraft = document.getElementById("recording-detail-ai-draft");
const recordingDetailTranscriptDocument = document.getElementById("recording-detail-transcript-document");
const recordingDetailStatusMessage = document.getElementById("recording-detail-status-message");
const recordingsConfirmModal = document.getElementById("recordings-confirm-modal");
const recordingsConfirmCancel = document.getElementById("recordings-confirm-cancel");
const recordingsConfirmOk = document.getElementById("recordings-confirm-ok");

const RECORDINGS_BUCKET = "meeting-recordings";
const RECORDER_AUDIO_BITS_PER_SECOND = 64000;
const MAX_RECORDING_AUDIO_BYTES = 250 * 1024 * 1024;
const BLANK_NOTES_TEMPLATE_VALUE = "__blank_notes__";
const HANDWRITTEN_NOTE_MAX_BYTES = 3 * 1024 * 1024;
const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let recordingsCache = [];
let recordingTemplates = [];
let referenceDocuments = [];
let pendingMeetingReferences = [];
let totalRecordingCount = 0;
let mediaRecorder = null;
let activeStream = null;
let activeChunks = [];
let activeRecordingId = "";
let activeRecordingMimeType = "";
let recordingStartedAt = null;
let durationTimer = null;
let elapsedRecordingMs = 0;
let activeDetailRecordingId = "";
let detailPlayerUrl = "";
let detailReferencePreviewUrl = "";
let isRecordingWorkflowActive = false;
let pendingRetryUploadOpen = false;
let isRetryUploadMode = false;
let pendingRecordingsConfirmResolve = null;
let recordingNotesSaveTimer = null;
let recordingDetailNotesSaveTimer = null;
let recordingWorkflowSchemaAvailable = true;
let recordingReferencesSchemaAvailable = true;
let reviewActionPending = false;
let pendingRecordedBlob = null;
let pendingRecordedTitle = "";
let pendingRecordedDurationSeconds = 0;
let pendingUploadedAudioFile = null;
let pendingUploadedAudioTitle = "";
let pendingUploadedAudioDurationSeconds = 0;
let pendingUploadedAudioStartedAt = null;

function buildAllRecordingsDetailHref(recordingId) {
  const params = new URLSearchParams();
  if (recordingId) params.set("recording", recordingId);
  const query = params.toString();
  return `./all-meeting-notes${query ? `?${query}` : ""}`;
}

function consumeRetryUploadRequest() {
  if (!pendingRetryUploadOpen) return false;
  pendingRetryUploadOpen = false;

  const url = new URL(window.location.href);
  url.searchParams.delete("openUpload");
  url.searchParams.delete("retryTitle");
  url.searchParams.delete("retryRecording");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  return true;
}

function isPauseSupported() {
  return Boolean(
    window.MediaRecorder &&
    typeof window.MediaRecorder.prototype.pause === "function" &&
    typeof window.MediaRecorder.prototype.resume === "function"
  );
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

function setRecordingDetailTab(tabName = "notes") {
  const nextTab = recordingDetailTabPanels.some((panel) => panel.dataset.recordingDetailPanel === tabName)
    ? tabName
    : "notes";

  recordingDetailTabs.forEach((button) => {
    const isActive = button.dataset.recordingDetailTab === nextTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  recordingDetailTabPanels.forEach((panel) => {
    const isActive = panel.dataset.recordingDetailPanel === nextTab;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function focusRecordingDetailTab(tabName) {
  setRecordingDetailTab(tabName);
  const activeTab = recordingDetailTabs.find((button) => button.dataset.recordingDetailTab === tabName);
  activeTab?.focus();
}

function handleRecordingDetailTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  if (!recordingDetailTabs.length) return;

  const currentIndex = recordingDetailTabs.indexOf(event.currentTarget);
  if (currentIndex === -1) return;

  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = currentIndex === 0 ? recordingDetailTabs.length - 1 : currentIndex - 1;
  if (event.key === "ArrowRight") nextIndex = currentIndex === recordingDetailTabs.length - 1 ? 0 : currentIndex + 1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = recordingDetailTabs.length - 1;

  focusRecordingDetailTab(recordingDetailTabs[nextIndex].dataset.recordingDetailTab);
}

function setRecordPanelOpen(isOpen, options = {}) {
  if (!recordPanelToggle || !recordPanelBody) return;
  const nextOpen = Boolean(isOpen);
  show(recordPanelBody, nextOpen);
  recordPanelToggle.classList.toggle("is-open", nextOpen);
  recordPanelToggle.setAttribute("aria-expanded", String(nextOpen));
  const indicator = recordPanelToggle.querySelector(".section-toggle-indicator");
  if (indicator) indicator.textContent = nextOpen ? "-" : "+";

  if (nextOpen && options.scroll) {
    recordPanelToggle.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (nextOpen && options.focus) {
    window.setTimeout(() => recordingTitleInput?.focus({ preventScroll: true }), 120);
  }
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
  mobileMenuAccount?.classList.toggle("is-active", section === "account");
  mobileMenuLibrary?.classList.toggle("is-active", section === "library");
  mobileMenuFilesLink?.classList.toggle("is-active", section === "files");
  mobileMenuMessagesLink?.classList.toggle("is-active", section === "messages");
  if (mobileMenuRecordingsLink) {
    const isRecordings = section === "recordings";
    mobileMenuRecordingsLink.classList.toggle("is-active", isRecordings);
    if (isRecordings) {
      mobileMenuRecordingsLink.setAttribute("aria-current", "page");
    } else {
      mobileMenuRecordingsLink.removeAttribute("aria-current");
    }
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

function getErrorMessage(error, fallback) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function isMissingRecordingWorkflowSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("selected_template_id") ||
    message.includes("notes_content_json") ||
    message.includes("transcript_text") ||
    message.includes("ai_review_status") ||
    message.includes("ai_review_json") ||
    message.includes("ai_draft_document_id") ||
    message.includes("schema cache")
  );
}

function isMissingRecordingReferencesSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("meeting_recording_references") && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("not found")
  );
}

function textFromTiptapNode(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const children = Array.isArray(node.content) ? node.content.map(textFromTiptapNode).join("") : "";
  if (["paragraph", "heading", "listItem"].includes(node.type)) return `${children.trim()}\n`;
  if (node.type === "bulletList" || node.type === "orderedList") return `${children.trim()}\n`;
  return children;
}

function plainTextFromContentJson(contentJson) {
  return String(textFromTiptapNode(contentJson || {}))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inlineTextFromTiptapNode(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return Array.isArray(node.content) ? node.content.map(inlineTextFromTiptapNode).join("") : "";
}

function appendNotesLine(lines, value = "") {
  const line = String(value || "").replace(/[ \t]+$/g, "");
  if (!line && lines[lines.length - 1] === "") return;
  lines.push(line);
}

function appendParagraphNodeToNotes(node, lines, prefix = "") {
  const text = inlineTextFromTiptapNode(node).trim();
  if (!text) {
    appendNotesLine(lines);
    return;
  }
  text.split("\n").forEach((line, index) => {
    appendNotesLine(lines, `${index === 0 ? prefix : " ".repeat(prefix.length)}${line.trim()}`);
  });
}

function getListItemTextNodes(node) {
  return (Array.isArray(node?.content) ? node.content : []).filter((child) => {
    return child?.type !== "bulletList" && child?.type !== "orderedList";
  });
}

function getNestedListNodes(node) {
  return (Array.isArray(node?.content) ? node.content : []).filter((child) => {
    return child?.type === "bulletList" || child?.type === "orderedList";
  });
}

function appendListItemToNotes(node, lines, marker, depth) {
  const indent = "  ".repeat(depth);
  const textLines = getListItemTextNodes(node)
    .map((child) => templateNotesTextFromNode(child))
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (textLines.length) {
    appendNotesLine(lines, `${indent}${marker} ${textLines[0]}`);
    textLines.slice(1).forEach((line) => appendNotesLine(lines, `${indent}  ${line}`));
  } else {
    appendNotesLine(lines, `${indent}${marker}`);
  }

  getNestedListNodes(node).forEach((child) => appendListNodeToNotes(child, lines, depth + 1));
}

function appendListNodeToNotes(node, lines, depth = 0) {
  const items = Array.isArray(node?.content) ? node.content.filter((child) => child?.type === "listItem") : [];
  const start = Number(node?.attrs?.start) || 1;
  items.forEach((item, index) => {
    const marker = node.type === "orderedList" ? `${start + index}.` : "-";
    appendListItemToNotes(item, lines, marker, depth);
  });
}

function appendTableNodeToNotes(node, lines) {
  const rows = Array.isArray(node?.content) ? node.content.filter((child) => child?.type === "tableRow") : [];
  rows.forEach((row) => {
    const cells = (Array.isArray(row.content) ? row.content : [])
      .filter((cell) => cell?.type === "tableCell" || cell?.type === "tableHeader")
      .map((cell) => templateNotesTextFromNode(cell).replace(/\s*\n\s*/g, " ").trim());
    if (cells.length) appendNotesLine(lines, cells.join("\t"));
  });
}

function appendTemplateNotesNode(node, lines, options = {}) {
  if (!node || typeof node !== "object") return;

  if (node.type === "doc") {
    (Array.isArray(node.content) ? node.content : []).forEach((child) => appendTemplateNotesNode(child, lines));
    return;
  }

  if (node.type === "paragraph" || node.type === "heading") {
    appendParagraphNodeToNotes(node, lines, options.prefix || "");
    appendNotesLine(lines);
    return;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    appendListNodeToNotes(node, lines, options.depth || 0);
    appendNotesLine(lines);
    return;
  }

  if (node.type === "blockquote") {
    const quoteLines = [];
    (Array.isArray(node.content) ? node.content : []).forEach((child) => appendTemplateNotesNode(child, quoteLines));
    const quoteText = normalizeTemplateNotesLines(quoteLines);
    quoteText.split("\n").forEach((line) => appendNotesLine(lines, line));
    appendNotesLine(lines);
    return;
  }

  if (node.type === "table") {
    appendTableNodeToNotes(node, lines);
    appendNotesLine(lines);
    return;
  }

  if (node.type === "horizontalRule") {
    appendNotesLine(lines);
    return;
  }

  if (node.type === "text" || node.type === "hardBreak") {
    appendNotesLine(lines, inlineTextFromTiptapNode(node));
    return;
  }

  (Array.isArray(node.content) ? node.content : []).forEach((child) => appendTemplateNotesNode(child, lines));
}

function normalizeTemplateNotesLines(lines) {
  const normalized = [];
  lines.forEach((line) => {
    const nextLine = String(line || "").replace(/[ \t]+$/g, "");
    if (!nextLine && normalized[normalized.length - 1] === "") return;
    normalized.push(nextLine);
  });
  while (normalized[0] === "") normalized.shift();
  while (normalized[normalized.length - 1] === "") normalized.pop();
  return normalized.join("\n");
}

function templateNotesTextFromNode(node) {
  const lines = [];
  appendTemplateNotesNode(node, lines);
  return normalizeTemplateNotesLines(lines);
}

function templateNotesTextFromBlocks(contentJson) {
  const blocks = Array.isArray(contentJson?.blocks) ? contentJson.blocks : [];
  const lines = [];
  blocks.forEach((block) => {
    if (block?.type === "list") {
      (Array.isArray(block.items) ? block.items : []).forEach((item) => appendNotesLine(lines, `- ${String(item || "").trim()}`));
      appendNotesLine(lines);
      return;
    }
    if (typeof block?.text === "string") {
      appendNotesLine(lines, block.text.trim());
      appendNotesLine(lines);
      return;
    }
    if (typeof block?.html === "string") {
      const template = document.createElement("template");
      template.innerHTML = block.html;
      appendNotesLine(lines, template.content.textContent.trim());
      appendNotesLine(lines);
    }
  });
  return normalizeTemplateNotesLines(lines);
}

function templateNotesTextFromContentJson(contentJson) {
  if (contentJson?.type === "doc") return templateNotesTextFromNode(contentJson);
  if (Array.isArray(contentJson?.blocks)) return templateNotesTextFromBlocks(contentJson);
  if (typeof contentJson?.html === "string") {
    const template = document.createElement("template");
    template.innerHTML = contentJson.html;
    return template.content.textContent.trim();
  }
  return "";
}

function noteTextToContentJson(text) {
  const content = String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    }));

  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

function getSelectedTemplate() {
  const id = recordingTemplateSelect?.value || "";
  if (id === BLANK_NOTES_TEMPLATE_VALUE) return null;
  return recordingTemplates.find((template) => template.id === id) || null;
}

function getTemplateLabel(templateId) {
  if (!templateId) return "No template";
  const template = recordingTemplates.find((item) => item.id === templateId);
  return template?.title || "Template";
}

function getReferenceTypeLabel(type) {
  return type === "agenda" ? "Agenda" : "Supporting document";
}

function getReferenceDocument(documentId) {
  return referenceDocuments.find((item) => item.id === documentId) || null;
}

function normalizeReference(row, index = 0) {
  const document = row?.app_document || getReferenceDocument(row?.app_document_id);
  return {
    id: row?.id || "",
    meeting_recording_id: row?.meeting_recording_id || "",
    app_document_id: row?.app_document_id || document?.id || "",
    reference_type: row?.reference_type === "agenda" ? "agenda" : "supporting_document",
    sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : index,
    app_document: document || null,
  };
}

function sortReferences(references = []) {
  return [...references].sort((a, b) => {
    const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (orderDiff) return orderDiff;
    return String(a.app_document?.title || "").localeCompare(String(b.app_document?.title || ""));
  });
}

function getRecordingReferences(recording) {
  return sortReferences(Array.isArray(recording?.references) ? recording.references : []);
}

function referenceAlreadySelected(references, documentId) {
  return references.some((item) => item.app_document_id === documentId);
}

function renderReferenceSelect(selectEl, references = []) {
  if (!selectEl) return;
  const selectedValue = selectEl.value;
  selectEl.innerHTML = `<option value="">Select a document</option>`;
  const selectedIds = new Set(references.map((item) => item.app_document_id));
  referenceDocuments.forEach((doc) => {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = doc.title || "Untitled document";
    option.disabled = selectedIds.has(doc.id);
    selectEl.append(option);
  });
  if (selectedValue && referenceDocuments.some((doc) => doc.id === selectedValue) && !selectedIds.has(selectedValue)) {
    selectEl.value = selectedValue;
  }
}

function renderReferenceList(listEl, emptyEl, references = [], options = {}) {
  if (!listEl) return;
  const sorted = sortReferences(references);
  listEl.innerHTML = sorted.map((reference) => {
    const doc = reference.app_document || getReferenceDocument(reference.app_document_id);
    const title = doc?.title || "Untitled document";
    const href = `/n3xra-records/documents?id=${encodeURIComponent(reference.app_document_id)}`;
    const removeAttr = options.canRemove
      ? ` <button class="recording-reference-remove" type="button" data-reference-remove-id="${escapeHtml(reference.id || reference.app_document_id)}">Remove</button>`
      : "";
    return `
      <article class="recording-reference-row" data-reference-preview-id="${escapeHtml(reference.app_document_id)}">
        <div>
          <span class="recording-reference-type">${escapeHtml(getReferenceTypeLabel(reference.reference_type))}</span>
          <p class="recording-reference-title">${escapeHtml(title)}</p>
        </div>
        <div class="recording-reference-actions">
          <a class="btn secondary button-link" href="${href}" rel="noopener">Open</a>
          ${removeAttr}
        </div>
      </article>
    `;
  }).join("");
  show(emptyEl, sorted.length === 0);
}

function renderPendingReferences() {
  renderReferenceSelect(recordingReferenceSelect, pendingMeetingReferences);
  renderReferenceList(recordingReferenceList, recordingReferenceEmpty, pendingMeetingReferences, { canRemove: true });
  if (recordingReferenceAdd) recordingReferenceAdd.disabled = !recordingReferenceSelect?.value;
}

function clearPendingReferences() {
  pendingMeetingReferences = [];
  if (recordingReferenceSelect) recordingReferenceSelect.value = "";
  if (recordingReferenceType) recordingReferenceType.value = "agenda";
  renderPendingReferences();
}

function addPendingReference() {
  const documentId = recordingReferenceSelect?.value || "";
  if (!documentId || referenceAlreadySelected(pendingMeetingReferences, documentId)) return;
  const document = getReferenceDocument(documentId);
  if (!document) return;
  pendingMeetingReferences.push({
    id: `pending-${documentId}`,
    app_document_id: document.id,
    reference_type: recordingReferenceType?.value === "supporting_document" ? "supporting_document" : "agenda",
    sort_order: pendingMeetingReferences.length,
    app_document: document,
  });
  if (recordingReferenceSelect) recordingReferenceSelect.value = "";
  renderPendingReferences();
  updateControls();
}

function removePendingReference(referenceId) {
  pendingMeetingReferences = pendingMeetingReferences
    .filter((item) => item.id !== referenceId && item.app_document_id !== referenceId)
    .map((item, index) => ({ ...item, sort_order: index }));
  renderPendingReferences();
  updateControls();
}

function getCurrentNotesPayload() {
  const notesText = String(recordingNotesInput?.value || "").trim();
  const selectedTemplateId = recordingTemplateSelect?.value || "";
  return {
    selected_template_id: selectedTemplateId && selectedTemplateId !== BLANK_NOTES_TEMPLATE_VALUE ? selectedTemplateId : null,
    notes_content_json: noteTextToContentJson(notesText),
    notes_plain_text: notesText,
    notes_updated_at: new Date().toISOString(),
  };
}

function hasMeetingNoteRequiredFields() {
  return Boolean(recordingTitleInput?.value.trim() && recordingTemplateSelect?.value);
}

function renderTemplateSelect() {
  if (!recordingTemplateSelect) return;
  const selectedValue = recordingTemplateSelect.value;
  recordingTemplateSelect.innerHTML = `
    <option value="">Select a template</option>
    <option value="${BLANK_NOTES_TEMPLATE_VALUE}">No template - blank notes</option>
  `;
  recordingTemplates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.title || "Untitled template";
    recordingTemplateSelect.append(option);
  });
  if (
    selectedValue === BLANK_NOTES_TEMPLATE_VALUE ||
    (selectedValue && recordingTemplates.some((template) => template.id === selectedValue))
  ) {
    recordingTemplateSelect.value = selectedValue;
  }
}

function applySelectedTemplateToNotes() {
  if (!recordingTemplateSelect) return;
  if (recordingTemplateSelect.value === BLANK_NOTES_TEMPLATE_VALUE) {
    if (!activeRecordingId) recordingNotesInput.value = "";
    queueActiveRecordingNotesSave();
    updateControls();
    return;
  }

  const template = getSelectedTemplate();
  if (!template) {
    updateControls();
    return;
  }
  const templateText = String(
    templateNotesTextFromContentJson(template.content_json || {}) ||
    template.plain_text ||
    plainTextFromContentJson(template.content_json || {})
  ).trim();
  recordingNotesInput.value = templateText;
  queueActiveRecordingNotesSave();
  updateControls();
}

function setRecordingsConfirmModalOpen(isOpen) {
  if (!recordingsConfirmModal) return;
  recordingsConfirmModal.classList.toggle("is-open", isOpen);
  recordingsConfirmModal.setAttribute("aria-hidden", String(!isOpen));
}

function confirmRecordingsAction() {
  if (!recordingsConfirmModal) return Promise.resolve(false);
  setRecordingsConfirmModalOpen(true);
  return new Promise((resolve) => {
    pendingRecordingsConfirmResolve = resolve;
  });
}

function resolveRecordingsConfirm(value) {
  if (pendingRecordingsConfirmResolve) {
    pendingRecordingsConfirmResolve(Boolean(value));
  }
  pendingRecordingsConfirmResolve = null;
  setRecordingsConfirmModalOpen(false);
}

function getActiveOrganization() {
  return activeMembership?.organization || null;
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
    isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function canRecordInActiveOrganization() {
  const capabilities = getActiveCapabilities();
  return Boolean(getActiveOrganization()) && capabilities.canManageDocuments && capabilities.canUseRecordings;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(Number(totalSeconds || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }
  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRecordingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let value = size;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function slugifySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "meeting-recording";
}

function getSupportedMimeType() {
  if (typeof window.MediaRecorder === "undefined") return "";
  for (const candidate of MIME_TYPE_CANDIDATES) {
    if (window.MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function getFileExtension(mimeType) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function setRecorderState(label, copy) {
  recorderStateLabel.textContent = label;
  recorderStateCopy.textContent = copy;
}

function setUploadProgressVisible(isVisible, copy = "") {
  show(uploadProgressShell, isVisible);
  if (copy) {
    uploadProgressCopy.textContent = copy;
  } else {
    uploadProgressCopy.textContent = "Upload in progress. Do not leave this page until it finishes.";
  }
}

function appendTextToNotetakerNotes(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText || !recordingNotesInput) return;
  const existing = String(recordingNotesInput.value || "").trimEnd();
  recordingNotesInput.value = existing ? `${existing}\n\n${cleanText}` : cleanText;
  recordingNotesInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function appendTextToDetailNotes(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText || !recordingDetailNotes) return;
  const existing = String(recordingDetailNotes.value || "").trimEnd();
  recordingDetailNotes.value = existing ? `${existing}\n\n${cleanText}` : cleanText;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(new Error("Unable to read the selected image.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Unable to read this image format. Try a JPG, PNG, or screenshot.")), { once: true });
    image.src = src;
  });
}

async function prepareHandwrittenNoteImage(file) {
  if (!file) throw new Error("Choose a handwritten note image first.");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("Choose an image file, such as a photo or screenshot.");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare this image for scanning.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const qualities = [0.86, 0.74, 0.62, 0.5];
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const estimatedBytes = Math.ceil((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
    if (estimatedBytes <= HANDWRITTEN_NOTE_MAX_BYTES) return dataUrl;
  }

  throw new Error("That image is too large to scan. Try a closer crop or screenshot of the handwritten note.");
}

async function scanHandwrittenNote(file, options = {}) {
  const requireTemplate = options.requireTemplate !== false;
  const organization = getActiveOrganization();
  if (!organization) throw new Error("Select a library before scanning notes.");
  if (requireTemplate && !recordingTemplateSelect.value) {
    throw new Error("Select a document template or blank notes before scanning notes.");
  }

  const imageDataUrl = await prepareHandwrittenNoteImage(file);
  const token = currentSession?.access_token || "";
  const response = await fetch("/api/ocr-handwritten-note", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      organizationId: organization.id,
      imageDataUrl,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to scan the handwritten note.");
  return String(data.text || "").trim();
}

async function handleHandwrittenNoteFile(file) {
  if (!file) return;
  scanHandwrittenNoteButton.disabled = true;
  setStatus(recordingStatus, "Scanning handwritten note...");
  try {
    const text = await scanHandwrittenNote(file);
    if (!text) {
      setStatus(recordingStatus, "No readable note text was found in that image.", "error");
      return;
    }
    appendTextToNotetakerNotes(text);
    setStatus(recordingStatus, "Handwritten note added to notetaker notes.", "success");
  } catch (error) {
    setStatus(recordingStatus, getErrorMessage(error, "Unable to scan handwritten note."), "error");
  } finally {
    if (handwrittenNoteInput) handwrittenNoteInput.value = "";
    updateControls();
  }
}

async function handleDetailHandwrittenNoteFile(file) {
  if (!file || !activeDetailRecordingId) return;
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(recordingDetailStatusMessage, "You need editor access to add notes.", "error");
    return;
  }
  recordingDetailScanHandwrittenNoteButton.disabled = true;
  setStatus(recordingDetailStatusMessage, "Scanning handwritten note...");
  try {
    const text = await scanHandwrittenNote(file, { requireTemplate: false });
    if (!text) {
      setStatus(recordingDetailStatusMessage, "No readable note text was found in that image.", "error");
      return;
    }
    appendTextToDetailNotes(text);
    await saveRecordingDetailNotes();
    setStatus(recordingDetailStatusMessage, "Handwritten note added to notetaker notes.", "success");
  } catch (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to scan handwritten note."), "error");
  } finally {
    if (recordingDetailHandwrittenNoteInput) recordingDetailHandwrittenNoteInput.value = "";
    const recording = getRecordingById(activeDetailRecordingId);
    recordingDetailScanHandwrittenNoteButton.disabled = !recording ||
      !getActiveCapabilities().canEditDocuments ||
      !recordingWorkflowSchemaAvailable;
  }
}

function setRecordingUploadMode(isRetryMode) {
  isRetryUploadMode = isRetryMode;
  recordingUploadKicker.textContent = isRetryMode ? "Retry upload" : "Upload audio";
  recordingUploadTitle.textContent = isRetryMode ? "Select the file again" : "Select audio file";
  recordingUploadNote.textContent = isRetryMode
    ? `Browsers cannot keep the previous file attached. Choose the original audio file again to retry this upload. Max ${formatBytes(MAX_RECORDING_AUDIO_BYTES)}.`
    : `Choose an existing audio file to attach before saving this meeting note. Max ${formatBytes(MAX_RECORDING_AUDIO_BYTES)}.`;
  recordingUploadSubmit.textContent = isRetryMode ? "Retry upload" : "Attach audio";
}

function setRecordingUploadModalOpen(isOpen) {
  recordingUploadModal.classList.toggle("is-open", isOpen);
  recordingUploadModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    setStatus(recordingUploadStatus, "");
  }
}

function getSelectedRecordingFile() {
  return recordingFileInput?.files?.[0] || null;
}

function updateSelectedFileCopy() {
  const selectedFile = getSelectedRecordingFile();
  recordingFileCopy.textContent = selectedFile
    ? `${selectedFile.name} · ${formatBytes(selectedFile.size || 0)}${selectedFile.size > MAX_RECORDING_AUDIO_BYTES ? ` · Over ${formatBytes(MAX_RECORDING_AUDIO_BYTES)} limit` : ""}`
    : "No file selected.";
}

function clearRecorderStats() {
  recorderStateLabel.textContent = "";
  recordingDuration.textContent = "";
  uploadStateValue.textContent = "";
  setUploadProgressVisible(false);
}

function updateControls() {
  const recorderState = mediaRecorder?.state || "inactive";
  const isCaptureActive = recorderState === "recording" || recorderState === "paused";
  const hasPendingRecording = hasUnsavedRecordingAudio();
  const hasPendingUpload = hasPendingUploadedAudio();
  const hasActiveSession = isRecordingWorkflowActive || isCaptureActive || hasPendingRecording;
  const pauseSupported = isPauseSupported();
  const hasSelectedTemplate = Boolean(recordingTemplateSelect.value);
  const hasRequiredFields = hasMeetingNoteRequiredFields();
  const canUseRecorder = canRecordInActiveOrganization() && recordingWorkflowSchemaAvailable && hasSelectedTemplate;
  const canSaveMeetingNote = canRecordInActiveOrganization() && recordingWorkflowSchemaAvailable && hasRequiredFields;

  startRecordingButton.disabled = !canUseRecorder || hasActiveSession || hasPendingUpload || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
  uploadRecordingButton.disabled = !canUseRecorder || hasActiveSession;
  uploadRecordingButton.textContent = hasPendingUpload ? "Change audio" : "Upload recording";
  show(startRecordingButton, !hasActiveSession && !hasPendingUpload);
  show(uploadRecordingButton, !hasActiveSession);
  pauseRecordingButton.disabled = !isCaptureActive || !pauseSupported;
  pauseRecordingButton.textContent = recorderState === "paused" ? "Resume recording" : "Pause recording";
  stopRecordingButton.disabled = !isCaptureActive;
  show(pauseRecordingButton, isCaptureActive && pauseSupported);
  show(stopRecordingButton, isCaptureActive);
  if (saveRecordingButton) {
    saveRecordingButton.disabled = !canSaveMeetingNote || isRecordingWorkflowActive || isCaptureActive;
    show(saveRecordingButton, !isCaptureActive);
  }
  activeOrganizationSelect.disabled = hasActiveSession || hasPendingUpload || memberships.length <= 1;
  recordingTitleInput.disabled = hasActiveSession;
  recordingTemplateSelect.disabled = hasActiveSession || !recordingWorkflowSchemaAvailable;
  recordingNotesInput.disabled = !canUseRecorder;
  if (recordingReferenceSelect) recordingReferenceSelect.disabled = !canUseRecorder || hasActiveSession || !recordingReferencesSchemaAvailable;
  if (recordingReferenceType) recordingReferenceType.disabled = !canUseRecorder || hasActiveSession || !recordingReferencesSchemaAvailable;
  if (recordingReferenceAdd) recordingReferenceAdd.disabled = !canUseRecorder || hasActiveSession || !recordingReferencesSchemaAvailable || !recordingReferenceSelect.value;
  recordingFileInput.disabled = !canUseRecorder || hasActiveSession;
  recordingUploadSubmit.disabled = !canUseRecorder || hasActiveSession || !Boolean(getSelectedRecordingFile());
  if (scanHandwrittenNoteButton) scanHandwrittenNoteButton.disabled = !canUseRecorder || isRecordingWorkflowActive;
  if (handwrittenNoteInput) handwrittenNoteInput.disabled = !canUseRecorder || isRecordingWorkflowActive;
}

function getRecordingById(recordingId) {
  return recordingsCache.find((item) => item.id === recordingId) || null;
}

function hasUnsavedRecordingAudio() {
  return Boolean(activeRecordingId && pendingRecordedBlob);
}

function hasPendingUploadedAudio() {
  return Boolean(pendingUploadedAudioFile);
}

function isRetryableRecording(recording) {
  return String(recording?.status || "").trim().toLowerCase() === "failed";
}

function canPlaybackRecording(recording) {
  const status = String(recording?.status || "").trim().toLowerCase();
  return Boolean(recording?.storage_path) && ["uploaded", "transcribing", "ready"].includes(status);
}

function canTranscribeRecording(recording) {
  const status = String(recording?.status || "").trim().toLowerCase();
  const transcriptStatus = String(recording?.transcript_status || "").trim().toLowerCase();
  return Boolean(recording?.storage_path) &&
    ["uploaded", "ready"].includes(status) &&
    !["processing", "ready"].includes(transcriptStatus) &&
    getActiveCapabilities().canManageDocuments;
}

function setRecordingDetailModalOpen(isOpen) {
  recordingDetailModal.classList.toggle("is-open", isOpen);
  recordingDetailModal.setAttribute("aria-hidden", String(!isOpen));
}

function clearDetailPlayer() {
  if (detailPlayerUrl) {
    recordingDetailPlayer.pause();
    recordingDetailPlayer.removeAttribute("src");
    recordingDetailPlayer.load();
    detailPlayerUrl = "";
  }
  recordingDetailPlay.textContent = "Play";
  show(recordingDetailPlayer, false);
}

async function createRecordingSignedUrl(recording) {
  if (!recording?.storage_path) {
    throw new Error("No audio file is stored for this meeting note yet.");
  }

  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(recording.storage_path, 60 * 10);
  if (error || !data?.signedUrl) {
    throw error || new Error("Unable to create a playback link.");
  }
  return data.signedUrl;
}

function startDurationTimer() {
  stopDurationTimer();
  durationTimer = window.setInterval(() => {
    const elapsedMs = getElapsedRecordingMs();
    const seconds = Math.max(Math.round(elapsedMs / 1000), 0);
    recordingDuration.textContent = formatDuration(seconds);
  }, 500);
}

function stopDurationTimer() {
  if (durationTimer) {
    window.clearInterval(durationTimer);
    durationTimer = null;
  }
}

function stopActiveStreamTracks() {
  if (!activeStream) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
}

function getElapsedRecordingMs() {
  if (!recordingStartedAt) return elapsedRecordingMs;
  return elapsedRecordingMs + (Date.now() - recordingStartedAt.getTime());
}

function pauseElapsedClock() {
  if (!recordingStartedAt) return;
  elapsedRecordingMs += Date.now() - recordingStartedAt.getTime();
  recordingStartedAt = null;
}

function resumeElapsedClock() {
  recordingStartedAt = new Date();
}

function renderOrganizationSelector() {
  if (!memberships.length || !getActiveOrganization()) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeOrganizationName.textContent = "No active library";
    activeMembershipRole.textContent = "No library access";
    recordingCount.textContent = "0";
    activeOrganizationSelect.disabled = true;
    show(activeOrganizationSelect, false);
    show(activeOrganizationName, true);
    show(recordingsNoAccessNotice, true);
    show(recordingsContextPanel, false);
    show(mobileMenuMessagesLink, false);
    show(mobileMenuRecordingsLink, false);
    updateControls();
    return;
  }

  const currentId = getActiveOrganization()?.id || "";
  activeOrganizationSelect.innerHTML = memberships
    .map((membership) => {
      const selected = membership.organization?.id === currentId ? " selected" : "";
      return `<option value="${escapeHtml(membership.organization?.id || "")}"${selected}>${escapeHtml(membership.organization?.name || "Untitled library")}</option>`;
    })
    .join("");
  const hasMany = memberships.length > 1;
  activeOrganizationName.textContent = getActiveOrganization()?.name || "Untitled library";
  activeMembershipRole.textContent = formatRoleLabel(getMembershipRole(activeMembership));
  show(activeOrganizationSelect, hasMany);
  show(activeOrganizationName, !hasMany);
  show(recordingsNoAccessNotice, !canRecordInActiveOrganization());
  show(recordingsContextPanel, true);
  show(mobileMenuMessagesLink, getActiveCapabilities().canShareDocuments);
  show(mobileMenuRecordingsLink, getActiveCapabilities().canUseRecordings);
  updateControls();
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
  }
  renderOrganizationSelector();
}

async function loadRecordingTemplates() {
  const organization = getActiveOrganization();
  recordingTemplates = [];
  renderTemplateSelect();
  if (!organization) return;

  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, content_json, plain_text, updated_at, created_at")
    .eq("organization_id", organization.id)
    .eq("document_kind", "template")
    .order("updated_at", { ascending: false });

  if (error) {
    recordingTemplates = [];
    renderTemplateSelect();
    return;
  }

  recordingTemplates = Array.isArray(data) ? data : [];
  renderTemplateSelect();
  updateControls();
}

async function loadReferenceDocuments() {
  const organization = getActiveOrganization();
  referenceDocuments = [];
  renderPendingReferences();
  renderReferenceSelect(recordingDetailReferenceSelect, getRecordingReferences(getRecordingById(activeDetailRecordingId)));
  if (!organization) return;

  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, status, updated_at, created_at")
    .eq("organization_id", organization.id)
    .eq("document_kind", "document")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (error) {
    referenceDocuments = [];
    renderPendingReferences();
    return;
  }

  referenceDocuments = Array.isArray(data) ? data : [];
  renderPendingReferences();
  renderReferenceSelect(recordingDetailReferenceSelect, getRecordingReferences(getRecordingById(activeDetailRecordingId)));
}

async function loadReferencesForRecordings(recordingIds = []) {
  if (!recordingReferencesSchemaAvailable || !recordingIds.length) return;

  const { data, error } = await supabase
    .from("meeting_recording_references")
    .select("id, meeting_recording_id, app_document_id, reference_type, sort_order")
    .in("meeting_recording_id", recordingIds)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingRecordingReferencesSchemaError(error)) {
      recordingReferencesSchemaAvailable = false;
      return;
    }
    throw error;
  }

  recordingReferencesSchemaAvailable = true;
  const rows = Array.isArray(data) ? data : [];
  const documentIds = Array.from(new Set(rows.map((row) => row.app_document_id).filter(Boolean)));
  let documentsById = new Map(referenceDocuments.map((doc) => [doc.id, doc]));
  const missingDocumentIds = documentIds.filter((id) => !documentsById.has(id));

  if (missingDocumentIds.length) {
    const { data: docs } = await supabase
      .from("app_documents")
      .select("id, title, status, updated_at, created_at")
      .in("id", missingDocumentIds);
    (docs || []).forEach((doc) => documentsById.set(doc.id, doc));
  }

  const referencesByRecording = new Map();
  rows.forEach((row, index) => {
    const reference = normalizeReference({ ...row, app_document: documentsById.get(row.app_document_id) || null }, index);
    const list = referencesByRecording.get(reference.meeting_recording_id) || [];
    list.push(reference);
    referencesByRecording.set(reference.meeting_recording_id, list);
  });

  recordingsCache = recordingsCache.map((recording) => ({
    ...recording,
    references: sortReferences(referencesByRecording.get(recording.id) || []),
  }));
}

function mergeRecordingUpdate(recording) {
  if (!recording?.id) return;
  const index = recordingsCache.findIndex((item) => item.id === recording.id);
  if (index === -1) return;
  recordingsCache[index] = {
    ...recordingsCache[index],
    ...recording,
  };
}

async function loadRecordings() {
  const organization = getActiveOrganization();
  if (!organization) {
    recordingsCache = [];
    totalRecordingCount = 0;
    renderRecordings();
    setStatus(recordingsListStatus, "");
    return;
  }

  setStatus(recordingsListStatus, "Loading meeting notes...");
  let { data, error, count } = await supabase
    .from("meeting_recordings")
    .select(`
      id,
      document_id,
      title,
      status,
      transcript_status,
      transcript_text,
      ai_review_status,
      selected_template_id,
      started_at,
      ended_at,
      duration_seconds,
      storage_path,
      audio_mime_type,
      file_size,
      processing_error,
      notes_plain_text,
      ai_review_json,
      ai_draft_document_id,
      final_document_id,
      created_at
    `, { count: "exact" })
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(3);

  if (error && isMissingRecordingWorkflowSchemaError(error)) {
    recordingWorkflowSchemaAvailable = false;
    const fallback = await supabase
      .from("meeting_recordings")
      .select(`
        id,
        document_id,
        title,
        status,
        transcript_status,
        started_at,
        ended_at,
        duration_seconds,
        storage_path,
        audio_mime_type,
        file_size,
        processing_error,
        created_at
      `, { count: "exact" })
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(3);
    data = fallback.data;
    error = fallback.error;
    count = fallback.count;
  } else {
    recordingWorkflowSchemaAvailable = true;
  }

  if (error) {
    recordingsCache = [];
    totalRecordingCount = 0;
    renderRecordings();
    setStatus(recordingsListStatus, getErrorMessage(error, "Unable to load meeting notes."), "error");
    return;
  }

  recordingsCache = Array.isArray(data) ? data : [];
  let referenceLoadError = null;
  try {
    await loadReferencesForRecordings(recordingsCache.map((recording) => recording.id));
  } catch (error) {
    referenceLoadError = error;
  }
  totalRecordingCount = Number(count || 0);
  renderRecordings();
  setStatus(
    recordingsListStatus,
    referenceLoadError
      ? getErrorMessage(referenceLoadError, "Meeting notes loaded, but references could not be loaded.")
      : totalRecordingCount ? `${totalRecordingCount} meeting note${totalRecordingCount === 1 ? "" : "s"} saved.` : "",
    referenceLoadError ? "error" : ""
  );
}

function renderRecordings() {
  recordingCount.textContent = String(totalRecordingCount);
  if (!recordingsCache.length) {
    recordingsList.innerHTML = "";
    show(recordingsEmpty, true);
    return;
  }

  show(recordingsEmpty, false);
  recordingsList.innerHTML = recordingsCache
    .map((recording) => {
      const errorCopy = recording.processing_error
        ? `<p class="recording-row-note recording-row-note-error">${escapeHtml(recording.processing_error)}</p>`
        : "";

      return `
        <article class="recording-row" data-recording-id="${escapeHtml(recording.id)}" role="button" tabindex="0">
          <div class="recording-row-main">
            <div>
              <p class="recording-row-title">${escapeHtml(recording.title || "Untitled meeting note")}</p>
              <p class="recording-row-meta">${escapeHtml(formatDateTime(recording.started_at || recording.created_at))}</p>
            </div>
            <span class="recording-row-status status-${escapeHtml(String(recording.status || "").toLowerCase())}">${escapeHtml(formatRecordingStatus(recording.status))}</span>
          </div>
          <div class="recording-row-details">
            <span>${escapeHtml(formatDuration(recording.duration_seconds || 0))}</span>
            <span>${escapeHtml(formatBytes(recording.file_size || 0))}</span>
            <span>${escapeHtml(formatRecordingStatus(recording.transcript_status))} transcript</span>
            <span>${escapeHtml(formatRecordingStatus(recording.ai_review_status || "not_started"))} AI review</span>
          </div>
          ${errorCopy}
        </article>
      `;
    })
    .join("");
}

function formatSuggestionStatus(status) {
  if (status === "applied") return "Applied";
  if (status === "dismissed") return "Dismissed";
  return "";
}

function renderReviewItems(container, title, items, emptyCopy, options = {}) {
  if (!container) return;
  const safeItems = Array.isArray(items) ? items : [];
  const isSuggestions = options.kind === "suggestions";
  const canAct = Boolean(options.canAct);
  const openIndexes = isSuggestions ? safeItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => getSuggestionText(item) && !isSuggestionResolved(item))
    .map(({ index }) => index) : [];
  container.innerHTML = `
    <div class="recording-review-heading">
      <p class="recording-review-title">${escapeHtml(title)}</p>
      ${
        isSuggestions && canAct && openIndexes.length
          ? '<button class="btn secondary recording-review-action" type="button" data-review-action="apply-all">Apply all</button>'
          : ""
      }
    </div>
    ${
      safeItems.length
        ? safeItems.map((item, index) => {
            const status = getSuggestionStatus(item);
            const statusLabel = formatSuggestionStatus(status);
            const statusClass = status.replace(/[^a-z0-9_-]/g, "");
            const text = isSuggestions ? getSuggestionText(item) : String(item?.text || item?.note || item?.issue || "").trim();
            return `
            <article class="recording-review-item">
              ${statusLabel ? `<span class="recording-review-status is-${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>` : ""}
              <p>${escapeHtml(text)}</p>
              ${item?.reason ? `<span>${escapeHtml(item.reason)}</span>` : ""}
              ${
                isSuggestions && canAct && !isSuggestionResolved(item)
                  ? `
                    <div class="recording-review-actions">
                      <button class="btn secondary recording-review-action" type="button" data-review-action="apply" data-review-index="${index}">Apply</button>
                      <button class="btn secondary recording-review-action" type="button" data-review-action="dismiss" data-review-index="${index}">Dismiss</button>
                    </div>
                  `
                  : ""
              }
            </article>
          `;
          }).join("")
        : `<p class="empty">${escapeHtml(emptyCopy)}</p>`
    }
  `;
}

function renderAiReview(review) {
  const hasReview = review && typeof review === "object" && (Array.isArray(review.suggested_additions) || Array.isArray(review.conflicts));
  if (!hasReview) {
    renderReviewItems(recordingAiSuggestions, "Suggested additions", [], "No AI review has been run yet.");
    renderReviewItems(recordingAiConflicts, "Possible conflicts", [], "No conflicts found.");
    return;
  }

  renderReviewItems(recordingAiSuggestions, "Suggested additions", review.suggested_additions, "No new additions suggested.", {
    kind: "suggestions",
    canAct: getActiveCapabilities().canEditDocuments,
  });
  renderReviewItems(recordingAiConflicts, "Possible conflicts", review.conflicts, "No conflicts found.");
}

function renderDetailReferences(recording) {
  const references = getRecordingReferences(recording);
  const canEdit = getActiveCapabilities().canEditDocuments && recordingReferencesSchemaAvailable;
  show(recordingDetailReferencePicker, canEdit);
  renderReferenceSelect(recordingDetailReferenceSelect, references);
  if (recordingDetailReferenceSelect) recordingDetailReferenceSelect.disabled = !canEdit;
  if (recordingDetailReferenceType) recordingDetailReferenceType.disabled = !canEdit;
  if (recordingDetailReferenceAdd) recordingDetailReferenceAdd.disabled = !canEdit || !recordingDetailReferenceSelect?.value;
  renderReferenceList(recordingDetailReferenceList, recordingDetailReferenceEmpty, references, { canRemove: canEdit });
  void previewReferenceDocument(references[0] || null);
}

function clearReferencePreview() {
  if (recordingDetailReferenceFrame) recordingDetailReferenceFrame.removeAttribute("src");
  show(recordingDetailReferencePreview, false);
  if (detailReferencePreviewUrl) {
    URL.revokeObjectURL(detailReferencePreviewUrl);
    detailReferencePreviewUrl = "";
  }
}

async function previewReferenceDocument(reference) {
  clearReferencePreview();
  if (!reference?.app_document_id || !recordingDetailReferencePreview || !recordingDetailReferenceFrame) return;
  const doc = reference.app_document || getReferenceDocument(reference.app_document_id);
  if (recordingDetailReferencePreviewType) {
    recordingDetailReferencePreviewType.textContent = getReferenceTypeLabel(reference.reference_type);
  }
  if (recordingDetailReferencePreviewTitle) {
    recordingDetailReferencePreviewTitle.textContent = doc?.title || "Referenced document";
  }
  if (recordingDetailReferencePreviewOpen) {
    recordingDetailReferencePreviewOpen.href = `/n3xra-records/documents?id=${encodeURIComponent(reference.app_document_id)}`;
  }
  show(recordingDetailReferencePreview, true);
  try {
    detailReferencePreviewUrl = await createAppDocumentPdfObjectUrl({
      config: getConfig(),
      accessToken: currentSession?.access_token || "",
      documentId: reference.app_document_id,
    });
    recordingDetailReferenceFrame.src = detailReferencePreviewUrl;
  } catch (error) {
    recordingDetailReferenceFrame.removeAttribute("src");
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to preview referenced document."), "error");
  }
}

async function saveReferencesForRecording(recordingId, references = []) {
  if (!recordingReferencesSchemaAvailable || !recordingId || !references.length) return;
  const rows = sortReferences(references).map((reference, index) => ({
    meeting_recording_id: recordingId,
    app_document_id: reference.app_document_id,
    reference_type: reference.reference_type === "agenda" ? "agenda" : "supporting_document",
    sort_order: index,
  }));
  const { error } = await supabase
    .from("meeting_recording_references")
    .insert(rows);
  if (error) {
    if (isMissingRecordingReferencesSchemaError(error)) {
      recordingReferencesSchemaAvailable = false;
      return;
    }
    throw error;
  }
}

async function reloadRecordingReferences(recordingId) {
  if (!recordingId) return;
  await loadReferencesForRecordings([recordingId]);
  const updated = getRecordingById(recordingId);
  if (updated) renderDetailReferences(updated);
}

async function addDetailReference() {
  const recording = getRecordingById(activeDetailRecordingId);
  const documentId = recordingDetailReferenceSelect?.value || "";
  if (!recording || !documentId || referenceAlreadySelected(getRecordingReferences(recording), documentId)) return;

  const { error } = await supabase
    .from("meeting_recording_references")
    .insert({
      meeting_recording_id: recording.id,
      app_document_id: documentId,
      reference_type: recordingDetailReferenceType?.value === "supporting_document" ? "supporting_document" : "agenda",
      sort_order: getRecordingReferences(recording).length,
    });

  if (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to attach reference."), "error");
    return;
  }

  if (recordingDetailReferenceSelect) recordingDetailReferenceSelect.value = "";
  await reloadRecordingReferences(recording.id);
  setStatus(recordingDetailStatusMessage, "Reference attached.", "success");
}

async function removeDetailReference(referenceId) {
  const recording = getRecordingById(activeDetailRecordingId);
  if (!recording || !referenceId) return;
  const { error } = await supabase
    .from("meeting_recording_references")
    .delete()
    .eq("id", referenceId);

  if (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to remove reference."), "error");
    return;
  }

  await reloadRecordingReferences(recording.id);
  setStatus(recordingDetailStatusMessage, "Reference removed.", "success");
}

function populateRecordingDetails(recording) {
  recordingDetailTitle.textContent = recording.title || "Untitled meeting note";
  recordingDetailStatus.textContent = formatRecordingStatus(recording.status);
  recordingDetailTranscriptStatus.textContent = formatRecordingStatus(recording.transcript_status);
  recordingDetailTemplate.textContent = getTemplateLabel(recording.selected_template_id || "");
  recordingDetailAiStatus.textContent = formatRecordingStatus(recording.ai_review_status || "not_started");
  recordingDetailStartedAt.textContent = formatDateTime(recording.started_at || recording.created_at);
  recordingDetailEndedAt.textContent = recording.ended_at ? formatDateTime(recording.ended_at) : "Not finished";
  recordingDetailDuration.textContent = formatDuration(recording.duration_seconds || 0);
  recordingDetailSize.textContent = formatBytes(recording.file_size || 0);
  recordingDetailPlay.disabled = !canPlaybackRecording(recording);
  show(recordingDetailTranscribe, canTranscribeRecording(recording));
  show(recordingDetailRetry, isRetryableRecording(recording));
  recordingDetailPlay.textContent = "Play";
  recordingDetailNotes.value = String(recording.notes_plain_text || "").trim();
  recordingDetailNotes.disabled = !getActiveCapabilities().canEditDocuments || !recordingWorkflowSchemaAvailable;
  if (recordingDetailScanHandwrittenNoteButton) {
    recordingDetailScanHandwrittenNoteButton.disabled = recordingDetailNotes.disabled;
  }
  if (recordingDetailHandwrittenNoteInput) {
    recordingDetailHandwrittenNoteInput.disabled = recordingDetailNotes.disabled;
  }
  const aiDraftPreview = String(recording.ai_review_json?.final_document_text || "").trim();
  if (recordingDetailAiDraftPreview) {
    recordingDetailAiDraftPreview.textContent = aiDraftPreview || "No AI draft created yet.";
  }
  if (recordingDetailTranscriptCopy) {
    if (recording.document_id) {
      recordingDetailTranscriptCopy.textContent = "Transcript file is ready. Open it to view, download, share, or manage it from Files.";
    } else if (recording.transcript_status === "processing" || recording.transcript_status === "queued") {
      recordingDetailTranscriptCopy.textContent = "Transcript is being created. Check back shortly.";
    } else if (recording.transcript_status === "failed") {
      recordingDetailTranscriptCopy.textContent = "Transcript creation failed. Use Retry to run transcription again.";
    } else {
      recordingDetailTranscriptCopy.textContent = "No transcript file has been created yet.";
    }
  }
  if (recordingDetailTranscriptText) {
    recordingDetailTranscriptText.textContent = String(recording.transcript_text || "").trim() || "No transcript available yet.";
  }
  show(recordingDetailTranscriptDocument, Boolean(recording.document_id));
  if (recording.document_id) {
    recordingDetailTranscriptDocument.href = `./files?id=${encodeURIComponent(recording.document_id)}`;
  }
  const reviewDocumentId = recording.final_document_id || recording.ai_draft_document_id || "";
  show(recordingDetailAiDraft, Boolean(reviewDocumentId));
  if (reviewDocumentId) {
    recordingDetailAiDraft.href = `./documents?id=${encodeURIComponent(reviewDocumentId)}`;
    recordingDetailAiDraft.textContent = "Finalize and send document";
  }
  renderDetailReferences(recording);
  renderAiReview(recording.ai_review_json || null);
  recordingDetailAiReview.textContent = recording.ai_review_status === "ready" ? "Regenerate AI review" : "Review with AI";
  recordingDetailAiReview.title = recording.ai_review_status === "ready"
    ? "Regenerate the AI draft while preserving applied suggestions."
    : "";
  recordingDetailAiReview.disabled = !recordingWorkflowSchemaAvailable || recording.transcript_status !== "ready";
  setStatus(recordingDetailStatusMessage, recording.processing_error || "");
}

async function openRecordingDetail(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;
  activeDetailRecordingId = recording.id;
  populateRecordingDetails(recording);
  clearDetailPlayer();
  setRecordingDetailTab("details");
  setRecordingDetailModalOpen(true);

  if (!canPlaybackRecording(recording)) return;

  setStatus(recordingDetailStatusMessage, "Loading audio...");
  try {
    detailPlayerUrl = await createRecordingSignedUrl(recording);
    recordingDetailPlayer.src = detailPlayerUrl;
    show(recordingDetailPlayer, true);
    setStatus(recordingDetailStatusMessage, recording.processing_error || "");
  } catch (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to load the audio file."), "error");
  }
}

function openRecordingInAllRecordings(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording?.id) return;
  window.location.href = buildAllRecordingsDetailHref(recording.id);
}

function closeRecordingDetail() {
  if (recordingDetailNotesSaveTimer) {
    window.clearTimeout(recordingDetailNotesSaveTimer);
    recordingDetailNotesSaveTimer = null;
    void saveRecordingDetailNotes().catch((error) => {
      setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save notes."), "error");
    });
  }
  clearDetailPlayer();
  clearReferencePreview();
  setRecordingDetailModalOpen(false);
  activeDetailRecordingId = "";
  setStatus(recordingDetailStatusMessage, "");
}

function setReviewActionsDisabled(isDisabled) {
  recordingAiReviewPanel?.querySelectorAll("[data-review-action]").forEach((button) => {
    button.disabled = Boolean(isDisabled);
  });
}

function updateActiveRecordingReview(review) {
  const recording = getRecordingById(activeDetailRecordingId);
  if (!recording) return;
  mergeRecordingUpdate({
    ...recording,
    ai_review_json: review,
  });
  const updated = getRecordingById(recording.id);
  if (updated) {
    populateRecordingDetails(updated);
    renderRecordings();
  }
}

async function handleReviewSuggestionAction(action, index = null) {
  if (reviewActionPending) return;
  const recording = getRecordingById(activeDetailRecordingId);
  if (!recording) return;
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(recordingDetailStatusMessage, "You need editor access to apply AI suggestions.", "error");
    return;
  }

  reviewActionPending = true;
  setReviewActionsDisabled(true);

  try {
    if (action === "apply-all") {
      const indexes = getOpenSuggestionIndexes(recording.ai_review_json || {});
      if (!indexes.length) {
        setStatus(recordingDetailStatusMessage, "No unapplied suggestions remain.");
        return;
      }
      setStatus(recordingDetailStatusMessage, "Rewriting the document with approved suggestions...");
      const result = await applyRecordingSuggestions({ supabase, recording, indexes });
      if (result.recording) mergeRecordingUpdate(result.recording);
      updateActiveRecordingReview(result.review);
      setStatus(recordingDetailStatusMessage, `${result.appliedCount} suggestion${result.appliedCount === 1 ? "" : "s"} integrated into the document.`, "success");
      return;
    }

    if (action === "apply") {
      setStatus(recordingDetailStatusMessage, "Rewriting the document with the approved suggestion...");
      const result = await applyRecordingSuggestions({ supabase, recording, indexes: [index] });
      if (result.recording) mergeRecordingUpdate(result.recording);
      updateActiveRecordingReview(result.review);
      setStatus(recordingDetailStatusMessage, "Suggestion integrated into the document.", "success");
      return;
    }

    if (action === "dismiss") {
      setStatus(recordingDetailStatusMessage, "Dismissing suggestion...");
      const result = await dismissRecordingSuggestion({ supabase, recording, index });
      updateActiveRecordingReview(result.review);
      setStatus(recordingDetailStatusMessage, "Suggestion dismissed.", "success");
    }
  } catch (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to update the suggestion."), "error");
  } finally {
    reviewActionPending = false;
    setReviewActionsDisabled(false);
  }
}

async function updateMeetingRecording(recordingId, patch) {
  if (!recordingId) return;
  const { error } = await supabase
    .from("meeting_recordings")
    .update(patch)
    .eq("id", recordingId);
  if (error) throw error;
}

async function saveActiveRecordingNotes() {
  if (!activeRecordingId || !recordingWorkflowSchemaAvailable) return;
  const payload = getCurrentNotesPayload();
  await updateMeetingRecording(activeRecordingId, payload);
}

async function saveRecordingDetailNotes() {
  if (!activeDetailRecordingId || !recordingWorkflowSchemaAvailable) return;
  const recordingId = activeDetailRecordingId;
  const notesText = String(recordingDetailNotes?.value || "").trim();
  const payload = {
    notes_content_json: noteTextToContentJson(notesText),
    notes_plain_text: notesText,
    notes_updated_at: new Date().toISOString(),
  };
  await updateMeetingRecording(recordingId, payload);
  const recording = getRecordingById(recordingId);
  if (recording) {
    mergeRecordingUpdate({ id: recordingId, ...payload });
    renderRecordings();
  }
}

function queueRecordingDetailNotesSave() {
  if (recordingDetailNotesSaveTimer) {
    window.clearTimeout(recordingDetailNotesSaveTimer);
  }
  if (!activeDetailRecordingId || !recordingWorkflowSchemaAvailable) return;
  recordingDetailNotesSaveTimer = window.setTimeout(() => {
    void saveRecordingDetailNotes().catch((error) => {
      setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save notes."), "error");
    });
  }, 900);
}

function queueActiveRecordingNotesSave() {
  if (recordingNotesSaveTimer) {
    window.clearTimeout(recordingNotesSaveTimer);
  }
  if (!activeRecordingId || !recordingWorkflowSchemaAvailable || hasUnsavedRecordingAudio()) {
    updateControls();
    return;
  }
  recordingNotesSaveTimer = window.setTimeout(() => {
    void saveActiveRecordingNotes().catch((error) => {
      setStatus(recordingStatus, getErrorMessage(error, "Unable to save notes."), "error");
    });
  }, 900);
}

async function requestRecordingTranscription(recordingId) {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

  const response = await fetch("/api/transcribe-recording", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordingId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to transcribe audio.");
  return data;
}

async function requestRecordingAiReview(recordingId) {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

  const response = await fetch("/api/finalize-recording-notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordingId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to review meeting notes.");
  return data;
}

async function handleRecordingAiReview(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;
  if (recording.transcript_status !== "ready") {
    setStatus(recordingDetailStatusMessage, "The transcript must be ready before AI can review this meeting note.", "error");
    return;
  }

  recordingDetailAiReview.disabled = true;
  recordingDetailAiStatus.textContent = "Processing";
  setStatus(
    recordingDetailStatusMessage,
    recording.ai_review_status === "ready"
      ? "Regenerating the AI draft while preserving applied suggestions..."
      : "Reviewing notes against the transcript..."
  );

  try {
    const result = await requestRecordingAiReview(recording.id);
    if (result?.recording) {
      mergeRecordingUpdate(result.recording);
      populateRecordingDetails(getRecordingById(recording.id) || result.recording);
      renderRecordings();
    }
    setStatus(recordingDetailStatusMessage, recording.ai_review_status === "ready" ? "AI draft regenerated." : "AI draft is ready.", "success");
  } catch (error) {
    recordingDetailAiStatus.textContent = "Failed";
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to review meeting notes."), "error");
  } finally {
    const updated = getRecordingById(recording.id) || recording;
    recordingDetailAiReview.disabled = !recordingWorkflowSchemaAvailable || updated.transcript_status !== "ready";
  }
}

async function transcribeRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !canTranscribeRecording(recording)) return;

  setStatus(recordingDetailStatusMessage, "Creating transcript...");
  recordingDetailTranscribe.disabled = true;

  try {
    await requestRecordingTranscription(recordingId);
    await loadRecordings();
    const updated = getRecordingById(recordingId);
    if (updated) {
      activeDetailRecordingId = updated.id;
      populateRecordingDetails(updated);
    }
    setStatus(recordingDetailStatusMessage, "Transcript created as a searchable file.", "success");
  } catch (error) {
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to create transcript."), "error");
    recordingDetailTranscribe.disabled = false;
  }
}

function retryRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !isRetryableRecording(recording)) return;
  recordingTitleInput.value = recording.title || "";
  setRecordPanelOpen(true, { scroll: true });
  setRecordingUploadMode(true);
  setRecordingUploadModalOpen(true);
  updateControls();
}

async function createMeetingRecording(title) {
  const organization = getActiveOrganization();
  if (!organization) {
    throw new Error("Select a library before creating a meeting note.");
  }

  const payload = {
    organization_id: organization.id,
    created_by_user_id: currentSession.user.id,
    title,
    status: "created",
    transcript_status: "not_started",
    ...(recordingWorkflowSchemaAvailable ? getCurrentNotesPayload() : {}),
    metadata: {
      source: "browser_media_recorder",
    },
  };

  const { data, error } = await supabase
    .from("meeting_recordings")
    .insert(payload)
    .select("id, title")
    .single();

  if (error) throw error;
  await saveReferencesForRecording(data.id, pendingMeetingReferences);
  clearPendingReferences();
  return data;
}

async function getAudioDurationSeconds(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const durationSeconds = await new Promise((resolve, reject) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => {
        resolve(Number.isFinite(audio.duration) ? Math.max(Math.round(audio.duration), 0) : 0);
      }, { once: true });
      audio.addEventListener("error", () => {
        reject(new Error("Unable to read the audio file metadata."));
      }, { once: true });
      audio.src = objectUrl;
    });
    return durationSeconds;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildUploadTitle(file) {
  const manualTitle = recordingTitleInput.value.trim();
  if (manualTitle) return manualTitle;
  return String(file?.name || "Uploaded meeting note").replace(/\.[^/.]+$/, "") || "Uploaded meeting note";
}

async function uploadRecordingBlob(recordingId, title, blob, mimeType, durationSeconds) {
  const organization = getActiveOrganization();
  if (!organization) throw new Error("No active library selected.");

  const safeTitle = slugifySegment(title);
  const extension = getFileExtension(mimeType);
  const storagePath = `${organization.id}/${recordingId}/${safeTitle}.${extension}`;

  uploadStateValue.textContent = "Uploading";
  setRecorderState("Uploading", "Audio is being sent to secure storage.");
  setStatus(recordingStatus, "Uploading audio...");
  setUploadProgressVisible(true, "Upload in progress. Do not leave this page until it finishes.");

  await updateMeetingRecording(recordingId, {
    status: "uploading",
    duration_seconds: durationSeconds,
    storage_bucket: RECORDINGS_BUCKET,
    storage_path: storagePath,
    audio_mime_type: mimeType,
    file_size: blob.size,
    processing_error: null,
  });

  const { error: storageError } = await supabase.storage.from(RECORDINGS_BUCKET).upload(storagePath, blob, {
    contentType: mimeType,
    upsert: false,
  });

  if (storageError) {
    await updateMeetingRecording(recordingId, {
      status: "failed",
      processing_error: storageError.message,
    });
    throw storageError;
  }

  await updateMeetingRecording(recordingId, {
    status: "uploaded",
    duration_seconds: durationSeconds,
    storage_bucket: RECORDINGS_BUCKET,
    storage_path: storagePath,
    audio_mime_type: mimeType,
    file_size: blob.size,
    processing_error: null,
  });

  uploadStateValue.textContent = "Uploaded";
  setRecorderState("Transcribing", "Audio uploaded. Creating a searchable transcript file.");
  setStatus(recordingStatus, "Audio uploaded. Creating transcript...");

  try {
    await requestRecordingTranscription(recordingId);
    uploadStateValue.textContent = "Transcript ready";
    setRecorderState("Saved", "Transcript created as a searchable file in this library.");
    setStatus(recordingStatus, "Meeting note saved and transcript created.", "success");
  } catch (error) {
    uploadStateValue.textContent = "Transcript failed";
    setRecorderState("Saved", "Audio uploaded. Transcript could not be created automatically.");
    setStatus(recordingStatus, getErrorMessage(error, "Meeting note saved, but transcription failed."), "error");
  }
}

function clearPendingRecordedAudio() {
  pendingRecordedBlob = null;
  pendingRecordedTitle = "";
  pendingRecordedDurationSeconds = 0;
}

function clearPendingUploadedAudio(options = {}) {
  pendingUploadedAudioFile = null;
  pendingUploadedAudioTitle = "";
  pendingUploadedAudioDurationSeconds = 0;
  pendingUploadedAudioStartedAt = null;
  if (options.clearInput !== false && recordingFileInput) {
    recordingFileInput.value = "";
    updateSelectedFileCopy();
  }
}

async function prepareStoppedRecording() {
  if (!activeRecordingId) return;

  const recordingId = activeRecordingId;
  const title = recordingTitleInput.value.trim();
  const endedAt = new Date();
  const durationSeconds = Math.max(Math.round(getElapsedRecordingMs() / 1000), 0);
  const blob = new Blob(activeChunks, { type: activeRecordingMimeType || "audio/webm" });

  recordingDuration.textContent = formatDuration(durationSeconds);
  uploadStateValue.textContent = "Ready to save";
  stopDurationTimer();
  stopActiveStreamTracks();
  isRecordingWorkflowActive = false;
  mediaRecorder = null;

  try {
    await updateMeetingRecording(recordingId, {
      status: "recorded",
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      audio_mime_type: blob.type || activeRecordingMimeType || "audio/webm",
      file_size: blob.size,
      processing_error: null,
    });
    pendingRecordedBlob = blob;
    pendingRecordedTitle = title;
    pendingRecordedDurationSeconds = durationSeconds;
    activeChunks = [];
    setRecorderState("Stopped", "Review notes, scan handwritten notes if needed, then save the meeting note.");
    setStatus(recordingStatus, "Recording stopped. Review notes, then select Save meeting note.", "success");
  } catch (error) {
    setRecorderState("Failed", "The meeting note was created, but stopping the audio did not finish.");
    uploadStateValue.textContent = "Failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to stop the audio recording."), "error");
    activeRecordingId = "";
    activeChunks = [];
    clearPendingRecordedAudio();
  } finally {
    recordingStartedAt = null;
    elapsedRecordingMs = 0;
    updateControls();
    await loadRecordings();
  }
}

async function handleSaveStoppedRecording() {
  if (!activeRecordingId || !pendingRecordedBlob) return;

  const recordingId = activeRecordingId;
  const title = pendingRecordedTitle || recordingTitleInput.value.trim() || "Meeting note";
  const blob = pendingRecordedBlob;
  const mimeType = blob.type || activeRecordingMimeType || "audio/webm";
  const durationSeconds = pendingRecordedDurationSeconds;

  if (blob.size > MAX_RECORDING_AUDIO_BYTES) {
    setRecorderState("Stopped", "The recording is still available, but it is too large to transcribe.");
    uploadStateValue.textContent = "Too large";
    setStatus(recordingStatus, `This recording is larger than the ${formatBytes(MAX_RECORDING_AUDIO_BYTES)} transcription limit.`, "error");
    return;
  }

  isRecordingWorkflowActive = true;
  updateControls();
  try {
    await saveActiveRecordingNotes();
    await uploadRecordingBlob(recordingId, title, blob, mimeType, durationSeconds);
    activeRecordingId = "";
    activeRecordingMimeType = "";
    recordingTitleInput.value = "";
    recordingTemplateSelect.value = "";
    recordingNotesInput.value = "";
    clearPendingRecordedAudio();
    clearPendingUploadedAudio();
    clearRecorderStats();
    setRecordPanelOpen(false);
    await loadRecordings();
    await openRecordingDetail(recordingId);
  } catch (error) {
    setRecorderState("Stopped", "The recording is still available. Try saving again.");
    uploadStateValue.textContent = "Save failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to save the meeting note."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
  }
}

async function handleSaveUploadedRecording() {
  if (!pendingUploadedAudioFile) return;
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to save meeting notes in this library.", "error");
    return;
  }
  if (!validateMeetingNoteRequiredFields()) return;

  const file = pendingUploadedAudioFile;
  const title = pendingUploadedAudioTitle || buildUploadTitle(file);
  const durationSeconds = pendingUploadedAudioDurationSeconds;
  const startedAt = pendingUploadedAudioStartedAt || new Date(file.lastModified || Date.now());
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const mimeType = file.type || "audio/mpeg";
  let createdRecording = null;

  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, "Saving meeting note...");
  setRecorderState("Saving", "Saving notes and attached audio.");
  uploadStateValue.textContent = "Preparing";
  setUploadProgressVisible(true, "Saving meeting note and preparing audio upload.");

  try {
    createdRecording = await createMeetingRecording(title);
    activeRecordingId = createdRecording.id;
    activeRecordingMimeType = mimeType;
    await updateMeetingRecording(createdRecording.id, {
      status: "recorded",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      audio_mime_type: mimeType,
      file_size: file.size,
      metadata: {
        source: "uploaded_audio_file",
        original_filename: file.name,
      },
      processing_error: null,
    });

    await uploadRecordingBlob(createdRecording.id, title, file, mimeType, durationSeconds);
    recordingTitleInput.value = "";
    recordingTemplateSelect.value = "";
    recordingNotesInput.value = "";
    clearPendingRecordedAudio();
    clearPendingUploadedAudio();
    clearRecorderStats();
    setRecordPanelOpen(false);
    await loadRecordings();
    await openRecordingDetail(createdRecording.id);
  } catch (error) {
    if (createdRecording?.id) {
      try {
        await updateMeetingRecording(createdRecording.id, {
          status: "failed",
          processing_error: getErrorMessage(error, "Upload could not be completed."),
        });
      } catch {
        // Keep the original error visible in the UI even if the failure update also fails.
      }
    }
    setRecorderState("Ready", "The note and attached audio are still available. Try saving again.");
    uploadStateValue.textContent = "Save failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to save the meeting note."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    activeRecordingId = "";
    activeRecordingMimeType = "";
    updateControls();
    await loadRecordings();
  }
}

function validateMeetingNoteRequiredFields() {
  if (!recordingTitleInput.value.trim()) {
    recordingTitleInput.focus();
    setStatus(recordingStatus, "Enter a meeting title before saving.", "error");
    return false;
  }
  if (!recordingTemplateSelect.value) {
    recordingTemplateSelect.focus();
    setStatus(recordingStatus, "Select a document template or blank notes before saving.", "error");
    return false;
  }
  return true;
}

async function handleSaveMeetingNote() {
  if (hasUnsavedRecordingAudio()) {
    await handleSaveStoppedRecording();
    return;
  }
  if (hasPendingUploadedAudio()) {
    await handleSaveUploadedRecording();
    return;
  }
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to save meeting notes in this library.", "error");
    return;
  }
  if (!validateMeetingNoteRequiredFields()) return;

  const title = recordingTitleInput.value.trim();
  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, "Saving meeting note...");
  setRecorderState("Saving", "Saving notes without an audio recording.");
  uploadStateValue.textContent = "No recording";

  try {
    const createdRecording = await createMeetingRecording(title);
    await updateMeetingRecording(createdRecording.id, {
      status: "ready",
      transcript_status: "not_started",
      ai_review_status: "not_started",
      duration_seconds: 0,
      file_size: 0,
      metadata: {
        source: "manual_notes",
      },
      processing_error: null,
    });
    recordingTitleInput.value = "";
    recordingTemplateSelect.value = "";
    recordingNotesInput.value = "";
    clearPendingRecordedAudio();
    clearPendingUploadedAudio();
    clearRecorderStats();
    setRecordPanelOpen(false);
    setStatus(recordingStatus, "Meeting note saved.", "success");
    await loadRecordings();
    await openRecordingDetail(createdRecording.id);
  } catch (error) {
    setRecorderState("Ready", "The notes were not saved. Try again.");
    uploadStateValue.textContent = "Save failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to save meeting note."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
  }
}

async function handleStartRecording() {
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to record audio in this library.", "error");
    return;
  }
  if (!validateMeetingNoteRequiredFields()) return;
  const title = recordingTitleInput.value.trim();
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    setStatus(recordingStatus, "This browser does not support in-browser audio recording.", "error");
    return;
  }
  if (mediaRecorder?.state === "recording") return;

  const mimeType = getSupportedMimeType();
  isRecordingWorkflowActive = true;

  setStatus(recordingStatus, "Creating meeting note...");
  setRecorderState("Preparing", "Creating a meeting note before microphone capture starts.");
  uploadStateValue.textContent = "Not started";

  let createdRecording = null;

  try {
    createdRecording = await createMeetingRecording(title);
    activeRecordingId = createdRecording.id;
    updateControls();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    activeChunks = [];
    activeRecordingMimeType = mimeType;
    const recorderOptions = { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
    if (mimeType) recorderOptions.mimeType = mimeType;
    mediaRecorder = new MediaRecorder(stream, recorderOptions);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        activeChunks.push(event.data);
      }
    });
    mediaRecorder.addEventListener("stop", () => {
      void prepareStoppedRecording();
    });
    mediaRecorder.addEventListener("pause", () => {
      pauseElapsedClock();
      setRecorderState("Paused", "Recording is paused. Resume when you are ready to continue.");
      setStatus(recordingStatus, "Recording paused.");
      updateControls();
    });
    mediaRecorder.addEventListener("resume", () => {
      resumeElapsedClock();
      setRecorderState("Recording", "Microphone capture is active. Pause or stop when you are ready.");
      setStatus(recordingStatus, "Recording resumed.");
      updateControls();
    });

    elapsedRecordingMs = 0;
    resumeElapsedClock();
    await updateMeetingRecording(createdRecording.id, {
      status: "recording",
      started_at: recordingStartedAt.toISOString(),
      audio_mime_type: mediaRecorder.mimeType || mimeType || null,
      processing_error: null,
    });

    mediaRecorder.start(1000);
    recordingDuration.textContent = "00:00";
    uploadStateValue.textContent = "Recording";
    setRecorderState("Recording", "Microphone capture is active. Stop when you are ready to review notes.");
    setStatus(recordingStatus, "Recording in progress...");
    startDurationTimer();
    updateControls();
    await loadRecordings();
  } catch (error) {
    isRecordingWorkflowActive = false;
    stopDurationTimer();
    stopActiveStreamTracks();
    mediaRecorder = null;
    activeChunks = [];
    activeRecordingMimeType = "";
    recordingStartedAt = null;
    elapsedRecordingMs = 0;
    updateControls();

    if (createdRecording?.id) {
      try {
        await updateMeetingRecording(createdRecording.id, {
          status: "failed",
          processing_error: getErrorMessage(error, "Audio recording could not start."),
        });
      } catch {
        // Keep the original error visible in the UI even if the failure update also fails.
      }
      activeRecordingId = "";
    }

    clearRecorderStats();
    setRecorderState("", "Ready to create a new meeting note.");
    setStatus(recordingStatus, getErrorMessage(error, "Unable to start audio recording."), "error");
    await loadRecordings();
  }
}

async function handleUploadRecording() {
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to upload audio in this library.", "error");
    return;
  }
  if (!validateMeetingNoteRequiredFields()) return;

  const file = getSelectedRecordingFile();
  if (!file) {
    setStatus(recordingUploadStatus, "Choose an audio file to upload.", "error");
    return;
  }
  if (file.size > MAX_RECORDING_AUDIO_BYTES) {
    setStatus(recordingUploadStatus, `This audio file is larger than the ${formatBytes(MAX_RECORDING_AUDIO_BYTES)} transcription limit.`, "error");
    return;
  }

  const title = buildUploadTitle(file);
  recordingUploadSubmit.disabled = true;
  setStatus(recordingUploadStatus, "Reading audio metadata...");
  try {
    const durationSeconds = await getAudioDurationSeconds(file);
    pendingUploadedAudioFile = file;
    pendingUploadedAudioTitle = title;
    pendingUploadedAudioDurationSeconds = durationSeconds;
    pendingUploadedAudioStartedAt = new Date(file.lastModified || Date.now());
    recordingDuration.textContent = formatDuration(durationSeconds);
    uploadStateValue.textContent = "Attached";
    setRecorderState("Audio attached", "Add or review notes, then select Save meeting note.");
    setStatus(recordingStatus, "Audio attached. Add notes if needed, then select Save meeting note.", "success");
    setRecordingUploadModalOpen(false);
  } catch (error) {
    clearPendingUploadedAudio({ clearInput: false });
    setStatus(recordingUploadStatus, getErrorMessage(error, "Unable to read the audio file."), "error");
  } finally {
    updateControls();
  }
}

async function handleStopRecording() {
  if (!mediaRecorder || (mediaRecorder.state !== "recording" && mediaRecorder.state !== "paused")) return;
  const confirmed = await confirmRecordingsAction();
  if (!confirmed) return;
  setRecorderState("Finishing", "Stopping microphone capture and preparing the upload.");
  setStatus(recordingStatus, "Stopping recording...");
  pauseRecordingButton.disabled = true;
  stopRecordingButton.disabled = true;
  mediaRecorder.stop();
}

function handlePauseRecording() {
  if (!mediaRecorder || !isPauseSupported()) return;
  if (mediaRecorder.state === "recording") {
    setStatus(recordingStatus, "Pausing recording...");
    mediaRecorder.pause();
    return;
  }
  if (mediaRecorder.state === "paused") {
    setStatus(recordingStatus, "Resuming recording...");
    mediaRecorder.resume();
  }
}

async function handleOrganizationChange(nextOrganizationId) {
  if (!nextOrganizationId || nextOrganizationId === getActiveOrganization()?.id) return;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;

  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);
  renderOrganizationSelector();
  clearRecorderStats();
  setRecorderState("", "Ready to create a new meeting note.");
  setStatus(recordingStatus, "");
  elapsedRecordingMs = 0;
  recordingFileInput.value = "";
  updateSelectedFileCopy();
  setRecordingUploadMode(false);
  setRecordingUploadModalOpen(false);
  clearPendingRecordedAudio();
  clearPendingUploadedAudio();
  clearPendingReferences();
  if (recordingDetailModal.classList.contains("is-open")) {
    closeRecordingDetail();
  }
  recordingTemplateSelect.value = "";
  recordingNotesInput.value = "";
  await loadRecordingTemplates();
  await loadReferenceDocuments();
  await loadRecordings();
}

async function handleSignout() {
  if (isRecordingWorkflowActive || hasUnsavedRecordingAudio() || hasPendingUploadedAudio()) {
    setStatus(recordingStatus, "Save or finish the active meeting note before logging out.", "error");
    return;
  }

  await supabase.auth.signOut();
  window.location.replace("/n3xra-records/login");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(recordingsPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/n3xra-records/login");
    return;
  }

  try {
    await bootstrapAccess();
  } catch (error) {
    show(setupPanel, false);
    show(recordingsPanel, true);
    setStatus(recordingStatus, getErrorMessage(error, "Unable to load meeting note context."), "error");
    return;
  }

  if (!getActiveCapabilities().canUseRecordings) {
    window.location.replace("/n3xra-records/library");
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const retryTitle = urlParams.get("retryTitle") || "";
  pendingRetryUploadOpen = urlParams.get("openUpload") === "1";
  if (retryTitle) {
    recordingTitleInput.value = retryTitle;
  }

  show(setupPanel, false);
  show(recordingsPanel, true);
  updateControls();
  await loadRecordingTemplates();
  await loadReferenceDocuments();
  await loadRecordings();

  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    startRecordingButton.disabled = true;
    setRecorderState("Unsupported", "This browser does not expose the MediaRecorder API required for capture.");
    setStatus(recordingStatus, "Audio recording is unavailable in this browser.", "error");
  }

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount?.addEventListener("click", () => {
    window.location.replace("/n3xra-records/account");
  });
  mobileMenuLibrary?.addEventListener("click", () => {
    window.location.replace("/n3xra-records/library");
  });
  recordingFileInput.addEventListener("change", () => {
    updateSelectedFileCopy();
    updateControls();
    setStatus(recordingUploadStatus, "");
  });
  recordingTemplateSelect.addEventListener("change", () => {
    applySelectedTemplateToNotes();
  });
  recordingReferenceSelect?.addEventListener("change", updateControls);
  recordingReferenceAdd?.addEventListener("click", addPendingReference);
  recordingReferenceList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reference-remove-id]");
    if (!button) return;
    removePendingReference(button.getAttribute("data-reference-remove-id") || "");
    updateControls();
  });
  recordingDetailReferenceSelect?.addEventListener("change", () => {
    if (recordingDetailReferenceAdd) recordingDetailReferenceAdd.disabled = !recordingDetailReferenceSelect.value;
  });
  recordingDetailReferenceAdd?.addEventListener("click", () => {
    void addDetailReference();
  });
  recordingDetailReferenceList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reference-remove-id]");
    if (button) {
      void removeDetailReference(button.getAttribute("data-reference-remove-id") || "");
      return;
    }
    const row = event.target.closest("[data-reference-preview-id]");
    if (!row) return;
    const recording = getRecordingById(activeDetailRecordingId);
    const reference = getRecordingReferences(recording).find((item) => item.app_document_id === row.getAttribute("data-reference-preview-id"));
    void previewReferenceDocument(reference || null);
  });
  recordingTitleInput.addEventListener("input", updateControls);
  recordingNotesInput.addEventListener("input", queueActiveRecordingNotesSave);
  activeOrganizationSelect.addEventListener("change", async () => {
    closeMobileMenu();
    await handleOrganizationChange(activeOrganizationSelect.value);
  });
  newRecordingAction?.addEventListener("click", () => {
    setRecordPanelOpen(true, { scroll: true, focus: true });
  });
  recordPanelToggle?.addEventListener("click", () => {
    setRecordPanelOpen(recordPanelBody?.classList.contains("hidden"));
  });
  startRecordingButton.addEventListener("click", () => {
    void handleStartRecording();
  });
  uploadRecordingButton.addEventListener("click", () => {
    if (!validateMeetingNoteRequiredFields()) return;
    setRecordingUploadMode(false);
    setRecordingUploadModalOpen(true);
  });
  saveRecordingButton?.addEventListener("click", () => {
    void handleSaveMeetingNote();
  });
  scanHandwrittenNoteButton?.addEventListener("click", () => {
    handwrittenNoteInput?.click();
  });
  handwrittenNoteInput?.addEventListener("change", () => {
    void handleHandwrittenNoteFile(handwrittenNoteInput.files?.[0] || null);
  });
  recordingDetailScanHandwrittenNoteButton?.addEventListener("click", () => {
    recordingDetailHandwrittenNoteInput?.click();
  });
  recordingDetailHandwrittenNoteInput?.addEventListener("change", () => {
    void handleDetailHandwrittenNoteFile(recordingDetailHandwrittenNoteInput.files?.[0] || null);
  });
  recordingUploadClose.addEventListener("click", () => {
    setRecordingUploadModalOpen(false);
  });
  recordingUploadModal.addEventListener("click", (event) => {
    if (event.target === recordingUploadModal) {
      setRecordingUploadModalOpen(false);
    }
  });
  recordingUploadSubmit.addEventListener("click", () => {
    void handleUploadRecording();
  });
  stopRecordingButton.addEventListener("click", handleStopRecording);
  pauseRecordingButton.addEventListener("click", handlePauseRecording);
  recordingsList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-recording-id]");
    if (!row) return;
    void openRecordingDetail(row.getAttribute("data-recording-id") || "");
  });
  recordingsList.addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-recording-id]");
    if (!row) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openRecordingDetail(row.getAttribute("data-recording-id") || "");
  });
  recordingAiReviewPanel?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-action]");
    if (!button) return;
    void handleReviewSuggestionAction(
      button.getAttribute("data-review-action") || "",
      button.getAttribute("data-review-index")
    );
  });
  recordingDetailNotes?.addEventListener("input", queueRecordingDetailNotesSave);
  recordingDetailTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setRecordingDetailTab(button.dataset.recordingDetailTab || "details");
    });
    button.addEventListener("keydown", handleRecordingDetailTabKeydown);
  });
  recordingDetailAiReview.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    void handleRecordingAiReview(activeDetailRecordingId);
  });
  recordingDetailPlay.addEventListener("click", async () => {
    if (!detailPlayerUrl && activeDetailRecordingId) {
      await openRecordingDetail(activeDetailRecordingId);
      return;
    }
    if (recordingDetailPlayer.paused) {
      try {
        await recordingDetailPlayer.play();
        recordingDetailPlay.textContent = "Pause";
      } catch {
        // Browsers may require an extra interaction before audio playback.
      }
      return;
    }
    recordingDetailPlayer.pause();
    recordingDetailPlay.textContent = "Play";
  });
  recordingDetailPlayer.addEventListener("play", () => {
    recordingDetailPlay.textContent = "Pause";
  });
  recordingDetailPlayer.addEventListener("pause", () => {
    recordingDetailPlay.textContent = "Play";
  });
  recordingDetailPlayer.addEventListener("ended", () => {
    recordingDetailPlay.textContent = "Play";
  });
  recordingDetailTranscribe.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    void transcribeRecording(activeDetailRecordingId);
  });
  recordingDetailRetry.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    retryRecording(activeDetailRecordingId);
  });
  recordingDetailClose.addEventListener("click", closeRecordingDetail);
  recordingDetailModal.addEventListener("click", (event) => {
    if (event.target === recordingDetailModal) {
      closeRecordingDetail();
    }
  });
  recordingsConfirmCancel?.addEventListener("click", () => resolveRecordingsConfirm(false));
  recordingsConfirmOk?.addEventListener("click", () => resolveRecordingsConfirm(true));
  recordingsConfirmModal?.addEventListener("click", (event) => {
    if (event.target === recordingsConfirmModal) {
      resolveRecordingsConfirm(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (isRecordingWorkflowActive || hasUnsavedRecordingAudio() || hasPendingUploadedAudio()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && recordingUploadModal.classList.contains("is-open")) {
      setRecordingUploadModalOpen(false);
      return;
    }
    if (event.key === "Escape" && recordingDetailModal.classList.contains("is-open")) {
      closeRecordingDetail();
      return;
    }
    if (event.key === "Escape" && recordingsConfirmModal?.classList.contains("is-open")) {
      resolveRecordingsConfirm(false);
    }
  });

  setMenuActive("recordings");
  updateSelectedFileCopy();
  if (consumeRetryUploadRequest()) {
    setRecordPanelOpen(true, { scroll: true });
    setRecordingUploadMode(true);
    setRecordingUploadModalOpen(true);
    updateControls();
  }
}

void init();
