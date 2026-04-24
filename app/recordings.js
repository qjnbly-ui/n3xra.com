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

const setupPanel = document.getElementById("setup-panel");
const recordingsPanel = document.getElementById("recordings-panel");
const recordingsNoAccessNotice = document.getElementById("recordings-no-access-notice");
const recordingsContextPanel = document.getElementById("recordings-context-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeOrganizationName = document.getElementById("active-organization-name");
const activeMembershipRole = document.getElementById("active-membership-role");
const recordingCount = document.getElementById("recording-count");
const recordingTitleInput = document.getElementById("recording-title");
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
const recordingDetailStartedAt = document.getElementById("recording-detail-started-at");
const recordingDetailEndedAt = document.getElementById("recording-detail-ended-at");
const recordingDetailDuration = document.getElementById("recording-detail-duration");
const recordingDetailSize = document.getElementById("recording-detail-size");
const recordingDetailStatusMessage = document.getElementById("recording-detail-status-message");

const RECORDINGS_BUCKET = "meeting-recordings";
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
let isRecordingWorkflowActive = false;
let pendingRetryUploadOpen = false;
let isRetryUploadMode = false;

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
  recordingFileInput.disabled = hasActiveSession;
  recordingUploadSubmit.disabled = hasActiveSession || !Boolean(getSelectedRecordingFile());
}

function getRecordingById(recordingId) {
  return recordingsCache.find((item) => item.id === recordingId) || null;
}

function setRecordingDetailModalOpen(isOpen) {
  recordingDetailModal.classList.toggle("is-open", isOpen);
  recordingDetailModal.setAttribute("aria-hidden", String(!isOpen));
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
  const { data, error, count } = await supabase
    .from("meeting_recordings")
    .select(`
      id,
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
          </div>
          ${errorCopy}
        </article>
      `;
    })
    .join("");
}

function populateRecordingDetails(recording) {
  recordingDetailTitle.textContent = recording.title || "Untitled recording";
  recordingDetailStatus.textContent = formatRecordingStatus(recording.status);
  recordingDetailTranscriptStatus.textContent = formatRecordingStatus(recording.transcript_status);
  recordingDetailStartedAt.textContent = formatDateTime(recording.started_at || recording.created_at);
  recordingDetailEndedAt.textContent = recording.ended_at ? formatDateTime(recording.ended_at) : "Not finished";
  recordingDetailDuration.textContent = formatDuration(recording.duration_seconds || 0);
  recordingDetailSize.textContent = formatBytes(recording.file_size || 0);
  setStatus(recordingDetailStatusMessage, recording.processing_error || "");
}

function openRecordingDetail(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;
  activeDetailRecordingId = recording.id;
  populateRecordingDetails(recording);
  setRecordingDetailModalOpen(true);
}

function openRecordingInAllRecordings(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording?.id) return;
  window.location.href = buildAllRecordingsDetailHref(recording.id);
}

function closeRecordingDetail() {
  setRecordingDetailModalOpen(false);
  activeDetailRecordingId = "";
  setStatus(recordingDetailStatusMessage, "");
}

async function updateMeetingRecording(recordingId, patch) {
  if (!recordingId) return;
  const { error } = await supabase
    .from("meeting_recordings")
    .update(patch)
    .eq("id", recordingId);
  if (error) throw error;
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
  setRecorderState("Saved", "Audio uploaded. View playback and history on the all recordings page.");
  setStatus(recordingStatus, "Recording saved and uploaded.", "success");
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    activeChunks = [];
    activeRecordingMimeType = mimeType;
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

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
    clearRecorderStats();
    updateControls();
    await loadRecordings();
  }
}

function handleStopRecording() {
  if (!mediaRecorder || (mediaRecorder.state !== "recording" && mediaRecorder.state !== "paused")) return;
  const confirmed = window.confirm("Do you want to stop this recording?");
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
  activeOrganizationSelect.addEventListener("change", async () => {
    closeMobileMenu();
    await handleOrganizationChange(activeOrganizationSelect.value);
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
    openRecordingInAllRecordings(row.getAttribute("data-recording-id") || "");
  });
  recordingsList.addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-recording-id]");
    if (!row) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRecordingInAllRecordings(row.getAttribute("data-recording-id") || "");
  });
  recordingDetailClose.addEventListener("click", closeRecordingDetail);
  recordingDetailModal.addEventListener("click", (event) => {
    if (event.target === recordingDetailModal) {
      closeRecordingDetail();
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
    }
  });

  setMenuActive("recordings");
  updateSelectedFileCopy();
  if (consumeRetryUploadRequest()) {
    setRecordingUploadMode(true);
    setRecordingUploadModalOpen(true);
    updateControls();
  }
}

void init();
