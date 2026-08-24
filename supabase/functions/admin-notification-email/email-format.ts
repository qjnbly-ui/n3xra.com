import {
  notificationMessageToPlainText,
  renderNotificationMessageHtml,
} from "../_shared/platform-notifications/notification-message-format.ts";

export type AdminNotification = {
  id: string;
  product: string;
  priority: string;
  title: string;
  summary: string;
  message_text?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  action_url?: string | null;
  created_at: string;
  email_delivery_status?: string | null;
  sms_delivery_status?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function label(value: unknown) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function notificationActionUrl(actionUrl: unknown, appOrigin = "https://www.n3xra.com") {
  const raw = String(actionUrl ?? "").trim();
  if (!raw) return `${appOrigin.replace(/\/+$/, "")}/account/admin/inbox/`;
  try {
    const url = new URL(raw, `${appOrigin.replace(/\/+$/, "")}/`);
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "n3xra.com" && !url.hostname.endsWith(".n3xra.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function buildAdminNotificationEmail(notification: AdminNotification, appOrigin?: string) {
  const title = String(notification.title || "N3XRA notification").trim().slice(0, 300);
  const summary = String(notification.summary || "").trim();
  const messageSource = String(notification.message_text || "").trim();
  const messageText = notificationMessageToPlainText(messageSource);
  const includeMessage = messageText && messageText !== notificationMessageToPlainText(summary);
  const actor = [notification.actor_name, notification.actor_email].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  const actionUrl = notificationActionUrl(notification.action_url, appOrigin);
  const product = label(notification.product || "platform");
  const priority = label(notification.priority || "activity");
  const created = Number.isNaN(Date.parse(notification.created_at)) ? "" : new Date(notification.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
  const details = [summary, includeMessage ? messageText : ""].filter(Boolean);
  const text = [
    title,
    "",
    ...details,
    "",
    `Product: ${product}`,
    `Priority: ${priority}`,
    actor ? `From: ${actor}` : "",
    created ? `Received: ${created} PT` : "",
    actionUrl ? `Open notification: ${actionUrl}` : "",
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join("\n").trim();
  const messageHtml = includeMessage ? renderNotificationMessageHtml(messageSource) : "";
  const html = `<div style="margin:0;padding:32px 16px;background:#eef3f4;font-family:Arial,sans-serif;color:#142019"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #d7e1e3;border-radius:18px;overflow:hidden"><div style="padding:26px 30px;background:#13271d;color:#fff"><p style="margin:0 0 8px;color:#8ed1c7;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">N3XRA Notifications · ${escapeHtml(product)}</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;line-height:1.2">${escapeHtml(title)}</h1></div><div style="padding:28px 30px"><div style="display:inline-block;margin:0 0 18px;padding:5px 9px;background:#e5f2ef;color:#17634f;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase">${escapeHtml(priority)}</div>${summary ? `<p style="margin:0 0 18px;font-size:16px;line-height:1.65">${escapeHtml(summary)}</p>` : ""}${messageHtml ? `<div style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#33443b">${messageHtml}</div>` : ""}${actor ? `<p style="margin:0 0 8px;color:#64716b;font-size:13px"><strong>From:</strong> ${escapeHtml(actor)}</p>` : ""}${created ? `<p style="margin:0 0 20px;color:#64716b;font-size:13px"><strong>Received:</strong> ${escapeHtml(created)} PT</p>` : ""}${actionUrl ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;background:#13271d;color:#fff;text-decoration:none;font-weight:800;border-radius:9px">Open notification</a>` : ""}</div></div></div>`;

  return { subject: `[N3XRA] ${title}`.slice(0, 300), text, html, actionUrl };
}

export function buildAdminNotificationSms(notification: AdminNotification, appOrigin?: string) {
  const title = String(notification.title || "New admin notification").trim().replace(/\s+/g, " ").slice(0, 110);
  const summarySource = String(notification.summary || notification.message_text || "Open N3XRA for details.").trim();
  const summary = notificationMessageToPlainText(summarySource).replace(/\s+/g, " ");
  const actionUrl = notificationActionUrl(notification.action_url, appOrigin)
    || notificationActionUrl("/account/admin/inbox/", appOrigin);
  const heading = `N3XRA Admin: ${title}`;
  const reserved = heading.length + actionUrl.length + 2;
  const available = Math.max(40, 300 - reserved);
  const excerpt = summary.length > available ? `${summary.slice(0, Math.max(1, available - 1)).trimEnd()}…` : summary;
  return [heading, excerpt, actionUrl].filter(Boolean).join("\n");
}
