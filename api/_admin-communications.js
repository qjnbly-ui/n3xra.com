const twilio = require("twilio");
const { createAdminNotification } = require("./_admin-notifications");
const { publicHttpUrl } = require("./_receptionist");
const { normalizePhone } = require("./_account-phone");
const { requirePlatformAdmin, supabaseJson } = require("./_communications");
const { generateNexConversationReply } = require("./_nex-conversation");

const N3XRA_PHONE = normalizePhone(
  process.env.TWILIO_RECEPTIONIST_NUMBER || process.env.TWILIO_FROM_NUMBER || "+15416526840",
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLIANCE_KEYWORD = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|START|UNSTOP|SUBSCRIBE|YES|HELP|INFO)$/i;

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
    supabaseJson("admin_communication_threads?select=id,phone_e164,unread_count,last_message_preview,last_message_direction,last_message_at,nex_mode,nex_resume_after_minutes,nex_paused_until,last_manual_reply_at,nex_last_reply_at&order=last_message_at.desc&limit=500"),
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
    nexMode: thread.nex_mode || "automatic",
    nexResumeAfterMinutes: Number(thread.nex_resume_after_minutes || 120),
    nexPausedUntil: thread.nex_paused_until || null,
    lastManualReplyAt: thread.last_manual_reply_at || null,
    nexLastReplyAt: thread.nex_last_reply_at || null,
    contact: byPhone.get(thread.phone_e164) || null,
  }));
}

async function listMessages(threadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(threadId || ""))) throw httpError(400, "A valid conversation is required.");
  return supabaseJson(`admin_communication_messages?select=id,thread_id,twilio_message_sid,direction,body,message_status,from_e164,to_e164,media_count,media,error_code,created_by_user_id,message_at,status_updated_at&thread_id=eq.${encodeURIComponent(threadId)}&order=message_at.asc&limit=1000`);
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

async function pauseNexForManualReply(phone, threadId = "") {
  const normalized = normalizePhone(phone);
  const rows = threadId
    ? await supabaseJson(`admin_communication_threads?select=id,nex_resume_after_minutes&id=eq.${encodeURIComponent(threadId)}&limit=1`)
    : await supabaseJson(`admin_communication_threads?select=id,nex_resume_after_minutes&phone_e164=eq.${encodeURIComponent(normalized)}&limit=1`);
  const thread = rows?.[0];
  if (!thread?.id) return null;
  const minutes = Math.max(5, Math.min(10080, Number(thread.nex_resume_after_minutes || 120)));
  const now = new Date();
  const pausedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
  await supabaseJson(`admin_communication_threads?id=eq.${encodeURIComponent(thread.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      last_manual_reply_at: now.toISOString(),
      nex_paused_until: pausedUntil,
      nex_pending_inbound_message_id: null,
      nex_pending_claimed_at: null,
      updated_at: now.toISOString(),
    }),
  });
  return { threadId: thread.id, pausedUntil };
}

async function updateNexSettings({ threadId, mode, resumeAfterMinutes, resumeNow = false }) {
  if (!UUID_PATTERN.test(String(threadId || ""))) throw httpError(400, "A valid conversation is required.");
  const nexMode = String(mode || "").toLowerCase();
  const minutes = Number(resumeAfterMinutes);
  if (!["automatic", "never"].includes(nexMode)) throw httpError(400, "Choose when Nex may enter this conversation.");
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) throw httpError(400, "Choose a valid Nex inactivity period.");
  const values = {
    nex_mode: nexMode,
    nex_resume_after_minutes: minutes,
    ...(nexMode === "never" || resumeNow ? { nex_paused_until: null } : {}),
    ...(nexMode === "never" ? { nex_pending_inbound_message_id: null, nex_pending_claimed_at: null } : {}),
    updated_at: new Date().toISOString(),
  };
  const rows = await supabaseJson(`admin_communication_threads?id=eq.${encodeURIComponent(threadId)}&select=id,nex_mode,nex_resume_after_minutes,nex_paused_until`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(values),
  });
  if (!rows?.[0]?.id) throw httpError(404, "Conversation not found.");
  return rows[0];
}

async function claimNexReply(threadId, messageId) {
  const result = await supabaseJson("rpc/claim_admin_communication_nex_reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_thread_id: threadId, p_message_id: messageId, p_claimed_at: new Date().toISOString() }),
  });
  return Array.isArray(result) ? result[0] || { should_reply: false } : result || { should_reply: false };
}

async function releaseNexClaim(threadId, messageId, completed = false) {
  const values = {
    nex_pending_inbound_message_id: null,
    nex_pending_claimed_at: null,
    ...(completed ? { nex_last_replied_to_message_id: messageId, nex_last_reply_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  };
  await supabaseJson(`admin_communication_threads?id=eq.${encodeURIComponent(threadId)}&nex_pending_inbound_message_id=eq.${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
}

async function nexReplyStillAllowed(threadId, messageId) {
  const rows = await supabaseJson(`admin_communication_threads?select=id,nex_mode,nex_paused_until,nex_pending_inbound_message_id&id=eq.${encodeURIComponent(threadId)}&limit=1`);
  const thread = rows?.[0];
  return Boolean(
    thread?.id
    && thread.nex_mode === "automatic"
    && thread.nex_pending_inbound_message_id === messageId
    && (!thread.nex_paused_until || new Date(thread.nex_paused_until).getTime() <= Date.now())
  );
}

function isComplianceKeyword(body) {
  return COMPLIANCE_KEYWORD.test(String(body || "").trim());
}

async function maybeReplyWithNex({ message, payload, req }) {
  const body = String(payload?.Body || "").trim();
  if (!message?.thread_id || !message?.message_id || !body || isComplianceKeyword(body)) return { sent: false, reason: "not_eligible" };
  const claim = await claimNexReply(message.thread_id, message.message_id);
  if (!claim?.should_reply) return { sent: false, reason: "not_claimed" };
  try {
    const [messages, contacts] = await Promise.all([listMessages(message.thread_id), listContacts()]);
    const history = (messages || []).filter((item) => item.id !== message.message_id && item.body).slice(-10).map((item) => ({
      role: item.direction === "inbound" ? "user" : "assistant",
      content: String(item.body),
    }));
    const contact = contacts.find((item) => item.phone === claim.phone_e164);
    if (!contact?.smsOptedIn) {
      await releaseNexClaim(message.thread_id, message.message_id);
      return { sent: false, reason: "not_opted_in" };
    }
    const accountKnown = Boolean(contact.userId);
    const reply = await generateNexConversationReply({ body, history, accountKnown });
    if (!reply || !(await nexReplyStillAllowed(message.thread_id, message.message_id))) {
      await releaseNexClaim(message.thread_id, message.message_id);
      return { sent: false, reason: reply ? "human_handoff" : "provider_unavailable" };
    }
    const sent = await sendMessage({ to: claim.phone_e164, body: reply, userId: null, req, senderType: "nex" });
    await releaseNexClaim(message.thread_id, message.message_id, true);
    return { sent: true, message: sent };
  } catch (error) {
    await releaseNexClaim(message.thread_id, message.message_id).catch(() => null);
    throw error;
  }
}

async function sendMessage({ to, body, userId, req, senderType = "human" }) {
  const recipient = normalizePhone(to);
  const text = String(body || "").trim();
  if (!recipient) throw httpError(400, "Enter a valid phone number.");
  if (!text) throw httpError(400, "Enter a message.");
  if (text.length > 1600) throw httpError(400, "Messages can be up to 1,600 characters.");
  if (!(await phoneIsOptedIn(recipient))) throw httpError(409, "This number has not opted in to N3XRA texts. They can text START to (541) 652-6840.");
  const existingPause = senderType === "human" ? await pauseNexForManualReply(recipient) : null;
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
  const recorded = await recordMessage({ phone: recipient, sid: sent.sid, direction: "outbound", body: text, status: sent.status || "queued", from: N3XRA_PHONE, to: recipient, userId });
  if (senderType === "human" && !existingPause) await pauseNexForManualReply(recipient, recorded?.thread_id);
  return recorded;
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

module.exports = { N3XRA_PHONE, httpError, isComplianceKeyword, listContacts, listMessages, listThreads, markRead, maybeReplyWithNex, parseInboundMedia, recordIncomingMessage, requirePlatformAdmin, sendMessage, updateMessageStatus, updateNexSettings };
