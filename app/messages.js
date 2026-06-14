import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
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
const messagesPanel = document.getElementById("messages-panel");
const messagesNoAccessNotice = document.getElementById("messages-no-access-notice");
const messagesLibraryContext = document.getElementById("messages-library-context");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const messageRecipientCount = document.getElementById("message-recipient-count");
const messageForm = document.getElementById("message-form");
const messageSendTo = document.getElementById("message-send-to");
const messageSendContactsField = document.getElementById("message-send-contacts-field");
const messageSendContactList = document.getElementById("message-send-contact-list");
const messageSubject = document.getElementById("message-subject");
const messageBody = document.getElementById("message-body");
const messageFromNote = document.getElementById("message-from-note");
const messageReset = document.getElementById("message-reset");
const messageSubmit = document.getElementById("message-submit");
const messageStatus = document.getElementById("message-status");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuFilesLink = document.getElementById("mobile-menu-files-link");
const mobileMenuMessagesLink = document.getElementById("mobile-menu-messages-link");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let messageRecipients = [];

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

function closeMobileMenu() {
  mobileMenu?.classList.remove("is-open");
  mobileMenu?.classList.add("hidden");
  mobileMenuToggle?.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const nextOpen = !mobileMenu?.classList.contains("is-open");
  mobileMenu?.classList.toggle("is-open", nextOpen);
  mobileMenu?.classList.toggle("hidden", !nextOpen);
  mobileMenuToggle?.setAttribute("aria-expanded", String(nextOpen));
}

function setMenuActive() {
  mobileMenuAccount?.classList.toggle("is-active", false);
  mobileMenuLibrary?.classList.toggle("is-active", false);
  mobileMenuFilesLink?.classList.toggle("is-active", false);
  mobileMenuMessagesLink?.classList.toggle("is-active", true);
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

function hasMultipleLibraries() {
  return memberships.length > 1;
}

async function handleSignout() {
  await supabase.auth.signOut();
  window.location.replace("./login");
}

function mergeSendRecipients(accountUsers, contacts) {
  const byEmail = new Map();

  accountUsers.forEach((user) => {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) return;
    byEmail.set(email, {
      id: user.id || email,
      source: "account_user",
      name: user.full_name || email,
      email,
    });
  });

  contacts.forEach((contact) => {
    const email = String(contact.email || "").trim().toLowerCase();
    if (!email || byEmail.has(email)) return;
    byEmail.set(email, {
      id: contact.id || email,
      source: "contact",
      name: contact.full_name || email,
      email,
    });
  });

  return Array.from(byEmail.values()).sort((first, second) => {
    if (first.source !== second.source) {
      return first.source === "account_user" ? -1 : 1;
    }
    return String(first.name || first.email).localeCompare(String(second.name || second.email));
  });
}

async function loadAccountUserRecipients(organizationId) {
  const { data: membershipRows, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId);

  if (membershipError) throw membershipError;

  const userIds = Array.from(new Set((membershipRows || []).map((item) => item.user_id).filter(Boolean)));
  if (!userIds.length) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  if (profileError) throw profileError;
  return Array.isArray(profiles) ? profiles : [];
}

async function loadContactRecipients(organizationId) {
  const { data, error } = await supabase
    .from("organization_contacts")
    .select("id, full_name, email")
    .eq("organization_id", organizationId)
    .order("full_name", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function renderMessageRecipients() {
  show(messageSendContactsField, messageRecipients.length > 0);
  messageSendContactList.innerHTML = "";
  messageRecipientCount.textContent = String(messageRecipients.length);

  const groups = [
    {
      source: "account_user",
      title: "Account users",
      recipients: messageRecipients.filter((recipient) => recipient.source === "account_user"),
      collapsed: true,
    },
    {
      source: "contact",
      title: "Contacts",
      recipients: messageRecipients.filter((recipient) => recipient.source === "contact"),
      collapsed: false,
    },
  ].filter((group) => group.recipients.length);

  groups.forEach((group) => {
    const wrapper = document.createElement("details");
    wrapper.className = "document-send-recipient-group";
    wrapper.open = !group.collapsed;
    wrapper.innerHTML = `
      <summary class="document-send-recipient-summary">
        <span>${escapeHtml(group.title)} <small>${group.recipients.length}</small></span>
        ${group.source === "account_user" ? `<button class="btn secondary document-send-select-all" type="button" data-recipient-action="select-all" data-recipient-source="${escapeHtml(group.source)}">Select all</button>` : ""}
      </summary>
    `;

    const options = document.createElement("div");
    options.className = "document-send-recipient-options";

    group.recipients.forEach((recipient) => {
      const label = document.createElement("label");
      label.className = "document-send-contact";
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(recipient.email || "")}" data-recipient-source="${escapeHtml(group.source)}">
        <span>
          <strong>${escapeHtml(recipient.name || recipient.email || "Recipient")}</strong>
          <small>${escapeHtml(recipient.email || "")}</small>
        </span>
      `;
      options.append(label);
    });

    wrapper.append(options);
    messageSendContactList.append(wrapper);
  });
}

function handleRecipientListClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-recipient-action='select-all']") : null;
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const source = button.getAttribute("data-recipient-source") || "";
  const group = button.closest(".document-send-recipient-group");
  if (!group) return;
  group.open = true;
  messageSendContactList.querySelectorAll("input[type='checkbox'][data-recipient-source]").forEach((input) => {
    if (input.getAttribute("data-recipient-source") === source) input.checked = true;
  });
}

function getSelectedRecipients() {
  const emails = [];
  const typedEmail = messageSendTo.value.trim().toLowerCase();
  if (typedEmail) emails.push(typedEmail);
  messageSendContactList.querySelectorAll("input[type='checkbox']:checked").forEach((input) => {
    const email = String(input.value || "").trim().toLowerCase();
    if (email) emails.push(email);
  });
  return Array.from(new Set(emails));
}

function updateMessageControls() {
  const organization = getActiveOrganization();
  const canSend = Boolean(organization && getActiveCapabilities().canShareDocuments);
  messageSubmit.disabled = !canSend;
  messageForm.querySelectorAll("input, textarea, button").forEach((element) => {
    if (element === mobileMenuToggle) return;
    if (element.id === "message-submit") {
      element.disabled = !canSend;
      return;
    }
    element.disabled = !canSend;
  });
}

async function loadMessageRecipients() {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canShareDocuments) {
    messageRecipients = [];
    renderMessageRecipients();
    return;
  }

  try {
    const [accountUsersResult, contactsResult] = await Promise.allSettled([
      loadAccountUserRecipients(organization.id),
      loadContactRecipients(organization.id),
    ]);
    const accountUsers = accountUsersResult.status === "fulfilled" ? accountUsersResult.value : [];
    const contacts = contactsResult.status === "fulfilled" ? contactsResult.value : [];
    messageRecipients = mergeSendRecipients(accountUsers, contacts);
  } catch (_error) {
    messageRecipients = [];
  }

  renderMessageRecipients();
}

function renderOrganizationSelector() {
  const organization = getActiveOrganization();
  const capabilities = getActiveCapabilities();
  const canSend = Boolean(organization && capabilities.canShareDocuments);
  show(messagesNoAccessNotice, !canSend);
  show(messagesLibraryContext, Boolean(organization));
  show(mobileMenuMessagesLink, canSend);
  show(mobileMenuRecordingsLink, capabilities.canUseRecordings);
  setMenuActive();

  activeOrganizationSelect.disabled = !hasMultipleLibraries();
  activeOrganizationSelect.innerHTML = "";
  if (!organization) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeMembershipRole.textContent = "No library access";
    messageRecipientCount.textContent = "0";
    updateMessageControls();
    return;
  }

  memberships.forEach((membership) => {
    const option = document.createElement("option");
    option.value = membership.organization.id;
    option.textContent = membership.organization.name || "Untitled library";
    option.selected = membership.organization.id === organization.id;
    activeOrganizationSelect.append(option);
  });

  activeMembershipRole.textContent = formatRoleLabel(getMembershipRole(activeMembership));
  updateMessageControls();
}

async function bootstrapAccess() {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select(`
      id,
      role,
      organization:organizations (
        id,
        name,
        subscription_tier,
        owner_user_id
      )
    `)
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;
  memberships = dedupeMembershipsByOrganization(buildMembershipMap(data || []));
  activeMembership = resolveActiveOrganization(memberships);
  if (activeMembership?.organization?.id) {
    setStoredActiveOrganizationId(activeMembership.organization.id);
  }
}

async function handleOrganizationChange() {
  const nextOrganizationId = activeOrganizationSelect.value;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;
  activeMembership = nextMembership;
  setStoredActiveOrganizationId(nextOrganizationId);
  renderOrganizationSelector();
  await loadMessageRecipients();
}

function resetMessageForm({ clearStatus = true } = {}) {
  messageForm.reset();
  messageSendContactList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  if (clearStatus) setStatus(messageStatus, "");
}

async function sendMessage(event) {
  event.preventDefault();
  const organization = getActiveOrganization();
  const recipientEmails = getSelectedRecipients();
  const subject = messageSubject.value.trim();
  const message = messageBody.value.trim();

  if (!organization || !getActiveCapabilities().canShareDocuments) {
    setStatus(messageStatus, "You do not have permission to send messages from this library.", "error");
    return;
  }
  if (!recipientEmails.length || !subject || !message) {
    setStatus(messageStatus, "At least one recipient, subject, and message are required.", "error");
    return;
  }

  const config = getConfig();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || currentSession?.access_token || "";
  if (sessionError || !accessToken) {
    setStatus(messageStatus, sessionError?.message || "Sign in again before sending.", "error");
    return;
  }

  setStatus(messageStatus, "Sending message...");
  messageSubmit.disabled = true;

  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/send-records-message`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: organization.id,
        recipientEmails,
        subject,
        message,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Message could not be sent.");
    }

    const sentCount = Number(payload?.sentCount || 0);
    const failed = Array.isArray(payload?.failed) ? payload.failed : [];
    const summary = failed.length
      ? `Sent to ${sentCount}; failed: ${failed.map((item) => item.email).join(", ")}.`
      : `Sent to ${sentCount} recipient${sentCount === 1 ? "" : "s"}.`;
    setStatus(messageStatus, summary, failed.length ? "error" : "success");
    if (!failed.length) resetMessageForm({ clearStatus: false });
  } catch (error) {
    setStatus(messageStatus, error?.message || "Unable to send message.", "error");
  } finally {
    updateMessageControls();
  }
}

async function init() {
  show(setupPanel, !hasConfig());
  show(messagesPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login");
    return;
  }
  if (isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("./admin");
    return;
  }

  show(setupPanel, false);
  show(messagesPanel, true);

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.href = "./account";
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.href = "./library";
  });
  activeOrganizationSelect.addEventListener("change", handleOrganizationChange);
  messageSendContactList.addEventListener("click", handleRecipientListClick);
  messageForm.addEventListener("submit", sendMessage);
  messageReset.addEventListener("click", resetMessageForm);

  try {
    await bootstrapAccess();
    renderOrganizationSelector();
    await loadMessageRecipients();
  } catch (error) {
    memberships = [];
    activeMembership = null;
    messageRecipients = [];
    renderOrganizationSelector();
    renderMessageRecipients();
    setStatus(messageStatus, error?.message || "Unable to load message context.", "error");
  }

  messageFromNote.textContent = currentSession?.user?.email
    ? `Replies will go to ${currentSession.user.email}.`
    : "Replies will go to the sender account.";
}

init();
