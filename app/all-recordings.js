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
const allRecordingsPanel = document.getElementById("all-recordings-panel");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
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
const recordingDetailTitle = document.getElementById("recording-detail-title");
const recordingDetailStatus = document.getElementById("recording-detail-status");
const recordingDetailTranscriptStatus = document.getElementById("recording-detail-transcript-status");
const recordingDetailStartedAt = document.getElementById("recording-detail-started-at");
const recordingDetailEndedAt = document.getElementById("recording-detail-ended-at");
const recordingDetailDuration = document.getElementById("recording-detail-duration");
const recordingDetailSize = document.getElementById("recording-detail-size");
const recordingDetailPlayer = document.getElementById("recording-detail-player");
const recordingDetailPlay = document.getElementById("recording-detail-play");
const recordingDetailTranscribe = document.getElementById("recording-detail-transcribe");
const recordingDetailRetry = document.getElementById("recording-detail-retry");
const recordingDetailDelete = document.getElementById("recording-detail-delete");
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
let activePlayerUrl = "";
let activeTopPlayerRecordingId = "";
let detailPlayerUrl = "";
let activeDetailRecordingId = "";
let pendingDeleteRecordingId = "";
let pendingLinkedRecordingId = "";

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

function getRecordingById(recordingId) {
  return recordingsCache.find((item) => item.id === recordingId) || null;
}

function isRetryableRecording(recording) {
  return String(recording?.status || "").trim().toLowerCase() === "failed";
}

function buildRetryRecordingHref(recording) {
  const params = new URLSearchParams();
  if (recording?.title) params.set("retryTitle", recording.title);
  if (recording?.id) params.set("retryRecording", recording.id);
  params.set("openUpload", "1");
  return `./recordings.html?${params.toString()}`;
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
    throw new Error("No audio file is stored for this recording yet.");
  }

  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(recording.storage_path, 60 * 10);
  if (error || !data?.signedUrl) {
    throw error || new Error("Unable to create a playback link.");
  }
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
  selectedRecordingCopy.textContent = "Select a recording below to load playback.";
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
    recordingCount.textContent = "0";
    renderRecordings();
    setStatus(recordingsStatus, "");
    return;
  }

  setStatus(recordingsStatus, "Loading recordings...");
  const { data, error } = await supabase
    .from("meeting_recordings")
    .select(`
      id,
      title,
      status,
      transcript_status,
      ai_review_status,
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
    .order("created_at", { ascending: false });

  if (error) {
    recordingsCache = [];
    renderRecordings();
    setStatus(recordingsStatus, getErrorMessage(error, "Unable to load recordings."), "error");
    return;
  }

  recordingsCache = Array.isArray(data) ? data : [];
  recordingCount.textContent = String(recordingsCache.length);
  renderRecordings();
  setStatus(recordingsStatus, `${recordingsCache.length} recording${recordingsCache.length === 1 ? "" : "s"} loaded.`, recordingsCache.length ? "success" : "");

  const linkedRecordingId = consumeLinkedRecordingId();
  if (linkedRecordingId) {
    if (getRecordingById(linkedRecordingId)) {
      void openRecordingDetail(linkedRecordingId);
    } else {
      setStatus(recordingsStatus, "Requested recording was not found in this library.", "error");
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
    const item = document.createElement("article");
    item.className = "recording-row";
    item.setAttribute("data-recording-id", recording.id);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
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
    `;
    recordingsList.append(item);
  });
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
  selectedRecordingCopy.textContent = `${recording.title || "Untitled recording"} · ${formatDateTime(recording.started_at || recording.created_at)}`;
  try {
    await recordingPlayer.play();
  } catch {
    // Browsers may require a second interaction before playback.
  }
  setStatus(recordingPlayerStatus, "Audio loaded.", "success");
}

function populateRecordingDetails(recording) {
  recordingDetailTitle.textContent = recording.title || "Untitled recording";
  recordingDetailStatus.textContent = formatRecordingStatus(recording.status);
  recordingDetailTranscriptStatus.textContent = formatRecordingStatus(recording.transcript_status);
  recordingDetailStartedAt.textContent = formatDateTime(recording.started_at || recording.created_at);
  recordingDetailEndedAt.textContent = recording.ended_at ? formatDateTime(recording.ended_at) : "Not finished";
  recordingDetailDuration.textContent = formatDuration(recording.duration_seconds || 0);
  recordingDetailSize.textContent = formatBytes(recording.file_size || 0);
  recordingDetailPlay.disabled = !canPlaybackRecording(recording);
  show(recordingDetailTranscribe, canTranscribeRecording(recording));
  show(recordingDetailRetry, isRetryableRecording(recording));
  recordingDetailPlay.textContent = "Play";
  recordingDetailDelete.disabled = !getActiveCapabilities().canDeleteDocuments;
  setStatus(recordingDetailStatusMessage, recording.processing_error || "");
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

async function openRecordingDetail(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;

  activeDetailRecordingId = recording.id;
  populateRecordingDetails(recording);
  clearDetailPlayer();
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
  selectedRecordingCopy.textContent = `${recording.title || "Untitled recording"} · ${formatDateTime(recording.started_at || recording.created_at)}`;
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
  await syncDetailPlayerBackToTop();
  setRecordingDetailModalOpen(false);
  activeDetailRecordingId = "";
  setStatus(recordingDetailStatusMessage, "");
}

function promptDeleteRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording || !getActiveCapabilities().canDeleteDocuments) return;
  pendingDeleteRecordingId = recording.id;
  recordingDeleteCopy.textContent = `Delete "${recording.title || "Untitled recording"}"? This action cannot be undone.`;
  setRecordingDeleteModalOpen(true);
}

async function deleteRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return;

  setStatus(recordingDeleteStatus, "Deleting recording...");
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
    setStatus(recordingsStatus, "Recording deleted.", "success");
  } catch (error) {
    setStatus(recordingDeleteStatus, getErrorMessage(error, "Unable to delete the recording."), "error");
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
  await loadRecordings();
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(recordingsStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("./login.html");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(allRecordingsPanel, false);
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
    show(allRecordingsPanel, true);
    setStatus(recordingsStatus, getErrorMessage(error, "Unable to load recording context."), "error");
    return;
  }

  if (!getActiveCapabilities().canUseRecordings) {
    window.location.replace("./dashboard.html?section=library");
    return;
  }

  pendingLinkedRecordingId = new URLSearchParams(window.location.search).get("recording") || "";

  show(setupPanel, false);
  show(allRecordingsPanel, true);
  await loadRecordings();

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.replace("./dashboard.html?section=account");
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.replace("./dashboard.html?section=library");
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
