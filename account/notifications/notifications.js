import {
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";
import { arrangeAdminWorkspace } from "/account/admin/admin-navigation.js?v=9";

let setupPanel, notificationPanel, accountNavLink, notificationProductInput, notificationChannelInput, notificationSubjectInput, notificationCtaUrlInput, notificationPreheaderInput, notificationMessageInput, notificationMessageCount, notificationCtaLabelInput, notificationFilterInput, notificationLoadRecipientsButton, notificationSelectVisibleButton, notificationClearSelectedButton, notificationClearDraftButton, notificationSelectedCount, notificationLoadedCount, notificationRecipientList, notificationReviewButton, notificationStatus, notificationReviewModal, notificationReviewClose, notificationReviewCancel, notificationReviewProduct, notificationReviewCount, notificationReviewChannel, notificationReviewSubject, notificationEmailPreview, notificationSendButton, notificationReviewStatus;

function bindNotificationDom() {
  setupPanel = document.getElementById("setup-panel"); notificationPanel = document.getElementById("notification-panel"); accountNavLink = document.getElementById("account-nav-link"); notificationProductInput = document.getElementById("notification-product"); notificationChannelInput = document.getElementById("notification-channel"); notificationSubjectInput = document.getElementById("notification-subject"); notificationCtaUrlInput = document.getElementById("notification-cta-url"); notificationPreheaderInput = document.getElementById("notification-preheader"); notificationMessageInput = document.getElementById("notification-message"); notificationMessageCount = document.getElementById("notification-message-count"); notificationCtaLabelInput = document.getElementById("notification-cta-label"); notificationFilterInput = document.getElementById("notification-filter"); notificationLoadRecipientsButton = document.getElementById("notification-load-recipients"); notificationSelectVisibleButton = document.getElementById("notification-select-visible"); notificationClearSelectedButton = document.getElementById("notification-clear-selected"); notificationClearDraftButton = document.getElementById("notification-clear-draft"); notificationSelectedCount = document.getElementById("notification-selected-count"); notificationLoadedCount = document.getElementById("notification-loaded-count"); notificationRecipientList = document.getElementById("notification-recipient-list"); notificationReviewButton = document.getElementById("notification-review"); notificationStatus = document.getElementById("notification-status"); notificationReviewModal = document.getElementById("notification-review-modal"); notificationReviewClose = document.getElementById("notification-review-close"); notificationReviewCancel = document.getElementById("notification-review-cancel"); notificationReviewProduct = document.getElementById("notification-review-product"); notificationReviewCount = document.getElementById("notification-review-count"); notificationReviewChannel = document.getElementById("notification-review-channel"); notificationReviewSubject = document.getElementById("notification-review-subject"); notificationEmailPreview = document.getElementById("notification-email-preview"); notificationSendButton = document.getElementById("notification-send"); notificationReviewStatus = document.getElementById("notification-review-status");
}

let supabase = null;
let currentSession = null;
let notificationRecipients = [];
let selectedNotificationEmails = new Set();
let pendingNotificationPayload = null;

async function hasPlatformAdminAccess() {
  if (isPlatformAdminEmail(currentSession?.user?.email)) return true;
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "get-platform-admin-access",
    },
  });
  return Boolean(!error && data?.ok);
}

const PRODUCT_LABELS = {
  records: "N3XRA Records",
  ai_music: "AI Music Generator",
  virals: "N3XRA Virals",
  utilities: "N3XRA Utilities",
  all: "All N3XRA accounts",
};

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "status";
  if (tone) el.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getNotificationProductLabel(productId = notificationProductInput?.value) {
  return PRODUCT_LABELS[productId] || PRODUCT_LABELS.records;
}

function syncNotificationComposer() {
  const isTextOnly = notificationChannelInput?.value === "sms";
  document.querySelectorAll("[data-notification-email-only]").forEach((field) => {
    field.hidden = isTextOnly;
  });
  if (notificationMessageCount) {
    notificationMessageCount.textContent = `${notificationMessageInput?.value.length || 0} / 8,000`;
  }
}

function getFilteredNotificationRecipients() {
  const query = String(notificationFilterInput?.value || "").trim().toLowerCase();
  if (!query) return notificationRecipients;
  return notificationRecipients.filter((recipient) => {
    const haystack = [
      recipient.email,
      recipient.name,
      recipient.productLabel,
      recipient.plan,
      recipient.status,
      recipient.context,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function updateNotificationCounts() {
  const total = notificationRecipients.length;
  const selected = selectedNotificationEmails.size;
  if (notificationSelectedCount) notificationSelectedCount.textContent = `${selected} selected`;
  if (notificationLoadedCount) {
    notificationLoadedCount.textContent = total
      ? `${total} account${total === 1 ? "" : "s"} loaded for ${getNotificationProductLabel()}.`
      : "No accounts loaded.";
  }
}

function renderNotificationRecipients() {
  if (!notificationRecipientList) return;
  const recipients = getFilteredNotificationRecipients();
  notificationRecipientList.innerHTML = "";

  if (!notificationRecipients.length) {
    notificationRecipientList.innerHTML = '<div class="notification-empty-state">Load an audience to view accounts.</div>';
    updateNotificationCounts();
    return;
  }

  if (!recipients.length) {
    notificationRecipientList.innerHTML = '<div class="notification-empty-state">No accounts match this search.</div>';
    updateNotificationCounts();
    return;
  }

  recipients.forEach((recipient) => {
    const email = normalizeEmail(recipient.email);
    const checked = selectedNotificationEmails.has(email) ? " checked" : "";
    const row = document.createElement("label");
    row.className = "notification-recipient-row";
    row.innerHTML = `
      <input type="checkbox" data-notification-email="${escapeHtml(email)}"${checked}>
      <span class="notification-recipient-avatar">${escapeHtml(String(recipient.name || recipient.email).trim().charAt(0).toUpperCase() || "N")}</span>
      <span class="notification-recipient-copy">
        <strong>${escapeHtml(recipient.name || recipient.email)}</strong>
        <small>${escapeHtml(recipient.email)}</small>
        <span>${escapeHtml([recipient.plan, recipient.status].filter(Boolean).join(" · ") || recipient.context || recipient.productLabel || "N3XRA account")}</span>
      </span>
      <span class="notification-sms-badge${recipient.smsOptedIn ? " is-active" : ""}">${recipient.smsOptedIn ? "SMS" : "Email"}</span>
    `;
    notificationRecipientList.append(row);
  });
  updateNotificationCounts();
}

function resetNotificationRecipients() {
  notificationRecipients = [];
  selectedNotificationEmails = new Set();
  renderNotificationRecipients();
  setStatus(notificationStatus, "");
}

async function loadNotificationRecipients() {
  const product = notificationProductInput.value;
  setStatus(notificationStatus, "Loading accounts...");
  notificationLoadRecipientsButton.disabled = true;

  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "list-notification-recipients",
      product,
    },
  });

  notificationLoadRecipientsButton.disabled = false;
  if (error || data?.error) {
    setStatus(notificationStatus, error?.message || data?.error || "Unable to load accounts.", "error");
    return;
  }

  notificationRecipients = Array.isArray(data?.recipients) ? data.recipients : [];
  selectedNotificationEmails = new Set();
  renderNotificationRecipients();
  setStatus(notificationStatus, `${notificationRecipients.length} account${notificationRecipients.length === 1 ? "" : "s"} loaded. Select recipients before reviewing.`, "success");
}

function handleNotificationRecipientToggle(event) {
  const input = event.target.closest("input[type='checkbox'][data-notification-email]");
  if (!input) return;
  const email = normalizeEmail(input.getAttribute("data-notification-email"));
  if (!email) return;
  if (input.checked) selectedNotificationEmails.add(email);
  else selectedNotificationEmails.delete(email);
  updateNotificationCounts();
}

function selectVisibleNotificationRecipients() {
  getFilteredNotificationRecipients().forEach((recipient) => {
    const email = normalizeEmail(recipient.email);
    if (email) selectedNotificationEmails.add(email);
  });
  renderNotificationRecipients();
}

function clearNotificationRecipients() {
  selectedNotificationEmails = new Set();
  renderNotificationRecipients();
}

function clearNotificationDraft() {
  notificationSubjectInput.value = "";
  notificationPreheaderInput.value = "";
  notificationMessageInput.value = "";
  notificationCtaLabelInput.value = "";
  notificationCtaUrlInput.value = "";
  notificationChannelInput.value = "email";
  setStatus(notificationStatus, "");
  syncNotificationComposer();
  notificationSubjectInput.focus();
}

function getSelectedNotificationRecipients() {
  return notificationRecipients.filter((recipient) => selectedNotificationEmails.has(normalizeEmail(recipient.email)));
}

function getNotificationPayload() {
  const channel = notificationChannelInput.value;
  const subject = notificationSubjectInput.value.trim();
  const message = notificationMessageInput.value.trim();
  const recipients = getSelectedNotificationRecipients();
  const ctaUrl = notificationCtaUrlInput.value.trim();
  const ctaLabel = notificationCtaLabelInput.value.trim();
  const preheader = notificationPreheaderInput.value.trim();
  const product = notificationProductInput.value;

  if (!recipients.length) throw new Error("Select at least one account.");
  if (["email", "both"].includes(channel) && !subject) throw new Error("Enter an email subject for email delivery.");
  if (!message) throw new Error("Write the email message.");
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) throw new Error("Button link must start with http:// or https://.");

  return {
    product,
    channel,
    productLabel: getNotificationProductLabel(product),
    subject,
    preheader,
    message,
    ctaUrl,
    ctaLabel: ctaLabel || "Open N3XRA",
    recipients,
  };
}

function setNotificationReviewOpen(isOpen) {
  notificationReviewModal?.classList.toggle("is-open", Boolean(isOpen));
  notificationReviewModal?.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (!isOpen) {
    pendingNotificationPayload = null;
    setStatus(notificationReviewStatus, "");
  }
}

function renderNotificationReview(payload) {
  if (!notificationReviewModal || !notificationReviewProduct || !notificationReviewCount || !notificationReviewChannel || !notificationReviewSubject || !notificationEmailPreview) {
    throw new Error("The message review panel is unavailable. Refresh this page and try again.");
  }
  notificationReviewProduct.textContent = payload.productLabel;
  notificationReviewCount.textContent = String(payload.recipients.length);
  notificationReviewChannel.textContent = { email: "Email", sms: "Text", both: "Email + text" }[payload.channel] || "Email";
  notificationReviewSubject.textContent = payload.subject || (payload.channel === "sms" ? "Text update" : "-");
  notificationEmailPreview.innerHTML = `
    <div class="notification-preview-frame">
      <div class="notification-preview-head">
        <p class="settings-modal-kicker">${escapeHtml(payload.productLabel)}</p>
        <h2>${escapeHtml(payload.subject)}</h2>
        ${payload.preheader ? `<p class="field-note">${escapeHtml(payload.preheader)}</p>` : ""}
      </div>
      <div class="notification-preview-message">${nl2br(payload.message)}</div>
      ${payload.ctaUrl ? `<p><a class="btn button-link" href="${escapeHtml(payload.ctaUrl)}" target="_blank" rel="noopener">${escapeHtml(payload.ctaLabel)}</a></p>` : ""}
      <hr>
      <p class="field-note">First recipients: ${escapeHtml(payload.recipients.slice(0, 8).map((recipient) => recipient.email).join(", "))}${payload.recipients.length > 8 ? "..." : ""}</p>
    </div>
  `;
}

function handleNotificationReview() {
  try {
    const payload = getNotificationPayload();
    pendingNotificationPayload = payload;
    renderNotificationReview(payload);
    setNotificationReviewOpen(true);
  } catch (error) {
    setStatus(notificationStatus, error.message || "Review failed.", "error");
  }
}

async function sendNotificationEmail() {
  if (!pendingNotificationPayload) return;
  notificationSendButton.disabled = true;
  setStatus(notificationReviewStatus, "Sending update...");

  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "send-notification-email",
      channel: pendingNotificationPayload.channel,
      product: pendingNotificationPayload.product,
      subject: pendingNotificationPayload.subject,
      preheader: pendingNotificationPayload.preheader,
      message: pendingNotificationPayload.message,
      ctaUrl: pendingNotificationPayload.ctaUrl,
      ctaLabel: pendingNotificationPayload.ctaLabel,
      recipientEmails: pendingNotificationPayload.recipients.map((recipient) => recipient.email),
    },
  });

  notificationSendButton.disabled = false;
  if (error || data?.error) {
    setStatus(notificationReviewStatus, error?.message || data?.error || "Unable to send update.", "error");
    return;
  }

  setStatus(notificationReviewStatus, `${data.sentCount || 0} sent${data.failedCount ? `, ${data.failedCount} failed` : ""}.`, data.failedCount ? "error" : "success");
  const sentSummary = [
    data.emailSentCount ? `${data.emailSentCount} email${data.emailSentCount === 1 ? "" : "s"}` : "",
    data.smsSentCount ? `${data.smsSentCount} text${data.smsSentCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ") || "0 messages";
  setStatus(notificationStatus, `${sentSummary} sent${data.failedCount ? `, ${data.failedCount} failed` : ""}.`, data.failedCount ? "error" : "success");
}

function bindEvents() {
  document.getElementById("admin-sign-out")?.addEventListener("click", async () => {
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/account");
  }, { once: true });
  accountNavLink?.addEventListener("click", async (event) => {
    if (!currentSession?.user) return;
    event.preventDefault();
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/account");
  });
  notificationProductInput?.addEventListener("change", resetNotificationRecipients);
  notificationChannelInput?.addEventListener("change", syncNotificationComposer);
  notificationMessageInput?.addEventListener("input", syncNotificationComposer);
  notificationLoadRecipientsButton?.addEventListener("click", loadNotificationRecipients);
  notificationFilterInput?.addEventListener("input", renderNotificationRecipients);
  notificationRecipientList?.addEventListener("change", handleNotificationRecipientToggle);
  notificationSelectVisibleButton?.addEventListener("click", selectVisibleNotificationRecipients);
  notificationClearSelectedButton?.addEventListener("click", clearNotificationRecipients);
  notificationClearDraftButton?.addEventListener("click", clearNotificationDraft);
  notificationReviewButton?.addEventListener("click", handleNotificationReview);
  notificationReviewClose?.addEventListener("click", () => setNotificationReviewOpen(false));
  notificationReviewCancel?.addEventListener("click", () => setNotificationReviewOpen(false));
  notificationSendButton?.addEventListener("click", sendNotificationEmail);
  notificationReviewModal?.addEventListener("click", (event) => {
    if (event.target === notificationReviewModal) setNotificationReviewOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && notificationReviewModal?.classList.contains("is-open")) {
      setNotificationReviewOpen(false);
    }
  });
}

export async function startNotifications() {
  bindNotificationDom();
  show(setupPanel, !hasConfig());
  show(notificationPanel, false);
  if (!hasConfig()) return;

  if (!supabase) supabase = createBrowserSupabase();
  if (!currentSession) currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/account?next=/account/notifications/");
    return;
  }
  if (!(await hasPlatformAdminAccess())) {
    window.location.replace("/account");
    return;
  }

  show(notificationPanel, true);
  arrangeAdminWorkspace();
  bindEvents();
  syncNotificationComposer();
}

if (!window.__n3xraAdminSoftNavigation) startNotifications();
