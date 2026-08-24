const twilio = require("twilio");
const { createAdminNotification } = require("./_admin-notifications");
const { publicHttpUrl } = require("./_receptionist");
const { normalizePhone } = require("./_account-phone");
const { requirePlatformAdmin, supabaseJson } = require("./_communications");

const N3XRA_PHONE = normalizePhone(
  process.env.TWILIO_RECEPTIONIST_NUMBER || process.env.TWILIO_FROM_NUMBER || "+15416526840",
);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseInboundMedia(payload = {}) {
  const count = Math.max(0, Math.min(10, Number(payload.NumMedia || 0) || 0));
  return Array.from({ length: count }, (_, index) => ({
    url: String(payload[`MediaUrl${index}`] || "").trim(),
    contentType: String(payload[`MediaContentType${index}`] || "application/octet-stream").trim(),
  })).filter((item) => item.url);
}

async function recordMessage({ phone, sid, direction, body, status, from, to, media = [], userId = null }) {
  const rows = await supabaseJson("rpc/record_admin_communication_message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_phone_e164: normalizePhone(phone),
      p_twilio_message_sid: String(sid || "").trim(),
      p_direction: direction,
      p_body: String(body || "").slice(0, 16000),
      p_message_status: String(status || (direction === "inbound" ? "received" : "queued")).toLowerCase(),
      p_from_e164: normalizePhone(from),
      p_to_e164: normalizePhone(to),
      p_media: media,
      p_created_by_user_id: userId,
      p_message_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function recordIncomingMessage(payload) {
  const from = normalizePhone(payload?.From);
  const to = normalizePhone(payload?.To || N3XRA_PHONE);
  const sid = String(payload?.MessageSid || payload?.SmsMessageSid || "").trim();
  if (!from || !to || !sid) throw httpError(400, "The incoming message payload is incomplete.");
  const media = parseInboundMedia(payload);
  const message = await recordMessage({ phone: from, sid, direction: "inbound", body: payload?.Body, status: "received", from, to, media });
  const existing = await supabaseJson(
    `admin_notifications?select=id&event_type=eq.communications.inbound_message&source_table=eq.admin_communication_threads&source_id=eq.${encodeURIComponent(message.thread_id)}&limit=1`,
  ).catch(() => []);
  const body = String(payload?.Body || "").trim();
  const summary = body || (media.length ? "Picture message" : "New text message");
  const notification = {
    event_type: "communications.inbound_message",
    product: "platform",
    priority: "important",
    title: `New text from ${from}`,
    summary: summary.slice(0, 2000),
    message_text: body || summary,
    actor_name: from,
    source_table: "admin_communication_threads",
    source_id: message.thread_id,
    action_url: `/account/admin/communications/?thread=${encodeURIComponent(message.thread_id)}`,
    metadata: { thread_id: message.thread_id, message_id: message.message_id, phone: from, media_count: media.length },
  };
  if (existing?.[0]?.id) {
    await supabaseJson(`admin_notifications?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ ...notification, read_at: null, archived_at: null, deleted_at: null, created_at: new Date().toISOString() }),
    });
  } else {
    await createAdminNotification(notification);
  }
  return message;
}

async function latestConsentByPhone() {
  const rows = await supabaseJson("sms_consent_events?select=phone_e164,event_type,created_at&order=created_at.desc&limit=10000").catch(() => []);
  const latest = new Map();
  for (const row of rows || []) if (row.phone_e164 && !latest.has(row.phone_e164)) latest.set(row.phone_e164, row);
  return latest;
}

async function listContacts() {
  const [credentials, profiles, consent] = await Promise.all([
    supabaseJson("account_phone_credentials?select=user_id,phone_e164,updated_at&phone_e164=not.is.null&limit=5000"),
    supabaseJson("profiles?select=id,full_name,email,account_status&limit=5000"),
    latestConsentByPhone(),
  ]);
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const contacts = (credentials || []).map((credential) => {
    const profile = profileById.get(credential.user_id) || {};
    const event = consent.get(credential.phone_e164);
    return {
      userId: credential.user_id,
      phone: credential.phone_e164,
      name: profile.full_name || profile.email || credential.phone_e164,
      email: profile.email || "",
      accountStatus: profile.account_status || "",
      smsOptedIn: event?.event_type === "opt_in",
      consentUpdatedAt: event?.created_at || null,
    };
  });
  const knownPhones = new Set(contacts.map((contact) => contact.phone));
  for (const [phone, event] of consent) {
    if (knownPhones.has(phone)) continue;
    contacts.push({
      userId: null,
      phone,
      name: phone,
      email: "",
      accountStatus: "",
      smsOptedIn: event?.event_type === "opt_in",
      consentUpdatedAt: event?.created_at || null,
    });
  }
  return contacts.sort((a, b) => a.name.localeCompare(b.name));
}

async function listThreads() {
  const [threads, contacts] = await Promise.all([
    supabaseJson("admin_communication_threads?select=id,phone_e164,unread_count,last_message_preview,last_message_direction,last_message_at&order=last_message_at.desc&limit=500"),
    listContacts(),
  ]);
  const byPhone = new Map(contacts.map((contact) => [contact.phone, contact]));
  return (threads || []).map((thread) => ({
    id: thread.id,
    phone: thread.phone_e164,
    unreadCount: Number(thread.unread_count || 0),
    preview: thread.last_message_preview || "",
    direction: thread.last_message_direction || "",
    lastMessageAt: thread.last_message_at,
    contact: byPhone.get(thread.phone_e164) || null,
  }));
}

async function listMessages(threadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(threadId || ""))) throw httpError(400, "A valid conversation is required.");
  return supabaseJson(`admin_communication_messages?select=id,thread_id,twilio_message_sid,direction,body,message_status,from_e164,to_e164,media_count,media,error_code,message_at,status_updated_at&thread_id=eq.${encodeURIComponent(threadId)}&order=message_at.asc&limit=1000`);
}

async function markRead(threadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(threadId || ""))) throw httpError(400, "A valid conversation is required.");
  const now = new Date().toISOString();
  await Promise.all([
    supabaseJson(`admin_communication_threads?id=eq.${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ unread_count: 0, updated_at: now }),
    }),
    supabaseJson(`admin_notifications?event_type=eq.communications.inbound_message&source_table=eq.admin_communication_threads&source_id=eq.${encodeURIComponent(threadId)}&read_at=is.null`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ read_at: now }),
    }),
  ]);
}

async function phoneIsOptedIn(phone) {
  const normalized = normalizePhone(phone);
  const rows = await supabaseJson(`sms_consent_events?select=event_type,created_at&phone_e164=eq.${encodeURIComponent(normalized)}&order=created_at.desc&limit=1`).catch(() => []);
  return rows?.[0]?.event_type === "opt_in";
}

async function sendMessage({ to, body, userId, req }) {
  const recipient = normalizePhone(to);
  const text = String(body || "").trim();
  if (!recipient) throw httpError(400, "Enter a valid phone number.");
  if (!text) throw httpError(400, "Enter a message.");
  if (text.length > 1600) throw httpError(400, "Messages can be up to 1,600 characters.");
  if (!(await phoneIsOptedIn(recipient))) throw httpError(409, "This number has not opted in to N3XRA texts. They can text START to (541) 652-6840.");
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!accountSid || !authToken || !N3XRA_PHONE) throw httpError(503, "Twilio messaging is not configured.");
  const client = twilio(accountSid, authToken);
  let sent;
  try {
    sent = await client.messages.create({
      from: N3XRA_PHONE,
      to: recipient,
      body: text,
      statusCallback: new URL("/api/admin-communications-sms-status", publicHttpUrl(req)).toString(),
    });
  } catch (error) {
    throw httpError(Number(error?.status) || 502, `Twilio could not send this message.${error?.code ? ` Twilio ${error.code}.` : ""}`);
  }
  return recordMessage({ phone: recipient, sid: sent.sid, direction: "outbound", body: text, status: sent.status || "queued", from: N3XRA_PHONE, to: recipient, userId });
}

async function updateMessageStatus(sid, status, errorCode = "") {
  const allowed = new Set(["accepted", "scheduled", "canceled", "queued", "sending", "sent", "delivered", "undelivered", "failed", "receiving", "received", "read"]);
  const normalized = String(status || "").toLowerCase();
  if (!String(sid || "").trim() || !allowed.has(normalized)) return;
  await supabaseJson(`admin_communication_messages?twilio_message_sid=eq.${encodeURIComponent(sid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ message_status: normalized, error_code: String(errorCode || "") || null, status_updated_at: new Date().toISOString() }),
  });
}

module.exports = { N3XRA_PHONE, httpError, listContacts, listMessages, listThreads, markRead, parseInboundMedia, recordIncomingMessage, requirePlatformAdmin, sendMessage, updateMessageStatus };
