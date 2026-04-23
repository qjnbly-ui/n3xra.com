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
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const recordingsNoAccessNotice = document.getElementById("recordings-no-access-notice");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const recordingTitleInput = document.getElementById("recording-title");
const recordingCount = document.getElementById("recording-count");
const recordingDuration = document.getElementById("recording-duration");
const uploadStateValue = document.getElementById("upload-state-value");
const recordingFormat = document.getElementById("recording-format");
const startRecordingButton = document.getElementById("start-recording-button");
const stopRecordingButton = document.getElementById("stop-recording-button");
const recordingPreview = document.getElementById("recording-preview");
const recordingStatus = document.getElementById("recording-status");
const recorderStateLabel = document.getElementById("recorder-state-label");
const recorderStateCopy = document.getElementById("recorder-state-copy");
const recordingsList = document.getElementById("recordings-list");
const recordingsEmpty = document.getElementById("recordings-empty");
const recordingsListStatus = document.getElementById("recordings-list-status");

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
let mediaRecorder = null;
let activeStream = null;
let activeChunks = [];
let activeRecordingId = "";
let activeRecordingMimeType = "";
let recordingStartedAt = null;
let durationTimer = null;
let activePreviewUrl = "";

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

function getDefaultRecordingTitle() {
  const organizationName = getActiveOrganization()?.name || "Meeting";
  const timestamp = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  return `${organizationName} meeting ${timestamp}`;
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

function resetPreview() {
  if (activePreviewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(activePreviewUrl);
  }
  activePreviewUrl = "";
  recordingPreview.pause();
  recordingPreview.removeAttribute("src");
  recordingPreview.load();
  show(recordingPreview, false);
}

function setPreviewSource(url) {
  if (activePreviewUrl.startsWith("blob:") && activePreviewUrl !== url) {
    URL.revokeObjectURL(activePreviewUrl);
  }
  activePreviewUrl = url;
  recordingPreview.src = url;
  show(recordingPreview, true);
}

function setRecorderState(label, copy) {
  recorderStateLabel.textContent = label;
  recorderStateCopy.textContent = copy;
}

function updateControls() {
  const recordingActive = mediaRecorder?.state === "recording";
  startRecordingButton.disabled = !canRecordInActiveOrganization() || recordingActive || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
  stopRecordingButton.disabled = !recordingActive;
  activeOrganizationSelect.disabled = recordingActive || memberships.length <= 1;
  recordingTitleInput.disabled = recordingActive;
}

function startDurationTimer() {
  stopDurationTimer();
  durationTimer = window.setInterval(() => {
    if (!recordingStartedAt) return;
    const seconds = Math.max(Math.round((Date.now() - recordingStartedAt.getTime()) / 1000), 0);
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

function renderOrganizationSelector() {
  if (!memberships.length || !getActiveOrganization()) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeMembershipRole.textContent = "No library access";
    recordingCount.textContent = "0";
    activeOrganizationSelect.disabled = true;
    show(recordingsNoAccessNotice, true);
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
  activeMembershipRole.textContent = formatRoleLabel(getMembershipRole(activeMembership));
  show(recordingsNoAccessNotice, !canRecordInActiveOrganization());
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
    renderRecordings();
    setStatus(recordingsListStatus, "");
    return;
  }

  setStatus(recordingsListStatus, "Loading recordings...");
  const { data, error } = await supabase
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
    `)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    recordingsCache = [];
    renderRecordings();
    setStatus(recordingsListStatus, getErrorMessage(error, "Unable to load recordings."), "error");
    return;
  }

  recordingsCache = Array.isArray(data) ? data : [];
  renderRecordings();
  setStatus(recordingsListStatus, recordingsCache.length ? `${recordingsCache.length} recording${recordingsCache.length === 1 ? "" : "s"} loaded.` : "");
}

function renderRecordings() {
  recordingCount.textContent = String(recordingsCache.length);
  if (!recordingsCache.length) {
    recordingsList.innerHTML = "";
    show(recordingsEmpty, true);
    return;
  }

  show(recordingsEmpty, false);
  recordingsList.innerHTML = recordingsCache
    .map((recording) => {
      const hasAudio = Boolean(recording.storage_path);
      const errorCopy = recording.processing_error
        ? `<p class="recording-row-note recording-row-note-error">${escapeHtml(recording.processing_error)}</p>`
        : "";

      return `
        <article class="recording-row">
          <div class="recording-row-main">
            <div>
              <p class="recording-row-title">${escapeHtml(recording.title || "Untitled recording")}</p>
              <p class="recording-row-meta">${escapeHtml(formatDateTime(recording.started_at || recording.created_at))}</p>
            </div>
            <span class="recording-row-status status-${escapeHtml(String(recording.status || "").toLowerCase())}">${escapeHtml(formatRecordingStatus(recording.status))}</span>
          </div>
          <div class="recording-row-details">
            <span>${escapeHtml(formatDuration(recording.duration_seconds || 0))}</span>
            <span>${escapeHtml(recording.audio_mime_type || "Audio pending")}</span>
            <span>${escapeHtml(formatBytes(recording.file_size || 0))}</span>
          </div>
          ${errorCopy}
          <div class="recording-row-actions">
            <button class="btn secondary" type="button" data-action="open-audio" data-id="${escapeHtml(recording.id)}" ${hasAudio ? "" : "disabled"}>Open audio</button>
          </div>
        </article>
      `;
    })
    .join("");
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

async function uploadRecordingBlob(recordingId, title, blob, mimeType, durationSeconds) {
  const organization = getActiveOrganization();
  if (!organization) throw new Error("No active library selected.");

  const safeTitle = slugifySegment(title);
  const extension = getFileExtension(mimeType);
  const storagePath = `${organization.id}/${recordingId}/${safeTitle}.${extension}`;

  uploadStateValue.textContent = "Uploading";
  setRecorderState("Uploading", "Audio is being sent to secure storage.");
  setStatus(recordingStatus, "Uploading audio...");

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
  setRecorderState("Saved", "Audio uploaded. This recording is ready for the future transcript step.");
  setStatus(recordingStatus, "Recording saved and uploaded.", "success");
}

async function finalizeRecording() {
  if (!activeRecordingId) return;

  const recordingId = activeRecordingId;
  const title = recordingTitleInput.value.trim() || getDefaultRecordingTitle();
  const endedAt = new Date();
  const durationSeconds = recordingStartedAt ? Math.max(Math.round((endedAt.getTime() - recordingStartedAt.getTime()) / 1000), 0) : 0;
  const blob = new Blob(activeChunks, { type: activeRecordingMimeType || "audio/webm" });
  const previewUrl = URL.createObjectURL(blob);

  recordingDuration.textContent = formatDuration(durationSeconds);
  setPreviewSource(previewUrl);
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
    mediaRecorder = null;
    activeChunks = [];
    activeRecordingId = "";
    activeRecordingMimeType = "";
    recordingStartedAt = null;
    updateControls();
    await loadRecordings();
  }
}

async function handleStartRecording() {
  if (!canRecordInActiveOrganization()) {
    setStatus(recordingStatus, "You need editor access to record audio in this library.", "error");
    return;
  }
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    setStatus(recordingStatus, "This browser does not support in-browser audio recording.", "error");
    return;
  }
  if (mediaRecorder?.state === "recording") return;

  const title = recordingTitleInput.value.trim() || getDefaultRecordingTitle();
  const mimeType = getSupportedMimeType();

  resetPreview();
  setStatus(recordingStatus, "Creating recording session...");
  setRecorderState("Preparing", "Creating a meeting row before microphone capture starts.");
  uploadStateValue.textContent = "Not started";
  recordingFormat.textContent = mimeType || "Browser default";

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

    recordingStartedAt = new Date();
    await updateMeetingRecording(createdRecording.id, {
      status: "recording",
      started_at: recordingStartedAt.toISOString(),
      audio_mime_type: mediaRecorder.mimeType || mimeType || null,
      processing_error: null,
    });

    mediaRecorder.start(1000);
    recordingDuration.textContent = "00:00";
    uploadStateValue.textContent = "Waiting for stop";
    recordingFormat.textContent = mediaRecorder.mimeType || mimeType || "Browser default";
    setRecorderState("Recording", "Microphone capture is active. Stop to upload and save.");
    setStatus(recordingStatus, "Recording in progress...");
    startDurationTimer();
    updateControls();
    await loadRecordings();
  } catch (error) {
    stopDurationTimer();
    stopActiveStreamTracks();
    mediaRecorder = null;
    activeChunks = [];
    activeRecordingMimeType = "";
    recordingStartedAt = null;
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

    uploadStateValue.textContent = "Not started";
    setRecorderState("Idle", "Ready to create a new recording session.");
    setStatus(recordingStatus, getErrorMessage(error, "Unable to start recording."), "error");
    await loadRecordings();
  }
}

function handleStopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  setRecorderState("Finishing", "Stopping microphone capture and preparing the upload.");
  setStatus(recordingStatus, "Stopping recording...");
  stopRecordingButton.disabled = true;
  mediaRecorder.stop();
}

async function openRecordingAudio(recordingId) {
  const recording = recordingsCache.find((item) => item.id === recordingId);
  if (!recording?.storage_path) return;

  setStatus(recordingsListStatus, "Loading saved audio...");
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(recording.storage_path, 60 * 10);
  if (error) {
    setStatus(recordingsListStatus, getErrorMessage(error, "Unable to open the saved audio."), "error");
    return;
  }

  setPreviewSource(data.signedUrl);
  recordingPreview.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    await recordingPreview.play();
  } catch {
    // Browsers may require a second interaction before autoplaying audio.
  }
  setStatus(recordingsListStatus, "Saved audio loaded in the player above.", "success");
}

async function handleOrganizationChange(nextOrganizationId) {
  if (!nextOrganizationId || nextOrganizationId === getActiveOrganization()?.id) return;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;

  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);
  renderOrganizationSelector();
  resetPreview();
  recordingDuration.textContent = "00:00";
  uploadStateValue.textContent = "Not started";
  recordingFormat.textContent = "Pending";
  setRecorderState("Idle", "Ready to create a new recording session.");
  setStatus(recordingStatus, "");
  await loadRecordings();
}

async function handleSignout() {
  if (mediaRecorder?.state === "recording") {
    setStatus(recordingStatus, "Stop the active recording before logging out.", "error");
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
  activeOrganizationSelect.addEventListener("change", async () => {
    closeMobileMenu();
    await handleOrganizationChange(activeOrganizationSelect.value);
  });
  startRecordingButton.addEventListener("click", () => {
    void handleStartRecording();
  });
  stopRecordingButton.addEventListener("click", handleStopRecording);
  recordingsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='open-audio']");
    if (!button) return;
    void openRecordingAudio(button.getAttribute("data-id") || "");
  });
  window.addEventListener("beforeunload", (event) => {
    if (mediaRecorder?.state === "recording") {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

void init();
