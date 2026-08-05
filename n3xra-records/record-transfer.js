import { createBrowserSupabase, hasConfig, getSessionOrNull } from "/shared/lib/supabase-client.js";

const titleEl = document.getElementById("record-transfer-title");
const introEl = document.getElementById("record-transfer-intro");
const errorEl = document.getElementById("record-transfer-error");
const summaryEl = document.getElementById("record-transfer-summary");
const recordingEl = document.getElementById("record-transfer-recording");
const sourceEl = document.getElementById("record-transfer-source");
const emailEl = document.getElementById("record-transfer-email");
const expiresEl = document.getElementById("record-transfer-expires");
const destinationEl = document.getElementById("record-transfer-destination");
const destinationNoteEl = document.getElementById("record-transfer-destination-note");
const acceptButton = document.getElementById("record-transfer-accept");
const statusEl = document.getElementById("record-transfer-status");

let supabase = null;
let token = "";

function show(element, visible) {
  element?.classList.toggle("hidden", !visible);
}

function setStatus(message, tone = "") {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.className = "status";
  if (tone) statusEl.classList.add(tone);
}

function showError(message) {
  if (errorEl) errorEl.textContent = message;
  show(errorEl, true);
  show(summaryEl, false);
  if (introEl) introEl.textContent = "This packet cannot be accepted right now.";
}

function loginUrl() {
  const redirect = `${window.location.pathname}${window.location.search}`;
  const url = new URL("/n3xra-records/login", window.location.origin);
  url.searchParams.set("redirect", redirect);
  return url.href;
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke("transfer-record-packet", { body });
  if (error) {
    const payload = await error.context?.json?.().catch(() => ({}));
    throw new Error(payload?.error || error.message || "Unable to reach the transfer service.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadInvitation() {
  const data = await invoke({ action: "get", token });
  const invitation = data.invitation;
  if (invitation.status !== "pending") {
    throw new Error(`This transfer invitation is ${invitation.status}.`);
  }
  document.title = `${invitation.recordingTitle} Transfer | N3XRA Records`;
  titleEl.textContent = invitation.recordingTitle;
  introEl.textContent = `${invitation.sourceOrganizationName} is offering to transfer this complete record packet to your organization.`;
  recordingEl.textContent = invitation.recordingTitle;
  sourceEl.textContent = invitation.sourceOrganizationName;
  emailEl.textContent = invitation.recipientEmail;
  expiresEl.textContent = new Date(invitation.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  destinationEl.innerHTML = (data.destinations || []).map((organization) => (
    `<option value="${organization.id}">${String(organization.name || "Untitled workspace").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`
  )).join("");
  const hasDestination = Boolean(data.destinations?.length);
  acceptButton.disabled = !hasDestination;
  if (!hasDestination) {
    destinationEl.innerHTML = '<option value="">No eligible Organization workspaces</option>';
    destinationNoteEl.textContent = "This account needs an active Organization workspace, with you as Account Admin, before it can receive the packet.";
  }
  show(errorEl, false);
  show(summaryEl, true);
}

async function acceptTransfer() {
  const targetOrganizationId = destinationEl.value;
  if (!targetOrganizationId) return;
  acceptButton.disabled = true;
  destinationEl.disabled = true;
  setStatus("Moving the secure record packet. Keep this page open...");
  try {
    const data = await invoke({ action: "accept", token, targetOrganizationId });
    titleEl.textContent = "Record packet received";
    introEl.textContent = `${data.result?.title || "The record packet"} is now in ${data.result?.target_organization_name || "your workspace"}.`;
    show(summaryEl, false);
    setStatus("Transfer complete. Opening Meeting Notes...", "success");
    window.setTimeout(() => {
      window.location.href = `/n3xra-records/meeting-notes?recording=${encodeURIComponent(data.result?.recording_id || "")}`;
    }, 900);
  } catch (error) {
    setStatus(error?.message || "Unable to accept the record packet.", "error");
    acceptButton.disabled = false;
    destinationEl.disabled = false;
  }
}

async function init() {
  token = new URLSearchParams(window.location.search).get("token")?.trim() || "";
  if (!token) return showError("The secure transfer token is missing.");
  if (!hasConfig()) return showError("N3XRA Records is temporarily unavailable.");
  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(loginUrl());
    return;
  }
  try {
    await loadInvitation();
  } catch (error) {
    showError(error?.message || "Unable to load this transfer invitation.");
  }
}

acceptButton?.addEventListener("click", acceptTransfer);
init();
