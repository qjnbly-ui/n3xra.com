import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
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
import {
  applyRecordingSuggestions,
  dismissRecordingSuggestion,
  getOpenSuggestionIndexes,
  getSuggestionStatus,
  getSuggestionText,
  isSuggestionResolved,
} from "./lib/recording-suggestions.js";

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
const recordingNotesState = document.getElementById("recording-notes-state");
const saveRecordingNotesButton = document.getElementById("save-recording-notes-button");
const applyRecordingTemplateButton = document.getElementById("apply-recording-template-button");
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
const recordingStatus = document.getElementById("recording-status");
const recordingsList = document.getElementById("recordings-list");
const recordingsEmpty = document.getElementById("recordings-empty");
const recordingsListStatus = document.getElementById("recordings-list-status");
const recordingDetailModal = document.getElementById("recording-detail-modal");
const recordingDetailClose = document.getElementById("recording-detail-close");
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
const recordingAiReviewPanel = document.getElementById("recording-ai-review-panel");
const recordingAiSuggestions = document.getElementById("recording-ai-suggestions");
const recordingAiConflicts = document.getElementById("recording-ai-conflicts");
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
let isRecordingWorkflowActive = false;
let pendingRetryUploadOpen = false;
let isRetryUploadMode = false;
let pendingRecordingsConfirmResolve = null;
let recordingNotesSaveTimer = null;
let lastAppliedTemplateId = "";
let recordingWorkflowSchemaAvailable = true;
let reviewActionPending = false;

function buildAllRecordingsDetailHref(recordingId) {
  const params = new URLSearchParams();
  if (recordingId) params.set("recording", recordingId);
  const query = params.toString();
  return `./all-recordings.html${query ? `?${query}` : ""}`;
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
    message.includes("ai_review_status") ||
    message.includes("ai_review_json") ||
    message.includes("ai_draft_document_id") ||
    message.includes("schema cache")
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
  return recordingTemplates.find((template) => template.id === id) || null;
}

function getTemplateLabel(templateId) {
  if (!templateId) return "No template";
  const template = recordingTemplates.find((item) => item.id === templateId);
  return template?.title || "Template";
}

function getCurrentNotesPayload() {
  const notesText = String(recordingNotesInput?.value || "").trim();
  return {
    selected_template_id: recordingTemplateSelect?.value || null,
    notes_content_json: noteTextToContentJson(notesText),
    notes_plain_text: notesText,
    notes_updated_at: new Date().toISOString(),
  };
}

function renderTemplateSelect() {
  if (!recordingTemplateSelect) return;
  const selectedValue = recordingTemplateSelect.value;
  recordingTemplateSelect.innerHTML = '<option value="">No template</option>';
  recordingTemplates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.title || "Untitled template";
    recordingTemplateSelect.append(option);
  });
  if (selectedValue && recordingTemplates.some((template) => template.id === selectedValue)) {
    recordingTemplateSelect.value = selectedValue;
  }
}

function applySelectedTemplateToNotes(force = false) {
  const template = getSelectedTemplate();
  if (!template) return;
  const currentNotes = String(recordingNotesInput?.value || "").trim();
  if (currentNotes && !force && lastAppliedTemplateId !== template.id) return;

  const templateText = String(
    templateNotesTextFromContentJson(template.content_json || {}) ||
    template.plain_text ||
    plainTextFromContentJson(template.content_json || {})
  ).trim();
  if (!templateText) return;
  recordingNotesInput.value = templateText;
  lastAppliedTemplateId = template.id;
  setStatus(recordingStatus, "Template copied into notes.");
  queueActiveRecordingNotesSave();
  updateControls();
}

function setRecordingNotesState(message, tone = "") {
  if (!recordingNotesState) return;
  recordingNotesState.textContent = message || "";
  recordingNotesState.className = "recording-stat-value";
  if (tone) recordingNotesState.classList.add(tone);
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

function setRecordingUploadMode(isRetryMode) {
  isRetryUploadMode = isRetryMode;
  recordingUploadKicker.textContent = isRetryMode ? "Retry upload" : "Upload recording";
  recordingUploadTitle.textContent = isRetryMode ? "Select the file again" : "Select audio file";
  recordingUploadNote.textContent = isRetryMode
    ? "Browsers cannot keep the previous file attached. Choose the original audio file again to retry this upload."
    : "Choose an existing audio file and save it as a recording.";
  recordingUploadSubmit.textContent = isRetryMode ? "Retry upload" : "Final upload";
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
    ? `${selectedFile.name} · ${formatBytes(selectedFile.size || 0)}`
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
  const hasActiveSession = isRecordingWorkflowActive || isCaptureActive;
  const pauseSupported = isPauseSupported();

  startRecordingButton.disabled = !canRecordInActiveOrganization() || hasActiveSession || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
  uploadRecordingButton.disabled = !canRecordInActiveOrganization() || hasActiveSession;
  show(startRecordingButton, !hasActiveSession);
  show(uploadRecordingButton, !hasActiveSession);
  pauseRecordingButton.disabled = !isCaptureActive || !pauseSupported;
  pauseRecordingButton.textContent = recorderState === "paused" ? "Resume recording" : "Pause recording";
  stopRecordingButton.disabled = !isCaptureActive;
  show(pauseRecordingButton, isCaptureActive && pauseSupported);
  show(stopRecordingButton, isCaptureActive);
  activeOrganizationSelect.disabled = hasActiveSession || memberships.length <= 1;
  recordingTitleInput.disabled = hasActiveSession;
  recordingTemplateSelect.disabled = hasActiveSession || !recordingWorkflowSchemaAvailable;
  recordingNotesInput.disabled = !canRecordInActiveOrganization() || !recordingWorkflowSchemaAvailable;
  recordingFileInput.disabled = hasActiveSession;
  recordingUploadSubmit.disabled = hasActiveSession || !Boolean(getSelectedRecordingFile());
  saveRecordingNotesButton.disabled = !recordingWorkflowSchemaAvailable || !activeRecordingId;
  applyRecordingTemplateButton.disabled = !recordingWorkflowSchemaAvailable || !recordingTemplateSelect.value;
}

function getRecordingById(recordingId) {
  return recordingsCache.find((item) => item.id === recordingId) || null;
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
    throw new Error("No audio file is stored for this recording yet.");
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

  setStatus(recordingsListStatus, "Loading recordings...");
  let { data, error, count } = await supabase
    .from("meeting_recordings")
    .select(`
      id,
      document_id,
      title,
      status,
      transcript_status,
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
    setRecordingNotesState("Migration needed", "error");
  } else {
    recordingWorkflowSchemaAvailable = true;
  }

  if (error) {
    recordingsCache = [];
    totalRecordingCount = 0;
    renderRecordings();
    setStatus(recordingsListStatus, getErrorMessage(error, "Unable to load recordings."), "error");
    return;
  }

  recordingsCache = Array.isArray(data) ? data : [];
  totalRecordingCount = Number(count || 0);
  renderRecordings();
  setStatus(recordingsListStatus, totalRecordingCount ? `${totalRecordingCount} recording${totalRecordingCount === 1 ? "" : "s"} saved.` : "");
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
              <p class="recording-row-title">${escapeHtml(recording.title || "Untitled recording")}</p>
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
  show(recordingAiReviewPanel, Boolean(hasReview));
  if (!hasReview) {
    if (recordingAiSuggestions) recordingAiSuggestions.innerHTML = "";
    if (recordingAiConflicts) recordingAiConflicts.innerHTML = "";
    return;
  }

  renderReviewItems(recordingAiSuggestions, "Suggested additions", review.suggested_additions, "No additions suggested.", {
    kind: "suggestions",
    canAct: getActiveCapabilities().canEditDocuments,
  });
  renderReviewItems(recordingAiConflicts, "Possible conflicts", review.conflicts, "No conflicts found.");
}

function populateRecordingDetails(recording) {
  recordingDetailTitle.textContent = recording.title || "Untitled recording";
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
  recordingDetailNotes.textContent = String(recording.notes_plain_text || "").trim() || "No notes saved yet.";
  show(recordingDetailTranscriptDocument, Boolean(recording.document_id));
  if (recording.document_id) {
    recordingDetailTranscriptDocument.href = `./files.html?id=${encodeURIComponent(recording.document_id)}`;
  }
  const reviewDocumentId = recording.final_document_id || recording.ai_draft_document_id || "";
  show(recordingDetailAiDraft, Boolean(reviewDocumentId));
  if (reviewDocumentId) {
    recordingDetailAiDraft.href = `./documents.html?id=${encodeURIComponent(reviewDocumentId)}`;
    recordingDetailAiDraft.textContent = recording.final_document_id ? "Open final" : "Open AI draft";
  }
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
  clearDetailPlayer();
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
  setRecordingNotesState("Saving...");
  await updateMeetingRecording(activeRecordingId, payload);
  setRecordingNotesState("Saved", "success");
}

function queueActiveRecordingNotesSave() {
  if (recordingNotesSaveTimer) {
    window.clearTimeout(recordingNotesSaveTimer);
  }
  if (!activeRecordingId || !recordingWorkflowSchemaAvailable) {
    setRecordingNotesState(recordingNotesInput?.value?.trim() ? "Ready for start" : "Not saved yet");
    updateControls();
    return;
  }
  setRecordingNotesState("Unsaved");
  recordingNotesSaveTimer = window.setTimeout(() => {
    void saveActiveRecordingNotes().catch((error) => {
      setRecordingNotesState("Save failed", "error");
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
  if (!response.ok) throw new Error(data?.error || "Unable to transcribe recording.");
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
  if (!response.ok) throw new Error(data?.error || "Unable to review recording notes.");
  return data;
}

async function handleRecordingAiReview(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;
  if (recording.transcript_status !== "ready") {
    setStatus(recordingDetailStatusMessage, "The transcript must be ready before AI can review this recording.", "error");
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
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to review recording notes."), "error");
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
    throw new Error("Select a library before recording.");
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
  return String(file?.name || "Uploaded recording").replace(/\.[^/.]+$/, "") || "Uploaded recording";
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
  setStatus(recordingStatus, "Audio uploaded. Transcribing recording...");

  try {
    await requestRecordingTranscription(recordingId);
    uploadStateValue.textContent = "Transcript ready";
    setRecorderState("Saved", "Transcript created as a searchable file in this library.");
    setStatus(recordingStatus, "Recording saved and transcript created.", "success");
  } catch (error) {
    uploadStateValue.textContent = "Transcript failed";
    setRecorderState("Saved", "Audio uploaded. Transcript could not be created automatically.");
    setStatus(recordingStatus, getErrorMessage(error, "Recording saved, but transcription failed."), "error");
  }
}

async function finalizeRecording() {
  if (!activeRecordingId) return;

  const recordingId = activeRecordingId;
  const title = recordingTitleInput.value.trim();
  const endedAt = new Date();
  const durationSeconds = Math.max(Math.round(getElapsedRecordingMs() / 1000), 0);
  const blob = new Blob(activeChunks, { type: activeRecordingMimeType || "audio/webm" });

  recordingDuration.textContent = formatDuration(durationSeconds);
  uploadStateValue.textContent = "Pending";
  stopDurationTimer();
  stopActiveStreamTracks();

  try {
    await updateMeetingRecording(recordingId, {
      status: "recorded",
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      audio_mime_type: blob.type || activeRecordingMimeType || "audio/webm",
      file_size: blob.size,
      processing_error: null,
    });
    try {
      await saveActiveRecordingNotes();
    } catch (error) {
      const notesError = getErrorMessage(error, "Notes could not be saved.");
      setRecordingNotesState("Save failed", "error");
      setStatus(recordingStatus, `${notesError} Audio upload will continue.`, "error");
    }

    await uploadRecordingBlob(recordingId, title, blob, blob.type || activeRecordingMimeType || "audio/webm", durationSeconds);
  } catch (error) {
    setRecorderState("Failed", "The recording row was created, but saving the audio did not finish.");
    uploadStateValue.textContent = "Failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to finish saving the recording."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    mediaRecorder = null;
    activeChunks = [];
    activeRecordingId = "";
    activeRecordingMimeType = "";
    recordingStartedAt = null;
    elapsedRecordingMs = 0;
    recordingTitleInput.value = "";
    recordingTemplateSelect.value = "";
    recordingNotesInput.value = "";
    lastAppliedTemplateId = "";
    setRecordingNotesState("Not saved yet");
    clearRecorderStats();
    updateControls();
    await loadRecordings();
  }
}

async function handleStartRecording() {
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to record audio in this library.", "error");
    return;
  }
  const title = recordingTitleInput.value.trim();
  if (!title) {
    recordingTitleInput.focus();
    setStatus(recordingStatus, "Enter a meeting title before starting the recording.", "error");
    return;
  }
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    setStatus(recordingStatus, "This browser does not support in-browser audio recording.", "error");
    return;
  }
  if (mediaRecorder?.state === "recording") return;

  const mimeType = getSupportedMimeType();
  isRecordingWorkflowActive = true;

  setStatus(recordingStatus, "Creating recording session...");
  setRecorderState("Preparing", "Creating a meeting row before microphone capture starts.");
  uploadStateValue.textContent = "Not started";

  let createdRecording = null;

  try {
    createdRecording = await createMeetingRecording(title);
    activeRecordingId = createdRecording.id;
    setRecordingNotesState(recordingWorkflowSchemaAvailable ? "Saved" : "Migration needed", recordingWorkflowSchemaAvailable ? "success" : "error");
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
      void finalizeRecording();
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
    uploadStateValue.textContent = "Waiting for stop";
    setRecorderState("Recording", "Microphone capture is active. Stop to upload and save.");
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
          processing_error: getErrorMessage(error, "Recording could not start."),
        });
      } catch {
        // Keep the original error visible in the UI even if the failure update also fails.
      }
      activeRecordingId = "";
    }

    clearRecorderStats();
    setRecorderState("", "Ready to create a new recording session.");
    setStatus(recordingStatus, getErrorMessage(error, "Unable to start recording."), "error");
    await loadRecordings();
  }
}

async function handleUploadRecording() {
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to upload audio in this library.", "error");
    return;
  }

  const file = getSelectedRecordingFile();
  if (!file) {
    setStatus(recordingUploadStatus, "Choose an audio file to upload.", "error");
    return;
  }

  isRecordingWorkflowActive = true;
  updateControls();
  setRecordingUploadModalOpen(false);
  setStatus(recordingStatus, "Preparing upload...");
  setRecorderState("Preparing", "Creating a recording row for the selected audio file.");
  uploadStateValue.textContent = "Preparing";
  setUploadProgressVisible(true, "Preparing upload. Do not leave this page until it finishes.");

  const title = buildUploadTitle(file);
  let createdRecording = null;

  try {
    const durationSeconds = await getAudioDurationSeconds(file);
    const startedAt = new Date(file.lastModified || Date.now());
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

    createdRecording = await createMeetingRecording(title);
    activeRecordingId = createdRecording.id;
    activeRecordingMimeType = file.type || "audio/mpeg";
    setRecordingNotesState(recordingWorkflowSchemaAvailable ? "Saved" : "Migration needed", recordingWorkflowSchemaAvailable ? "success" : "error");
    updateControls();

    recordingDuration.textContent = formatDuration(durationSeconds);
    await updateMeetingRecording(createdRecording.id, {
      status: "recorded",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      audio_mime_type: activeRecordingMimeType,
      file_size: file.size,
      metadata: {
        source: "uploaded_audio_file",
        original_filename: file.name,
      },
      processing_error: null,
    });

    await uploadRecordingBlob(createdRecording.id, title, file, activeRecordingMimeType, durationSeconds);
    recordingFileInput.value = "";
    updateSelectedFileCopy();
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
    setRecorderState("Failed", "The selected file could not be saved as a recording.");
    uploadStateValue.textContent = "Failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to upload the audio file."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    activeRecordingId = "";
    activeRecordingMimeType = "";
    recordingTitleInput.value = "";
    recordingTemplateSelect.value = "";
    recordingNotesInput.value = "";
    lastAppliedTemplateId = "";
    setRecordingNotesState("Not saved yet");
    clearRecorderStats();
    updateControls();
    await loadRecordings();
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
  setRecorderState("", "Ready to create a new recording session.");
  setStatus(recordingStatus, "");
  elapsedRecordingMs = 0;
  recordingFileInput.value = "";
  updateSelectedFileCopy();
  setRecordingUploadMode(false);
  setRecordingUploadModalOpen(false);
  if (recordingDetailModal.classList.contains("is-open")) {
    closeRecordingDetail();
  }
  recordingTemplateSelect.value = "";
  recordingNotesInput.value = "";
  lastAppliedTemplateId = "";
  setRecordingNotesState("Not saved yet");
  await loadRecordingTemplates();
  await loadRecordings();
}

async function handleSignout() {
  if (isRecordingWorkflowActive) {
    setStatus(recordingStatus, "Wait for the active recording or upload to finish before logging out.", "error");
    return;
  }

  await supabase.auth.signOut();
  window.location.replace("./login.html");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(recordingsPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login.html");
    return;
  }

  try {
    await bootstrapAccess();
  } catch (error) {
    show(setupPanel, false);
    show(recordingsPanel, true);
    setStatus(recordingStatus, getErrorMessage(error, "Unable to load recording context."), "error");
    return;
  }

  if (!getActiveCapabilities().canUseRecordings) {
    window.location.replace("./dashboard.html?section=library");
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
  await loadRecordings();

  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    startRecordingButton.disabled = true;
    setRecorderState("Unsupported", "This browser does not expose the MediaRecorder API required for capture.");
    setStatus(recordingStatus, "Recording is unavailable in this browser.", "error");
  }

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount?.addEventListener("click", () => {
    window.location.replace("./dashboard.html?section=account");
  });
  mobileMenuLibrary?.addEventListener("click", () => {
    window.location.replace("./dashboard.html?section=library");
  });
  recordingFileInput.addEventListener("change", () => {
    updateSelectedFileCopy();
    updateControls();
    setStatus(recordingUploadStatus, "");
  });
  recordingTemplateSelect.addEventListener("change", () => {
    applySelectedTemplateToNotes(false);
    queueActiveRecordingNotesSave();
    updateControls();
  });
  recordingNotesInput.addEventListener("input", queueActiveRecordingNotesSave);
  saveRecordingNotesButton.addEventListener("click", () => {
    void saveActiveRecordingNotes().catch((error) => {
      setRecordingNotesState("Save failed", "error");
      setStatus(recordingStatus, getErrorMessage(error, "Unable to save notes."), "error");
    });
  });
  applyRecordingTemplateButton.addEventListener("click", () => {
    applySelectedTemplateToNotes(true);
  });
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
    setRecordingUploadMode(false);
    setRecordingUploadModalOpen(true);
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
    if (isRecordingWorkflowActive) {
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
