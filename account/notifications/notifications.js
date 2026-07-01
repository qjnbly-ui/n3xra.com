import {
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const notificationPanel = document.getElementById("notification-panel");
const accountNavLink = document.getElementById("account-nav-link");
const notificationProductInput = document.getElementById("notification-product");
const notificationSubjectInput = document.getElementById("notification-subject");
const notificationCtaUrlInput = document.getElementById("notification-cta-url");
const notificationPreheaderInput = document.getElementById("notification-preheader");
const notificationMessageInput = document.getElementById("notification-message");
const notificationCtaLabelInput = document.getElementById("notification-cta-label");
const notificationFilterInput = document.getElementById("notification-filter");
const notificationLoadRecipientsButton = document.getElementById("notification-load-recipients");
const notificationSelectVisibleButton = document.getElementById("notification-select-visible");
const notificationClearSelectedButton = document.getElementById("notification-clear-selected");
const notificationSelectedCount = document.getElementById("notification-selected-count");
const notificationLoadedCount = document.getElementById("notification-loaded-count");
const notificationRecipientList = document.getElementById("notification-recipient-list");
const notificationReviewButton = document.getElementById("notification-review");
const notificationStatus = document.getElementById("notification-status");
const notificationReviewModal = document.getElementById("notification-review-modal");
const notificationReviewClose = document.getElementById("notification-review-close");
const notificationReviewCancel = document.getElementById("notification-review-cancel");
const notificationReviewProduct = document.getElementById("notification-review-product");
const notificationReviewCount = document.getElementById("notification-review-count");
const notificationReviewSubject = document.getElementById("notification-review-subject");
const notificationEmailPreview = document.getElementById("notification-email-preview");
const notificationSendButton = document.getElementById("notification-send");
const notificationReviewStatus = document.getElementById("notification-review-status");

let supabase = null;
let currentSession = null;
let notificationRecipients = [];
let selectedNotificationEmails = new Set();
let pendingNotificationPayload = null;

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
    notificationRecipientList.innerHTML = '<tr><td colspan="5">Load accounts to choose recipients.</td></tr>';
    updateNotificationCounts();
    return;
  }

  if (!recipients.length) {
    notificationRecipientList.innerHTML = '<tr><td colspan="5">No accounts match this filter.</td></tr>';
    updateNotificationCounts();
    return;
  }

  recipients.forEach((recipient) => {
    const email = normalizeEmail(recipient.email);
    const checked = selectedNotificationEmails.has(email) ? " checked" : "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" data-notification-email="${escapeHtml(email)}"${checked}></td>
      <td><strong>${escapeHtml(recipient.name || recipient.email)}</strong><br><small>${escapeHtml(recipient.email)}</small></td>
      <td>${escapeHtml(recipient.productLabel || getNotificationProductLabel())}</td>
      <td>${escapeHtml([recipient.plan, recipient.status].filter(Boolean).join(" / ") || "-")}</td>
      <td>${escapeHtml(recipient.context || "-")}</td>
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

function getSelectedNotificationRecipients() {
  return notificationRecipients.filter((recipient) => selectedNotificationEmails.has(normalizeEmail(recipient.email)));
}

function getNotificationPayload() {
  const subject = notificationSubjectInput.value.trim();
  const message = notificationMessageInput.value.trim();
  const recipients = getSelectedNotificationRecipients();
  const ctaUrl = notificationCtaUrlInput.value.trim();
  const ctaLabel = notificationCtaLabelInput.value.trim();
  const preheader = notificationPreheaderInput.value.trim();
  const product = notificationProductInput.value;

  if (!recipients.length) throw new Error("Select at least one account.");
  if (!subject) throw new Error("Enter an email subject.");
  if (!message) throw new Error("Write the email message.");
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) throw new Error("Button link must start with http:// or https://.");

  return {
    product,
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
  notificationReviewProduct.textContent = payload.productLabel;
  notificationReviewCount.textContent = String(payload.recipients.length);
  notificationReviewSubject.textContent = payload.subject;
  notificationEmailPreview.innerHTML = `
    <div class="notification-preview-frame">
      <p class="settings-modal-kicker">${escapeHtml(payload.productLabel)}</p>
      <h2>${escapeHtml(payload.subject)}</h2>
      ${payload.preheader ? `<p class="field-note">${escapeHtml(payload.preheader)}</p>` : ""}
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
  setStatus(notificationReviewStatus, "Sending update email...");

  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action: "send-notification-email",
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
    setStatus(notificationReviewStatus, error?.message || data?.error || "Unable to send update email.", "error");
    return;
  }

  setStatus(notificationReviewStatus, `${data.sentCount || 0} sent${data.failedCount ? `, ${data.failedCount} failed` : ""}.`, data.failedCount ? "error" : "success");
  setStatus(notificationStatus, `${data.sentCount || 0} update email${Number(data.sentCount || 0) === 1 ? "" : "s"} sent.`, data.failedCount ? "error" : "success");
}

function bindEvents() {
  accountNavLink?.addEventListener("click", async (event) => {
    if (!currentSession?.user) return;
    event.preventDefault();
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/account");
  });
  notificationProductInput?.addEventListener("change", resetNotificationRecipients);
  notificationLoadRecipientsButton?.addEventListener("click", loadNotificationRecipients);
  notificationFilterInput?.addEventListener("input", renderNotificationRecipients);
  notificationRecipientList?.addEventListener("change", handleNotificationRecipientToggle);
  notificationSelectVisibleButton?.addEventListener("click", selectVisibleNotificationRecipients);
  notificationClearSelectedButton?.addEventListener("click", clearNotificationRecipients);
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

async function init() {
  show(setupPanel, !hasConfig());
  show(notificationPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("/account?next=/account/notifications/");
    return;
  }
  if (!isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("/account");
    return;
  }

  if (accountNavLink) {
    accountNavLink.textContent = "Sign out";
    accountNavLink.dataset.authState = "signed-in";
  }
  show(notificationPanel, true);
  bindEvents();
}

init();
