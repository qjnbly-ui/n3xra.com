import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId } from "/shared/lib/orgs.js";

const DESKTOP_SHELL_BREAKPOINT = 981;
const RECORDS_AI_HISTORY_LIMIT = 8;
const RECORDS_AI_PENDING_GUIDE_KEY = "n3xra-records-pending-guide";
const RECORDS_AI_GUIDE_ROUTES = new Set([
  "/n3xra-records/library",
  "/n3xra-records/meeting-notes",
  "/n3xra-records/documents.html",
  "/n3xra-records/messages.html",
  "/n3xra-records/account/?view=profile",
  "/n3xra-records/account/?view=library",
  "/n3xra-records/account/?view=templates",
  "/n3xra-records/account/?view=phone",
  "/n3xra-records/account/?view=ai",
  "/n3xra-records/account/?view=users",
  "/n3xra-records/account/?view=contacts",
  "/n3xra-records/account/?view=access",
  "/n3xra-records/account/?view=storage",
  "/n3xra-records/account/?view=billing",
  "/n3xra-records/account/?view=activity",
  "/n3xra-records/account/?view=support",
]);

let recordsAiSupabase = null;
let recordsAiHistory = [];
let recordsAiLastFocusedElement = null;
let recordsAiMediaRecorder = null;
let recordsAiMediaStream = null;
let recordsAiAudioChunks = [];
let recordsAiRecordingTimer = null;
let recordsAiDiscardRecording = false;
let recordsAiVoiceSubmission = false;
let recordsAiCurrentAudio = null;
let recordsAiCurrentAudioUrl = "";
let recordsAiLastAnswer = "";
let recordsAiWakeLock = null;
let recordsAiWakeLockWanted = false;
let recordsAiGuideAudio = null;
let recordsAiGuideAudioUrl = "";
let recordsAiGuideVoiceEnabled = true;

try {
  recordsAiGuideVoiceEnabled = window.localStorage.getItem("n3xra-records-guide-voice") !== "off";
} catch {
  recordsAiGuideVoiceEnabled = true;
}

const RECORDS_AI_ACTIONS = Object.freeze({
  "library.search": { label: "Show Library search", href: "/n3xra-records/library", selector: "#library-search-panel" },
  "library.ai_search": { label: "Show AI Search", href: "/n3xra-records/library", activationLabel: "AI Search", activationSelector: "#search-mode-ai", selector: "#library-search-panel" },
  "library.upload": { label: "Show document upload", href: "/n3xra-records/library", activationLabel: "Upload", activationSelector: "#files-open-upload-modal", selector: "#upload-form" },
  "meeting.new": { label: "Show new meeting note", href: "/n3xra-records/meeting-notes", activationLabel: "New meeting note", activationSelector: "#record-panel-toggle", selector: "#record-panel-body" },
  "documents.new": { label: "Show Document Builder", href: "/n3xra-records/documents.html", selector: "#new-document-button" },
  "messages.compose": { label: "Show Communication", href: "/n3xra-records/messages.html", selector: "#message-form" },
  "account.profile": { label: "Open Profile", href: "/n3xra-records/account/?view=profile", selector: "#library-settings-card" },
  "account.library": { label: "Open Library settings", href: "/n3xra-records/account/?view=library", selector: "#admin-library-panel" },
  "account.templates": { label: "Open Templates", href: "/n3xra-records/account/?view=templates", selector: "#admin-templates-panel" },
  "account.phone": { label: "Open Phone Meetings", href: "/n3xra-records/account/?view=phone", selector: "#admin-phone-panel" },
  "account.ai": { label: "Open AI settings", href: "/n3xra-records/account/?view=ai", selector: "#admin-ai-panel" },
  "account.users": { label: "Open Users", href: "/n3xra-records/account/?view=users", selector: "#admin-users-panel" },
  "account.contacts": { label: "Open Contacts", href: "/n3xra-records/account/?view=contacts", selector: "#admin-contacts-panel" },
  "account.access": { label: "Open Invites & access", href: "/n3xra-records/account/?view=access", selector: "#admin-access-panel" },
  "account.storage": { label: "Open Storage", href: "/n3xra-records/account/?view=storage", selector: "#admin-storage-panel" },
  "account.billing": { label: "Open Billing", href: "/n3xra-records/account/?view=billing", selector: "#admin-billing-panel" },
  "account.activity": { label: "Open Audit activity", href: "/n3xra-records/account/?view=activity", selector: "#admin-activity-panel" },
  "account.support": { label: "Open support access", href: "/n3xra-records/account/?view=support", selector: "#support-access-card" },
});

const RECORDS_WORKSPACE_LINKS = [
  { key: "library", label: "Library", href: "/n3xra-records/library" },
  { key: "meeting-notes", label: "Meeting Notes", href: "/n3xra-records/meeting-notes" },
  { key: "document-builder", label: "Document Builder", href: "/n3xra-records/documents.html" },
  { key: "messages", label: "Communication", href: "/n3xra-records/messages.html" },
];

const RECORDS_MANAGE_GROUPS = [
  {
    label: "Configuration",
    links: [
      { label: "Library settings", view: "library" },
      { label: "Templates", view: "templates" },
      { label: "Phone Meetings", view: "phone" },
      { label: "AI settings", view: "ai" },
    ],
  },
  {
    label: "People and access",
    links: [
      { label: "Users", view: "users" },
      { label: "Contacts", view: "contacts" },
      { label: "Invites & access", view: "access" },
    ],
  },
  {
    label: "Plan and usage",
    links: [
      { label: "Storage", view: "storage" },
      { label: "Billing", view: "billing" },
    ],
  },
  {
    label: "Audit",
    links: [{ label: "Audit activity", view: "activity" }],
  },
  {
    label: "Support",
    links: [{ label: "N3XRA support access", view: "support" }],
  },
];

function normalizePathname(value = window.location.pathname) {
  return String(value || "")
    .replace(/\/index\.html$/i, "")
    .replace(/\.html$/i, "")
    .replace(/\/+$/, "");
}

function getActiveRecordsPage() {
  const pathname = normalizePathname();
  if (pathname.endsWith("/n3xra-records/account")) return "account";
  if (pathname.endsWith("/n3xra-records/library")) return "library";
  if (pathname.endsWith("/n3xra-records/files")) return "library";
  if (pathname.endsWith("/n3xra-records/documents")) return "document-builder";
  if (pathname.endsWith("/n3xra-records/messages")) return "messages";
  if (
    pathname.endsWith("/n3xra-records/meeting-notes") ||
    pathname.endsWith("/n3xra-records/all-meeting-notes") ||
    pathname.endsWith("/n3xra-records/recordings") ||
    pathname.endsWith("/n3xra-records/all-recordings")
  ) return "meeting-notes";
  return "";
}

function renderPrimaryLink(item, activePage) {
  const isActive = item.key === activePage;
  return `<a href="${item.href}"${isActive ? ' class="is-active" aria-current="page"' : ""}>${item.label}</a>`;
}

function renderManageGroup(group) {
  return `
    <p class="records-desktop-nav-group-label">${group.label}</p>
    ${group.links
      .map((item) => `<a href="/n3xra-records/account/?view=${item.view}">${item.label}</a>`)
      .join("")}
  `;
}

function buildDesktopNavigation(activePage) {
  const navigation = document.createElement("aside");
  navigation.className = "records-desktop-nav records-shared-desktop-nav";
  navigation.setAttribute("aria-label", "Records navigation");
  navigation.innerHTML = `
    <p class="records-desktop-nav-label">N3XRA Records</p>
    <div class="records-desktop-nav-section">
      <p class="records-desktop-nav-group-label">Workspace</p>
      <nav class="records-desktop-nav-links records-desktop-nav-primary">
        ${RECORDS_WORKSPACE_LINKS.map((item) => renderPrimaryLink(item, activePage)).join("")}
      </nav>

      <button
        class="records-desktop-nav-parent records-desktop-nav-toggle"
        type="button"
        data-records-manage-toggle
        aria-expanded="false"
        aria-controls="records-shared-manage-library-menu"
      >
        <span>Manage library</span>
        <span class="records-desktop-nav-toggle-icon" data-records-manage-indicator aria-hidden="true">+</span>
      </button>
      <nav
        class="records-desktop-nav-links records-desktop-nav-submenu records-desktop-nav-manage"
        id="records-shared-manage-library-menu"
        data-records-manage-menu
        hidden
      >
        ${RECORDS_MANAGE_GROUPS.map(renderManageGroup).join("")}
      </nav>

      <div class="records-desktop-nav-divider"></div>
      <p class="records-desktop-nav-group-label">Account</p>
      <nav class="records-desktop-nav-links records-desktop-nav-account">
        <a href="/n3xra-records/account/?view=profile"${activePage === "account" ? ' class="is-active" aria-current="page"' : ""}>Profile</a>
      </nav>
    </div>
  `;

  const manageToggle = navigation.querySelector("[data-records-manage-toggle]");
  const manageMenu = navigation.querySelector("[data-records-manage-menu]");
  const manageIndicator = navigation.querySelector("[data-records-manage-indicator]");
  manageToggle?.addEventListener("click", () => {
    const isOpen = manageToggle.getAttribute("aria-expanded") === "true";
    manageToggle.setAttribute("aria-expanded", String(!isOpen));
    manageToggle.classList.toggle("records-desktop-nav-parent-active", !isOpen);
    if (manageMenu) manageMenu.hidden = isOpen;
    if (manageIndicator) manageIndicator.textContent = isOpen ? "+" : "−";
  });

  return navigation;
}

function installDesktopHeader() {
  const topbarInner = document.querySelector(".topbar > .topbar-inner");
  if (!topbarInner || topbarInner.querySelector(".records-desktop-appbar")) return;

  const appbar = document.createElement("div");
  appbar.className = "records-desktop-appbar";
  appbar.innerHTML = `
    <a class="records-desktop-app-brand" href="/n3xra-records/library" aria-label="N3XRA Records home">
      <img src="/assets/n3xra_logo_transparent_small.png" alt="">
      <span>N3XRA</span>
      <i aria-hidden="true"></i>
      <strong>Records</strong>
    </a>
    <div class="records-desktop-app-actions">
      <button class="records-ai-header-trigger" type="button" data-records-ai-open>Ask Records AI</button>
      <a href="/account/">Dashboard</a>
      <button type="button" data-records-desktop-signout>Sign out</button>
    </div>
  `;

  appbar.querySelector("[data-records-desktop-signout]")?.addEventListener("click", () => {
    document.getElementById("mobile-logout-button")?.click();
  });

  topbarInner.prepend(appbar);
}

function installMobileDocumentBuilderLink(activePage) {
  const mobileMenu = document.getElementById("mobile-menu");
  const libraryLink = document.getElementById("mobile-menu-library");
  const messagesLink = document.getElementById("mobile-menu-messages-link");
  const meetingNotesLink = document.getElementById("mobile-menu-recordings-link");
  document.getElementById("mobile-menu-files-link")?.remove();
  if (!mobileMenu || !libraryLink || mobileMenu.querySelector("[data-mobile-document-builder]")) return;

  const link = document.createElement("a");
  link.className = "mobile-menu-link button-link";
  link.href = "/n3xra-records/documents.html";
  link.textContent = "Document Builder";
  link.setAttribute("data-mobile-document-builder", "");
  if (activePage === "document-builder") {
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  }
  // Keep the workspace destinations in the same order on mobile and desktop.
  // Moving existing nodes preserves their listeners and active-state behavior.
  libraryLink.insertAdjacentElement("afterend", link);
  if (meetingNotesLink) mobileMenu.insertBefore(meetingNotesLink, link);
  if (messagesLink) mobileMenu.insertBefore(messagesLink, link.nextSibling);
}

function getRecordsAiLibraryName() {
  const activeSelect =
    document.getElementById("active-organization-select")
    || document.getElementById("library-active-organization-select");
  const selectedLabel = activeSelect?.selectedOptions?.[0]?.textContent?.trim();
  if (selectedLabel) return selectedLabel.replace(/\s+\([^)]*\)\s*$/, "");

  const activeName =
    document.getElementById("active-organization-name")
    || document.getElementById("library-active-organization-name");
  return String(activeName?.textContent || "").trim();
}

function appendRecordsAiInlineMarkup(container, value) {
  const text = String(value || "");
  const tokenPattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      container.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const link = document.createElement("a");
      link.textContent = parts?.[1] || token;
      link.href = parts?.[2] || "#";
      if (/^https?:\/\//i.test(parts?.[2] || "")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      container.append(link);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderRecordsAiAnswer(container, content) {
  const normalized = String(content || "")
    .trim()
    .replace(/\s+(#{1,3}\s+)/g, "\n$1")
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    .replace(/\s+([-*]\s+)/g, "\n$1");
  const lines = normalized.split(/\r?\n/);
  let activeList = null;
  let activeListType = "";

  const endList = () => {
    activeList = null;
    activeListType = "";
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      endList();
      return;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (orderedMatch || unorderedMatch) {
      const type = orderedMatch ? "ol" : "ul";
      if (!activeList || activeListType !== type) {
        activeList = document.createElement(type);
        activeListType = type;
        container.append(activeList);
      }
      const item = document.createElement("li");
      appendRecordsAiInlineMarkup(item, (orderedMatch || unorderedMatch)[1]);
      activeList.append(item);
      return;
    }

    endList();
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    const block = document.createElement(headingMatch ? "h3" : "p");
    if (headingMatch) block.className = "records-ai-answer-heading";
    appendRecordsAiInlineMarkup(block, headingMatch ? headingMatch[2] : line);
    container.append(block);
  });
}

function appendRecordsAiMessage(container, role, content, actions = []) {
  if (!container || !content) return;
  const message = document.createElement("div");
  message.className = `records-ai-message is-${role}`;

  const label = document.createElement("p");
  label.className = "records-ai-message-label";
  label.textContent = role === "assistant" ? "Records AI" : "You";

  const copy = document.createElement("div");
  copy.className = "records-ai-message-copy";
  if (role === "assistant") {
    renderRecordsAiAnswer(copy, content);
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    copy.append(paragraph);
  }

  message.append(label, copy);
  if (role === "assistant" && Array.isArray(actions) && actions.length) {
    const actionRow = document.createElement("div");
    actionRow.className = "records-ai-message-actions";
    actions.slice(0, 2).forEach((action) => {
      const guide = normalizeRecordsAiGuide(action?.guide);
      if (!RECORDS_AI_ACTIONS[action?.id] && !guide) return;
      const button = document.createElement("button");
      button.type = "button";
      if (guide) {
        button.dataset.recordsAiGuide = "";
        button.recordsAiGuidePlan = guide;
        button.textContent = guide.buttonLabel;
      } else {
        button.dataset.recordsAiAction = action.id;
        button.textContent = RECORDS_AI_ACTIONS[action.id].label;
      }
      actionRow.append(button);
    });
    if (actionRow.childElementCount) message.append(actionRow);
  }
  container.append(message);
  container.scrollTop = container.scrollHeight;
}

function setRecordsAiStatus(message = "", tone = "") {
  const status = document.querySelector("[data-records-ai-status]");
  if (!status) return;
  status.textContent = message;
  status.className = "records-ai-status";
  if (tone) status.classList.add(`is-${tone}`);
}

function setRecordsAiVoiceButton(recording) {
  const button = document.querySelector("[data-records-ai-voice]");
  if (!button) return;
  button.classList.toggle("is-recording", recording);
  button.setAttribute("aria-pressed", recording ? "true" : "false");
  button.innerHTML = recording
    ? '<span aria-hidden="true">■</span> Stop recording'
    : '<span aria-hidden="true">●</span> Talk to Records AI';
}

function resetRecordsAiAudioControls() {
  const listenButton = document.querySelector("[data-records-ai-listen]");
  const stopButton = document.querySelector("[data-records-ai-stop-audio]");
  if (listenButton) {
    listenButton.hidden = !recordsAiLastAnswer;
    listenButton.disabled = false;
    listenButton.textContent = "Listen";
  }
  if (stopButton) stopButton.hidden = true;
}

function stopRecordsAiPlayback() {
  if (recordsAiCurrentAudio) {
    recordsAiCurrentAudio.pause();
    recordsAiCurrentAudio = null;
  }
  if (recordsAiCurrentAudioUrl) {
    URL.revokeObjectURL(recordsAiCurrentAudioUrl);
    recordsAiCurrentAudioUrl = "";
  }
  resetRecordsAiAudioControls();
}

function stopRecordsAiGuideSpeech() {
  window.speechSynthesis?.cancel();
  if (recordsAiGuideAudio) {
    recordsAiGuideAudio.pause();
    recordsAiGuideAudio = null;
  }
  if (recordsAiGuideAudioUrl) {
    URL.revokeObjectURL(recordsAiGuideAudioUrl);
    recordsAiGuideAudioUrl = "";
  }
}

function fallbackRecordsAiGuideSpeech(text) {
  return new Promise((resolve) => {
    if (!recordsAiGuideVoiceEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    utterance.rate = 1.02;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    window.setTimeout(finish, 8000);
  });
}

async function narrateRecordsAiGuide(message) {
  const text = String(message || "").trim();
  if (!recordsAiGuideVoiceEnabled || !text) return;
  stopRecordsAiGuideSpeech();

  try {
    const response = await fetch("/api/elevenlabs-text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error("Guide voice unavailable");
    recordsAiGuideAudioUrl = URL.createObjectURL(await response.blob());
    const audio = new Audio(recordsAiGuideAudioUrl);
    recordsAiGuideAudio = audio;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (recordsAiGuideAudio === audio) recordsAiGuideAudio = null;
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(() => finish(), 10000);
      audio.addEventListener("ended", () => finish(), { once: true });
      audio.addEventListener("error", () => finish(new Error("Guide audio failed")), { once: true });
      audio.play().catch((error) => finish(error));
    });
  } catch {
    await fallbackRecordsAiGuideSpeech(text);
  } finally {
    if (recordsAiGuideAudioUrl) {
      URL.revokeObjectURL(recordsAiGuideAudioUrl);
      recordsAiGuideAudioUrl = "";
    }
  }
}

function updateRecordsAiGuideVoiceButton() {
  const button = document.querySelector("[data-records-ai-guide-voice]");
  if (!button) return;
  button.setAttribute("aria-pressed", String(recordsAiGuideVoiceEnabled));
  button.textContent = recordsAiGuideVoiceEnabled ? "Guide voice on" : "Guide voice off";
}

function toggleRecordsAiGuideVoice() {
  recordsAiGuideVoiceEnabled = !recordsAiGuideVoiceEnabled;
  if (!recordsAiGuideVoiceEnabled) stopRecordsAiGuideSpeech();
  try {
    window.localStorage.setItem("n3xra-records-guide-voice", recordsAiGuideVoiceEnabled ? "on" : "off");
  } catch {
    // The preference remains active for this page when storage is unavailable.
  }
  updateRecordsAiGuideVoiceButton();
}

async function speakRecordsAiAnswer(answer = recordsAiLastAnswer) {
  const text = String(answer || "").trim();
  if (!text) return;

  stopRecordsAiPlayback();
  const listenButton = document.querySelector("[data-records-ai-listen]");
  const stopButton = document.querySelector("[data-records-ai-stop-audio]");
  if (listenButton) {
    listenButton.hidden = true;
    listenButton.disabled = true;
  }
  if (stopButton) stopButton.hidden = false;
  setRecordsAiStatus("Preparing voice answer…");

  try {
    const response = await fetch("/api/elevenlabs-text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(String(data?.error || "Voice playback is unavailable right now."));
    }

    recordsAiCurrentAudioUrl = URL.createObjectURL(await response.blob());
    recordsAiCurrentAudio = new Audio(recordsAiCurrentAudioUrl);
    recordsAiCurrentAudio.addEventListener("ended", () => {
      stopRecordsAiPlayback();
      setRecordsAiStatus("");
    }, { once: true });
    recordsAiCurrentAudio.addEventListener("error", () => {
      stopRecordsAiPlayback();
      setRecordsAiStatus("Voice playback is unavailable right now.", "error");
    }, { once: true });
    await recordsAiCurrentAudio.play();
    if (listenButton) listenButton.disabled = false;
    setRecordsAiStatus("");
  } catch (error) {
    stopRecordsAiPlayback();
    const blocked = error?.name === "NotAllowedError" || /not allowed|user agent|current context/i.test(String(error?.message || ""));
    setRecordsAiStatus(
      blocked ? "Audio is ready. Select Listen to play it." : (error instanceof Error ? error.message : "Voice playback is unavailable right now."),
      blocked ? "" : "error"
    );
  }
}

async function transcribeRecordsAiAudio(blob) {
  const response = await fetch("/api/elevenlabs-speech-to-text", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || "I could not hear that. Please try again."));
  return String(data?.text || "").trim();
}

async function requestRecordsAiWakeLock() {
  recordsAiWakeLockWanted = true;
  if (!navigator.wakeLock?.request || document.visibilityState !== "visible" || recordsAiWakeLock) return;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (!recordsAiWakeLockWanted || recordsAiMediaRecorder?.state !== "recording") {
      await sentinel.release();
      return;
    }
    recordsAiWakeLock = sentinel;
    sentinel.addEventListener("release", () => {
      if (recordsAiWakeLock === sentinel) recordsAiWakeLock = null;
    }, { once: true });
  } catch {
    // Voice questions are short, so recording remains available without wake-lock support.
  }
}

function releaseRecordsAiWakeLock() {
  recordsAiWakeLockWanted = false;
  const sentinel = recordsAiWakeLock;
  recordsAiWakeLock = null;
  if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
}

function stopRecordsAiRecording({ discard = false } = {}) {
  recordsAiDiscardRecording = discard;
  clearTimeout(recordsAiRecordingTimer);
  if (recordsAiMediaRecorder?.state === "recording") {
    recordsAiMediaRecorder.stop();
  } else {
    recordsAiMediaStream?.getTracks().forEach((track) => track.stop());
    recordsAiMediaStream = null;
    setRecordsAiVoiceButton(false);
    releaseRecordsAiWakeLock();
  }
}

async function handleRecordsAiVoiceButton() {
  const button = document.querySelector("[data-records-ai-voice]");
  if (!button) return;
  if (recordsAiMediaRecorder?.state === "recording") {
    stopRecordsAiRecording();
    return;
  }

  try {
    recordsAiDiscardRecording = false;
    setRecordsAiStatus("Allow microphone access to talk with Records AI.");
    recordsAiMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = mimeType
      ? new MediaRecorder(recordsAiMediaStream, { mimeType })
      : new MediaRecorder(recordsAiMediaStream);
    recordsAiMediaRecorder = recorder;
    recordsAiAudioChunks = [];

    recordsAiMediaStream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (recordsAiMediaRecorder?.state === "recording") stopRecordsAiRecording();
      }, { once: true });
    });

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordsAiAudioChunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      clearTimeout(recordsAiRecordingTimer);
      recordsAiMediaStream?.getTracks().forEach((track) => track.stop());
      recordsAiMediaStream = null;
      recordsAiMediaRecorder = null;
      releaseRecordsAiWakeLock();
      setRecordsAiVoiceButton(false);

      if (recordsAiDiscardRecording) {
        recordsAiAudioChunks = [];
        recordsAiDiscardRecording = false;
        setRecordsAiStatus("");
        return;
      }

      button.disabled = true;
      setRecordsAiStatus("Transcribing…");
      try {
        const recording = new Blob(recordsAiAudioChunks, { type: recorder.mimeType || "audio/webm" });
        const transcript = await transcribeRecordsAiAudio(recording);
        if (!transcript) throw new Error("I could not hear a question. Please try again.");
        const input = document.querySelector("[data-records-ai-question]");
        if (input) input.value = transcript;
        recordsAiVoiceSubmission = true;
        input?.form?.requestSubmit();
      } catch (error) {
        setRecordsAiStatus(error instanceof Error ? error.message : "I could not hear that. Please try again.", "error");
      } finally {
        button.disabled = false;
        recordsAiAudioChunks = [];
      }
    }, { once: true });

    recorder.start();
    void requestRecordsAiWakeLock();
    setRecordsAiVoiceButton(true);
    setRecordsAiStatus("Listening… Select Stop recording when you are finished.");
    recordsAiRecordingTimer = window.setTimeout(() => stopRecordsAiRecording(), 30000);
  } catch {
    recordsAiMediaStream?.getTracks().forEach((track) => track.stop());
    recordsAiMediaStream = null;
    recordsAiMediaRecorder = null;
    releaseRecordsAiWakeLock();
    setRecordsAiVoiceButton(false);
    setRecordsAiStatus("Microphone access is needed to talk with Records AI.", "error");
  }
}

function openRecordsAiAssistant() {
  const layer = document.querySelector("[data-records-ai-layer]");
  if (!layer) return;
  recordsAiLastFocusedElement = document.activeElement;
  layer.hidden = false;
  window.requestAnimationFrame(() => {
    layer.classList.add("is-open");
    layer.querySelector("[data-records-ai-question]")?.focus();
  });
}

function closeRecordsAiAssistant() {
  const layer = document.querySelector("[data-records-ai-layer]");
  if (!layer || layer.hidden) return;
  stopRecordsAiRecording({ discard: true });
  stopRecordsAiPlayback();
  layer.classList.remove("is-open");
  window.setTimeout(() => {
    layer.hidden = true;
    if (recordsAiLastFocusedElement instanceof HTMLElement) recordsAiLastFocusedElement.focus();
  }, 220);
}

function isRecordsAiElementVisible(element) {
  return Boolean(element && !element.hidden && element.getClientRects().length);
}

function showRecordsAiGuideNote(message, eyebrow = "Records AI guide") {
  let note = document.querySelector("[data-records-ai-guide-note]");
  if (!note) {
    note = document.createElement("div");
    note.className = "records-ai-guide-note";
    note.dataset.recordsAiGuideNote = "";
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    document.body.append(note);
  }
  note.innerHTML = "";
  const kicker = document.createElement("span");
  kicker.textContent = eyebrow;
  const copy = document.createElement("strong");
  copy.textContent = message;
  note.append(kicker, copy);
  note.classList.add("is-visible");
}

function hideRecordsAiGuideNote(delay = 0) {
  window.setTimeout(() => {
    document.querySelector("[data-records-ai-guide-note]")?.classList.remove("is-visible");
  }, delay);
}

function markRecordsAiGuideTarget(target, message, eyebrow) {
  document.querySelectorAll(".records-ai-spotlight").forEach((element) => element.classList.remove("records-ai-spotlight"));
  showRecordsAiGuideNote(message, eyebrow);
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("records-ai-spotlight");
  void target.offsetWidth;
  target.classList.add("records-ai-spotlight");
}

function spotlightRecordsAiTarget(actionId, attempt = 0, activate = true) {
  const action = RECORDS_AI_ACTIONS[actionId];
  const activationTarget = activate && action?.activationSelector
    ? document.querySelector(action.activationSelector)
    : null;
  const target = action ? document.querySelector(action.selector) : null;
  const expectedTarget = activationTarget || target;
  if ((!expectedTarget || !isRecordsAiElementVisible(expectedTarget)) && attempt < 64) {
    window.setTimeout(() => spotlightRecordsAiTarget(actionId, attempt + 1, activate), 125);
    return;
  }
  if (!expectedTarget || !isRecordsAiElementVisible(expectedTarget)) {
    showRecordsAiGuideNote("That area is not available with the current page or access.", "Unable to continue");
    hideRecordsAiGuideNote(4000);
    return;
  }

  if (activationTarget) {
    const instruction = `Now, choose ${action.activationLabel}.`;
    markRecordsAiGuideTarget(activationTarget, `Choose ${action.activationLabel}`, "Next selection");
    void (async () => {
      await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, 1250)),
        narrateRecordsAiGuide(instruction),
      ]);
      activationTarget.click();
      activationTarget.classList.remove("records-ai-spotlight");
      window.setTimeout(() => spotlightRecordsAiTarget(actionId, 0, false), 350);
    })();
    return;
  }

  markRecordsAiGuideTarget(target, action.label, "You’re here");
  void narrateRecordsAiGuide(`You’ve reached ${getRecordsAiSpokenDestination(action)}.`);
  window.setTimeout(() => target.classList.remove("records-ai-spotlight"), 4200);
  hideRecordsAiGuideNote(4200);
  if (typeof target.focus === "function") target.focus({ preventScroll: true });
}

function getRecordsAiNavigationTarget(action, destination) {
  const isDesktop = getRecordsAiDisplayContext().displayMode === "desktop";
  const requiredView = destination.searchParams.get("view");
  if (requiredView) {
    if (isDesktop) {
      const localButton = document.querySelector(`[data-records-account-view="${requiredView}"]`);
      if (localButton) return localButton;
      return Array.from(document.querySelectorAll(".records-desktop-nav-manage a")).find((link) => {
        const url = new URL(link.href, window.location.origin);
        return url.searchParams.get("view") === requiredView;
      }) || null;
    }
    return document.getElementById("mobile-menu-account");
  }

  const destinationPath = normalizePathname(destination.pathname);
  const navigationRoot = isDesktop
    ? document.querySelector(".records-desktop-nav")
    : document.getElementById("mobile-menu");
  return Array.from(navigationRoot?.querySelectorAll("a") || []).find((link) => {
    const url = new URL(link.href, window.location.origin);
    return normalizePathname(url.pathname) === destinationPath;
  }) || null;
}

function getRecordsAiSelectionLabel(action, destination) {
  const view = destination.searchParams.get("view");
  if (view) {
    const viewLabels = {
      profile: "Profile",
      library: "Library settings",
      templates: "Templates",
      phone: "Phone Meetings",
      ai: "AI settings",
      users: "Users",
      contacts: "Contacts",
      access: "Invites & access",
      storage: "Storage",
      billing: "Billing",
      activity: "Audit activity",
      support: "N3XRA support access",
    };
    return viewLabels[view] || action.label.replace(/^(Open|Show)\s+/i, "");
  }
  if (destination.pathname.includes("meeting-notes")) return "Meeting Notes";
  if (destination.pathname.includes("documents")) return "Document Builder";
  if (destination.pathname.includes("messages")) return "Communication";
  return "Library";
}

function getRecordsAiSpokenDestination(action) {
  return String(action?.label || "this area")
    .replace(/^(Open|Show)\s+/i, "")
    .replace(/^document upload$/i, "Document upload")
    .replace(/^new meeting note$/i, "New meeting note");
}

function normalizeRecordsAiGuide(input) {
  if (!input || typeof input !== "object") return null;
  const buttonLabel = String(input.buttonLabel || "").trim().slice(0, 60);
  const route = String(input.route || "").trim();
  const steps = Array.isArray(input.steps)
    ? input.steps.slice(0, 7).map((step) => ({
        target: String(step?.target || "").trim().slice(0, 100),
        narration: String(step?.narration || "").trim().slice(0, 220),
      })).filter((step) => step.target)
    : [];
  if (!buttonLabel || !RECORDS_AI_GUIDE_ROUTES.has(route) || !steps.length) return null;
  return { buttonLabel, route, steps };
}

function normalizeRecordsAiTargetText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+\*/g, "")
    .trim()
    .toLowerCase();
}

function findRecordsAiGuideTarget(label) {
  const expected = normalizeRecordsAiTargetText(label);
  if (!expected) return null;
  const candidates = Array.from(document.querySelectorAll(
    "button, a, label, legend, [role='button'], [role='tab'], h1, h2, h3, h4, .field-title"
  )).filter((element) => !element.closest("[data-records-ai-layer]") && isRecordsAiElementVisible(element));
  return candidates.find((element) => normalizeRecordsAiTargetText(element.textContent) === expected)
    || candidates.find((element) => normalizeRecordsAiTargetText(element.textContent).startsWith(expected))
    || null;
}

function safelyRevealRecordsAiGuideTarget(target) {
  if (!target) return;
  const radio = target.matches("input[type='radio']")
    ? target
    : target.querySelector?.("input[type='radio']");
  if (radio && !radio.disabled && !radio.checked) {
    radio.click();
    return;
  }
  const role = target.getAttribute("role");
  if (role === "tab" && target.getAttribute("aria-selected") !== "true") {
    target.click();
    return;
  }
  if (
    target.matches("button, [role='button']")
    && target.hasAttribute("aria-controls")
    && target.getAttribute("aria-expanded") === "false"
    && !target.disabled
  ) target.click();
}

async function playRecordsAiGuidePlan(input) {
  const guide = normalizeRecordsAiGuide(input);
  if (!guide) return;
  for (let index = 0; index < guide.steps.length; index += 1) {
    const step = guide.steps[index];
    let target = null;
    for (let attempt = 0; attempt < 24 && !target; attempt += 1) {
      target = findRecordsAiGuideTarget(step.target);
      if (!target) await new Promise((resolve) => window.setTimeout(resolve, 125));
    }
    if (!target) {
      showRecordsAiGuideNote(`I couldn’t find “${step.target}” on this page.`, "Guide paused");
      void narrateRecordsAiGuide(`I couldn't find ${step.target} on this page.`);
      hideRecordsAiGuideNote(5000);
      return;
    }

    const isLast = index === guide.steps.length - 1;
    const spoken = step.narration || `${isLast ? "Finally" : "Next"}, find ${step.target}.`;
    markRecordsAiGuideTarget(target, step.target, isLast ? "Final step" : `Step ${index + 1} of ${guide.steps.length}`);
    await Promise.all([
      new Promise((resolve) => window.setTimeout(resolve, isLast ? 1500 : 1200)),
      narrateRecordsAiGuide(spoken),
    ]);
    if (!isLast) {
      safelyRevealRecordsAiGuideTarget(target);
      target.classList.remove("records-ai-spotlight");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    } else {
      window.setTimeout(() => target.classList.remove("records-ai-spotlight"), 5000);
      hideRecordsAiGuideNote(5000);
    }
  }
}

async function runRecordsAiGuidePlan(input) {
  const guide = normalizeRecordsAiGuide(input);
  if (!guide) return;
  const destination = new URL(guide.route, window.location.origin);
  const currentPath = normalizePathname(window.location.pathname);
  const destinationPath = normalizePathname(destination.pathname);
  const requiredView = destination.searchParams.get("view");
  const currentView = new URLSearchParams(window.location.search).get("view");

  closeRecordsAiAssistant();
  if (currentPath === destinationPath && (!requiredView || requiredView === currentView)) {
    window.setTimeout(() => void playRecordsAiGuidePlan(guide), 260);
    return;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 260));
  await guideRecordsAiNavigation({ label: guide.buttonLabel }, destination);
  try {
    window.sessionStorage.setItem(RECORDS_AI_PENDING_GUIDE_KEY, JSON.stringify(guide));
  } catch {
    showRecordsAiGuideNote("The guided path could not continue across pages in this browser.", "Guide paused");
    hideRecordsAiGuideNote(4500);
    return;
  }
  destination.searchParams.set("recordsAiGuide", "1");
  window.location.assign(`${destination.pathname}${destination.search}`);
}

function applyPendingRecordsAiGuide() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("recordsAiGuide") !== "1") return;
  url.searchParams.delete("recordsAiGuide");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  let guide = null;
  try {
    guide = JSON.parse(window.sessionStorage.getItem(RECORDS_AI_PENDING_GUIDE_KEY) || "null");
    window.sessionStorage.removeItem(RECORDS_AI_PENDING_GUIDE_KEY);
  } catch {
    guide = null;
  }
  if (normalizeRecordsAiGuide(guide)) window.setTimeout(() => void playRecordsAiGuidePlan(guide), 250);
}

async function guideRecordsAiNavigation(action, destination) {
  const isDesktop = getRecordsAiDisplayContext().displayMode === "desktop";
  const requiredView = destination.searchParams.get("view");
  let hasPriorSelection = false;

  if (requiredView && isDesktop) {
    const manageToggle = document.querySelector("[data-records-manage-toggle]");
    if (manageToggle?.getAttribute("aria-expanded") !== "true") {
      const instruction = "First, open Manage library.";
      markRecordsAiGuideTarget(manageToggle, "Open Manage library", "First selection");
      await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, 1050)),
        narrateRecordsAiGuide(instruction),
      ]);
      manageToggle.click();
      hasPriorSelection = true;
      manageToggle.classList.remove("records-ai-spotlight");
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  } else if (!isDesktop) {
    const mobileMenu = document.getElementById("mobile-menu");
    const menuToggle = document.getElementById("mobile-menu-toggle");
    if (mobileMenu?.classList.contains("hidden") && menuToggle) {
      const instruction = "First, open the Records menu.";
      markRecordsAiGuideTarget(menuToggle, "Open the Records menu", "First selection");
      await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, 1050)),
        narrateRecordsAiGuide(instruction),
      ]);
      menuToggle.click();
      hasPriorSelection = true;
      menuToggle.classList.remove("records-ai-spotlight");
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }

  const navigationTarget = getRecordsAiNavigationTarget(action, destination);
  if (navigationTarget && isRecordsAiElementVisible(navigationTarget)) {
    const selectionLabel = getRecordsAiSelectionLabel(action, destination);
    const instruction = `${hasPriorSelection ? "Then" : "First"}, choose ${selectionLabel}.`;
    markRecordsAiGuideTarget(
      navigationTarget,
      `Choose ${selectionLabel}`,
      hasPriorSelection ? "Next selection" : "First selection"
    );
    await Promise.all([
      new Promise((resolve) => window.setTimeout(resolve, 1350)),
      narrateRecordsAiGuide(instruction),
    ]);
    navigationTarget.classList.remove("records-ai-spotlight");
  }
}

async function runRecordsAiAction(actionId) {
  const action = RECORDS_AI_ACTIONS[actionId];
  if (!action) return;
  const destination = new URL(action.href, window.location.origin);
  const currentPath = normalizePathname(window.location.pathname);
  const destinationPath = normalizePathname(destination.pathname);

  closeRecordsAiAssistant();
  if (currentPath === destinationPath) {
    const requiredView = destination.searchParams.get("view");
    const currentView = new URLSearchParams(window.location.search).get("view");
    if (!requiredView || requiredView === currentView) {
      window.setTimeout(() => spotlightRecordsAiTarget(actionId), 250);
      return;
    }
  }

  await new Promise((resolve) => window.setTimeout(resolve, 260));
  await guideRecordsAiNavigation(action, destination);
  const openingLabel = action.label.replace(/^(Open|Show)\s+/i, "");
  showRecordsAiGuideNote(`Opening ${openingLabel}…`, "Moving to the destination");
  destination.searchParams.set("recordsAiFocus", actionId);
  window.location.assign(`${destination.pathname}${destination.search}`);
}

function applyPendingRecordsAiSpotlight() {
  const url = new URL(window.location.href);
  const actionId = url.searchParams.get("recordsAiFocus") || "";
  if (!RECORDS_AI_ACTIONS[actionId]) return;
  url.searchParams.delete("recordsAiFocus");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  spotlightRecordsAiTarget(actionId);
}

async function getRecordsAiAccessToken() {
  if (!hasConfig()) throw new Error("Records is not configured on this server.");
  if (!recordsAiSupabase) recordsAiSupabase = createBrowserSupabase();
  const { data: refreshedData } = await recordsAiSupabase.auth.refreshSession();
  const { data: sessionData } = await recordsAiSupabase.auth.getSession();
  return refreshedData?.session?.access_token || sessionData?.session?.access_token || "";
}

function getRecordsAiDisplayContext() {
  const viewportWidth = Math.max(0, Math.round(Number(window.innerWidth) || 0));
  const viewportHeight = Math.max(0, Math.round(Number(window.innerHeight) || 0));
  const isDesktop =
    typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${DESKTOP_SHELL_BREAKPOINT}px)`).matches
      : viewportWidth >= DESKTOP_SHELL_BREAKPOINT;
  const manageLibraryToggle = document.querySelector("[data-records-manage-toggle]");
  const mobileMenu = document.getElementById("mobile-menu");

  return {
    displayMode: isDesktop ? "desktop" : "mobile",
    viewportWidth,
    viewportHeight,
    manageLibraryExpanded: manageLibraryToggle
      ? manageLibraryToggle.getAttribute("aria-expanded") === "true"
      : null,
    mobileMenuOpen: mobileMenu ? !mobileMenu.classList.contains("hidden") : null,
  };
}

async function askRecordsAi(question) {
  const accessToken = await getRecordsAiAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

  const organizationId = getStoredActiveOrganizationId();
  if (!organizationId) throw new Error("Choose an active library before asking Records AI.");

  const response = await fetch("/api/records-help", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      question,
      history: recordsAiHistory,
      context: {
        organizationId,
        libraryName: getRecordsAiLibraryName(),
        role: "",
        plan: "",
        currentPath: window.location.pathname,
        ...getRecordsAiDisplayContext(),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Records AI is unavailable right now.");
  return {
    answer: String(data?.answer || "").trim(),
    actions: Array.isArray(data?.actions) ? data.actions : [],
  };
}

async function handleRecordsAiSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const questionInput = form.querySelector("[data-records-ai-question]");
  const submitButton = form.querySelector("[data-records-ai-submit]");
  const messages = document.querySelector("[data-records-ai-messages]");
  const question = String(questionInput?.value || "").trim();
  const shouldSpeak = recordsAiVoiceSubmission;
  recordsAiVoiceSubmission = false;
  if (!question) {
    setRecordsAiStatus("Enter a question first.", "error");
    questionInput?.focus();
    return;
  }

  appendRecordsAiMessage(messages, "user", question);
  stopRecordsAiPlayback();
  questionInput.value = "";
  submitButton.disabled = true;
  setRecordsAiStatus("Records AI is thinking…");

  try {
    const result = await askRecordsAi(question);
    const answer = result.answer;
    if (!answer) throw new Error("Records AI returned an empty answer.");
    appendRecordsAiMessage(messages, "assistant", answer, result.actions);
    recordsAiLastAnswer = answer;
    resetRecordsAiAudioControls();
    recordsAiHistory.push(
      { role: "user", content: question },
      { role: "assistant", content: answer }
    );
    if (recordsAiHistory.length > RECORDS_AI_HISTORY_LIMIT) {
      recordsAiHistory = recordsAiHistory.slice(-RECORDS_AI_HISTORY_LIMIT);
    }
    setRecordsAiStatus("");
    if (shouldSpeak) void speakRecordsAiAnswer(answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to ask Records AI.";
    appendRecordsAiMessage(messages, "assistant", message);
    setRecordsAiStatus(message, "error");
  } finally {
    submitButton.disabled = false;
    questionInput?.focus();
  }
}

function installRecordsAiAssistant() {
  if (document.querySelector("[data-records-ai-layer]")) return;

  const mobileMenu = document.getElementById("mobile-menu");
  if (mobileMenu && !mobileMenu.querySelector("[data-records-ai-open]")) {
    const mobileTrigger = document.createElement("button");
    mobileTrigger.className = "mobile-menu-link records-ai-mobile-trigger";
    mobileTrigger.type = "button";
    mobileTrigger.dataset.recordsAiOpen = "";
    mobileTrigger.textContent = "Ask Records AI";
    mobileMenu.append(mobileTrigger);
  }

  const layer = document.createElement("div");
  layer.className = "records-ai-layer";
  layer.dataset.recordsAiLayer = "";
  layer.hidden = true;
  layer.innerHTML = `
    <button class="records-ai-scrim" type="button" data-records-ai-close aria-label="Close Records AI"></button>
    <aside class="records-ai-drawer" role="dialog" aria-modal="true" aria-labelledby="records-ai-title">
      <header class="records-ai-drawer-head">
        <div>
          <p class="records-ai-kicker">N3XRA Records</p>
          <h2 id="records-ai-title">Ask Records AI</h2>
          <p>Guidance for finding tools and completing work in Records.</p>
        </div>
        <button class="records-ai-close" type="button" data-records-ai-close aria-label="Close Records AI">×</button>
      </header>
      <div class="records-ai-messages" data-records-ai-messages aria-live="polite"></div>
      <div class="records-ai-starters" aria-label="Suggested questions">
        <button type="button" data-records-ai-prompt="Give me the shortest steps to start and finish a meeting note.">Meeting notes</button>
        <button type="button" data-records-ai-prompt="Give me the shortest steps to invite a user and choose their access.">Invite a user</button>
        <button type="button" data-records-ai-prompt="Where do I change this library's AI settings?">AI settings</button>
      </div>
      <form class="records-ai-composer" data-records-ai-form>
        <label for="records-ai-question">Ask a Records question</label>
        <div class="records-ai-input-row">
          <textarea id="records-ai-question" data-records-ai-question rows="2" maxlength="900" placeholder="How do I…"></textarea>
          <button type="submit" data-records-ai-submit>Ask</button>
        </div>
        <div class="records-ai-voice-controls">
          <button type="button" data-records-ai-voice aria-pressed="false"><span aria-hidden="true">●</span> Talk to Records AI</button>
          <button type="button" data-records-ai-listen hidden>Listen</button>
          <button type="button" data-records-ai-stop-audio hidden>Stop audio</button>
          <button type="button" data-records-ai-guide-voice aria-pressed="true">Guide voice on</button>
        </div>
        <p class="records-ai-status" data-records-ai-status></p>
      </form>
    </aside>
  `;
  document.body.append(layer);

  const messages = layer.querySelector("[data-records-ai-messages]");
  appendRecordsAiMessage(
    messages,
    "assistant",
    "Tell me what you’re trying to accomplish. I can help you find the right tools, understand your options, and move through Records step by step."
  );

  document.querySelectorAll("[data-records-ai-open]").forEach((button) => {
    button.addEventListener("click", openRecordsAiAssistant);
  });
  layer.querySelectorAll("[data-records-ai-close]").forEach((button) => {
    button.addEventListener("click", closeRecordsAiAssistant);
  });
  layer.querySelector("[data-records-ai-form]")?.addEventListener("submit", handleRecordsAiSubmit);
  const voiceButton = layer.querySelector("[data-records-ai-voice]");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    if (voiceButton) voiceButton.hidden = true;
  } else {
    voiceButton?.addEventListener("click", handleRecordsAiVoiceButton);
  }
  layer.querySelector("[data-records-ai-listen]")?.addEventListener("click", () => void speakRecordsAiAnswer());
  layer.querySelector("[data-records-ai-stop-audio]")?.addEventListener("click", () => {
    stopRecordsAiPlayback();
    setRecordsAiStatus("");
  });
  layer.querySelector("[data-records-ai-guide-voice]")?.addEventListener("click", toggleRecordsAiGuideVoice);
  updateRecordsAiGuideVoiceButton();
  layer.querySelector("[data-records-ai-question]")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  });
  layer.querySelectorAll("[data-records-ai-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = layer.querySelector("[data-records-ai-question]");
      input.value = button.dataset.recordsAiPrompt || "";
      input.focus();
    });
  });
  layer.querySelector("[data-records-ai-messages]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-records-ai-action], [data-records-ai-guide]");
    if (button && !button.disabled) {
      button.disabled = true;
      if (button.hasAttribute("data-records-ai-guide")) {
        void runRecordsAiGuidePlan(button.recordsAiGuidePlan);
      } else {
        void runRecordsAiAction(button.dataset.recordsAiAction || "");
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layer.hidden) closeRecordsAiAssistant();
  });
  window.addEventListener("pagehide", () => {
    stopRecordsAiRecording({ discard: true });
    stopRecordsAiPlayback();
    stopRecordsAiGuideSpeech();
  });
  document.addEventListener("visibilitychange", () => {
    if (recordsAiMediaRecorder?.state !== "recording") return;
    if (document.visibilityState === "hidden") {
      try {
        recordsAiMediaRecorder.requestData();
      } catch {
        // The recorder may already be transitioning to its stopped state.
      }
      setRecordsAiStatus("Keep this app open and the screen on until your question is submitted.");
      return;
    }
    void requestRecordsAiWakeLock();
  });
}

function installDesktopShell() {
  const body = document.body;
  const shell = body?.querySelector(":scope > .shell");
  const main = shell?.querySelector(":scope > main.main");
  if (!body || !shell || !main) return;

  const activePage = getActiveRecordsPage();
  installDesktopHeader();
  installMobileDocumentBuilderLink(activePage);
  installRecordsAiAssistant();
  applyPendingRecordsAiSpotlight();
  applyPendingRecordsAiGuide();

  if (body.classList.contains("records-account-page") || shell.querySelector(":scope > .records-desktop-frame")) return;

  const frame = document.createElement("div");
  frame.className = "records-desktop-frame";
  frame.append(buildDesktopNavigation(activePage), main);
  shell.append(frame);
  body.classList.add("records-shared-desktop-shell-page");

  if (window.innerWidth >= DESKTOP_SHELL_BREAKPOINT) {
    main.scrollTop = 0;
  }
}

installDesktopShell();
