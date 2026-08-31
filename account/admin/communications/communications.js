import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=3";
import { arrangeAdminWorkspace, refreshAdminNavigationBadges, renderAdminNavigation } from "/account/admin/admin-navigation.js?v=29";

let context;
let contacts = [];
let threads = [];
let activeThread = null;
let activePhone = "";
let activeCall = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const formatPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value;
};
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }).format(new Date(value)) : "";

function status(message = "", tone = "") {
  const el = $("communications-status");
  el.textContent = message;
  el.className = `communications-status${tone ? ` ${tone}` : ""}`;
}

async function api(path = "", options = {}) {
  const token = context?.session?.access_token;
  const response = await fetch(`/api/admin-communications${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The communications request failed.");
  return data;
}

function contactFor(phone) { return contacts.find((contact) => contact.phone === phone) || null; }
function labelFor(phone) { const contact = contactFor(phone); return contact?.name || formatPhone(phone); }

function nexStatus(thread) {
  if (!thread || thread.nexMode === "never") return { label: "Nex excluded", tone: "never", paused: false };
  const pausedUntil = thread.nexPausedUntil ? new Date(thread.nexPausedUntil) : null;
  if (pausedUntil && pausedUntil.getTime() > Date.now()) {
    return { label: `You are replying · Nex resumes ${formatDate(thread.nexPausedUntil)}`, tone: "paused", paused: true };
  }
  return { label: "Nex active", tone: "active", paused: false };
}

function renderNexControls(thread) {
  if (!thread) return "";
  const state = nexStatus(thread);
  const durations = [15, 30, 60, 120, 240, 480, 1440, 10080];
  const durationOptions = durations.map((minutes) => {
    const copy = minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 hour" : minutes < 1440 ? `${minutes / 60} hours` : minutes === 1440 ? "24 hours" : "7 days";
    return `<option value="${minutes}"${minutes === thread.nexResumeAfterMinutes ? " selected" : ""}>${copy}</option>`;
  }).join("");
  return `<div class="nex-conversation-controls">
    <span class="nex-state is-${state.tone}">${escapeHtml(state.label)}</span>
    <label>Participation<select id="nex-mode"><option value="automatic"${thread.nexMode === "automatic" ? " selected" : ""}>Nex may reply</option><option value="never"${thread.nexMode === "never" ? " selected" : ""}>Never use Nex</option></select></label>
    <label>Resume after<select id="nex-resume-after"${thread.nexMode === "never" ? " disabled" : ""}>${durationOptions}</select></label>
    <button class="nex-resume-button${state.paused ? "" : " hidden"}" id="resume-nex" type="button">Resume now</button>
  </div>`;
}

function renderContactOptions() {
  const optedIn = contacts.filter((contact) => contact.smsOptedIn);
  const options = optedIn.map((contact) => `<option value="${escapeHtml(contact.phone)}">${escapeHtml(contact.name)} · ${escapeHtml(formatPhone(contact.phone))}</option>`).join("");
  $("contact-picker").innerHTML = `<option value="">Select an opted-in account…</option>${options}`;
  $("call-contact").innerHTML = `<option value="">Select an account…</option>${contacts.map((contact) => `<option value="${escapeHtml(contact.phone)}">${escapeHtml(contact.name)} · ${escapeHtml(formatPhone(contact.phone))}</option>`).join("")}`;
  $("opted-in-count").textContent = optedIn.length;
  $("preferences-list").innerHTML = contacts.length ? contacts.map((contact) => `
    <div class="preference-row"><div><strong>${escapeHtml(contact.name)}</strong><span>${escapeHtml(formatPhone(contact.phone))}${contact.email ? ` · ${escapeHtml(contact.email)}` : ""}</span></div><span class="consent-pill${contact.smsOptedIn ? "" : " off"}">${contact.smsOptedIn ? "Opted in" : "Not opted in"}</span></div>
  `).join("") : '<p class="communications-empty">No account phone preferences are available.</p>';
}

function renderThreads() {
  const unread = threads.reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0);
  $("unread-count").textContent = unread ? `(${unread})` : "";
  $("thread-list").innerHTML = threads.length ? threads.map((thread) => {
    const name = thread.contact?.name || labelFor(thread.phone);
    return `<button class="thread-button${thread.id === activeThread?.id ? " is-active" : ""}" type="button" data-thread="${thread.id}"><span class="thread-avatar">${escapeHtml(name.charAt(0).toUpperCase() || "N")}</span><span class="thread-copy"><strong>${escapeHtml(name)}</strong><span>${thread.direction === "outbound" ? "N3XRA: " : ""}${escapeHtml(thread.preview)}</span></span><span class="thread-time">${escapeHtml(formatDate(thread.lastMessageAt))}${thread.unreadCount ? '<i class="unread-dot"></i>' : ""}</span></button>`;
  }).join("") : '<p class="communications-empty">No conversations yet.</p>';
}

function setActiveRecipient(phone, thread = null) {
  activePhone = phone;
  activeThread = thread;
  const contact = contactFor(phone);
  $("message-header").innerHTML = `<div class="message-recipient"><strong>${escapeHtml(contact?.name || formatPhone(phone))}</strong><span>${escapeHtml(formatPhone(phone))}${contact?.smsOptedIn ? " · Texting allowed" : " · Not opted in"}</span></div>${renderNexControls(thread)}`;
  $("message-body").disabled = !contact?.smsOptedIn;
  $("send-message").disabled = !contact?.smsOptedIn;
  if (!thread) $("message-list").innerHTML = '<p class="communications-empty">No messages yet. Write the first message below.</p>';
  renderThreads();
}

async function openThread(thread) {
  setActiveRecipient(thread.phone, thread);
  status("Loading conversation…");
  const data = await api(`?threadId=${encodeURIComponent(thread.id)}`);
  const messages = data.messages || [];
  $("message-list").innerHTML = messages.length ? messages.map((message) => `
    <div class="message-bubble ${message.direction === "outbound" ? "outbound" : "inbound"}">${escapeHtml(message.body || (message.media_count ? "Attachment" : ""))}<small>${escapeHtml(message.direction === "inbound" ? "Received" : message.created_by_user_id ? "You" : "Nex")} · ${escapeHtml(formatDate(message.message_at))} · ${escapeHtml(message.message_status || "")}</small></div>
  `).join("") : '<p class="communications-empty">No messages in this conversation.</p>';
  $("message-list").scrollTop = $("message-list").scrollHeight;
  await api("", { method:"PATCH", body:JSON.stringify({ action:"mark_read", threadId:thread.id }) });
  thread.unreadCount = 0;
  renderThreads();
  status("");
}

async function saveNexSettings({ resumeNow = false } = {}) {
  if (!activeThread?.id) return;
  const mode = $("nex-mode")?.value || activeThread.nexMode || "automatic";
  const resumeAfterMinutes = Number($("nex-resume-after")?.value || activeThread.nexResumeAfterMinutes || 120);
  status(resumeNow ? "Returning this conversation to Nex…" : "Saving Nex settings…");
  await api("", { method:"PATCH", body:JSON.stringify({ action:"update_nex_settings", threadId:activeThread.id, mode, resumeAfterMinutes, resumeNow }) });
  await refresh({ quiet:true });
  status(mode === "never" ? "Nex will never enter this conversation." : resumeNow ? "Nex can respond to the next incoming message." : "Nex settings saved.", "success");
}

async function refresh({ quiet = false } = {}) {
  if (!quiet) status("Loading calls and messages…");
  const data = await api();
  contacts = data.contacts || [];
  threads = data.threads || [];
  renderContactOptions();
  renderThreads();
  if (activeThread) {
    const refreshed = threads.find((thread) => thread.id === activeThread.id);
    if (refreshed) await openThread(refreshed);
  }
  if (!quiet) status("Calls and messages are up to date.", "success");
}

function handleAdminNotificationChange(event) {
  const changed = event.detail?.new || event.detail?.old || {};
  if (changed.event_type !== "communications.inbound_message") return;
  if (window.location.pathname !== "/account/admin/communications/") return;
  refresh({ quiet:true }).catch(() => null);
}

async function sendText(event) {
  event.preventDefault();
  const body = $("message-body").value.trim();
  if (!activePhone || !body) return;
  $("send-message").disabled = true;
  status("Sending text…");
  try {
    await api("", { method:"POST", body:JSON.stringify({ action:"send_sms", to:activePhone, body }) });
    $("message-body").value = "";
    $("message-count").textContent = "0 / 1,600";
    await refresh({ quiet:true });
    const thread = threads.find((item) => item.phone === activePhone);
    if (thread) await openThread(thread);
    status("Text sent from (541) 652-6840.", "success");
  } catch (error) { status(error.message, "error"); }
  finally { $("send-message").disabled = !contactFor(activePhone)?.smsOptedIn; }
}

function switchTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((panel) => { const active = panel.dataset.panel === name; panel.hidden = !active; panel.classList.toggle("is-active", active); });
}

async function startCall() {
  const phone = $("call-phone").value.trim() || $("call-contact").value;
  if (!phone) return status("Select an account or enter a phone number.", "error");
  $("call-state").textContent = "Preparing secure call…";
  try {
    await ensureTwilioVoice();
    const { data, error } = await context.supabase.functions.invoke("admin-voice-token", { body:{} });
    if (error || !data?.token) {
      let message = data?.error || error?.message || "Calling is unavailable.";
      if (error?.context?.json) {
        const detail = await error.context.json().catch(() => null);
        message = detail?.error || message;
      }
      throw new Error(message);
    }
    const device = new window.Twilio.Device(data.token, { logLevel:1, closeProtection:true });
    activeCall = await device.connect({ params:{ To:phone } });
    $("start-call").disabled = true;
    $("end-call").classList.remove("hidden");
    $("call-state").textContent = "Calling…";
    activeCall.on("accept", () => { $("call-state").textContent = "Call connected."; });
    const finish = () => { activeCall = null; device.destroy(); $("start-call").disabled = false; $("end-call").classList.add("hidden"); $("call-state").textContent = "Call ended."; };
    activeCall.on("disconnect", finish); activeCall.on("cancel", finish); activeCall.on("error", (error) => { $("call-state").textContent = error.message || "The call failed."; finish(); });
  } catch (error) { $("call-state").textContent = error.message; status(error.message, "error"); }
}

function ensureTwilioVoice() {
  if (window.Twilio?.Device) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-twilio-voice-sdk]');
    if (existing) {
      existing.addEventListener("load", () => window.Twilio?.Device
        ? resolve()
        : reject(new Error("The calling service did not initialize.")), { once:true });
      existing.addEventListener("error", () => reject(new Error("The calling service did not load.")), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "/assets/vendor/twilio-voice.min.js?v=1";
    script.defer = true;
    script.dataset.twilioVoiceSdk = "true";
    script.addEventListener("load", () => window.Twilio?.Device
      ? resolve()
      : reject(new Error("The calling service did not initialize.")), { once:true });
    script.addEventListener("error", () => reject(new Error("The calling service did not load.")), { once:true });
    document.head.append(script);
  });
}

function bindEvents() {
  document.querySelector(".communications-tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (button) switchTab(button.dataset.tab); });
  $("communications-refresh").addEventListener("click", () => refresh().catch((error) => status(error.message, "error")));
  $("open-contact").addEventListener("click", () => { const phone = $("contact-picker").value; if (!phone) return; const thread = threads.find((item) => item.phone === phone); thread ? openThread(thread).catch((error) => status(error.message,"error")) : setActiveRecipient(phone); });
  $("thread-list").addEventListener("click", (event) => { const button = event.target.closest("[data-thread]"); const thread = threads.find((item) => item.id === button?.dataset.thread); if (thread) openThread(thread).catch((error) => status(error.message,"error")); });
  $("message-body").addEventListener("input", () => { $("message-count").textContent = `${$("message-body").value.length} / 1,600`; });
  $("message-form").addEventListener("submit", sendText);
  $("message-header").addEventListener("change", (event) => {
    if (!["nex-mode", "nex-resume-after"].includes(event.target?.id)) return;
    saveNexSettings().catch((error) => status(error.message, "error"));
  });
  $("message-header").addEventListener("click", (event) => {
    if (event.target?.id !== "resume-nex") return;
    saveNexSettings({ resumeNow:true }).catch((error) => status(error.message, "error"));
  });
  $("call-contact").addEventListener("change", () => { if ($("call-contact").value) $("call-phone").value = $("call-contact").value; });
  $("start-call").addEventListener("click", startCall);
  $("end-call").addEventListener("click", () => activeCall?.disconnect());
  window.removeEventListener("n3xra:admin-notification-change", handleAdminNotificationChange);
  window.addEventListener("n3xra:admin-notification-change", handleAdminNotificationChange);
}

export async function startCommunications() {
  if (!hasConfig()) throw new Error("N3XRA is not connected to Supabase.");
  context = await getAdminSession();
  if (!context.allowed) return;
  renderAdminNavigation();
  $("communications-panel").classList.remove("hidden");
  arrangeAdminWorkspace();
  bindEvents();
  await refresh();
  const requestedThreadId = new URLSearchParams(window.location.search).get("thread");
  const requestedThread = threads.find((thread) => thread.id === requestedThreadId);
  if (requestedThread) await openThread(requestedThread);
  await refreshAdminNavigationBadges();
  document.body.classList.add("admin-ready");
}

if (!window.__n3xraAdminSoftNavigation) startCommunications().catch((error) => { document.body.classList.add("admin-ready"); status(error.message || "Calls and messages could not open.", "error"); });
