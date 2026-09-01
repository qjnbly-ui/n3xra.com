"use strict";
const node_crypto_1 = require("node:crypto");
const twilio = require("twilio");
const { authenticatedUser, clean, firstRow, sendJson, supabaseJson } = require("./_communications");
const { sendResendEmail } = require("./_communications-resend");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_ENTITLEMENTS = new Set(["trialing", "active", "past_due"]);
const SEND_ROLES = new Set(["account_admin", "editor"]);
const MAX_RECIPIENTS = 500;
function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}
function requiredUuid(value, label) {
    const normalized = clean(value, 80);
    if (!UUID_PATTERN.test(normalized))
        throw httpError(400, `${label} is invalid.`);
    return normalized;
}
function parseBody(req) {
    try {
        const value = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    catch {
        throw httpError(400, "Request body must be valid JSON.");
    }
}
function normalizeChannels(value) {
    const channels = [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, 20).toLowerCase()))]
        .filter((item) => item === "sms" || item === "email");
    if (!channels.length)
        throw httpError(400, "Choose text messages, email, or both.");
    return channels;
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function smsSegments(message) {
    const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/;
    const extended = (message.match(/[\^{}\\\[\]~|€]/g) || []).length;
    const length = gsm.test(message) ? message.length + extended : [...message].length;
    const single = gsm.test(message) ? 160 : 70;
    const multipart = gsm.test(message) ? 153 : 67;
    return length <= single ? 1 : Math.ceil(length / multipart);
}
async function requireSender(req, workspaceId, database = supabaseJson) {
    const user = await authenticatedUser(req);
    if (!user?.id)
        throw httpError(401, "Authentication required.");
    const workspace = firstRow(await database(`communications_workspaces?select=id,organization_id,program_name,sender_name,support_email,status,sms_overage_cents&id=eq.${encodeURIComponent(workspaceId)}&limit=1`));
    if (!workspace)
        throw httpError(404, "Communications workspace not found.");
    const [entitlement, access, platformAdmin] = await Promise.all([
        database(`organization_product_entitlements?select=status,portal_enabled&organization_id=eq.${encodeURIComponent(workspace.organization_id)}&product_key=eq.communications&limit=1`).then(firstRow),
        database(`organization_product_member_access?select=role,status&organization_id=eq.${encodeURIComponent(workspace.organization_id)}&product_key=eq.communications&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&limit=1`).then(firstRow),
        database(`platform_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,admin)&limit=1`).then(firstRow),
    ]);
    if (!entitlement?.portal_enabled || !ACTIVE_ENTITLEMENTS.has(String(entitlement.status)))
        throw httpError(403, "This Communications subscription is not active.");
    if (!platformAdmin && (!access || !SEND_ROLES.has(String(access.role))))
        throw httpError(403, "Editor or account administrator access is required to send messages.");
    if (workspace.status !== "active")
        throw httpError(409, "Communications delivery is not active for this organization yet.");
    return { user, workspace };
}
async function audience(database, workspaceId, topicId) {
    let allowedIds = null;
    if (topicId) {
        const topic = firstRow(await database(`communications_topics?select=id&workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(topicId)}&active=eq.true&limit=1`));
        if (!topic)
            throw httpError(400, "Choose an active subscriber topic.");
        const choices = await database(`communications_subscriber_topics?select=subscriber_id&topic_id=eq.${encodeURIComponent(topicId)}&limit=${MAX_RECIPIENTS + 1}`);
        allowedIds = new Set((choices || []).map((row) => String(row.subscriber_id)));
    }
    const rows = await database(`communications_subscribers?select=id,full_name,phone_e164,email,sms_status,email_status&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=joined_at.asc&limit=${MAX_RECIPIENTS + 1}`);
    const selected = (Array.isArray(rows) ? rows : []).filter((row) => !allowedIds || allowedIds.has(String(row.id)));
    if (selected.length > MAX_RECIPIENTS)
        throw httpError(413, `Send to at most ${MAX_RECIPIENTS} subscribers at a time.`);
    return selected;
}
async function createOrLoadBroadcast(database, input) {
    const existing = firstRow(await database(`communications_broadcasts?select=*&workspace_id=eq.${encodeURIComponent(input.workspace_id)}&idempotency_key=eq.${encodeURIComponent(input.idempotency_key)}&limit=1`));
    if (existing) {
        if (existing.payload_hash !== input.payload_hash)
            throw httpError(409, "This send request was already used for different content.");
        return existing;
    }
    try {
        return firstRow(await database("communications_broadcasts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(input),
        }));
    }
    catch (error) {
        const raced = firstRow(await database(`communications_broadcasts?select=*&workspace_id=eq.${encodeURIComponent(input.workspace_id)}&idempotency_key=eq.${encodeURIComponent(input.idempotency_key)}&limit=1`));
        if (raced) {
            if (raced.payload_hash !== input.payload_hash)
                throw httpError(409, "This send request was already used for different content.");
            return raced;
        }
        throw error;
    }
}
async function claimRecipient(database, id) {
    const claimed = await database(`communications_broadcast_recipients?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ status: "sending", claimed_at: new Date().toISOString() }),
    });
    return Array.isArray(claimed) && claimed.length === 1;
}
async function deliverEmail(database, context, recipient) {
    const domain = firstRow(await database(`communications_sending_domains?select=domain&workspace_id=eq.${encodeURIComponent(context.workspace.id)}&provider=eq.resend&status=eq.verified&limit=1`));
    if (!domain?.domain)
        throw httpError(409, "Email needs a verified sending domain before it can be sent.");
    const from = `updates@${domain.domain}`;
    const footer = `You received this because you subscribed to ${context.workspace.program_name}. To change your email preference, contact ${context.workspace.support_email}.`;
    const result = await sendResendEmail({
        workspaceId: context.workspace.id,
        subscriberId: recipient.subscriber_id,
        idempotencyKey: `broadcast/${context.broadcast.id}/${recipient.subscriber_id}`,
        from,
        to: recipient.email,
        subject: context.subject,
        text: `${context.message}\n\n${footer}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.65;white-space:pre-wrap">${escapeHtml(context.message)}</div><hr><p style="color:#667085;font:12px Arial,sans-serif">${escapeHtml(footer)}</p>`,
        replyTo: context.workspace.support_email,
    });
    return String(result.providerMessageId || "");
}
async function deliverSms(database, context, recipient) {
    const [channel, number] = await Promise.all([
        database(`communications_channels?select=status&workspace_id=eq.${encodeURIComponent(context.workspace.id)}&channel=eq.sms&limit=1`).then(firstRow),
        database(`communications_numbers?select=phone_e164,messaging_service_sid,status,carrier_registration_status,texting_activated_at&workspace_id=eq.${encodeURIComponent(context.workspace.id)}&status=eq.active&limit=1`).then(firstRow),
    ]);
    if (channel?.status !== "active" || !number?.phone_e164 || !number.texting_activated_at || !["approved", "registered"].includes(String(number.carrier_registration_status))) {
        throw httpError(409, "Texting needs an active registered number before it can be sent.");
    }
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
    if (!accountSid || !authToken)
        throw httpError(503, "Text delivery is not configured.");
    const body = `${context.workspace.sender_name}: ${context.message}\nReply STOP to opt out.`;
    const callback = new URL("/api/communications-sms-status", String(process.env.PUBLIC_SITE_URL || "https://n3xra.com")).toString();
    const sent = await twilio(accountSid, authToken).messages.create({
        ...(number.messaging_service_sid ? { messagingServiceSid: number.messaging_service_sid } : { from: number.phone_e164 }),
        to: recipient.phone_e164,
        body,
        statusCallback: callback,
    });
    const providerId = clean(sent.sid, 200);
    const segments = Number(sent.numSegments || smsSegments(body));
    await database("communications_message_events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
            workspace_id: context.workspace.id,
            subscriber_id: recipient.subscriber_id,
            channel: "sms",
            direction: "outbound",
            status: ["sent", "delivered"].includes(String(sent.status)) ? sent.status : "queued",
            provider_message_id: providerId,
            from_address: number.phone_e164,
            to_address: recipient.phone_e164,
            body_preview: context.message.slice(0, 500),
            sms_segment_count: segments,
            billable_units: segments,
            estimated_cost_cents: 0,
        }),
    });
    return providerId;
}
async function updateRecipient(database, id, status, providerMessageId, message) {
    await database(`communications_broadcast_recipients?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status, provider_message_id: providerMessageId, error_message: message, completed_at: new Date().toISOString() }),
    });
}
async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, 405, { error: "Method not allowed." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
        const body = parseBody(req);
        const workspaceId = requiredUuid(body.workspaceId, "Workspace");
        const idempotencyKey = requiredUuid(body.idempotencyKey, "Send request");
        const topicId = body.topicId ? requiredUuid(body.topicId, "Topic") : "";
        const channels = normalizeChannels(body.channels);
        const message = clean(body.message, 1600);
        const subject = channels.includes("email") ? clean(body.subject, 300) : "";
        if (!message)
            throw httpError(400, "Enter a message.");
        if (channels.includes("email") && !subject)
            throw httpError(400, "Enter an email subject.");
        const { user, workspace } = await requireSender(req, workspaceId);
        const subscribers = await audience(supabaseJson, workspaceId, topicId);
        const deliveries = subscribers.flatMap((subscriber) => channels.flatMap((channel) => {
            const address = channel === "email" ? subscriber.email : subscriber.phone_e164;
            const subscribed = channel === "email" ? subscriber.email_status === "subscribed" : subscriber.sms_status === "subscribed";
            return address && subscribed ? [{ subscriber, channel, address }] : [];
        }));
        if (!deliveries.length)
            throw httpError(409, "No subscribers in this audience have active consent for the selected channels.");
        const payloadHash = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify({ workspaceId, topicId, channels: [...channels].sort(), subject, message })).digest("hex");
        const broadcast = await createOrLoadBroadcast(supabaseJson, {
            workspace_id: workspaceId,
            actor_user_id: user.id,
            idempotency_key: idempotencyKey,
            payload_hash: payloadHash,
            topic_id: topicId || null,
            channels,
            subject: subject || null,
            body_preview: message.slice(0, 500),
            status: "preparing",
            recipient_count: deliveries.length,
        });
        if (!broadcast?.id)
            throw new Error("Broadcast could not be prepared.");
        const existingRecipients = await supabaseJson(`communications_broadcast_recipients?select=id,subscriber_id,channel,status,provider_message_id&broadcast_id=eq.${encodeURIComponent(broadcast.id)}&limit=${MAX_RECIPIENTS * 2}`);
        if (!existingRecipients.length) {
            await supabaseJson("communications_broadcast_recipients", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
                body: JSON.stringify(deliveries.map(({ subscriber, channel }) => ({ broadcast_id: broadcast.id, subscriber_id: subscriber.id, channel }))),
            });
        }
        await supabaseJson(`communications_broadcasts?id=eq.${encodeURIComponent(broadcast.id)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "sending" }),
        });
        const recipientRows = await supabaseJson(`communications_broadcast_recipients?select=id,subscriber_id,channel,status&broadcast_id=eq.${encodeURIComponent(broadcast.id)}&status=eq.pending&limit=${MAX_RECIPIENTS * 2}`);
        let sentCount = Number(broadcast.sent_count || 0);
        let failedCount = Number(broadcast.failed_count || 0);
        const pendingRecipients = recipientRows;
        for (let offset = 0; offset < pendingRecipients.length; offset += 5) {
            await Promise.all(pendingRecipients.slice(offset, offset + 5).map(async (row) => {
                if (!await claimRecipient(supabaseJson, row.id))
                    return;
                const subscriber = subscribers.find((item) => item.id === row.subscriber_id);
                if (!subscriber) {
                    failedCount += 1;
                    await updateRecipient(supabaseJson, row.id, "failed", null, "Subscriber is no longer available.");
                    return;
                }
                try {
                    const deliveryRecipient = { ...subscriber, subscriber_id: subscriber.id };
                    const providerId = row.channel === "email"
                        ? await deliverEmail(supabaseJson, { workspace, broadcast, message, subject }, deliveryRecipient)
                        : await deliverSms(supabaseJson, { workspace, broadcast, message }, deliveryRecipient);
                    sentCount += 1;
                    await updateRecipient(supabaseJson, row.id, "sent", providerId, null);
                }
                catch (caught) {
                    failedCount += 1;
                    await updateRecipient(supabaseJson, row.id, "failed", null, clean(caught.message || "Delivery failed.", 1000));
                }
            }));
        }
        const status = sentCount > 0 && failedCount === 0 ? "completed" : sentCount > 0 ? "partial" : "failed";
        await supabaseJson(`communications_broadcasts?id=eq.${encodeURIComponent(broadcast.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ status, sent_count: sentCount, failed_count: failedCount, completed_at: new Date().toISOString() }),
        });
        return sendJson(res, 200, { ok: sentCount > 0, status, sentCount, failedCount, recipientCount: deliveries.length });
    }
    catch (caught) {
        const error = caught;
        const status = Number(error.status || 500);
        if (status >= 500)
            console.error("Communications client send failed:", error);
        return sendJson(res, status >= 400 && status < 600 ? status : 500, { error: status >= 500 ? "Messages could not be sent right now." : error.message });
    }
}
module.exports = Object.assign(handler, { audience, normalizeChannels, requireSender, smsSegments });
