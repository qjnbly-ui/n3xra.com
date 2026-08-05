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
  clearRecordingReview,
  dismissRecordingSuggestion,
  getOpenSuggestionIndexes,
  getSuggestionStatus,
  getSuggestionText,
  isSuggestionResolved,
} from "./lib/recording-suggestions.js";
import { createAppDocumentPdfObjectUrl } from "./lib/app-document-pdf.js";
import {
  cleanupStaleLocalRecordingChunks,
  createMeetingRecordingChunkManager,
  deleteLocalChunksForRecording,
} from "./lib/meeting-recording-chunks.js";
import { getRecordingInterruptions, stripRecordingInterruptionMarkers } from "./lib/recording-interruptions.js";
import {
  formatRecordingDuration as formatDuration,
  getRecordingDurationSeconds,
  normalizeRecordingDurationSeconds,
} from "./lib/recording-duration.js";

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
const recordPanel = document.getElementById("record-panel");
const recordPanelToggle = document.getElementById("record-panel-toggle");
const recordPanelBody = document.getElementById("record-panel-body");
const meetingEditorEmpty = document.getElementById("meeting-editor-empty");
const meetingNotesSearch = document.getElementById("meeting-notes-search");
const cancelMeetingNoteButton = document.getElementById("cancel-meeting-note-button");
const meetingWorkspaceActionsSlot = document.getElementById("meeting-workspace-actions-slot");
const meetingWorkspaceActions = document.getElementById("meeting-workspace-actions");
const meetingWorkspaceActionsAnchor = document.getElementById("meeting-workspace-actions-anchor");
let meetingWorkspaceActionsRevealTimer = 0;
const recordingTitleInput = document.getElementById("recording-title");
const recordingTemplateSelect = document.getElementById("recording-template-select");
const recordingNotesInput = document.getElementById("recording-notes");
const meetingSourceBrowser = document.getElementById("meeting-source-browser");
const meetingSourcePhone = document.getElementById("meeting-source-phone");
const meetingSourceBoth = document.getElementById("meeting-source-both");
const meetingSourceUpload = document.getElementById("meeting-source-upload");
const meetingSourceNote = document.getElementById("meeting-source-note");
const phoneMeetingStart = document.getElementById("phone-meeting-start");
const browserRecordingWorkflow = document.getElementById("browser-recording-workflow");
const startPhoneMeetingButton = document.getElementById("start-phone-meeting-button");
const phoneMeetingDialIn = document.getElementById("phone-meeting-dial-in");
const phoneMeetingNumber = document.getElementById("phone-meeting-number");
const phoneMeetingCode = document.getElementById("phone-meeting-code");
const phoneMeetingExpires = document.getElementById("phone-meeting-expires");
const phoneMeetingState = document.getElementById("phone-meeting-state");
const phoneMeetingStateCopy = document.getElementById("phone-meeting-state-copy");
const endPhoneMeetingButton = document.getElementById("end-phone-meeting-button");
const retryPhoneMeetingTransferButton = document.getElementById("retry-phone-meeting-transfer-button");
const completePhoneMeetingWithoutRecordingButton = document.getElementById("complete-phone-meeting-without-recording-button");
const recordingReferenceSelect = document.getElementById("recording-reference-select");
const recordingReferenceType = document.getElementById("recording-reference-type");
const recordingReferenceAdd = document.getElementById("recording-reference-add");
const recordingReferenceList = document.getElementById("recording-reference-list");
const recordingReferenceEmpty = document.getElementById("recording-reference-empty");
const recordingReferencePreview = document.getElementById("recording-reference-preview");
const recordingReferencePreviewType = document.getElementById("recording-reference-preview-type");
const recordingReferencePreviewTitle = document.getElementById("recording-reference-preview-title");
const recordingReferencePreviewOpen = document.getElementById("recording-reference-preview-open");
const recordingReferencePreviewRemove = document.getElementById("recording-reference-preview-remove");
const recordingReferenceFrame = document.getElementById("recording-reference-frame");
const recordingFileInput = document.getElementById("recording-file-input");
const recordingFileCopy = document.getElementById("recording-file-copy");
const recorderStateLabel = document.getElementById("recorder-state-label");
const recorderStateCopy = document.getElementById("recorder-state-copy");
const recordingDuration = document.getElementById("recording-duration");
const uploadStateValue = document.getElementById("upload-state-value");
const uploadProgressShell = document.getElementById("upload-progress-shell");
const uploadProgressCopy = document.getElementById("upload-progress-copy");
const recordingProcessingProgress = document.getElementById("recording-processing-progress");
const recordingProcessingProgressFill = document.getElementById("recording-processing-progress-fill");
const startRecordingButton = document.getElementById("start-recording-button");
const uploadRecordingButton = document.getElementById("upload-recording-button");
const pauseRecordingButton = document.getElementById("pause-recording-button");
const stopRecordingButton = document.getElementById("stop-recording-button");
const resumeRecordingButton = document.getElementById("resume-recording-button");
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
const recordingDetailClearReview = recordingAiReviewPanel?.querySelector('[data-review-action="clear"]');
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
const recordingDetailTransfer = document.getElementById("recording-detail-transfer");
const recordingDetailDelete = document.getElementById("recording-detail-delete");
const recordingDetailStatusMessage = document.getElementById("recording-detail-status-message");
const recordingTransferModal = document.getElementById("recording-transfer-modal");
const recordingTransferCopy = document.getElementById("recording-transfer-copy");
const recordingTransferModeWorkspace = document.getElementById("recording-transfer-mode-workspace");
const recordingTransferModeExternal = document.getElementById("recording-transfer-mode-external");
const recordingTransferWorkspacePanel = document.getElementById("recording-transfer-workspace-panel");
const recordingTransferExternalPanel = document.getElementById("recording-transfer-external-panel");
const recordingTransferDestination = document.getElementById("recording-transfer-destination");
const recordingTransferWorkspaceNote = document.getElementById("recording-transfer-workspace-note");
const recordingTransferRecipientEmail = document.getElementById("recording-transfer-recipient-email");
const recordingTransferRecipientOrganization = document.getElementById("recording-transfer-recipient-organization");
const recordingTransferPending = document.getElementById("recording-transfer-pending");
const recordingTransferPendingCopy = document.getElementById("recording-transfer-pending-copy");
const recordingTransferCancelInvitation = document.getElementById("recording-transfer-cancel-invitation");
const recordingTransferCancel = document.getElementById("recording-transfer-cancel");
const recordingTransferSubmit = document.getElementById("recording-transfer-submit");
const recordingTransferStatus = document.getElementById("recording-transfer-status");
const recordingDeleteModal = document.getElementById("recording-delete-modal");
const recordingDeleteCopy = document.getElementById("recording-delete-copy");
const recordingDeleteCancel = document.getElementById("recording-delete-cancel");
const recordingDeleteSubmit = document.getElementById("recording-delete-submit");
const recordingDeleteStatus = document.getElementById("recording-delete-status");
const recordingsConfirmModal = document.getElementById("recordings-confirm-modal");
const recordingsConfirmCancel = document.getElementById("recordings-confirm-cancel");
const recordingsConfirmOk = document.getElementById("recordings-confirm-ok");

const RECORDINGS_BUCKET = "meeting-recordings";
const RECORDER_AUDIO_BITS_PER_SECOND = 64000;
const RECORDING_CHUNK_INTERVAL_MS = 20000;
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
let recordsUsageSummary = null;
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
let pendingTransferRecordingId = "";
let recordingTransferMode = "workspace";
let pendingExternalTransferInvitation = null;
let pendingDeleteRecordingId = "";
let detailPlayerUrl = "";
let pendingReferencePreviewUrl = "";
let pendingReferencePreviewId = "";
let detailReferencePreviewUrl = "";
let detailReferencePreviewReferenceId = "";
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
let recordingWakeLock = null;
let recordingWakeLockWanted = false;
let recordingCaptureEndHandled = false;
let recordingChunkManager = null;
let recordingChunkEnqueueChain = Promise.resolve();
let recordingChunkSummarySaveChain = Promise.resolve();
let recordingCaptureSessionId = "";
let recordingChunkStartedAt = null;
let pendingRecordedChunkBytes = 0;
let chunkedRecordingReadyToSave = false;
let activeInterruptionId = "";
let activeInterruptionNumber = 0;
let recordingWasInterrupted = false;
let recordingAutoRecoveryAttempted = false;
let recordingStopRequested = false;
let microphoneMuteTimer = null;
let recordingInterruptionPromise = Promise.resolve();
let recordingInterruptionCreation = null;
let recordingProcessingPollTimer = null;
let activeProcessingStartedAt = null;

function isIgnorableStorageDeleteError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not found") || message.includes("no such object") || message.includes("does not exist");
}
let phoneMeetingSettings = null;
let activePhoneMeetingSession = null;
let phoneMeetingPollTimer = null;
let phoneMeetingPollInFlight = false;
let lastPhoneMeetingStatus = "";
let phoneMeetingAutoSavedSessionId = "";
let phoneMeetingTranscriptionPromise = null;
let phoneMeetingTranscriptionRecordingId = "";

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

function getMeetingCaptureMode() {
  if (meetingSourceUpload?.checked) return "upload";
  if (meetingSourceBoth?.checked) return "both";
  if (meetingSourcePhone?.checked) return "phone";
  return "app";
}

function meetingUsesBrowserSource() {
  const mode = getMeetingCaptureMode();
  return mode === "app" || mode === "both" || mode === "upload";
}

function meetingUsesMicrophoneSource() {
  const mode = getMeetingCaptureMode();
  return mode === "app" || mode === "both";
}

function meetingUsesPhoneSource() {
  const mode = getMeetingCaptureMode();
  return mode === "phone" || mode === "both";
}

function setMeetingCaptureMode(mode = "app") {
  const nextMode = ["phone", "app", "both", "upload"].includes(mode) ? mode : "app";
  if (meetingSourcePhone) meetingSourcePhone.checked = nextMode === "phone";
  if (meetingSourceBrowser) meetingSourceBrowser.checked = nextMode === "app";
  if (meetingSourceBoth) meetingSourceBoth.checked = nextMode === "both";
  if (meetingSourceUpload) meetingSourceUpload.checked = nextMode === "upload";
}

function setMeetingSourceOptionAvailability(input, enabled) {
  if (!input) return;
  input.disabled = !enabled;
  input.closest(".meeting-source-option")?.classList.toggle("is-unavailable", !enabled);
}

function getMeetingSourcePreferences(overrides = {}) {
  const captureMode = getMeetingCaptureMode();
  return {
    capture_mode: captureMode,
    browser_microphone: meetingUsesMicrophoneSource(),
    phone_call: meetingUsesPhoneSource(),
    uploaded_audio: captureMode === "upload",
    ...overrides,
  };
}

function getMeetingSourceMetadata(source, overrides = {}) {
  return {
    source,
    meeting_sources: getMeetingSourcePreferences(overrides),
  };
}

function phoneMeetingsEnabledForLibrary() {
  return Boolean(
    phoneMeetingSettings?.feature_enabled &&
    ["ready_for_internal_test", "active"].includes(String(phoneMeetingSettings?.activation_status || "")) &&
    phoneMeetingSettings?.primary_phone_number
  );
}

function canStartPhoneMeetings() {
  if (!phoneMeetingsEnabledForLibrary()) return false;
  const capabilities = getActiveCapabilities();
  if (capabilities.isPlatformAdmin || activeMembership?.organization?.owner_user_id === currentSession?.user?.id) return true;
  const allowedRoles = Array.isArray(phoneMeetingSettings?.allowed_start_roles)
    ? phoneMeetingSettings.allowed_start_roles
    : ["account_admin", "editor"];
  return allowedRoles.includes(capabilities.role);
}

function phoneMeetingsAreActive() {
  return canStartPhoneMeetings();
}

function renderPhoneMeetingSourceAvailability() {
  if (!meetingSourceNote) return;
  if (!phoneMeetingsEnabledForLibrary()) {
    meetingSourceNote.textContent = "Phone calling is not active for this library yet. App recording and uploads are still available.";
    return;
  }
  if (!canStartPhoneMeetings()) {
    meetingSourceNote.textContent = "Phone Meetings is enabled for this library, but your role is not allowed to start calls. App recording and uploads are still available.";
    return;
  }
  const mode = getMeetingCaptureMode();
  if (mode === "phone") {
    meetingSourceNote.textContent = "Only the phone call will be attached to this meeting note.";
    return;
  }
  if (mode === "both") {
    meetingSourceNote.textContent = "Phone and app audio will stay together in this one meeting note.";
    return;
  }
  if (mode === "upload") {
    meetingSourceNote.textContent = "Upload an existing recording and keep it with this meeting note.";
    return;
  }
  meetingSourceNote.textContent = "App recording is selected. Choose Both when you also need a phone call in this meeting.";
}

function renderMeetingCaptureUi() {
  const phoneAvailable = phoneMeetingsAreActive();
  if (!phoneAvailable && meetingUsesPhoneSource()) {
    setMeetingCaptureMode("app");
  }
  setMeetingSourceOptionAvailability(meetingSourcePhone, phoneAvailable);
  setMeetingSourceOptionAvailability(meetingSourceBoth, phoneAvailable);
  [meetingSourcePhone, meetingSourceBrowser, meetingSourceBoth, meetingSourceUpload].forEach((input) => {
    input?.closest(".meeting-source-option")?.classList.toggle("is-selected", Boolean(input.checked));
  });
  show(browserRecordingWorkflow, meetingUsesBrowserSource());
  renderPhoneMeetingSourceAvailability();
  renderPhoneMeetingSession();
  updateControls();
}

function getPhoneMeetingStatusDetails(session = activePhoneMeetingSession) {
  const status = String(session?.status || "draft").toLowerCase();
  const details = {
    draft: {
      label: "Waiting for call",
      copy: "Dial the number and enter the meeting code when prompted.",
      upload: "Waiting for call",
    },
    connecting: {
      label: "Call connected",
      copy: "The caller is connected. Recording will begin after consent is confirmed.",
      upload: "Call connected",
    },
    in_progress: {
      label: "Recording phone meeting",
      copy: "The call is connected and audio is being recorded. Hang up when the meeting is finished.",
      upload: "Recording",
    },
    copying_to_storage: {
      label: "Call ended",
      copy: "The call has ended. N3XRA is securing the recording in this library.",
      upload: "Securing recording",
    },
    recording_ready: {
      label: "Recording saved",
      copy: "The call ended and its recording is safely attached to this meeting note.",
      upload: "Recording saved",
    },
    ready: {
      label: "Meeting completed",
      copy: "This meeting note was completed without a phone recording.",
      upload: "No recording",
    },
    failed: {
      label: "Recording needs attention",
      copy: session?.twilio_recording_sid
        ? "The call ended, but the recording transfer did not finish. Retry the transfer or complete the note after resolving the recording."
        : "The call ended without a usable recording. You can complete the meeting note without audio.",
      upload: "Transfer failed",
    },
    canceled: {
      label: "Call ended without recording",
      copy: "Recording was not started. You can complete this meeting note without audio.",
      upload: "No recording",
    },
    void: {
      label: "Phone meeting closed",
      copy: "This phone meeting is no longer active.",
      upload: "No recording",
    },
  };
  return { status, ...(details[status] || details.draft) };
}

function stopPhoneMeetingPolling() {
  if (phoneMeetingPollTimer) window.clearInterval(phoneMeetingPollTimer);
  phoneMeetingPollTimer = null;
  phoneMeetingPollInFlight = false;
}

function shouldOfferPhoneTransferRetry(session = activePhoneMeetingSession) {
  if (!session?.twilio_recording_sid) return false;
  const status = String(session.status || "").toLowerCase();
  if (status === "failed") return true;
  if (status !== "copying_to_storage") return false;
  const updatedAt = Date.parse(String(session.updated_at || ""));
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > 10000;
}

function canCompletePhoneMeetingWithoutRecording(session = activePhoneMeetingSession) {
  if (!session || session.twilio_recording_sid) return false;
  const status = String(session.status || "draft").toLowerCase();
  if (["draft", "failed", "canceled"].includes(status)) return true;
  if (status !== "copying_to_storage") return false;
  const endedAt = Date.parse(String(session.ended_at || ""));
  return Number.isFinite(endedAt) && Date.now() - endedAt > 30000;
}

function canEndPhoneMeeting(session = activePhoneMeetingSession) {
  if (!session?.twilio_call_sid || session.end_requested) return false;
  return ["connecting", "in_progress"].includes(String(session.status || "").toLowerCase());
}

function renderPhoneMeetingSession() {
  const showPhoneStart = Boolean(meetingUsesPhoneSource() && phoneMeetingsAreActive());
  show(phoneMeetingStart, showPhoneStart);
  if (!showPhoneStart || !activePhoneMeetingSession) {
    show(startPhoneMeetingButton, showPhoneStart);
    show(phoneMeetingDialIn, false);
    show(endPhoneMeetingButton, false);
    show(retryPhoneMeetingTransferButton, false);
    show(completePhoneMeetingWithoutRecordingButton, false);
    return;
  }
  show(startPhoneMeetingButton, false);
  phoneMeetingNumber.textContent = activePhoneMeetingSession.dial_in_number || "-";
  phoneMeetingCode.textContent = activePhoneMeetingSession.meeting_code || "-";
  const expiry = activePhoneMeetingSession.expires_at ? new Date(activePhoneMeetingSession.expires_at) : null;
  phoneMeetingExpires.textContent = expiry && !Number.isNaN(expiry.getTime())
    ? `Enter this code when prompted. It expires ${expiry.toLocaleString()}. Merge this call into an existing phone call when needed.`
    : "Enter this code when prompted. Merge this call into an existing phone call when needed.";
  const statusDetails = getPhoneMeetingStatusDetails();
  if (phoneMeetingState) phoneMeetingState.textContent = statusDetails.label;
  if (phoneMeetingStateCopy) phoneMeetingStateCopy.textContent = statusDetails.copy;
  show(endPhoneMeetingButton, canEndPhoneMeeting());
  show(retryPhoneMeetingTransferButton, shouldOfferPhoneTransferRetry());
  show(completePhoneMeetingWithoutRecordingButton, canCompletePhoneMeetingWithoutRecording());
  show(phoneMeetingDialIn, true);
}

async function refreshPhoneMeetingStatus() {
  const sessionId = activePhoneMeetingSession?.session_id || activePhoneMeetingSession?.id;
  if (!sessionId || !supabase || phoneMeetingPollInFlight) return;
  phoneMeetingPollInFlight = true;
  try {
    const { data, error } = await supabase
      .from("phone_meeting_sessions")
      .select("id, meeting_recording_id, status, started_at, ended_at, duration_seconds, twilio_call_sid, twilio_recording_sid, failure_code, created_at, updated_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;

    const priorStatus = String(activePhoneMeetingSession?.status || "draft").toLowerCase();
    activePhoneMeetingSession = {
      ...activePhoneMeetingSession,
      ...data,
      session_id: data.id,
    };
    const nextDetails = getPhoneMeetingStatusDetails(activePhoneMeetingSession);
    renderPhoneMeetingSession();
    uploadStateValue.textContent = nextDetails.upload;

    if (nextDetails.status !== priorStatus || nextDetails.status !== lastPhoneMeetingStatus) {
      lastPhoneMeetingStatus = nextDetails.status;
      if (nextDetails.status === "connecting") {
        setRecorderState("Connected", "The phone caller is connected and completing the recording notice.");
        setStatus(recordingStatus, "Phone call connected.", "success");
      } else if (nextDetails.status === "in_progress") {
        setRecorderState("Recording", "Phone capture is active. Hang up when the meeting is complete.");
        setStatus(recordingStatus, "Phone meeting recording is in progress.", "success");
      } else if (nextDetails.status === "copying_to_storage") {
        setRecorderState("Saving", "The call ended. Securing its recording in this library.");
        await savePhoneMeetingAfterCallEnd();
        setStatus(recordingStatus, "Call ended and meeting saved. Securing the phone recording...");
      } else if (nextDetails.status === "recording_ready") {
        await savePhoneMeetingAfterCallEnd();
        setRecorderState("Saved", "The phone recording is attached to this meeting note.");
        setStatus(
          recordingStatus,
          getMeetingCaptureMode() === "phone"
            ? "Phone recording saved. Review the meeting and select Finish meeting note when you are ready."
            : "Phone recording saved. Finish the app recording when your notes are ready.",
          "success"
        );
        await loadRecordings();
        await ensurePhoneMeetingTranscription(activeRecordingId);
      } else if (nextDetails.status === "failed") {
        setRecorderState("Needs attention", nextDetails.copy);
        setStatus(recordingStatus, nextDetails.copy, "error");
        await loadRecordings();
      } else if (["canceled", "ready"].includes(nextDetails.status)) {
        setRecorderState("No recording", nextDetails.copy);
        setStatus(recordingStatus, nextDetails.copy);
        await loadRecordings();
      }
    }
    updateControls();
  } catch (error) {
    console.warn("Unable to refresh phone meeting status", error);
    if (["copying_to_storage", "recording_ready"].includes(String(activePhoneMeetingSession?.status || "").toLowerCase())) {
      lastPhoneMeetingStatus = "";
    }
    setStatus(recordingStatus, getErrorMessage(error, "The call ended, but the latest meeting changes could not be saved automatically."), "error");
  } finally {
    phoneMeetingPollInFlight = false;
  }
}

function startPhoneMeetingPolling() {
  stopPhoneMeetingPolling();
  if (!activePhoneMeetingSession) return;
  void refreshPhoneMeetingStatus();
  phoneMeetingPollTimer = window.setInterval(() => {
    void refreshPhoneMeetingStatus();
  }, 2500);
}

async function recoverRecentPhoneMeetingSession() {
  const organization = getActiveOrganization();
  if (!organization?.id || !currentSession?.user?.id || !phoneMeetingsAreActive() || activePhoneMeetingSession) return;
  const recentCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("phone_meeting_sessions")
    .select("id, meeting_recording_id, status, started_at, ended_at, duration_seconds, twilio_call_sid, twilio_recording_sid, failure_code, metadata, created_at, updated_at")
    .eq("organization_id", organization.id)
    .eq("requested_by_user_id", currentSession.user.id)
    .in("status", ["draft", "connecting", "in_progress", "copying_to_storage", "recording_ready", "failed", "canceled"])
    .gte("created_at", recentCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.meeting_recording_id) return;

  const metadata = data.metadata || {};
  activePhoneMeetingSession = {
    ...data,
    session_id: data.id,
    dial_in_number: phoneMeetingSettings?.primary_phone_number || "",
    meeting_code: metadata.dial_in_code || "",
    expires_at: metadata.dial_in_expires_at || "",
  };
  activeRecordingId = data.meeting_recording_id;
  setMeetingCaptureMode("phone");

  const recording = getRecordingById(activeRecordingId);
  if (recording) {
    recordingTitleInput.value = recording.title || "";
    recordingTemplateSelect.value = recording.selected_template_id || BLANK_NOTES_TEMPLATE_VALUE;
    recordingNotesInput.value = recording.notes_plain_text || "";
  }

  lastPhoneMeetingStatus = "";
  renderMeetingCaptureUi();
  setRecordPanelOpen(true);
  startPhoneMeetingPolling();
}

async function loadPhoneMeetingSettings() {
  const organization = getActiveOrganization();
  phoneMeetingSettings = null;
  if (!organization?.id || !supabase) {
    renderMeetingCaptureUi();
    return;
  }

  const { data, error } = await supabase
    .from("organization_phone_meeting_settings")
    .select("feature_enabled, activation_status, primary_phone_number, allowed_start_roles")
    .eq("organization_id", organization.id)
    .maybeSingle();

  // The Phone Meetings foundation can be deployed independently of this page.
  // Keep normal meeting notes usable when the optional table is not present yet.
  if (!error) phoneMeetingSettings = data || null;
  renderMeetingCaptureUi();
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
  window.clearTimeout(meetingWorkspaceActionsRevealTimer);
  meetingWorkspaceActions?.classList.remove("is-revealed");
  show(recordPanelBody, nextOpen);
  show(meetingEditorEmpty, !nextOpen);
  recordPanelToggle.classList.toggle("is-open", nextOpen);
  recordPanelToggle.setAttribute("aria-expanded", String(nextOpen));
  const indicator = recordPanelToggle.querySelector(".section-toggle-indicator");
  if (indicator) indicator.textContent = nextOpen ? "-" : "+";
  const actionLabel = recordPanelToggle.querySelector(".meeting-note-toggle-label");
  if (actionLabel) actionLabel.textContent = nextOpen ? "Close" : "Start";

  if (nextOpen) {
    meetingWorkspaceActionsRevealTimer = window.setTimeout(() => {
      meetingWorkspaceActions?.classList.add("is-revealed");
    }, 180);
  }

  if (nextOpen && options.scroll) {
    recordPanelToggle.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (nextOpen && options.focus) {
    window.setTimeout(() => recordingTitleInput?.focus({ preventScroll: true }), 120);
  }
}

function cancelMeetingNoteDraft() {
  const recorderState = mediaRecorder?.state || "inactive";
  const hasActiveCapture = ["recording", "paused"].includes(recorderState);
  if (isRecordingWorkflowActive || hasActiveCapture || activePhoneMeetingSession || hasUnsavedRecordingAudio() || hasPendingUploadedAudio()) {
    setStatus(recordingStatus, "Finish or save the active audio before closing this meeting.", "error");
    return;
  }

  recordingTitleInput.value = "";
  recordingTemplateSelect.value = "";
  recordingNotesInput.value = "";
  setMeetingCaptureMode("app");
  clearPendingReferences();
  clearPendingRecordedAudio();
  clearPendingUploadedAudio();
  clearRecorderStats();
  setStatus(recordingStatus, "");
  setRecorderState("", "Ready to create a new meeting note.");
  renderMeetingCaptureUi();
  setRecordPanelOpen(false);
}

function initMeetingWorkspaceActionsDocking() {
  if (!meetingWorkspaceActionsSlot || !meetingWorkspaceActions || !meetingWorkspaceActionsAnchor) return;

  const scrollingElement = meetingWorkspaceActions.closest(".records-desktop-frame > .main");
  const scrollTarget = scrollingElement || window;
  let updateFrame = 0;

  const updateDocking = () => {
    updateFrame = 0;
    const actionHeight = meetingWorkspaceActions.offsetHeight;
    meetingWorkspaceActionsSlot.style.height = `${actionHeight}px`;

    const viewportRight = document.documentElement.clientWidth;
    const workspaceRect = recordPanel?.getBoundingClientRect();
    const formRect = recordPanelBody?.getBoundingClientRect();
    const workspaceLeft = Math.max(0, workspaceRect?.left || 0);
    const formLeft = Math.max(workspaceLeft, formRect?.left || workspaceLeft);
    const formRight = Math.min(viewportRight, formRect?.right || viewportRight);

    meetingWorkspaceActions.style.setProperty("--action-dock-left", `${workspaceLeft}px`);
    meetingWorkspaceActions.style.setProperty(
      "--action-dock-content-left",
      `${Math.max(16, formLeft - workspaceLeft)}px`,
    );
    meetingWorkspaceActions.style.setProperty(
      "--action-dock-content-right",
      `${Math.max(16, viewportRight - formRight)}px`,
    );

    const viewportBottom = scrollingElement
      ? scrollingElement.getBoundingClientRect().bottom
      : window.innerHeight;
    const restingEdge = meetingWorkspaceActionsAnchor.getBoundingClientRect().top;
    const fadeDistance = Math.max(128, actionHeight * 1.6);
    const distanceFromRest = Math.max(0, restingEdge - viewportBottom);
    const floatingOpacity = Math.min(1, distanceFromRest / fadeDistance);

    meetingWorkspaceActions.style.setProperty("--action-dock-opacity", floatingOpacity.toFixed(3));
    meetingWorkspaceActions.classList.toggle("is-docked", distanceFromRest <= 1);
  };

  const queueDockingUpdate = () => {
    if (updateFrame) return;
    updateFrame = window.requestAnimationFrame(updateDocking);
  };

  scrollTarget.addEventListener("scroll", queueDockingUpdate, { passive: true });
  window.addEventListener("resize", queueDockingUpdate, { passive: true });
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(queueDockingUpdate);
    resizeObserver.observe(recordPanel);
    resizeObserver.observe(recordPanelBody);
    resizeObserver.observe(meetingWorkspaceActionsSlot);
    resizeObserver.observe(meetingWorkspaceActions);
  }

  queueDockingUpdate();
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
    message.includes("processing_progress") ||
    message.includes("processing_stage") ||
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

function renderPendingReferences() {
  renderReferenceSelect(recordingReferenceSelect, pendingMeetingReferences);
  renderReferenceList(recordingReferenceList, recordingReferenceEmpty, pendingMeetingReferences, { canRemove: true });
  if (recordingReferenceAdd) recordingReferenceAdd.disabled = !recordingReferenceSelect?.value;
  void previewPendingReferenceDocument(pendingMeetingReferences[0] || null);
}

function clearPendingReferencePreview() {
  if (recordingReferenceFrame) recordingReferenceFrame.removeAttribute("src");
  show(recordingReferencePreview, false);
  show(recordingReferenceList, true);
  pendingReferencePreviewId = "";
  if (pendingReferencePreviewUrl) {
    URL.revokeObjectURL(pendingReferencePreviewUrl);
    pendingReferencePreviewUrl = "";
  }
}

async function previewPendingReferenceDocument(reference) {
  clearPendingReferencePreview();
  if (!reference?.app_document_id || !recordingReferencePreview || !recordingReferenceFrame) return;
  const doc = reference.app_document || getReferenceDocument(reference.app_document_id);
  if (recordingReferencePreviewType) {
    recordingReferencePreviewType.textContent = getReferenceTypeLabel(reference.reference_type);
  }
  if (recordingReferencePreviewTitle) {
    recordingReferencePreviewTitle.textContent = doc?.title || "Referenced document";
  }
  if (recordingReferencePreviewOpen) {
    recordingReferencePreviewOpen.href = `/n3xra-records/documents.html?id=${encodeURIComponent(reference.app_document_id)}`;
  }
  if (recordingReferencePreviewRemove) {
    recordingReferencePreviewRemove.dataset.referenceRemoveId = reference.id || reference.app_document_id;
  }
  pendingReferencePreviewId = reference.app_document_id;
  show(recordingReferencePreview, true);
  show(recordingReferenceList, false);
  try {
    pendingReferencePreviewUrl = await createAppDocumentPdfObjectUrl({
      config: getConfig(),
      accessToken: currentSession?.access_token || "",
      documentId: reference.app_document_id,
    });
    recordingReferenceFrame.src = pendingReferencePreviewUrl;
  } catch (error) {
    recordingReferenceFrame.removeAttribute("src");
    setStatus(recordingStatus, getErrorMessage(error, "Unable to preview referenced document."), "error");
  }
}

function clearPendingReferences() {
  pendingMeetingReferences = [];
  if (recordingReferenceSelect) recordingReferenceSelect.value = "";
  if (recordingReferenceType) recordingReferenceType.value = "agenda";
  clearPendingReferencePreview();
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
    activeMembership?.isSupportView ? false : isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function canRecordInActiveOrganization() {
  const capabilities = getActiveCapabilities();
  return Boolean(getActiveOrganization()) && capabilities.canManageDocuments && capabilities.canUseRecordings;
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

async function loadRecordsUsage() {
  const organization = getActiveOrganization();
  recordsUsageSummary = null;
  if (!organization?.id) return null;

  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) return null;
    const response = await fetch(`/api/records-usage?organizationId=${encodeURIComponent(organization.id)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    recordsUsageSummary = data?.usage || null;
  } catch (_error) {
    recordsUsageSummary = null;
  }

  return recordsUsageSummary;
}

function getStorageUploadBlockMessage(fileSize) {
  const organization = getActiveOrganization();
  const summary = recordsUsageSummary?.organizationId === organization?.id ? recordsUsageSummary : null;
  if (!summary?.metrics?.storage) return "";
  const uploadBytes = Math.max(0, Number(fileSize || 0));
  if (!uploadBytes) return "";
  const storage = summary.metrics.storage;
  if (storage.limit > 0 && storage.used + uploadBytes > storage.limit) {
    return `This recording would exceed the ${formatBytes(storage.limit)} storage limit for this library. ${formatBytes(storage.remaining)} remains; this recording is ${formatBytes(uploadBytes)}.`;
  }
  return "";
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

function processingStageLabel(stage) {
  if (stage === "uploading") return "Uploading saved audio";
  if (stage === "assembling") return "Assembling recording";
  if (stage === "transcribing") return "Creating transcript";
  if (stage === "complete") return "Meeting note complete";
  if (stage === "failed") return "Processing needs attention";
  return "Preparing meeting note";
}

function formatProcessingTime(seconds) {
  const value = Math.max(Math.round(Number(seconds || 0)), 0);
  if (value < 60) return `${Math.max(value, 1)}s`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function setRecordingProcessingProgress(progress, stage, startedAt = null) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress || 0))));
  if (startedAt) activeProcessingStartedAt = new Date(startedAt);
  if (!activeProcessingStartedAt || Number.isNaN(activeProcessingStartedAt.getTime())) activeProcessingStartedAt = new Date();
  if (recordingProcessingProgressFill) recordingProcessingProgressFill.style.width = `${percent}%`;
  if (recordingProcessingProgress) {
    recordingProcessingProgress.setAttribute("aria-valuenow", String(percent));
    recordingProcessingProgress.setAttribute("aria-valuetext", `${processingStageLabel(stage)}, ${percent}%`);
  }
  const elapsedSeconds = Math.max((Date.now() - activeProcessingStartedAt.getTime()) / 1000, 1);
  const remainingSeconds = percent >= 8 && percent < 100
    ? Math.min(Math.round((elapsedSeconds / percent) * (100 - percent)), 20 * 60)
    : 0;
  const etaCopy = remainingSeconds ? ` · About ${formatProcessingTime(remainingSeconds)} remaining` : "";
  uploadProgressCopy.textContent = `${processingStageLabel(stage)} · ${percent}%${etaCopy}`;
  show(uploadProgressShell, percent < 100 || stage === "complete");
}

function stopRecordingProcessingPolling() {
  if (recordingProcessingPollTimer) window.clearInterval(recordingProcessingPollTimer);
  recordingProcessingPollTimer = null;
}

function startRecordingProcessingPolling(recordingId) {
  stopRecordingProcessingPolling();
  const poll = async () => {
    const { data, error } = await supabase
      .from("meeting_recordings")
      .select("id,status,transcript_status,processing_stage,processing_progress,processing_started_at,processing_updated_at,processing_completed_at,processing_error")
      .eq("id", recordingId)
      .maybeSingle();
    if (error || !data) return;
    mergeRecordingUpdate(data);
    setRecordingProcessingProgress(data.processing_progress, data.processing_stage, data.processing_started_at);
    if (["complete", "failed"].includes(data.processing_stage)) stopRecordingProcessingPolling();
  };
  void poll();
  recordingProcessingPollTimer = window.setInterval(() => void poll(), 1500);
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
  stopRecordingProcessingPolling();
  activeProcessingStartedAt = null;
  if (recordingProcessingProgressFill) recordingProcessingProgressFill.style.width = "0%";
  if (recordingProcessingProgress) recordingProcessingProgress.setAttribute("aria-valuenow", "0");
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

  const browserSourceEnabled = meetingUsesBrowserSource();
  const microphoneSourceEnabled = meetingUsesMicrophoneSource();
  const uploadSourceEnabled = meetingSourceUpload
    ? getMeetingCaptureMode() === "upload"
    : browserSourceEnabled;
  const phoneSourceEnabled = meetingUsesPhoneSource();

  startRecordingButton.disabled = !canUseRecorder || !microphoneSourceEnabled || hasActiveSession || recordingWasInterrupted || hasPendingUpload || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
  uploadRecordingButton.disabled = !canUseRecorder || !uploadSourceEnabled || hasActiveSession;
  uploadRecordingButton.textContent = hasPendingUpload ? "Change audio" : "Upload recording";
  show(startRecordingButton, microphoneSourceEnabled && !hasActiveSession && !recordingWasInterrupted && !hasPendingUpload);
  show(uploadRecordingButton, uploadSourceEnabled && !hasActiveSession);
  pauseRecordingButton.disabled = !isCaptureActive || !pauseSupported;
  pauseRecordingButton.textContent = recorderState === "paused" ? "Resume recording" : "Pause recording";
  stopRecordingButton.disabled = !isCaptureActive;
  show(pauseRecordingButton, isCaptureActive && pauseSupported);
  show(stopRecordingButton, isCaptureActive);
  if (resumeRecordingButton) {
    show(resumeRecordingButton, recordingWasInterrupted && !isCaptureActive && Boolean(activeRecordingId));
    resumeRecordingButton.disabled = isRecordingWorkflowActive || !navigator.mediaDevices?.getUserMedia;
  }
  if (saveRecordingButton) {
    saveRecordingButton.disabled = !canSaveMeetingNote || isRecordingWorkflowActive || isCaptureActive;
    saveRecordingButton.textContent = activePhoneMeetingSession?.status === "recording_ready"
      ? "Finish meeting note"
      : hasPendingRecording || hasPendingUpload
        ? "Save meeting note"
        : "Save draft";
    show(saveRecordingButton, !isCaptureActive);
  }
  if (startRecordingButton) startRecordingButton.textContent = "Start app recording";
  if (startPhoneMeetingButton) {
    startPhoneMeetingButton.disabled = !canSaveMeetingNote || !phoneSourceEnabled || !phoneMeetingsAreActive() || isRecordingWorkflowActive || hasPendingUpload;
    startPhoneMeetingButton.textContent = getMeetingCaptureMode() === "both"
      ? "Start phone connection"
      : "Start phone meeting";
  }
  if (retryPhoneMeetingTransferButton) {
    retryPhoneMeetingTransferButton.disabled = isRecordingWorkflowActive || !shouldOfferPhoneTransferRetry();
  }
  if (completePhoneMeetingWithoutRecordingButton) {
    completePhoneMeetingWithoutRecordingButton.disabled = isRecordingWorkflowActive || !canCompletePhoneMeetingWithoutRecording();
  }
  if (endPhoneMeetingButton) {
    endPhoneMeetingButton.disabled = isRecordingWorkflowActive || !canEndPhoneMeeting();
  }
  if (cancelMeetingNoteButton) {
    cancelMeetingNoteButton.disabled = isRecordingWorkflowActive || isCaptureActive || Boolean(activePhoneMeetingSession) || hasPendingRecording || hasPendingUpload;
  }
  recordPanel?.classList.toggle("has-active-capture", hasActiveSession || Boolean(activePhoneMeetingSession) || hasPendingUpload);
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

function isRecoverableBrowserRecording(recording) {
  const status = String(recording?.status || "").trim().toLowerCase();
  return recording?.created_by_user_id === currentSession?.user?.id &&
    ["recording", "interrupted", "recorded", "finalizing"].includes(status);
}

function hasUnsavedRecordingAudio() {
  return Boolean(activeRecordingId && (pendingRecordedBlob || chunkedRecordingReadyToSave));
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

function setRecordingDeleteModalOpen(isOpen) {
  recordingDeleteModal.classList.toggle("is-open", isOpen);
  recordingDeleteModal.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    setStatus(recordingDeleteStatus, "");
    pendingDeleteRecordingId = "";
  }
}

function getRecordPacketTransferDestinations() {
  const activeOrganizationId = getActiveOrganization()?.id || "";
  return memberships.filter((membership) => (
    membership.organization?.id &&
    membership.organization.id !== activeOrganizationId &&
    membership.organization.subscription_tier === "organization" &&
    ["active", "trialing"].includes(String(membership.organization.account_status || "active")) &&
    getMembershipRole(membership) === "account_admin"
  ));
}

function canTransferRecordPacket(recording) {
  if (!recording || getMembershipRole(activeMembership) !== "account_admin") return false;
  return !["recording", "interrupted", "uploading", "finalizing", "transcribing"].includes(String(recording.status || "")) &&
    !["queued", "processing"].includes(String(recording.transcript_status || "")) &&
    String(recording.ai_review_status || "") !== "processing";
}

function setRecordingTransferMode(mode) {
  recordingTransferMode = mode === "external" ? "external" : "workspace";
  const isWorkspace = recordingTransferMode === "workspace";
  recordingTransferModeWorkspace?.classList.toggle("is-active", isWorkspace);
  recordingTransferModeWorkspace?.setAttribute("aria-selected", String(isWorkspace));
  recordingTransferModeExternal?.classList.toggle("is-active", !isWorkspace);
  recordingTransferModeExternal?.setAttribute("aria-selected", String(!isWorkspace));
  show(recordingTransferWorkspacePanel, isWorkspace);
  show(recordingTransferExternalPanel, !isWorkspace);
  if (recordingTransferSubmit) {
    recordingTransferSubmit.textContent = isWorkspace ? "Move record packet" : "Send transfer invitation";
    recordingTransferSubmit.disabled = !isWorkspace && Boolean(pendingExternalTransferInvitation);
  }
  setStatus(recordingTransferStatus, "");
}

function renderPendingExternalTransfer(invitation) {
  pendingExternalTransferInvitation = invitation?.status === "pending" ? invitation : null;
  show(recordingTransferPending, Boolean(pendingExternalTransferInvitation));
  if (recordingTransferPendingCopy && pendingExternalTransferInvitation) {
    recordingTransferPendingCopy.textContent = `Sent to ${pendingExternalTransferInvitation.recipient_email}. It expires ${formatDateTime(pendingExternalTransferInvitation.expires_at)}.`;
  }
  if (recordingTransferRecipientEmail) recordingTransferRecipientEmail.disabled = Boolean(pendingExternalTransferInvitation);
  if (recordingTransferRecipientOrganization) recordingTransferRecipientOrganization.disabled = Boolean(pendingExternalTransferInvitation);
  if (recordingTransferSubmit && recordingTransferMode === "external") {
    recordingTransferSubmit.disabled = Boolean(pendingExternalTransferInvitation);
  }
}

async function invokeRecordPacketTransfer(body) {
  const { data, error } = await supabase.functions.invoke("transfer-record-packet", { body });
  if (error) {
    const payload = await error.context?.json?.().catch(() => ({}));
    throw new Error(payload?.error || error.message || "Unable to reach the transfer service.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadExternalTransferInvitation(recordingId) {
  renderPendingExternalTransfer(null);
  const data = await invokeRecordPacketTransfer({ action: "list", recordingId });
  const pending = (data?.invitations || []).find((invitation) => invitation.status === "pending") || null;
  renderPendingExternalTransfer(pending);
}

function setRecordingTransferModalOpen(isOpen) {
  recordingTransferModal?.classList.toggle("is-open", isOpen);
  recordingTransferModal?.setAttribute("aria-hidden", String(!isOpen));
  if (!isOpen) {
    pendingTransferRecordingId = "";
    pendingExternalTransferInvitation = null;
    if (recordingTransferRecipientEmail) recordingTransferRecipientEmail.value = "";
    if (recordingTransferRecipientOrganization) recordingTransferRecipientOrganization.value = "";
    setStatus(recordingTransferStatus, "");
  }
}

function promptTransferRecordPacket(recordingId) {
  const recording = getRecordingById(recordingId);
  const destinations = getRecordPacketTransferDestinations();
  if (!canTransferRecordPacket(recording)) return;
  pendingTransferRecordingId = recording.id;
  recordingTransferCopy.textContent = `Move "${recording.title || "Untitled meeting note"}" and its complete record packet out of ${getActiveOrganization()?.name || "this workspace"}.`;
  if (destinations.length) {
    recordingTransferDestination.innerHTML = destinations.map((membership) => (
      `<option value="${escapeHtml(membership.organization.id)}">${escapeHtml(membership.organization.name || "Untitled library")}</option>`
    )).join("");
    recordingTransferDestination.disabled = false;
    recordingTransferWorkspaceNote.textContent = "You must be an Account Admin in both workspaces. Existing share links are revoked.";
  } else {
    recordingTransferDestination.innerHTML = '<option value="">No other eligible workspaces</option>';
    recordingTransferDestination.disabled = true;
    recordingTransferWorkspaceNote.textContent = "No other active Organization workspace is connected to this login. Use the other-organization option instead.";
  }
  setRecordingTransferMode(destinations.length ? "workspace" : "external");
  setRecordingTransferModalOpen(true);
  void loadExternalTransferInvitation(recording.id).catch((error) => {
    setStatus(recordingTransferStatus, getErrorMessage(error, "Unable to check transfer invitations."), "error");
  });
}

async function sendExternalRecordPacketTransfer(recordingId) {
  const recipientEmail = String(recordingTransferRecipientEmail?.value || "").trim();
  const recipientOrganizationName = String(recordingTransferRecipientOrganization?.value || "").trim();
  if (!recipientEmail || !recordingTransferRecipientEmail?.checkValidity()) {
    recordingTransferRecipientEmail?.focus();
    recordingTransferRecipientEmail?.reportValidity();
    return;
  }
  recordingTransferSubmit.disabled = true;
  recordingTransferCancel.disabled = true;
  setStatus(recordingTransferStatus, "Sending secure transfer invitation...");
  try {
    const data = await invokeRecordPacketTransfer({ action: "create", recordingId, recipientEmail, recipientOrganizationName });
    renderPendingExternalTransfer(data.invitation);
    setStatus(recordingTransferStatus, `Transfer invitation sent to ${recipientEmail}. The packet has not moved yet.`, "success");
  } catch (error) {
    setStatus(recordingTransferStatus, getErrorMessage(error, "Unable to send the transfer invitation."), "error");
    recordingTransferSubmit.disabled = false;
  } finally {
    recordingTransferCancel.disabled = false;
  }
}

async function cancelExternalRecordPacketTransfer() {
  if (!pendingExternalTransferInvitation?.id) return;
  recordingTransferCancelInvitation.disabled = true;
  setStatus(recordingTransferStatus, "Cancelling invitation...");
  try {
    await invokeRecordPacketTransfer({ action: "cancel", requestId: pendingExternalTransferInvitation.id });
    renderPendingExternalTransfer(null);
    setStatus(recordingTransferStatus, "Transfer invitation cancelled. The packet stayed in this workspace.", "success");
  } catch (error) {
    setStatus(recordingTransferStatus, getErrorMessage(error, "Unable to cancel the transfer invitation."), "error");
  } finally {
    recordingTransferCancelInvitation.disabled = false;
  }
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
  await recordSupportEvent(supabase, activeMembership?.organization?.id, "content_viewed", "recording", recording.id);
  await recordSupportEvent(supabase, activeMembership?.organization?.id, "signed_link_created", "recording", recording.id);
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

function recordingIsCapturing() {
  return mediaRecorder?.state === "recording" || mediaRecorder?.state === "paused";
}

function handleChunkUploadStatus(state) {
  const labels = {
    saving: "Saving",
    saved: "Saved",
    retrying: "Saving",
    offline: "Connection lost, saving locally",
    local_error: "Recording interrupted",
  };
  uploadStateValue.textContent = labels[state] || "Saving";
  if (state === "offline") {
    setStatus(recordingStatus, "Connection lost. Audio is being saved on this device and will upload when the connection returns.", "error");
  } else if (state === "local_error") {
    setStatus(recordingStatus, "This device could not save the latest audio chunk. Recording has been interrupted to protect the audio already saved.", "error");
  }
}

function persistRecordingChunkSummary(recordingId, summary) {
  const existing = getRecordingById(recordingId);
  const durationSeconds = Math.max(
    normalizeRecordingDurationSeconds(summary?.durationSeconds),
    normalizeRecordingDurationSeconds(existing?.duration_seconds),
    0
  );
  const fileSize = Math.max(Number(summary?.bytes || 0), Number(existing?.file_size || 0), 0);
  if (!recordingId || !Number(summary?.chunkCount || 0)) return Promise.resolve();

  if (activeRecordingId === recordingId) {
    pendingRecordedDurationSeconds = Math.max(pendingRecordedDurationSeconds, durationSeconds);
    pendingRecordedChunkBytes = Math.max(pendingRecordedChunkBytes, fileSize);
  }
  mergeRecordingUpdate({ id: recordingId, duration_seconds: durationSeconds, file_size: fileSize });
  renderRecordings();

  recordingChunkSummarySaveChain = recordingChunkSummarySaveChain
    .catch(() => null)
    .then(() => updateMeetingRecording(recordingId, {
      duration_seconds: durationSeconds,
      file_size: fileSize,
    }));
  return recordingChunkSummarySaveChain;
}

async function initializeRecordingChunkManager(recordingId) {
  recordingChunkManager?.dispose();
  const organization = getActiveOrganization();
  if (!organization || !currentSession?.user) throw new Error("Unable to initialize secure recording recovery.");
  if (recordsUsageSummary?.organizationId !== organization.id) await loadRecordsUsage();
  const storageMetric = recordsUsageSummary?.metrics?.storage;
  const remainingStorage = Number(storageMetric?.remaining || 0);
  const storageAwareMaxBytes = Number(storageMetric?.limit || 0) > 0
    ? Math.min(MAX_RECORDING_AUDIO_BYTES, Math.max(0, Math.floor(remainingStorage / 2)))
    : MAX_RECORDING_AUDIO_BYTES;
  recordingChunkManager = createMeetingRecordingChunkManager({
    supabase,
    bucket: RECORDINGS_BUCKET,
    organizationId: organization.id,
    recordingId,
    userId: currentSession.user.id,
    maxBytes: storageAwareMaxBytes,
    onStatus: handleChunkUploadStatus,
    onProgress: (summary) => {
      void persistRecordingChunkSummary(recordingId, summary).catch(() => null);
    },
    onUploadProgress: (summary) => {
      if (!activeProcessingStartedAt || !summary?.chunkCount) return;
      const uploadProgress = 5 + Math.round((Number(summary.uploadedChunkCount || 0) / summary.chunkCount) * 13);
      setRecordingProcessingProgress(Math.min(uploadProgress, 18), "uploading", activeProcessingStartedAt);
    },
  });
  return recordingChunkManager.initialize();
}

function queueRecordedChunk(blob, capturedEndedAt = new Date()) {
  if (!blob?.size || !recordingChunkManager || !recordingCaptureSessionId) return;
  const capturedStartedAt = recordingChunkStartedAt || recordingStartedAt || capturedEndedAt;
  recordingChunkStartedAt = capturedEndedAt;
  const details = {
    captureSessionId: recordingCaptureSessionId,
    mimeType: blob.type || activeRecordingMimeType || "audio/webm",
    startedAt: capturedStartedAt.toISOString(),
    endedAt: capturedEndedAt.toISOString(),
  };
  recordingChunkEnqueueChain = recordingChunkEnqueueChain
    .then(() => recordingChunkManager?.enqueue(blob, details))
    .catch(() => {
      handleChunkUploadStatus("local_error");
      handleUnexpectedRecordingEnd();
    });
}

async function createRecordingInterruption(reason = "microphone_interrupted") {
  if (!activeRecordingId || activeInterruptionId) return;
  if (recordingInterruptionCreation) return recordingInterruptionCreation;
  recordingInterruptionCreation = (async () => {
    activeInterruptionNumber += 1;
    const payload = {
      meeting_recording_id: activeRecordingId,
      organization_id: getActiveOrganization().id,
      created_by_user_id: currentSession.user.id,
      interruption_number: activeInterruptionNumber,
      reason,
      started_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("meeting_recording_interruptions").insert(payload).select("id").single();
    if (error) throw error;
    activeInterruptionId = data.id;
    await updateMeetingRecording(activeRecordingId, { status: "interrupted", processing_error: null });
  })();
  try {
    await recordingInterruptionCreation;
  } finally {
    recordingInterruptionCreation = null;
  }
}

async function closeRecordingInterruption() {
  if (!activeInterruptionId) return;
  const { error } = await supabase.from("meeting_recording_interruptions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", activeInterruptionId);
  if (error) throw error;
  activeInterruptionId = "";
}

function setRecordingScreenSafety(message) {
  const copy = document.getElementById("recording-screen-safety");
  if (copy) copy.textContent = message;
}

async function requestRecordingWakeLock() {
  recordingWakeLockWanted = true;
  if (!recordingIsCapturing()) return;
  if (!navigator.wakeLock?.request) {
    setRecordingScreenSafety("Keep this screen on and the app open while recording. This browser cannot prevent screen lock.");
    return;
  }
  if (document.visibilityState !== "visible" || recordingWakeLock) return;

  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (!recordingWakeLockWanted || !recordingIsCapturing()) {
      await sentinel.release();
      return;
    }
    recordingWakeLock = sentinel;
    setRecordingScreenSafety("Screen sleep protection is active while recording. Keep this app open; manually locking the device can still interrupt audio.");
    sentinel.addEventListener("release", () => {
      if (recordingWakeLock === sentinel) recordingWakeLock = null;
      if (recordingWakeLockWanted && recordingIsCapturing()) {
        setRecordingScreenSafety("Screen sleep protection was released. Keep this screen on until the recording is stopped.");
      }
    }, { once: true });
  } catch {
    setRecordingScreenSafety("Keep this screen on and the app open while recording. Screen sleep protection is unavailable right now.");
  }
}

function releaseRecordingWakeLock() {
  recordingWakeLockWanted = false;
  const sentinel = recordingWakeLock;
  recordingWakeLock = null;
  if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
  setRecordingScreenSafety("The screen will be kept awake automatically while app recording is active.");
}

function flushActiveRecordingChunk() {
  if (mediaRecorder?.state === "recording") {
    try {
      mediaRecorder.requestData();
    } catch {
      // Some browsers reject requestData while transitioning recorder state.
    }
  }
}

function handleUnexpectedRecordingEnd() {
  if (recordingCaptureEndHandled || !recordingIsCapturing()) return;
  recordingCaptureEndHandled = true;
  recordingWasInterrupted = true;
  recordingAutoRecoveryAttempted = false;
  flushActiveRecordingChunk();
  setRecorderState("Interrupted", "Microphone capture ended. Preserving the audio recorded so far.");
  setStatus(recordingStatus, "Recording was interrupted by the browser or device. Preparing the audio captured so far.", "error");
  recordingInterruptionPromise = createRecordingInterruption("microphone_interrupted").catch(() => null);
  try {
    mediaRecorder.stop();
  } catch {
    releaseRecordingWakeLock();
  }
}

function watchMicrophoneTrack(track) {
  track.addEventListener("ended", handleUnexpectedRecordingEnd);
  track.addEventListener("mute", () => {
    if (microphoneMuteTimer) window.clearTimeout(microphoneMuteTimer);
    recordingInterruptionPromise = createRecordingInterruption("microphone_muted").catch(() => null);
    microphoneMuteTimer = window.setTimeout(() => handleUnexpectedRecordingEnd(), 2500);
  });
  track.addEventListener("unmute", () => {
    if (microphoneMuteTimer) window.clearTimeout(microphoneMuteTimer);
    microphoneMuteTimer = null;
    void recordingInterruptionPromise.then(async () => {
      if (!activeInterruptionId || !recordingIsCapturing() || recordingWasInterrupted) return;
      await closeRecordingInterruption();
      await updateMeetingRecording(activeRecordingId, { status: "recording", processing_error: null });
      setStatus(recordingStatus, "Microphone capture recovered. A brief interruption was marked in this meeting.", "success");
    }).catch(() => null);
  });
}

function handleMediaRecorderStopped() {
  if (!recordingStopRequested && !recordingWasInterrupted) {
    recordingWasInterrupted = true;
    recordingInterruptionPromise = createRecordingInterruption("unexpected_recorder_stop").catch(() => null);
  }
  recordingStopRequested = false;
  void prepareStoppedRecording();
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
        storage_limit_mb,
        document_limit,
        user_limit,
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
    recordsUsageSummary = null;
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
      created_by_user_id,
      created_at
    `, { count: "exact" })
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

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
        metadata,
        created_by_user_id,
        created_at
      `, { count: "exact" })
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });
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
  await loadRecordsUsage();
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
  const searchQuery = meetingNotesSearch?.value.trim().toLowerCase() || "";
  const visibleRecordings = searchQuery
    ? recordingsCache.filter((recording) => [
        recording.title,
        recording.status,
        recording.transcript_status,
        recording.ai_review_status,
        formatDateTime(recording.started_at || recording.created_at),
      ].some((value) => String(value || "").toLowerCase().includes(searchQuery)))
    : recordingsCache;

  if (!visibleRecordings.length) {
    recordingsList.innerHTML = "";
    recordingsEmpty.textContent = searchQuery
      ? "No meeting notes match this search."
      : "No meeting notes saved in this library yet.";
    show(recordingsEmpty, true);
    return;
  }

  show(recordingsEmpty, false);
  recordingsList.innerHTML = visibleRecordings
    .map((recording) => {
      const errorCopy = recording.processing_error
        ? `<p class="recording-row-note recording-row-note-error">${escapeHtml(recording.processing_error)}</p>`
        : "";
      const progress = Math.max(0, Math.min(100, Number(recording.processing_progress || 0)));
      const progressCopy = progress > 0 && progress < 100
        ? `<div class="recording-row-progress"><span style="width:${progress}%"></span></div><p class="recording-row-progress-copy">${escapeHtml(processingStageLabel(recording.processing_stage))} · ${progress}%</p>`
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
            <span>${escapeHtml(formatDuration(getRecordingDurationSeconds(recording)))}</span>
            <span>${escapeHtml(formatBytes(recording.file_size || 0))}</span>
            <span>${escapeHtml(formatRecordingStatus(recording.transcript_status))} transcript</span>
            <span>${escapeHtml(formatRecordingStatus(recording.ai_review_status || "not_started"))} AI review</span>
          </div>
          ${progressCopy}
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
  const hasReviewItems = hasReview && (
    (Array.isArray(review.suggested_additions) && review.suggested_additions.length > 0) ||
    (Array.isArray(review.conflicts) && review.conflicts.length > 0)
  );
  show(recordingDetailClearReview, Boolean(hasReviewItems && getActiveCapabilities().canEditDocuments));
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
  recordingDetailDuration.textContent = formatDuration(getRecordingDurationSeconds(recording));
  recordingDetailSize.textContent = formatBytes(recording.file_size || 0);
  recordingDetailPlay.disabled = !canPlaybackRecording(recording);
  show(recordingDetailTranscribe, canTranscribeRecording(recording));
  show(recordingDetailRetry, isRetryableRecording(recording));
  show(recordingDetailTransfer, canTransferRecordPacket(recording));
  show(recordingDetailDelete, getActiveCapabilities().canDeleteDocuments);
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
  recordingDetailAiReview.disabled = !recordingWorkflowSchemaAvailable || recording.transcript_status !== "ready";
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

async function reconcileRecordingDurationFromPlayer(recording) {
  const durationSeconds = normalizeRecordingDurationSeconds(recordingDetailPlayer.duration);
  if (!durationSeconds || activeDetailRecordingId !== recording?.id) return;
  recordingDetailDuration.textContent = formatDuration(durationSeconds);
  if (Math.abs(durationSeconds - normalizeRecordingDurationSeconds(recording.duration_seconds)) <= 1) return;

  mergeRecordingUpdate({ id: recording.id, duration_seconds: durationSeconds });
  renderRecordings();
  if (canRecordInActiveOrganization() && recordingWorkflowSchemaAvailable) {
    await updateMeetingRecording(recording.id, { duration_seconds: durationSeconds });
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
  try {
    detailPlayerUrl = await createRecordingSignedUrl(recording);
    const reconcileWhenFinite = () => {
      if (!normalizeRecordingDurationSeconds(recordingDetailPlayer.duration)) return;
      recordingDetailPlayer.removeEventListener("durationchange", reconcileWhenFinite);
      void reconcileRecordingDurationFromPlayer(recording).catch(() => null);
    };
    recordingDetailPlayer.addEventListener("loadedmetadata", reconcileWhenFinite, { once: true });
    recordingDetailPlayer.addEventListener("durationchange", reconcileWhenFinite);
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

    await deleteLocalChunksForRecording(recording.id, {
      userId: currentSession?.user?.id,
      organizationId: recording.organization_id,
    }).catch(() => null);

    if (activeDetailRecordingId === recording.id) {
      clearDetailPlayer();
      setRecordingDetailModalOpen(false);
      activeDetailRecordingId = "";
    }

    setRecordingDeleteModalOpen(false);
    await loadRecordings();
    setStatus(recordingsListStatus, "Meeting note deleted.", "success");
  } catch (error) {
    setStatus(recordingDeleteStatus, getErrorMessage(error, "Unable to delete the meeting note."), "error");
  } finally {
    recordingDeleteSubmit.disabled = false;
    recordingDeleteCancel.disabled = false;
  }
}

function transferStoragePath(storagePath, targetOrganizationId) {
  const parts = String(storagePath || "").split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return [targetOrganizationId, ...parts.slice(1)].join("/");
}

async function copyRecordPacketObject(bucket, sourcePath, targetPath, copiedObjects) {
  if (!sourcePath || !targetPath || sourcePath === targetPath) return;
  const { error } = await supabase.storage.from(bucket).copy(sourcePath, targetPath);
  if (error) throw error;
  copiedObjects.push({ bucket, path: targetPath });
}

async function removeRecordPacketObjects(objects) {
  const byBucket = new Map();
  objects.forEach(({ bucket, path }) => {
    if (!bucket || !path) return;
    const paths = byBucket.get(bucket) || [];
    if (!paths.includes(path)) paths.push(path);
    byBucket.set(bucket, paths);
  });
  await Promise.all(Array.from(byBucket, ([bucket, paths]) => (
    supabase.storage.from(bucket).remove(paths).catch(() => null)
  )));
}

async function transferRecordPacket(recordingId, targetOrganizationId) {
  const recording = getRecordingById(recordingId);
  const destination = getRecordPacketTransferDestinations()
    .find((membership) => membership.organization?.id === targetOrganizationId);
  if (!canTransferRecordPacket(recording) || !destination) return;

  const copiedObjects = [];
  const sourceObjects = [];
  recordingTransferSubmit.disabled = true;
  recordingTransferCancel.disabled = true;
  recordingTransferDestination.disabled = true;
  setStatus(recordingTransferStatus, "Preparing the complete record packet...");

  try {
    if (recordingDetailNotesSaveTimer) {
      window.clearTimeout(recordingDetailNotesSaveTimer);
      recordingDetailNotesSaveTimer = null;
      await saveRecordingDetailNotes();
    }
    if (aiDraftHasUnsavedChanges()) await saveRecordingAiDraft({ quiet: true });

    const sourceRecordingPaths = [
      recording.storage_path,
      recording.metadata?.phoneMeeting?.storagePath,
    ].map((value) => String(value || "").trim()).filter((value, index, list) => value && list.indexOf(value) === index);
    const recordingPathMap = new Map(sourceRecordingPaths.map((sourcePath) => [
      sourcePath,
      transferStoragePath(sourcePath, targetOrganizationId),
    ]));

    let transcript = null;
    if (recording.document_id) {
      const { data, error } = await supabase
        .from("documents")
        .select("id, storage_path")
        .eq("id", recording.document_id)
        .single();
      if (error || !data?.storage_path) throw error || new Error("The transcript file could not be loaded.");
      transcript = data;
    }
    const targetTranscriptPath = transcript
      ? transferStoragePath(transcript.storage_path, targetOrganizationId)
      : null;

    setStatus(recordingTransferStatus, "Copying recording and transcript files...");
    for (const [sourcePath, targetPath] of recordingPathMap) {
      await copyRecordPacketObject(RECORDINGS_BUCKET, sourcePath, targetPath, copiedObjects);
      sourceObjects.push({ bucket: RECORDINGS_BUCKET, path: sourcePath });
    }
    if (transcript) {
      await copyRecordPacketObject("documents", transcript.storage_path, targetTranscriptPath, copiedObjects);
      sourceObjects.push({ bucket: "documents", path: transcript.storage_path });
    }

    setStatus(recordingTransferStatus, "Moving packet ownership...");
    const { data, error } = await supabase.rpc("transfer_record_packet", {
      input_recording_id: recording.id,
      input_target_organization_id: targetOrganizationId,
      input_recording_storage_path: recording.storage_path
        ? recordingPathMap.get(recording.storage_path)
        : null,
      input_transcript_storage_path: targetTranscriptPath,
    });
    if (error) throw error;

    await removeRecordPacketObjects(sourceObjects);
    await deleteLocalChunksForRecording(recording.id, {
      userId: currentSession?.user?.id,
      organizationId: getActiveOrganization()?.id,
    }).catch(() => null);

    clearDetailPlayer();
    setRecordingDetailModalOpen(false);
    setRecordingTransferModalOpen(false);
    activeDetailRecordingId = "";
    await handleOrganizationChange(targetOrganizationId);
    setStatus(recordingsListStatus, `Record packet moved to ${data?.target_organization_name || destination.organization.name}.`, "success");
  } catch (error) {
    await removeRecordPacketObjects(copiedObjects);
    setStatus(recordingTransferStatus, getErrorMessage(error, "Unable to move the record packet."), "error");
  } finally {
    recordingTransferSubmit.disabled = false;
    recordingTransferCancel.disabled = false;
    recordingTransferDestination.disabled = false;
  }
}

async function maintainLocalRecordingRecoveryStorage() {
  const organization = getActiveOrganization();
  if (!organization || !currentSession?.user) return null;
  return cleanupStaleLocalRecordingChunks({
    userId: currentSession.user.id,
    organizationId: organization.id,
  });
}

function showLocalRecordingRecoveryStorageStatus(summary) {
  if (!summary) return;
  const messages = [];
  if (summary.expiredCount) {
    messages.push(`${summary.expiredCount} expired recovery audio chunk${summary.expiredCount === 1 ? " was" : "s were"} removed from this device after 30 days.`);
  }
  if (summary.warningCount && summary.oldestWarningExpiresAt) {
    const daysRemaining = Math.max(Math.ceil((new Date(summary.oldestWarningExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)), 1);
    const meetingCount = summary.warningRecordingCount || 1;
    messages.push(`Unfinished audio for ${meetingCount} meeting${meetingCount === 1 ? "" : "s"} is saved on this device and expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Reopen it while online to finish saving it.`);
  }
  if (messages.length) setStatus(recordingsListStatus, messages.join(" "), summary.warningCount ? "error" : "success");
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
      return;
    }

    if (action === "clear") {
      setStatus(recordingDetailStatusMessage, "Clearing the AI review...");
      const result = await clearRecordingReview({ supabase, recording });
      updateActiveRecordingReview(result.review);
      setStatus(recordingDetailStatusMessage, "AI review cleared. Your AI draft was preserved.", "success");
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

function isPhoneMeetingRecording(recording) {
  return Boolean(recording?.metadata?.meeting_sources?.phone_call || recording?.metadata?.phoneMeeting);
}

async function ensurePhoneMeetingTranscription(recordingId, options = {}) {
  const recording = getRecordingById(recordingId);
  if (!recording || !isPhoneMeetingRecording(recording) || !recording.storage_path) return false;
  const transcriptStatus = String(recording.transcript_status || "").toLowerCase();
  if (["ready", "processing", "failed"].includes(transcriptStatus)) return false;
  if (phoneMeetingTranscriptionPromise && phoneMeetingTranscriptionRecordingId === recording.id) {
    return phoneMeetingTranscriptionPromise;
  }

  phoneMeetingTranscriptionRecordingId = recording.id;
  phoneMeetingTranscriptionPromise = (async () => {
    if (options.announce !== false) {
      uploadStateValue.textContent = "Creating transcript";
      setRecorderState("Transcribing", "Phone recording saved. Creating a searchable transcript file.");
      setStatus(recordingStatus, "Phone recording saved. Creating transcript...");
    }
    try {
      await requestRecordingTranscription(recording.id);
      await loadRecordings();
      if (options.announce !== false) {
        uploadStateValue.textContent = "Transcript ready";
        setRecorderState("Saved", "Phone recording and transcript are ready.");
        setStatus(recordingStatus, "Phone meeting saved and transcript created.", "success");
      }
      return true;
    } catch (error) {
      await loadRecordings().catch(() => null);
      if (options.announce !== false) {
        uploadStateValue.textContent = "Transcript failed";
        setRecorderState("Saved", "The phone recording is safe, but its transcript needs another attempt.");
        setStatus(recordingStatus, getErrorMessage(error, "Phone recording saved, but transcription failed."), "error");
      }
      return false;
    } finally {
      phoneMeetingTranscriptionPromise = null;
      phoneMeetingTranscriptionRecordingId = "";
    }
  })();
  return phoneMeetingTranscriptionPromise;
}

function recoverQueuedPhoneMeetingTranscription() {
  const recording = recordingsCache.find((item) =>
    item.created_by_user_id === currentSession?.user?.id &&
    isPhoneMeetingRecording(item) &&
    Boolean(item.storage_path) &&
    ["queued", "not_started"].includes(String(item.transcript_status || "").toLowerCase())
  );
  if (recording) void ensurePhoneMeetingTranscription(recording.id);
}

async function requestChunkedRecordingFinalization(recordingId, expectedLastSequence) {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");
  const response = await fetch("/api/finalize-recording-chunks", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recordingId, expectedLastSequence }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to assemble the saved audio chunks.");
  return data;
}

async function recoverBrowserMeetingRecording(recordingId = "") {
  const organization = getActiveOrganization();
  if (!organization || !currentSession?.user) return false;
  let query = supabase
    .from("meeting_recordings")
    .select("id,title,status,selected_template_id,started_at,duration_seconds,file_size,audio_mime_type,notes_plain_text,created_by_user_id")
    .eq("organization_id", organization.id)
    .eq("created_by_user_id", currentSession.user.id)
    .in("status", ["recording", "interrupted", "recorded", "finalizing"]);
  if (recordingId) query = query.eq("id", recordingId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  activeRecordingId = data.id;
  recordingTitleInput.value = data.title || "Recovered meeting note";
  recordingTemplateSelect.value = data.selected_template_id || BLANK_NOTES_TEMPLATE_VALUE;
  recordingNotesInput.value = data.notes_plain_text || "";
  activeRecordingMimeType = data.audio_mime_type || getSupportedMimeType() || "audio/webm";
  pendingRecordedTitle = data.title || "Meeting note";
  pendingRecordedDurationSeconds = normalizeRecordingDurationSeconds(data.duration_seconds);
  const managerState = await initializeRecordingChunkManager(data.id);
  chunkedRecordingReadyToSave = managerState.nextSequence > 0;
  pendingRecordedDurationSeconds = Math.max(pendingRecordedDurationSeconds, managerState.durationSeconds || 0);
  pendingRecordedChunkBytes = Math.max(Number(data.file_size || 0), managerState.bytes || 0);
  recordingDuration.textContent = formatDuration(pendingRecordedDurationSeconds);
  await recordingChunkSummarySaveChain.catch(() => null);

  const { data: interruptions } = await supabase
    .from("meeting_recording_interruptions")
    .select("id,interruption_number,ended_at")
    .eq("meeting_recording_id", data.id)
    .order("interruption_number", { ascending: false });
  activeInterruptionNumber = Number(interruptions?.[0]?.interruption_number || 0);
  activeInterruptionId = interruptions?.find((item) => !item.ended_at)?.id || "";

  if (data.status === "recording") {
    recordingWasInterrupted = true;
    await createRecordingInterruption("page_closed_or_browser_interrupted").catch(() => null);
  } else {
    recordingWasInterrupted = data.status === "interrupted";
  }

  setRecordPanelOpen(true);
  uploadStateValue.textContent = navigator.onLine ? "Saved" : "Connection lost, saving locally";
  if (data.status === "finalizing") {
    setRecorderState("Saving", "Recovering final recording assembly.");
    setStatus(recordingStatus, "Finishing the recovered recording...");
    try {
      const { lastSequence } = await recordingChunkManager.flush();
      await requestChunkedRecordingFinalization(data.id, lastSequence);
      recordingChunkManager.dispose();
      recordingChunkManager = null;
      activeRecordingId = "";
      chunkedRecordingReadyToSave = false;
      setStatus(recordingStatus, "Recovered meeting note saved.", "success");
      await loadRecordings();
    } catch (finalizeError) {
      recordingWasInterrupted = true;
      setStatus(recordingStatus, getErrorMessage(finalizeError, "The recovered recording is saved but still needs to finish."), "error");
    }
  } else if (recordingWasInterrupted) {
    setRecorderState("Interrupted", "Recording was interrupted. Audio captured before the interruption has been saved.");
    setStatus(recordingStatus, "Recording was interrupted. Audio captured before the interruption has been saved.", "error");
  } else {
    setRecorderState("Stopped", "Recovered audio is ready to save.");
    setStatus(recordingStatus, "Recovered recording found. Select Save meeting note to finish it.", "success");
  }
  updateControls();
  return true;
}

async function handleRecordingSelection(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;
  if (!isRecoverableBrowserRecording(recording)) {
    await openRecordingDetail(recordingId);
    return;
  }
  if (activeRecordingId === recordingId) {
    setRecordPanelOpen(true, { scroll: true });
    return;
  }
  if (activeRecordingId) {
    await openRecordingDetail(recordingId);
    return;
  }
  const recovered = await recoverBrowserMeetingRecording(recordingId);
  if (recovered) setRecordPanelOpen(true, { scroll: true });
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
    metadata: getMeetingSourceMetadata("meeting_note"),
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

async function startPhoneMeeting() {
  if (!phoneMeetingsAreActive()) {
    setStatus(recordingStatus, "Phone Meetings is not enabled for this library's internal test.", "error");
    return;
  }
  if (!canRecordInActiveOrganization() || !validateMeetingNoteRequiredFields()) return;
  const organization = getActiveOrganization();
  if (!organization) return;

  const originalLabel = startPhoneMeetingButton?.textContent;
  if (startPhoneMeetingButton) startPhoneMeetingButton.disabled = true;
  setStatus(recordingStatus, "Preparing a private phone-meeting code...");

  try {
    let meetingRecordingId = activeRecordingId;
    if (!meetingRecordingId) {
      const createdRecording = await createMeetingRecording(recordingTitleInput.value.trim());
      meetingRecordingId = createdRecording.id;
      activeRecordingId = createdRecording.id;
      await updateMeetingRecording(createdRecording.id, {
        status: "ready",
        transcript_status: "not_started",
        ai_review_status: "not_started",
        metadata: getMeetingSourceMetadata("phone_call"),
        processing_error: null,
      });
    }

    const { data, error } = await supabase.functions.invoke("twilio-phone-meetings", {
      body: { action: "start_session", organization_id: organization.id, meeting_recording_id: meetingRecordingId },
    });
    if (error) throw error;
    if (!data?.dial_in_number || !data?.meeting_code) throw new Error("Phone Meeting setup did not return a dial-in number and code.");

    activePhoneMeetingSession = {
      ...data,
      status: "draft",
      meeting_recording_id: meetingRecordingId,
    };
    lastPhoneMeetingStatus = "";
    renderPhoneMeetingSession();
    startPhoneMeetingPolling();
    setStatus(recordingStatus, "Phone meeting ready. Dial the number and enter the private code when prompted.", "success");
    await loadRecordings();
  } catch (error) {
    setStatus(recordingStatus, getErrorMessage(error, "Unable to start the phone meeting."), "error");
  } finally {
    if (startPhoneMeetingButton) startPhoneMeetingButton.textContent = originalLabel || "Start phone call";
    updateControls();
  }
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
  if (recordsUsageSummary?.organizationId !== organization.id) {
    await loadRecordsUsage();
  }
  const storageBlockMessage = getStorageUploadBlockMessage(blob.size);
  if (storageBlockMessage) throw new Error(storageBlockMessage);

  const safeTitle = slugifySegment(title);
  const extension = getFileExtension(mimeType);
  const storagePath = `${organization.id}/${recordingId}/${safeTitle}.${extension}`;

  uploadStateValue.textContent = "Uploading";
  setRecorderState("Uploading", "Audio is being sent to secure storage.");
  setStatus(recordingStatus, "Uploading audio...");
  const processingStartedAt = new Date().toISOString();
  setUploadProgressVisible(true);
  setRecordingProcessingProgress(8, "uploading", processingStartedAt);

  await updateMeetingRecording(recordingId, {
    status: "uploading",
    duration_seconds: durationSeconds,
    storage_bucket: RECORDINGS_BUCKET,
    storage_path: storagePath,
    audio_mime_type: mimeType,
    file_size: blob.size,
    processing_stage: "uploading",
    processing_progress: 8,
    processing_started_at: processingStartedAt,
    processing_updated_at: processingStartedAt,
    processing_completed_at: null,
    processing_error: null,
  });

  const { error: storageError } = await supabase.storage.from(RECORDINGS_BUCKET).upload(storagePath, blob, {
    contentType: mimeType,
    upsert: false,
  });

  if (storageError) {
    await updateMeetingRecording(recordingId, {
      status: "failed",
      processing_stage: "failed",
      processing_updated_at: new Date().toISOString(),
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
    processing_stage: "transcribing",
    processing_progress: 55,
    processing_updated_at: new Date().toISOString(),
    processing_error: null,
  });
  setRecordingProcessingProgress(55, "transcribing", processingStartedAt);
  startRecordingProcessingPolling(recordingId);

  uploadStateValue.textContent = "Uploaded";
  setRecorderState("Transcribing", "Audio uploaded. Creating a searchable transcript file.");
  setStatus(recordingStatus, "Audio uploaded. Creating transcript...");

  try {
    await requestRecordingTranscription(recordingId);
    setRecordingProcessingProgress(100, "complete", processingStartedAt);
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
  pendingRecordedChunkBytes = 0;
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

  await recordingChunkEnqueueChain;
  await recordingInterruptionPromise;

  const recordingId = activeRecordingId;
  const title = recordingTitleInput.value.trim();
  const endedAt = new Date();
  const durationSeconds = Math.max(Math.round(getElapsedRecordingMs() / 1000), pendingRecordedDurationSeconds, 0);
  const blob = new Blob(activeChunks, { type: activeRecordingMimeType || "audio/webm" });
  const fileSize = recordingChunkManager ? pendingRecordedChunkBytes : blob.size;

  recordingDuration.textContent = formatDuration(durationSeconds);
  uploadStateValue.textContent = "Ready to save";
  stopDurationTimer();
  stopActiveStreamTracks();
  releaseRecordingWakeLock();
  isRecordingWorkflowActive = false;
  mediaRecorder = null;

  try {
    await updateMeetingRecording(recordingId, {
      status: recordingWasInterrupted ? "interrupted" : "recorded",
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      audio_mime_type: blob.type || activeRecordingMimeType || "audio/webm",
      file_size: fileSize,
      processing_error: null,
    });
    pendingRecordedBlob = blob.size ? blob : null;
    chunkedRecordingReadyToSave = Boolean(recordingChunkManager);
    pendingRecordedTitle = title;
    pendingRecordedDurationSeconds = durationSeconds;
    activeChunks = [];
    setRecorderState(
      recordingWasInterrupted ? "Interrupted" : "Stopped",
      recordingWasInterrupted
        ? "Recording was interrupted. Audio captured before the interruption has been saved."
        : "Review notes, scan handwritten notes if needed, then save the meeting note."
    );
    setStatus(
      recordingStatus,
      recordingWasInterrupted
        ? "Recording was interrupted. Audio captured before the interruption has been saved. Resume when ready or save the partial recording."
        : "Recording stopped. Review notes, then select Save meeting note.",
      recordingWasInterrupted ? "error" : "success"
    );
  } catch (error) {
    setRecorderState("Failed", "The meeting note was created, but stopping the audio did not finish.");
    uploadStateValue.textContent = "Failed";
    setStatus(recordingStatus, getErrorMessage(error, "Unable to stop the audio recording."), "error");
    activeRecordingId = "";
    activeChunks = [];
    clearPendingRecordedAudio();
    chunkedRecordingReadyToSave = false;
  } finally {
    recordingStartedAt = null;
    elapsedRecordingMs = 0;
    updateControls();
    await loadRecordings();
    if (recordingWasInterrupted && !recordingAutoRecoveryAttempted && document.visibilityState === "visible") {
      recordingAutoRecoveryAttempted = true;
      window.setTimeout(() => void handleResumeRecording({ automatic: true }), 500);
    }
  }
}

async function handleSaveStoppedRecording() {
  if (!activeRecordingId || (!pendingRecordedBlob && !chunkedRecordingReadyToSave)) return;

  const recordingId = activeRecordingId;
  const title = pendingRecordedTitle || recordingTitleInput.value.trim() || "Meeting note";
  const blob = pendingRecordedBlob;
  const mimeType = blob?.type || activeRecordingMimeType || "audio/webm";
  const durationSeconds = pendingRecordedDurationSeconds;

  if (blob?.size > MAX_RECORDING_AUDIO_BYTES) {
    setRecorderState("Stopped", "The recording is still available, but it is too large to transcribe.");
    uploadStateValue.textContent = "Too large";
    setStatus(recordingStatus, `This recording is larger than the ${formatBytes(MAX_RECORDING_AUDIO_BYTES)} transcription limit.`, "error");
    return;
  }

  isRecordingWorkflowActive = true;
  updateControls();
  try {
    const processingStartedAt = new Date().toISOString();
    setUploadProgressVisible(true);
    setRecordingProcessingProgress(5, "uploading", processingStartedAt);
    await updateMeetingRecording(recordingId, {
      processing_stage: "uploading",
      processing_progress: 5,
      processing_started_at: processingStartedAt,
      processing_updated_at: processingStartedAt,
      processing_completed_at: null,
      processing_error: null,
    });
    startRecordingProcessingPolling(recordingId);
    await saveActiveRecordingNotes();
    if (chunkedRecordingReadyToSave && recordingChunkManager) {
      setRecorderState("Saving", "Uploading any remaining audio chunks.");
      setStatus(recordingStatus, "Verifying saved audio chunks...");
      const { lastSequence } = await recordingChunkManager.flush();
      if (lastSequence < 0) throw new Error("No recorded audio chunks are available to save.");
      setRecordingProcessingProgress(18, "uploading", processingStartedAt);
      await recordingChunkSummarySaveChain.catch(() => null);
      setRecorderState("Saving", "Assembling the complete recording in secure storage.");
      uploadStateValue.textContent = "Saving";
      await updateMeetingRecording(recordingId, {
        status: "finalizing",
        duration_seconds: durationSeconds,
        processing_stage: "assembling",
        processing_progress: 20,
        processing_updated_at: new Date().toISOString(),
        processing_error: null,
      });
      const result = await requestChunkedRecordingFinalization(recordingId, lastSequence);
      if (result?.recording) mergeRecordingUpdate(result.recording);
      uploadStateValue.textContent = result?.transcriptionError ? "Transcript failed" : "Complete";
      if (result?.transcriptionError) {
        setRecorderState("Saved", "Audio is safe, but the transcript needs another attempt.");
        setStatus(recordingStatus, result.transcriptionError, "error");
      } else {
        setRecordingProcessingProgress(100, "complete", processingStartedAt);
        setRecorderState("Saved", "Recording and searchable transcript are ready.");
        setStatus(recordingStatus, "Meeting note saved and transcript created.", "success");
      }
    } else {
      await uploadRecordingBlob(recordingId, title, blob, mimeType, durationSeconds);
    }
    recordingChunkManager?.dispose();
    recordingChunkManager = null;
    chunkedRecordingReadyToSave = false;
    recordingWasInterrupted = false;
    activeInterruptionId = "";
    activeInterruptionNumber = 0;
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
        ...getMeetingSourceMetadata("uploaded_audio_file", { uploaded_audio: true }),
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

async function finishActivePhoneMeetingForm(message) {
  const recordingId = activeRecordingId;
  stopPhoneMeetingPolling();
  activePhoneMeetingSession = null;
  lastPhoneMeetingStatus = "";
  activeRecordingId = "";
  recordingTitleInput.value = "";
  recordingTemplateSelect.value = "";
  recordingNotesInput.value = "";
  setMeetingCaptureMode("app");
  clearPendingRecordedAudio();
  clearPendingUploadedAudio();
  clearRecorderStats();
  setRecordPanelOpen(false);
  renderMeetingCaptureUi();
  setStatus(recordingStatus, message, "success");
  await loadRecordings();
  if (recordingId) await openRecordingDetail(recordingId);
}

async function savePhoneMeetingAfterCallEnd() {
  if (!activePhoneMeetingSession || !activeRecordingId) return;
  const sessionId = activePhoneMeetingSession.session_id || activePhoneMeetingSession.id;
  if (sessionId && phoneMeetingAutoSavedSessionId === sessionId) return;
  try {
    await updateMeetingRecording(activeRecordingId, {
      title: recordingTitleInput.value.trim(),
      ...getCurrentNotesPayload(),
    });
    phoneMeetingAutoSavedSessionId = sessionId || "";
  } catch (error) {
    console.warn("Unable to automatically save the phone meeting after the call ended", error);
    throw error;
  }
}

async function endPhoneMeeting() {
  if (!activePhoneMeetingSession || !activeRecordingId || !canEndPhoneMeeting()) return;
  if (!validateMeetingNoteRequiredFields()) return;
  const organization = getActiveOrganization();
  if (!organization) return;

  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, "Saving the meeting and ending the phone call...");
  try {
    await savePhoneMeetingAfterCallEnd();
    const { data, error } = await supabase.functions.invoke("twilio-phone-meetings", {
      body: {
        action: "end_call",
        organization_id: organization.id,
        meeting_recording_id: activeRecordingId,
        session_id: activePhoneMeetingSession.session_id || activePhoneMeetingSession.id,
      },
    });
    if (error) throw error;
    activePhoneMeetingSession = {
      ...activePhoneMeetingSession,
      ...(data || {}),
      end_requested: true,
    };
    renderPhoneMeetingSession();
    setRecorderState("Ending", "The phone call is ending. Its recording will be saved automatically.");
    setStatus(recordingStatus, "Phone call ending. Review and finalize the meeting after the recording is saved.", "success");
    startPhoneMeetingPolling();
  } catch (error) {
    setStatus(recordingStatus, getErrorMessage(error, "Unable to end the phone call."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
  }
}

async function completePhoneMeetingWithoutRecording() {
  if (!activePhoneMeetingSession || !activeRecordingId || !canCompletePhoneMeetingWithoutRecording()) return;
  if (!validateMeetingNoteRequiredFields()) return;
  const organization = getActiveOrganization();
  if (!organization) return;

  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, "Completing the meeting note without a recording...");
  try {
    await updateMeetingRecording(activeRecordingId, {
      title: recordingTitleInput.value.trim(),
      ...getCurrentNotesPayload(),
    });
    const { data, error } = await supabase.functions.invoke("twilio-phone-meetings", {
      body: {
        action: "complete_without_recording",
        organization_id: organization.id,
        meeting_recording_id: activeRecordingId,
        session_id: activePhoneMeetingSession.session_id || activePhoneMeetingSession.id,
      },
    });
    if (error) throw error;
    activePhoneMeetingSession = { ...activePhoneMeetingSession, ...(data || {}), status: "ready" };
    await finishActivePhoneMeetingForm("Meeting note completed without a phone recording.");
  } catch (error) {
    setStatus(recordingStatus, getErrorMessage(error, "Unable to complete the meeting note without a recording."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
  }
}

async function retryPhoneMeetingTransfer() {
  if (!activePhoneMeetingSession || !activeRecordingId || !shouldOfferPhoneTransferRetry()) return;
  const organization = getActiveOrganization();
  if (!organization) return;

  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, "Retrying the secure recording transfer...");
  try {
    const { data, error } = await supabase.functions.invoke("twilio-phone-meetings", {
      body: {
        action: "retry_recording_transfer",
        organization_id: organization.id,
        meeting_recording_id: activeRecordingId,
        session_id: activePhoneMeetingSession.session_id || activePhoneMeetingSession.id,
      },
    });
    if (error) throw error;
    activePhoneMeetingSession = {
      ...activePhoneMeetingSession,
      ...(data || {}),
      status: data?.status || "recording_ready",
    };
    lastPhoneMeetingStatus = "";
    renderPhoneMeetingSession();
    setStatus(recordingStatus, "Phone recording saved. Select Finish meeting note when your notes are ready.", "success");
    await loadRecordings();
    await ensurePhoneMeetingTranscription(activeRecordingId);
  } catch (error) {
    setStatus(recordingStatus, getErrorMessage(error, "The phone recording transfer still needs attention."), "error");
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
    startPhoneMeetingPolling();
  }
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

  // A phone session creates its meeting record up front so Twilio has a safe,
  // server-authorized place to attach the call. Save edits back to that same
  // record instead of creating a duplicate manual note.
  if (activePhoneMeetingSession && activeRecordingId) {
    isRecordingWorkflowActive = true;
    updateControls();
    setStatus(recordingStatus, "Saving the phone meeting note...");
    try {
      await updateMeetingRecording(activeRecordingId, {
        title,
        ...getCurrentNotesPayload(),
      });
      mergeRecordingUpdate({
        id: activeRecordingId,
        title,
        ...getCurrentNotesPayload(),
      });
      if (activePhoneMeetingSession.status === "recording_ready") {
        await finishActivePhoneMeetingForm("Phone meeting note completed with its recording attached.");
        return;
      }
      setStatus(
        recordingStatus,
        canCompletePhoneMeetingWithoutRecording()
          ? "Phone meeting note saved. Complete it without a recording when you are ready."
          : "Phone meeting note saved. Call status will update here automatically.",
        "success"
      );
      await loadRecordings();
    } catch (error) {
      setStatus(recordingStatus, getErrorMessage(error, "Unable to save the phone meeting note."), "error");
    } finally {
      isRecordingWorkflowActive = false;
      updateControls();
    }
    return;
  }

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
      metadata: getMeetingSourceMetadata("manual_notes"),
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
    pendingRecordedDurationSeconds = 0;
    pendingRecordedChunkBytes = 0;
    await initializeRecordingChunkManager(createdRecording.id);
    updateControls();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    activeChunks = [];
    activeRecordingMimeType = mimeType;
    recordingCaptureSessionId = crypto.randomUUID();
    recordingChunkStartedAt = new Date();
    recordingChunkEnqueueChain = Promise.resolve();
    chunkedRecordingReadyToSave = false;
    recordingWasInterrupted = false;
    const recorderOptions = { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
    if (mimeType) recorderOptions.mimeType = mimeType;
    mediaRecorder = new MediaRecorder(stream, recorderOptions);
    recordingCaptureEndHandled = false;
    recordingStopRequested = false;

    stream.getAudioTracks().forEach(watchMicrophoneTrack);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        queueRecordedChunk(event.data, new Date());
      }
    });
    mediaRecorder.addEventListener("stop", handleMediaRecorderStopped);
    mediaRecorder.addEventListener("error", handleUnexpectedRecordingEnd);
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
      metadata: getMeetingSourceMetadata("browser_media_recorder"),
      processing_error: null,
    });

    mediaRecorder.start(RECORDING_CHUNK_INTERVAL_MS);
    void requestRecordingWakeLock();
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
    releaseRecordingWakeLock();
    recordingChunkManager?.dispose();
    recordingChunkManager = null;
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

async function handleResumeRecording({ automatic = false } = {}) {
  if (!activeRecordingId || recordingIsCapturing() || isRecordingWorkflowActive) return;
  if (!recordingChunkManager) await initializeRecordingChunkManager(activeRecordingId);
  isRecordingWorkflowActive = true;
  updateControls();
  setStatus(recordingStatus, automatic ? "Attempting to restore microphone capture..." : "Restoring microphone capture...");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    recordingCaptureSessionId = crypto.randomUUID();
    recordingChunkStartedAt = new Date();
    recordingCaptureEndHandled = false;
    recordingStopRequested = false;
    const recorderOptions = { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
    if (activeRecordingMimeType) recorderOptions.mimeType = activeRecordingMimeType;
    mediaRecorder = new MediaRecorder(stream, recorderOptions);
    stream.getAudioTracks().forEach(watchMicrophoneTrack);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) queueRecordedChunk(event.data, new Date());
    });
    mediaRecorder.addEventListener("stop", handleMediaRecorderStopped);
    mediaRecorder.addEventListener("error", handleUnexpectedRecordingEnd);
    mediaRecorder.addEventListener("pause", () => {
      pauseElapsedClock();
      setRecorderState("Paused", "Recording is paused. Resume when you are ready to continue.");
      updateControls();
    });
    mediaRecorder.addEventListener("resume", () => {
      resumeElapsedClock();
      setRecorderState("Recording", "Microphone capture is active again.");
      updateControls();
    });

    await closeRecordingInterruption();
    recordingWasInterrupted = false;
    chunkedRecordingReadyToSave = false;
    pendingRecordedBlob = null;
    elapsedRecordingMs = pendingRecordedDurationSeconds * 1000;
    resumeElapsedClock();
    mediaRecorder.start(RECORDING_CHUNK_INTERVAL_MS);
    await updateMeetingRecording(activeRecordingId, { status: "recording", ended_at: null, processing_error: null });
    void requestRecordingWakeLock();
    startDurationTimer();
    setRecorderState("Recording", "Microphone capture resumed. No audio was captured during the interruption.");
    setStatus(recordingStatus, "Recording resumed. The interruption remains marked in this meeting.", "success");
  } catch (error) {
    stopActiveStreamTracks();
    mediaRecorder = null;
    recordingWasInterrupted = true;
    setRecorderState("Interrupted", "Recording was interrupted. Audio captured before the interruption has been saved.");
    setStatus(
      recordingStatus,
      automatic
        ? "Recording was interrupted. Audio captured before the interruption has been saved. Select Resume recording to continue."
        : getErrorMessage(error, "Microphone access is required to resume recording."),
      "error"
    );
  } finally {
    isRecordingWorkflowActive = false;
    updateControls();
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
  if (recordsUsageSummary?.organizationId !== getActiveOrganization()?.id) {
    await loadRecordsUsage();
  }
  const storageBlockMessage = getStorageUploadBlockMessage(file.size);
  if (storageBlockMessage) {
    setStatus(recordingUploadStatus, storageBlockMessage, "error");
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
  recordingStopRequested = true;
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
  stopPhoneMeetingPolling();
  activePhoneMeetingSession = null;
  lastPhoneMeetingStatus = "";
  if (recordingDetailModal.classList.contains("is-open")) {
    closeRecordingDetail();
  }
  if (recordingDeleteModal?.classList.contains("is-open")) {
    setRecordingDeleteModalOpen(false);
  }
  if (recordingTransferModal?.classList.contains("is-open")) {
    setRecordingTransferModalOpen(false);
  }
  recordingTemplateSelect.value = "";
  recordingNotesInput.value = "";
  await loadRecordingTemplates();
  await loadReferenceDocuments();
  await loadPhoneMeetingSettings();
  await loadRecordings();
  const linkedRecordingId = urlParams.get("recording") || "";
  if (linkedRecordingId && getRecordingById(linkedRecordingId)) {
    await openRecordingDetail(linkedRecordingId);
  }
  const localRecoveryStorage = await maintainLocalRecordingRecoveryStorage().catch(() => null);
  await recoverRecentPhoneMeetingSession();
  if (!activePhoneMeetingSession) {
    await recoverBrowserMeetingRecording().catch((error) => {
      setStatus(recordingStatus, getErrorMessage(error, "A recoverable meeting recording was found, but it could not be opened."), "error");
    });
  }
  recoverQueuedPhoneMeetingTranscription();
  showLocalRecordingRecoveryStorageStatus(localRecoveryStorage);
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
  await loadPhoneMeetingSettings();
  await loadRecordings();
  const localRecoveryStorage = await maintainLocalRecordingRecoveryStorage().catch(() => null);
  await recoverRecentPhoneMeetingSession();
  if (!activePhoneMeetingSession) {
    await recoverBrowserMeetingRecording().catch((error) => {
      setStatus(recordingStatus, getErrorMessage(error, "A recoverable meeting recording was found, but it could not be opened."), "error");
    });
  }
  recoverQueuedPhoneMeetingTranscription();
  showLocalRecordingRecoveryStorageStatus(localRecoveryStorage);

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
  recordingReferencePreviewRemove?.addEventListener("click", () => {
    removePendingReference(recordingReferencePreviewRemove.dataset.referenceRemoveId || pendingReferencePreviewId);
    updateControls();
  });
  recordingReferenceList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reference-remove-id]");
    if (button) {
      removePendingReference(button.getAttribute("data-reference-remove-id") || "");
      updateControls();
      return;
    }
    if (event.target.closest("a")) return;
    const row = event.target.closest("[data-reference-preview-id]");
    if (!row) return;
    const reference = sortReferences(pendingMeetingReferences).find((item) => item.app_document_id === row.getAttribute("data-reference-preview-id"));
    void previewPendingReferenceDocument(reference || null);
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
  recordingTitleInput.addEventListener("input", updateControls);
  meetingNotesSearch?.addEventListener("input", renderRecordings);
  [meetingSourceBrowser, meetingSourcePhone, meetingSourceBoth, meetingSourceUpload].forEach((input) => {
    input?.addEventListener("change", () => {
      if (meetingUsesPhoneSource() && !phoneMeetingsAreActive()) {
        setMeetingCaptureMode("app");
        setStatus(recordingStatus, "Phone calling will be available after this library's Phone Meetings add-on and number are activated.");
      }
      renderMeetingCaptureUi();
    });
  });
  startPhoneMeetingButton?.addEventListener("click", () => {
    void startPhoneMeeting();
  });
  endPhoneMeetingButton?.addEventListener("click", () => {
    void endPhoneMeeting();
  });
  retryPhoneMeetingTransferButton?.addEventListener("click", () => {
    void retryPhoneMeetingTransfer();
  });
  completePhoneMeetingWithoutRecordingButton?.addEventListener("click", () => {
    void completePhoneMeetingWithoutRecording();
  });
  recordingNotesInput.addEventListener("input", queueActiveRecordingNotesSave);
  activeOrganizationSelect.addEventListener("change", async () => {
    closeMobileMenu();
    await handleOrganizationChange(activeOrganizationSelect.value);
  });
  cancelMeetingNoteButton?.addEventListener("click", cancelMeetingNoteDraft);
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
  resumeRecordingButton?.addEventListener("click", () => {
    void handleResumeRecording();
  });
  recordingsList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-recording-id]");
    if (!row) return;
    void handleRecordingSelection(row.getAttribute("data-recording-id") || "").catch((error) => {
      setStatus(recordingStatus, getErrorMessage(error, "Unable to reopen this meeting recording."), "error");
    });
  });
  recordingsList.addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-recording-id]");
    if (!row) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void handleRecordingSelection(row.getAttribute("data-recording-id") || "").catch((error) => {
      setStatus(recordingStatus, getErrorMessage(error, "Unable to reopen this meeting recording."), "error");
    });
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
  recordingDetailDelete?.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    promptDeleteRecording(activeDetailRecordingId);
  });
  recordingDetailTransfer?.addEventListener("click", () => {
    if (!activeDetailRecordingId) return;
    promptTransferRecordPacket(activeDetailRecordingId);
  });
  recordingTransferCancel?.addEventListener("click", () => {
    setRecordingTransferModalOpen(false);
  });
  recordingTransferModeWorkspace?.addEventListener("click", () => setRecordingTransferMode("workspace"));
  recordingTransferModeExternal?.addEventListener("click", () => setRecordingTransferMode("external"));
  recordingTransferCancelInvitation?.addEventListener("click", () => {
    void cancelExternalRecordPacketTransfer();
  });
  recordingTransferSubmit?.addEventListener("click", () => {
    if (recordingTransferMode === "external") {
      if (pendingTransferRecordingId) void sendExternalRecordPacketTransfer(pendingTransferRecordingId);
      return;
    }
    const targetOrganizationId = recordingTransferDestination?.value || "";
    if (!pendingTransferRecordingId || !targetOrganizationId) return;
    void transferRecordPacket(pendingTransferRecordingId, targetOrganizationId);
  });
  recordingTransferModal?.addEventListener("click", (event) => {
    if (event.target === recordingTransferModal && !recordingTransferSubmit.disabled) {
      setRecordingTransferModalOpen(false);
    }
  });
  recordingDeleteCancel?.addEventListener("click", () => {
    setRecordingDeleteModalOpen(false);
  });
  recordingDeleteSubmit?.addEventListener("click", async () => {
    if (!pendingDeleteRecordingId) return;
    await deleteRecording(pendingDeleteRecordingId);
  });
  recordingDeleteModal?.addEventListener("click", (event) => {
    if (event.target === recordingDeleteModal) {
      setRecordingDeleteModalOpen(false);
    }
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
  document.addEventListener("visibilitychange", () => {
    if (!recordingIsCapturing()) return;
    if (document.visibilityState === "hidden") {
      flushActiveRecordingChunk();
      setRecordingScreenSafety("The app is hidden. Return to it and keep the screen on; device locking can interrupt microphone capture.");
      return;
    }
    const audioEnded = activeStream?.getAudioTracks().some((track) => track.readyState === "ended");
    if (audioEnded) {
      handleUnexpectedRecordingEnd();
      return;
    }
    void requestRecordingWakeLock();
  });
  window.addEventListener("pagehide", flushActiveRecordingChunk);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && recordingUploadModal.classList.contains("is-open")) {
      setRecordingUploadModalOpen(false);
      return;
    }
    if (event.key === "Escape" && recordingTransferModal?.classList.contains("is-open") && !recordingTransferSubmit.disabled) {
      setRecordingTransferModalOpen(false);
      return;
    }
    if (event.key === "Escape" && recordingDeleteModal?.classList.contains("is-open")) {
      setRecordingDeleteModalOpen(false);
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
  initMeetingWorkspaceActionsDocking();
  updateSelectedFileCopy();
  if (consumeRetryUploadRequest()) {
    setRecordPanelOpen(true, { scroll: true });
    setRecordingUploadMode(true);
    setRecordingUploadModalOpen(true);
    updateControls();
  }
}

void init();
