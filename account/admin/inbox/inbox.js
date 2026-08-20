import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js";
import { confirmAdminAction } from "/account/admin/admin-dialogs.js";
import { initializeAdminSelects } from "/account/admin/admin-select.js?v=1";
import { refreshAdminInboxBadge, renderAdminNavigation } from "/account/admin/admin-navigation.js?v=23";

initializeAdminSelects();

const list = document.getElementById("notification-list");
const status = document.getElementById("admin-inbox-status");
const dialog = document.getElementById("notification-dialog");
const filters = {
  search: document.getElementById("notification-search"),
  product: document.getElementById("notification-product"),
  priority: document.getElementById("notification-priority"),
  read: document.getElementById("notification-read"),
};
let supabase;
let notifications = [];
let folder = "inbox";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function label(value = "") {
  return String(value).replaceAll("_", " ").replaceAll(".", " · ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateTime(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
}

function filteredNotifications() {
  const query = filters.search.value.trim().toLowerCase();
  return notifications.filter((item) => {
    const inFolder = folder === "trash" ? item.deleted_at : folder === "archive" ? item.archived_at && !item.deleted_at : !item.archived_at && !item.deleted_at;
    if (!inFolder) return false;
    if (filters.product.value && item.product !== filters.product.value) return false;
    if (filters.priority.value && item.priority !== filters.priority.value) return false;
    if (filters.read.value === "unread" && item.read_at) return false;
    if (filters.read.value === "read" && !item.read_at) return false;
    if (!query) return true;
    return [item.title, item.summary, item.message_text, item.actor_name, item.actor_email, item.event_type, JSON.stringify(item.metadata || {})]
      .join(" ").toLowerCase().includes(query);
  });
}

function actionButtons(item) {
  if (folder === "trash") return `<button data-action="restore" data-id="${item.id}">Restore</button><button data-action="destroy" data-id="${item.id}">Delete forever</button>`;
  if (folder === "archive") return `<button data-action="restore" data-id="${item.id}">Move to inbox</button><button data-action="trash" data-id="${item.id}">Trash</button>`;
  return `<button data-action="${item.read_at ? "unread" : "read"}" data-id="${item.id}">Mark ${item.read_at ? "unread" : "read"}</button><button data-action="archive" data-id="${item.id}">Archive</button><button data-action="trash" data-id="${item.id}">Trash</button>`;
}

function render() {
  const items = filteredNotifications();
  list.innerHTML = items.length ? items.map((item) => `
    <article class="notification-item${item.read_at ? "" : " is-unread"}">
      <span class="notification-unread-dot" aria-hidden="true"></span>
      <div class="notification-item-main" data-open="${item.id}" tabindex="0" role="button">
        <div class="notification-item-meta"><span>${escapeHtml(label(item.product))}</span><span class="notification-priority notification-priority-${escapeHtml(item.priority)}">${escapeHtml(label(item.priority))}</span><time>${escapeHtml(dateTime(item.created_at))}</time></div>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.summary || item.message_text || "")}</p>
      </div>
      <div class="notification-item-actions">${actionButtons(item)}</div>
    </article>
  `).join("") : `<div class="notification-empty">No notifications match this view.</div>`;
  const inboxUnread = notifications.filter((item) => !item.read_at && !item.archived_at && !item.deleted_at).length;
  document.getElementById("inbox-count").textContent = inboxUnread ? `(${inboxUnread})` : "";
  status.textContent = `${items.length} notification${items.length === 1 ? "" : "s"}`;
}

async function load() {
  status.textContent = "Loading notifications…";
  const { data, error } = await supabase.from("admin_notifications").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  notifications = (data || []).filter((item) => item.product !== "utilities");
  render();
  await refreshAdminInboxBadge();
}

async function update(id, values) {
  const { error } = await supabase.from("admin_notifications").update(values).eq("id", id);
  if (error) throw error;
  await load();
}

async function act(action, id) {
  const now = new Date().toISOString();
  if (action === "read") return update(id, { read_at: now });
  if (action === "unread") return update(id, { read_at: null });
  if (action === "archive") return update(id, { archived_at: now, deleted_at: null });
  if (action === "trash") return update(id, { deleted_at: now });
  if (action === "restore") return update(id, { deleted_at: null, archived_at: null });
  if (action === "destroy") {
    if (!(await confirmAdminAction("Permanently delete this notification? This cannot be undone.", { title: "Delete notification", confirmLabel: "Delete notification" }))) return;
    const { error } = await supabase.from("admin_notifications").delete().eq("id", id);
    if (error) throw error;
    await load();
  }
}

function recordRows(item) {
  const record = item.metadata?.record;
  if (!record || typeof record !== "object") return "";
  const hidden = new Set(["id", "user_id", "client_user_id", "created_by_user_id", "metadata"]);
  return Object.entries(record).filter(([key, value]) => !hidden.has(key) && value !== null && value !== "" && typeof value !== "object").map(([key, value]) => `
    <div class="notification-detail-row"><strong>${escapeHtml(label(key))}</strong><span>${escapeHtml(String(value))}</span></div>
  `).join("");
}

function relatedActionUrl(item) {
  if (!item.action_url) return "";
  if (item.source_table !== "website_service_requests" || !item.source_id) return item.action_url;
  const url = new URL(item.action_url, window.location.origin);
  url.searchParams.set("request", item.source_id);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function openNotification(id) {
  const item = notifications.find((entry) => entry.id === id);
  if (!item) return;
  if (!item.read_at) {
    item.read_at = new Date().toISOString();
    await supabase.from("admin_notifications").update({ read_at: item.read_at }).eq("id", id);
    render();
  }
  document.getElementById("notification-detail-product").textContent = `${label(item.product)} · ${label(item.priority)}`;
  document.getElementById("notification-detail-title").textContent = item.title;
  document.getElementById("notification-detail-meta").textContent = [item.actor_name, item.actor_email, dateTime(item.created_at)].filter(Boolean).join(" · ");
  document.getElementById("notification-detail-message").textContent = item.message_text || item.summary || "No additional message.";
  document.getElementById("notification-detail-record").innerHTML = recordRows(item);
  const actionUrl = relatedActionUrl(item);
  document.getElementById("notification-detail-actions").innerHTML = actionUrl ? `<a class="portal-button" href="${escapeHtml(actionUrl)}">Open and process request</a>` : "";
  dialog.showModal();
}

export async function startInbox() {
  if (!hasConfig()) throw new Error("Portal configuration is missing.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  renderAdminNavigation();
  document.body.classList.add("admin-ready");
  document.querySelectorAll("[data-folder]").forEach((button) => button.addEventListener("click", () => {
    folder = button.dataset.folder;
    document.querySelectorAll("[data-folder]").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  }));
  Object.values(filters).forEach((control) => control.addEventListener(control === filters.search ? "input" : "change", render));
  document.getElementById("refresh-inbox").addEventListener("click", load);
  document.getElementById("mark-all-read").addEventListener("click", async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from("admin_notifications").update({ read_at: now }).is("read_at", null).is("archived_at", null).is("deleted_at", null);
    if (error) throw error;
    await load();
  });
  list.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (action) return act(action.dataset.action, action.dataset.id);
    const opener = event.target.closest("[data-open]");
    if (opener) await openNotification(opener.dataset.open);
  });
  list.addEventListener("keydown", (event) => { if (event.key === "Enter") openNotification(event.target.closest("[data-open]")?.dataset.open); });
  document.getElementById("close-notification").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  await load();
  document.body.classList.remove("portal-loading");
}

if (!window.__n3xraAdminSoftNavigation) {
  startInbox().catch((error) => {
    document.body.classList.add("admin-ready");
    if (status) status.textContent = error.message || "Unable to open admin notifications.";
  });
}
