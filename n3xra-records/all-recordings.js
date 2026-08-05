import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";
import { getSupportOrganizationId, loadSupportMembership, recordSupportEvent } from "./lib/support-access.js";
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
import { getRecordingInterruptions, stripRecordingInterruptionMarkers } from "./lib/recording-interruptions.js";
import {
  formatRecordingDuration as formatDuration,
  getRecordingDurationSeconds,
} from "./lib/recording-duration.js";

const setupPanel = document.getElementById("setup-panel");
const allRecordingsPanel = document.getElementById("all-recordings-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const allRecordingsNoAccessNotice = document.getElementById("all-recordings-no-access-notice");
const allRecordingsActiveOrganizationField = document.getElementById("all-recordings-active-organization-field");
const allRecordingsActiveMembershipField = document.getElementById("all-recordings-active-membership-field");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeOrganizationName = document.getElementById("active-organization-name");
const activeMembershipRole = document.getElementById("active-membership-role");
const recordingCount = document.getElementById("recording-count");
const recordingPlayerShell = document.getElementById("recording-player-shell");
const recordingPlayerHead = document.getElementById("recording-player-head");
const selectedRecordingCopy = document.getElementById("selected-recording-copy");
const recordingPlayer = document.getElementById("recording-player");
const recordingPlayerStatus = document.getElementById("recording-player-status");
const recordingsList = document.getElementById("recordings-list");
const recordingsEmpty = document.getElementById("recordings-empty");
const recordingsStatus = document.getElementById("recordings-status");
const recordingDetailModal = document.getElementById("recording-detail-modal");
const recordingDetailClose = document.getElementById("recording-detail-close");
const recordingDetailTabs = Array.from(document.querySelectorAll("[data-recording-detail-tab]"));
const recordingDetailTabPanels = Array.from(document.querySelectorAll("[data-recording-detail-panel]"));
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
const recordingDetailInterruptions = document.getElementById("recording-detail-interruptions");
const recordingDetailInterruptionList = document.getElementById("recording-detail-interruption-list");
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
const recordingDetailReferencePreviewRemove = document.getElementById("recording-detail-reference-preview-remove");
const recordingDetailReferenceFrame = document.getElementById("recording-detail-reference-frame");
const recordingDetailAiDraftPreview = document.getElementById("recording-detail-ai-draft-preview");
const recordingDetailAiDraftSave = document.getElementById("recording-detail-ai-draft-save");
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
const recordingDetailDelete = document.getElementById("recording-detail-delete");
const recordingDetailTransferLink = document.getElementById("recording-detail-transfer-link");
const recordingDetailStatusMessage = document.getElementById("recording-detail-status-message");
const recordingDeleteModal = document.getElementById("recording-delete-modal");
const recordingDeleteCopy = document.getElementById("recording-delete-copy");
const recordingDeleteCancel = document.getElementById("recording-delete-cancel");
const recordingDeleteSubmit = document.getElementById("recording-delete-submit");
const recordingDeleteStatus = document.getElementById("recording-delete-status");

const RECORDINGS_BUCKET = "meeting-recordings";

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let recordingsCache = [];
let recordingTemplates = [];
let activePlayerUrl = "";
let activeTopPlayerRecordingId = "";
let detailPlayerUrl = "";
let detailReferencePreviewUrl = "";
let detailReferencePreviewReferenceId = "";
let activeDetailRecordingId = "";
let pendingDeleteRecordingId = "";
let pendingLinkedRecordingId = "";
let reviewActionPending = false;
let recordingDetailNotesSaveTimer = null;
let referenceDocuments = [];
let recordingReferencesSchemaAvailable = true;

function consumeLinkedRecordingId() {
  if (!pendingLinkedRecordingId) return "";
  const recordingId = pendingLinkedRecordingId;
  pendingLinkedRecordingId = "";

  const url = new URL(window.location.href);
  url.searchParams.delete("recording");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  return recordingId;
}

function isIgnorableStorageDeleteError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not found") || message.includes("no such object") || message.includes("does not exist");
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

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

function formatRecordingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
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
    activeMembership?.isSupportView ? false : isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function getRecordingById(recordingId) {
  return recordingsCache.find((item) => item.id === recordingId) || null;
}

function mergeRecordingUpdate(recording) {
  if (!recording?.id) return;
  recordingsCache = recordingsCache.map((item) => (
    item.id === recording.id ? { ...item, ...recording } : item
  ));
}

function getTemplateLabel(templateId) {
  if (!templateId) return "No template";
  const template = recordingTemplates.find((item) => item.id === templateId);
  return template?.title || "Template";
}

function isMissingRecordingReferencesSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("meeting_recording_references") && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("not found")
  );
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
    const href = `/n3xra-records/documents.html?id=${encodeURIComponent(reference.app_document_id)}`;
    const showOpen = options.showOpen !== false;
    const removeAttr = options.canRemove
      ? ` <button class="recording-reference-remove" type="button" data-reference-remove-id="${escapeHtml(reference.id || reference.app_document_id)}">Remove</button>`
      : "";
    const openAttr = showOpen
      ? `<a class="btn secondary button-link" href="${href}" rel="noopener">Open</a>`
      : "";
    const actionsAttr = openAttr || removeAttr
      ? `<div class="recording-reference-actions">${openAttr}${removeAttr}</div>`
      : "";
    return `
      <article class="recording-reference-row" data-reference-preview-id="${escapeHtml(reference.app_document_id)}">
        <div>
          <span class="recording-reference-type">${escapeHtml(getReferenceTypeLabel(reference.reference_type))}</span>
          <p class="recording-reference-title">${escapeHtml(title)}</p>
        </div>
        ${actionsAttr}
      </article>
    `;
  }).join("");
  show(emptyEl, sorted.length === 0);
}

function isRetryableRecording(recording) {
  return String(recording?.status || "").trim().toLowerCase() === "failed";
}

function buildRetryRecordingHref(recording) {
  const params = new URLSearchParams();
  if (recording?.title) params.set("retryTitle", recording.title);
  if (recording?.id) params.set("retryRecording", recording.id);
  params.set("openUpload", "1");
  return `/n3xra-records/meeting-notes/?${params.toString()}`;
}

function retryRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !isRetryableRecording(recording)) return;
  window.location.href = buildRetryRecordingHref(recording);
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

function isMissingRecordingObjectError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("object not found") || message.includes("no such object");
}

async function updateMeetingRecording(recordingId, patch) {
  if (!recordingId) return;
  const { error } = await supabase
    .from("meeting_recordings")
    .update(patch)
    .eq("id", recordingId);
  if (error) throw error;
}

async function saveRecordingDetailNotes() {
  if (!activeDetailRecordingId) return;
  const recordingId = activeDetailRecordingId;
  const notesText = String(recordingDetailNotes?.value || "").trim();
  const payload = {
    notes_content_json: noteTextToContentJson(notesText),
    notes_plain_text: notesText,
    notes_updated_at: new Date().toISOString(),
  };
  await updateMeetingRecording(recordingId, payload);
  if (getRecordingById(recordingId)) {
    mergeRecordingUpdate({ id: recordingId, ...payload });
    renderRecordings();
  }
}

function queueRecordingDetailNotesSave() {
  if (recordingDetailNotesSaveTimer) {
    window.clearTimeout(recordingDetailNotesSaveTimer);
  }
  if (!activeDetailRecordingId) return;
  recordingDetailNotesSaveTimer = window.setTimeout(() => {
    void saveRecordingDetailNotes().catch((error) => {
      setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save notes."), "error");
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

function aiDraftHasUnsavedChanges() {
  if (!recordingDetailAiDraftPreview || recordingDetailAiDraftPreview.disabled) return false;
  return recordingDetailAiDraftPreview.value.trim() !== String(recordingDetailAiDraftPreview.dataset.savedValue || "").trim();
}

async function saveRecordingAiDraft({ quiet = false } = {}) {
  const recording = getRecordingById(activeDetailRecordingId);
  if (!recording || !recordingDetailAiDraftPreview) return null;
  const editedDraftText = recordingDetailAiDraftPreview.value.trim();
  if (!editedDraftText) throw new Error("The AI draft cannot be empty.");
  if (!aiDraftHasUnsavedChanges()) return recording;

  const accessToken = await getFreshAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");
  if (recordingDetailAiDraftSave) recordingDetailAiDraftSave.disabled = true;
  if (!quiet) setStatus(recordingDetailStatusMessage, "Saving draft changes...");

  const response = await fetch("/api/finalize-recording-notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordingId: recording.id, editedDraftText }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to save AI draft changes.");
  if (data.recording) mergeRecordingUpdate(data.recording);
  const updated = getRecordingById(recording.id) || data.recording || recording;
  populateRecordingDetails(updated);
  renderRecordings();
  if (!quiet) setStatus(recordingDetailStatusMessage, "Draft changes saved.", "success");
  return updated;
}

async function reconcileMissingRecordingObject(recording, error) {
  if (!recording?.id || !isMissingRecordingObjectError(error)) return false;

  const nextError = "Audio file is missing from storage for this row. Delete it and record again.";
  const currentStatus = String(recording.status || "").trim().toLowerCase();
  if (!["uploading", "uploaded", "recorded"].includes(currentStatus)) return false;

  try {
    await updateMeetingRecording(recording.id, {
      status: "failed",
      processing_error: nextError,
    });
  } catch {
    return false;
  }

  recordingsCache = recordingsCache.map((item) => (
    item.id === recording.id
      ? { ...item, status: "failed", processing_error: nextError }
      : item
  ));
  renderRecordings();

  if (activeDetailRecordingId === recording.id) {
    const updatedRecording = getRecordingById(recording.id);
    if (updatedRecording) populateRecordingDetails(updatedRecording);
  }

  setStatus(recordingsStatus, nextError, "error");
  return true;
}

async function createRecordingSignedUrl(recording) {
  if (!recording?.storage_path) {
    throw new Error("No audio file is stored for this meeting note yet.");
  }

  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(recording.storage_path, 60 * 10);
  if (error || !data?.signedUrl) {
    throw error || new Error("Unable to create a playback link.");
  }
  await recordSupportEvent(supabase, activeMembership?.organization?.id, "content_viewed", "recording", recording.id);
  await recordSupportEvent(supabase, activeMembership?.organization?.id, "signed_link_created", "recording", recording.id);
  return data.signedUrl;
}

function setRecordingDetailModalOpen(isOpen) {
  recordingDetailModal.classList.toggle("is-open", isOpen);
  recordingDetailModal.setAttribute("aria-hidden", String(!isOpen));
}

function setRecordingDeleteModalOpen(isOpen) {
  recordingDeleteModal.classList.toggle("is-open", isOpen);
  recordingDeleteModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    setStatus(recordingDeleteStatus, "");
    pendingDeleteRecordingId = "";
  }
}

function clearPlayer() {
  if (activePlayerUrl) {
    recordingPlayer.pause();
    recordingPlayer.removeAttribute("src");
    recordingPlayer.load();
    activePlayerUrl = "";
  }
  activeTopPlayerRecordingId = "";
  show(recordingPlayerShell, false);
  show(recordingPlayerHead, false);
  show(recordingPlayer, false);
  selectedRecordingCopy.textContent = "Select a meeting note below to load playback.";
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

function renderOrganizationSelector() {
  if (!memberships.length || !getActiveOrganization()) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeOrganizationName.textContent = "No active library";
    activeMembershipRole.textContent = "No library access";
    recordingCount.textContent = "0";
    activeOrganizationSelect.disabled = true;
    show(activeOrganizationSelect, false);
    show(activeOrganizationName, true);
    show(allRecordingsNoAccessNotice, true);
    show(allRecordingsActiveOrganizationField, false);
    show(allRecordingsActiveMembershipField, false);
    show(mobileMenuMessagesLink, false);
    show(mobileMenuRecordingsLink, false);
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
  show(allRecordingsNoAccessNotice, false);
  show(allRecordingsActiveOrganizationField, true);
  show(allRecordingsActiveMembershipField, memberships.length > 1);
  show(mobileMenuMessagesLink, getActiveCapabilities().canShareDocuments);
  show(mobileMenuRecordingsLink, getActiveCapabilities().canUseRecordings);
  activeOrganizationSelect.disabled = !hasMany;
  show(activeOrganizationSelect, hasMany);
  show(activeOrganizationName, !hasMany);
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
  if (getSupportOrganizationId() && isPlatformAdminEmail(currentSession.user.email)) {
    const supportMembership = await loadSupportMembership(supabase, currentSession.user);
    if (supportMembership) memberships = [supportMembership, ...memberships.filter((item) => item.organization?.id !== supportMembership.organization.id)];
  }
  activeMembership = resolveActiveOrganization(memberships, getSupportOrganizationId() || String(bootstrapData?.active_organization_id || ""));
  if (activeMembership?.organization?.id) {
    setStoredActiveOrganizationId(activeMembership.organization.id);
  }
  renderOrganizationSelector();
}

async function loadRecordingTemplates() {
  const organization = getActiveOrganization();
  if (!organization) {
    recordingTemplates = [];
    return;
  }

  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title")
    .eq("organization_id", organization.id)
    .eq("document_kind", "template")
    .order("title", { ascending: true });

  recordingTemplates = error || !Array.isArray(data) ? [] : data;
}

async function loadReferenceDocuments() {
  const organization = getActiveOrganization();
  referenceDocuments = [];
  renderReferenceSelect(recordingDetailReferenceSelect, getRecordingReferences(getRecordingById(activeDetailRecordingId)));
  if (!organization) return;

  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, status, updated_at, created_at")
    .eq("organization_id", organization.id)
    .eq("document_kind", "document")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  referenceDocuments = error || !Array.isArray(data) ? [] : data;
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
  const documentsById = new Map(referenceDocuments.map((doc) => [doc.id, doc]));
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

async function loadRecordings() {
  const organization = getActiveOrganization();
  if (!organization) {
    recordingsCache = [];
    recordingCount.textContent = "0";
    renderRecordings();
    setStatus(recordingsStatus, "");
    return;
  }

  setStatus(recordingsStatus, "Loading meeting notes...");
  const { data, error } = await supabase
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
      processing_stage,
      processing_progress,
      processing_started_at,
      processing_updated_at,
      processing_completed_at,
      notes_plain_text,
      ai_review_json,
      ai_draft_document_id,
      final_document_id,
      metadata,
      created_at
    `)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    recordingsCache = [];
    renderRecordings();
    setStatus(recordingsStatus, getErrorMessage(error, "Unable to load meeting notes."), "error");
    return;
  }

  recordingsCache = Array.isArray(data) ? data : [];
  let referenceLoadError = null;
  try {
    await loadReferencesForRecordings(recordingsCache.map((recording) => recording.id));
  } catch (error) {
    referenceLoadError = error;
  }
  recordingCount.textContent = String(recordingsCache.length);
  renderRecordings();
  setStatus(
    recordingsStatus,
    referenceLoadError
      ? getErrorMessage(referenceLoadError, "Meeting notes loaded, but references could not be loaded.")
      : `${recordingsCache.length} meeting note${recordingsCache.length === 1 ? "" : "s"} loaded.`,
    referenceLoadError ? "error" : recordingsCache.length ? "success" : ""
  );

  const linkedRecordingId = consumeLinkedRecordingId();
  if (linkedRecordingId) {
    if (getRecordingById(linkedRecordingId)) {
      void openRecordingDetail(linkedRecordingId);
    } else {
      setStatus(recordingsStatus, "Requested meeting note was not found in this library.", "error");
    }
  }
}

function renderRecordings() {
  recordingsList.innerHTML = "";
  show(recordingsEmpty, recordingsCache.length === 0);

  recordingsCache.forEach((recording) => {
    const errorCopy = recording.processing_error
      ? `<p class="recording-row-note recording-row-note-error">${escapeHtml(recording.processing_error)}</p>`
      : "";
    const progress = Math.max(0, Math.min(100, Number(recording.processing_progress || 0)));
    const progressCopy = progress > 0 && progress < 100
      ? `<div class="recording-row-progress"><span style="width:${progress}%"></span></div><p class="recording-row-progress-copy">${escapeHtml(formatRecordingStatus(recording.processing_stage))} · ${progress}%</p>`
      : "";
    const item = document.createElement("article");
    item.className = "recording-row";
    item.setAttribute("data-recording-id", recording.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
      <div class="recording-row-main">
        <div>
          <p class="recording-row-title">${escapeHtml(recording.title || "Untitled meeting note")}</p>
          <p class="recording-row-meta">${escapeHtml(formatDateTime(recording.started_at || recording.created_at))}</p>
        </div>
        <span class="recording-row-status status-${escapeHtml(String(recording.status || "").toLowerCase())}">${escapeHtml(formatRecordingStatus(recording.status))}</span>
      </div>
      <div class="recording-row-details">
        <span>${escapeHtml(formatDuration(getRecordingDurationSeconds(recording)))}</span>
        <span>${escapeHtml(formatBytes(recording.file_size || 0))}</span>
        <span>${escapeHtml(formatRecordingStatus(recording.transcript_status))} transcript</span>
        <span>${escapeHtml(formatRecordingStatus(recording.ai_review_status || "not_started"))} AI review</span>
      </div>
      ${progressCopy}
      ${errorCopy}
    `;
    recordingsList.append(item);
  });
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
  if (references.length > 1) {
    renderReferenceList(recordingDetailReferenceList, recordingDetailReferenceEmpty, references, { showOpen: false });
    show(recordingDetailReferenceList, true);
    show(recordingDetailReferenceEmpty, false);
  } else {
    if (recordingDetailReferenceList) recordingDetailReferenceList.innerHTML = "";
    show(recordingDetailReferenceList, false);
    show(recordingDetailReferenceEmpty, references.length === 0);
  }
  void previewReferenceDocument(references[0] || null);
}

function clearReferencePreview() {
  if (recordingDetailReferenceFrame) recordingDetailReferenceFrame.removeAttribute("src");
  show(recordingDetailReferencePreview, false);
  detailReferencePreviewReferenceId = "";
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
    recordingDetailReferencePreviewOpen.href = `/n3xra-records/documents.html?id=${encodeURIComponent(reference.app_document_id)}`;
  }
  if (recordingDetailReferencePreviewRemove) {
    recordingDetailReferencePreviewRemove.dataset.referenceRemoveId = reference.id || "";
  }
  detailReferencePreviewReferenceId = reference.id || "";
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

async function playRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!canPlaybackRecording(recording)) return;

  setStatus(recordingPlayerStatus, "Loading audio...");
  let signedUrl = "";
  try {
    signedUrl = await createRecordingSignedUrl(recording);
  } catch (error) {
    const reconciled = await reconcileMissingRecordingObject(recording, error);
    if (reconciled) {
      setStatus(recordingPlayerStatus, "Audio file is missing from storage for this row.", "error");
      return;
    }
    setStatus(recordingPlayerStatus, getErrorMessage(error, "Unable to load the audio file."), "error");
    return;
  }

  activePlayerUrl = signedUrl;
  activeTopPlayerRecordingId = recording.id;
  recordingPlayer.src = activePlayerUrl;
  show(recordingPlayerShell, true);
  show(recordingPlayerHead, true);
  show(recordingPlayer, true);
  selectedRecordingCopy.textContent = `${recording.title || "Untitled meeting note"} · ${formatDateTime(recording.started_at || recording.created_at)}`;
  try {
    await recordingPlayer.play();
  } catch {
    // Browsers may require a second interaction before playback.
  }
  setStatus(recordingPlayerStatus, "Audio loaded.", "success");
}

function populateRecordingDetails(recording) {
  recordingDetailTitle.textContent = recording.title || "Untitled meeting note";
  recordingDetailStatus.textContent = formatRecordingStatus(recording.status);
  recordingDetailTranscriptStatus.textContent = formatRecordingStatus(recording.transcript_status);
  recordingDetailTemplate.textContent = getTemplateLabel(recording.selected_template_id || "");
  recordingDetailAiStatus.textContent = formatRecordingStatus(recording.ai_review_status || "not_started");
  recordingDetailStartedAt.textContent = formatDateTime(recording.started_at || recording.created_at);
  recordingDetailEndedAt.textContent = recording.ended_at ? formatDateTime(recording.ended_at) : "Not finished";
  recordingDetailDuration.textContent = formatDuration(getRecordingDurationSeconds(recording));
  recordingDetailSize.textContent = formatBytes(recording.file_size || 0);
  recordingDetailNotes.value = String(recording.notes_plain_text || "").trim();
  recordingDetailNotes.disabled = !getActiveCapabilities().canEditDocuments;
  const aiDraftPreview = String(recording.ai_review_json?.final_document_text || "").trim();
  if (recordingDetailAiDraftPreview) {
    recordingDetailAiDraftPreview.value = aiDraftPreview;
    recordingDetailAiDraftPreview.placeholder = "No AI draft created yet.";
    recordingDetailAiDraftPreview.dataset.savedValue = aiDraftPreview;
    recordingDetailAiDraftPreview.disabled = !getActiveCapabilities().canEditDocuments || !aiDraftPreview;
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
  renderRecordingInterruptions(recording);
  if (recordingDetailTranscriptText) {
    recordingDetailTranscriptText.textContent = stripRecordingInterruptionMarkers(recording.transcript_text) || "No transcript available yet.";
  }
  recordingDetailPlay.disabled = !canPlaybackRecording(recording);
  show(recordingDetailTranscribe, canTranscribeRecording(recording));
  show(recordingDetailRetry, isRetryableRecording(recording));
  show(recordingDetailTranscriptDocument, Boolean(recording.document_id));
  if (recording.document_id) {
    recordingDetailTranscriptDocument.href = `/n3xra-records/library?id=${encodeURIComponent(recording.document_id)}`;
  }
  const reviewDocumentId = recording.final_document_id || recording.ai_draft_document_id || "";
  show(recordingDetailAiDraftSave, Boolean(reviewDocumentId && aiDraftPreview && getActiveCapabilities().canEditDocuments));
  if (recordingDetailAiDraftSave) recordingDetailAiDraftSave.disabled = true;
  show(recordingDetailAiDraft, Boolean(reviewDocumentId));
  if (reviewDocumentId) {
    recordingDetailAiDraft.href = `/n3xra-records/documents.html?id=${encodeURIComponent(reviewDocumentId)}`;
    recordingDetailAiDraft.textContent = "Finalize and send document";
  }
  renderDetailReferences(recording);
  renderAiReview(recording.ai_review_json || null);
  recordingDetailAiReview.textContent = recording.ai_review_status === "ready" ? "Regenerate AI review" : "Review with AI";
  recordingDetailAiReview.title = recording.ai_review_status === "ready"
    ? "Regenerate the AI draft while preserving applied suggestions."
    : "";
  recordingDetailAiReview.disabled = recording.transcript_status !== "ready";
  recordingDetailPlay.textContent = "Play";
  recordingDetailDelete.disabled = !getActiveCapabilities().canDeleteDocuments;
  const canOpenTransfer = getMembershipRole(activeMembership) === "account_admin" && memberships.some((membership) => (
    membership.organization?.id !== getActiveOrganization()?.id &&
    membership.organization?.subscription_tier === "organization" &&
    ["active", "trialing"].includes(String(membership.organization?.account_status || "active")) &&
    getMembershipRole(membership) === "account_admin"
  ));
  show(recordingDetailTransferLink, canOpenTransfer);
  if (recordingDetailTransferLink) {
    recordingDetailTransferLink.href = `/n3xra-records/meeting-notes?recording=${encodeURIComponent(recording.id)}`;
  }
  setStatus(recordingDetailStatusMessage, recording.processing_error || "");
}

function renderRecordingInterruptions(recording) {
  const interruptions = getRecordingInterruptions(recording);
  show(recordingDetailInterruptions, interruptions.length > 0);
  if (!recordingDetailInterruptionList) return;
  recordingDetailInterruptionList.innerHTML = interruptions.map((item, index) => {
    const startedAt = item?.started_at ? formatDateTime(item.started_at) : "Time unavailable";
    const endedAt = item?.ended_at ? formatDateTime(item.ended_at) : "Not resumed";
    const startedMs = item?.started_at ? new Date(item.started_at).getTime() : Number.NaN;
    const endedMs = item?.ended_at ? new Date(item.ended_at).getTime() : Number.NaN;
    const gapSeconds = Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(Math.round((endedMs - startedMs) / 1000), 0)
      : 0;
    const gapCopy = gapSeconds ? ` · ${formatDuration(gapSeconds)} gap` : "";
    return `
      <li>
        <strong>Interruption ${escapeHtml(item?.number || index + 1)}</strong>
        <span>${escapeHtml(startedAt)} to ${escapeHtml(endedAt)}${escapeHtml(gapCopy)}</span>
        <small>No audio was captured during this time.</small>
      </li>
    `;
  }).join("");
}

async function transcribeRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !canTranscribeRecording(recording)) return;

  setStatus(recordingsStatus, "Creating transcript...");
  if (activeDetailRecordingId === recordingId) {
    setStatus(recordingDetailStatusMessage, "Creating transcript...");
    recordingDetailTranscribe.disabled = true;
  }

  try {
    await requestRecordingTranscription(recordingId);
    await loadRecordings();
    setStatus(recordingsStatus, "Transcript created as a searchable file.", "success");
    if (activeDetailRecordingId === recordingId) {
      const updated = getRecordingById(recordingId);
      if (updated) populateRecordingDetails(updated);
      setStatus(recordingDetailStatusMessage, "Transcript created as a searchable file.", "success");
    }
  } catch (error) {
    const message = getErrorMessage(error, "Unable to create transcript.");
    setStatus(recordingsStatus, message, "error");
    if (activeDetailRecordingId === recordingId) {
      setStatus(recordingDetailStatusMessage, message, "error");
      recordingDetailTranscribe.disabled = false;
    }
  }
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
    await loadRecordingTemplates();
    await loadRecordings();
    const updated = getRecordingById(recording.id) || result?.recording;
    if (updated) {
      activeDetailRecordingId = updated.id;
      populateRecordingDetails(updated);
    }
    setStatus(recordingDetailStatusMessage, recording.ai_review_status === "ready" ? "AI draft regenerated." : "AI draft is ready.", "success");
  } catch (error) {
    recordingDetailAiStatus.textContent = "Failed";
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to review meeting notes."), "error");
  } finally {
    const updated = getRecordingById(recording.id) || recording;
    recordingDetailAiReview.disabled = updated.transcript_status !== "ready";
  }
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
  let signedUrl = "";
  try {
    signedUrl = await createRecordingSignedUrl(recording);
  } catch (error) {
    const reconciled = await reconcileMissingRecordingObject(recording, error);
    if (reconciled) {
      setStatus(recordingDetailStatusMessage, "Audio file is missing from storage for this row.", "error");
      return;
    }
    setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to load the audio file."), "error");
    return;
  }

  detailPlayerUrl = signedUrl;
  recordingDetailPlayer.src = detailPlayerUrl;
  show(recordingDetailPlayer, true);

  const sameAsTopPlayer = activeTopPlayerRecordingId === recording.id && Boolean(recordingPlayer.currentSrc);
  const resumeAt = sameAsTopPlayer ? recordingPlayer.currentTime : 0;
  const shouldResumePlayback = sameAsTopPlayer && !recordingPlayer.paused;
  if (sameAsTopPlayer) {
    recordingPlayer.pause();
  }

  recordingDetailPlayer.addEventListener("loadedmetadata", () => {
    if (resumeAt > 0) {
      recordingDetailPlayer.currentTime = resumeAt;
    }
  }, { once: true });

  if (shouldResumePlayback) {
    try {
      await recordingDetailPlayer.play();
      recordingDetailPlay.textContent = "Pause";
    } catch {
      // Browsers may require a second interaction before autoplaying audio.
    }
  }
  setStatus(recordingDetailStatusMessage, "");
}

async function syncDetailPlayerBackToTop() {
  if (!activeDetailRecordingId || !detailPlayerUrl) {
    clearDetailPlayer();
    return;
  }

  const recording = getRecordingById(activeDetailRecordingId);
  if (!recording) {
    clearDetailPlayer();
    return;
  }

  const resumeAt = recordingDetailPlayer.currentTime || 0;
  const shouldResumePlayback = !recordingDetailPlayer.paused;
  activePlayerUrl = detailPlayerUrl;
  activeTopPlayerRecordingId = recording.id;
  recordingPlayer.src = activePlayerUrl;
  show(recordingPlayerShell, true);
  show(recordingPlayerHead, true);
  show(recordingPlayer, true);
  selectedRecordingCopy.textContent = `${recording.title || "Untitled meeting note"} · ${formatDateTime(recording.started_at || recording.created_at)}`;
  recordingPlayer.addEventListener("loadedmetadata", () => {
    if (resumeAt > 0) {
      recordingPlayer.currentTime = resumeAt;
    }
  }, { once: true });
  if (shouldResumePlayback) {
    try {
      await recordingPlayer.play();
    } catch {
      // Browsers may require a second interaction before autoplaying audio.
    }
  }
  clearDetailPlayer();
}

async function closeRecordingDetail() {
  if (recordingDetailNotesSaveTimer) {
    window.clearTimeout(recordingDetailNotesSaveTimer);
    recordingDetailNotesSaveTimer = null;
    await saveRecordingDetailNotes().catch((error) => {
      setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save notes."), "error");
    });
  }
  await syncDetailPlayerBackToTop();
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
  recordingsCache = recordingsCache.map((item) => (
    item.id === recording.id
      ? { ...item, ai_review_json: review }
      : item
  ));
  renderRecordings();
  const updated = getRecordingById(recording.id);
  if (updated) populateRecordingDetails(updated);
}

async function handleReviewSuggestionAction(action, index = null) {
  if (reviewActionPending) return;
  let recording = getRecordingById(activeDetailRecordingId);
  if (!recording) return;
  if (!getActiveCapabilities().canEditDocuments) {
    setStatus(recordingDetailStatusMessage, "You need editor access to apply AI suggestions.", "error");
    return;
  }

  reviewActionPending = true;
  setReviewActionsDisabled(true);

  try {
    if (aiDraftHasUnsavedChanges()) {
      setStatus(recordingDetailStatusMessage, "Saving your draft edits before updating suggestions...");
      recording = await saveRecordingAiDraft({ quiet: true }) || recording;
    }
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

function promptDeleteRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !getActiveCapabilities().canDeleteDocuments) return;
  pendingDeleteRecordingId = recording.id;
  recordingDeleteCopy.textContent = `Delete "${recording.title || "Untitled meeting note"}"? This action cannot be undone.`;
  setRecordingDeleteModalOpen(true);
}

async function deleteRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;

  setStatus(recordingDeleteStatus, "Deleting meeting note...");
  recordingDeleteSubmit.disabled = true;
  recordingDeleteCancel.disabled = true;

  try {
    if (recording.storage_path) {
      const { error: storageError } = await supabase.storage.from(RECORDINGS_BUCKET).remove([recording.storage_path]);
      if (storageError && !isIgnorableStorageDeleteError(storageError)) throw storageError;
    }

    const { error } = await supabase
      .from("meeting_recordings")
      .delete()
      .eq("id", recording.id);
    if (error) throw error;

    if (activeTopPlayerRecordingId === recording.id) {
      clearPlayer();
    }
    if (activeDetailRecordingId === recording.id) {
      clearDetailPlayer();
      setRecordingDetailModalOpen(false);
      activeDetailRecordingId = "";
    }

    setRecordingDeleteModalOpen(false);
    await loadRecordings();
    setStatus(recordingsStatus, "Meeting note deleted.", "success");
  } catch (error) {
    setStatus(recordingDeleteStatus, getErrorMessage(error, "Unable to delete the meeting note."), "error");
  } finally {
    recordingDeleteSubmit.disabled = false;
    recordingDeleteCancel.disabled = false;
  }
}

async function handleOrganizationChange(nextOrganizationId) {
  if (!nextOrganizationId || nextOrganizationId === getActiveOrganization()?.id) return;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;

  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);
  if (recordingDetailModal.classList.contains("is-open")) {
    setRecordingDetailModalOpen(false);
    activeDetailRecordingId = "";
    clearDetailPlayer();
  }
  if (recordingDeleteModal.classList.contains("is-open")) {
    setRecordingDeleteModalOpen(false);
  }
  clearPlayer();
  renderOrganizationSelector();
  await loadRecordingTemplates();
  await loadReferenceDocuments();
  await loadRecordings();
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(recordingsStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("/n3xra-records/login");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(allRecordingsPanel, false);
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
    show(allRecordingsPanel, true);
    setStatus(recordingsStatus, getErrorMessage(error, "Unable to load meeting note context."), "error");
    return;
  }

  if (!getActiveCapabilities().canUseRecordings) {
    window.location.replace("/n3xra-records/library");
    return;
  }

  pendingLinkedRecordingId = new URLSearchParams(window.location.search).get("recording") || "";

  show(setupPanel, false);
  show(allRecordingsPanel, true);
  await loadRecordingTemplates();
  await loadReferenceDocuments();
  await loadRecordings();

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.replace("/n3xra-records/account");
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.replace("/n3xra-records/library");
  });
  activeOrganizationSelect.addEventListener("change", async () => {
    closeMobileMenu();
    await handleOrganizationChange(activeOrganizationSelect.value);
  });
  recordingsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) {
      event.stopPropagation();
      const action = button.getAttribute("data-action") || "";
      const recordingId = button.getAttribute("data-id") || "";
      if (action === "play-recording") {
        void playRecording(recordingId);
        return;
      }
      if (action === "open-recording") {
        void openRecordingDetail(recordingId);
        return;
      }
      if (action === "retry-recording") {
        retryRecording(recordingId);
        return;
      }
      if (action === "transcribe-recording") {
        void transcribeRecording(recordingId);
        return;
      }
      if (action === "delete-recording") {
        promptDeleteRecording(recordingId);
      }
      return;
    }

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
  recordingDetailClose.addEventListener("click", () => {
    void closeRecordingDetail();
  });
  recordingDetailModal.addEventListener("click", (event) => {
    if (event.target === recordingDetailModal) {
      void closeRecordingDetail();
    }
  });
  recordingAiReviewPanel?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-action]");
    if (!button) return;
    void handleReviewSuggestionAction(
      button.getAttribute("data-review-action") || "",
      button.getAttribute("data-review-index")
    );
  });
  recordingDetailReferenceSelect?.addEventListener("change", () => {
    if (recordingDetailReferenceAdd) recordingDetailReferenceAdd.disabled = !recordingDetailReferenceSelect.value;
  });
  recordingDetailReferenceAdd?.addEventListener("click", () => {
    void addDetailReference();
  });
  recordingDetailReferencePreviewRemove?.addEventListener("click", () => {
    void removeDetailReference(recordingDetailReferencePreviewRemove.dataset.referenceRemoveId || detailReferencePreviewReferenceId);
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
  recordingDetailNotes?.addEventListener("input", queueRecordingDetailNotesSave);
  recordingDetailAiDraftPreview?.addEventListener("input", () => {
    if (recordingDetailAiDraftSave) recordingDetailAiDraftSave.disabled = !aiDraftHasUnsavedChanges();
  });
  recordingDetailAiDraftSave?.addEventListener("click", () => {
    void saveRecordingAiDraft().catch((error) => {
      if (recordingDetailAiDraftSave) recordingDetailAiDraftSave.disabled = false;
      setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save AI draft changes."), "error");
    });
  });
  recordingDetailAiDraft?.addEventListener("click", (event) => {
    if (!aiDraftHasUnsavedChanges()) return;
    event.preventDefault();
    const destination = recordingDetailAiDraft.href;
    void saveRecordingAiDraft({ quiet: true })
      .then(() => { window.location.href = destination; })
      .catch((error) => {
        if (recordingDetailAiDraftSave) recordingDetailAiDraftSave.disabled = false;
        setStatus(recordingDetailStatusMessage, getErrorMessage(error, "Unable to save AI draft changes."), "error");
      });
  });
  recordingDetailTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setRecordingDetailTab(button.dataset.recordingDetailTab || "details");
    });
    button.addEventListener("keydown", handleRecordingDetailTabKeydown);
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
        // Browsers may require an extra interaction.
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
  recordingDetailDelete.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    promptDeleteRecording(activeDetailRecordingId);
  });
  recordingDetailRetry.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    retryRecording(activeDetailRecordingId);
  });
  recordingDetailTranscribe.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    void transcribeRecording(activeDetailRecordingId);
  });
  recordingDetailAiReview.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    void handleRecordingAiReview(activeDetailRecordingId);
  });
  recordingDeleteCancel.addEventListener("click", () => {
    setRecordingDeleteModalOpen(false);
  });
  recordingDeleteSubmit.addEventListener("click", async () => {
    if (!pendingDeleteRecordingId) return;
    await deleteRecording(pendingDeleteRecordingId);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (recordingDeleteModal.classList.contains("is-open")) {
      setRecordingDeleteModalOpen(false);
      return;
    }
    if (recordingDetailModal.classList.contains("is-open")) {
      void closeRecordingDetail();
    }
  });

  setMenuActive("recordings");
}

void init();
