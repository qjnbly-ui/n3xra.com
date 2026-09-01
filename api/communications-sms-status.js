"use strict";
const { validateTwilioWebhook } = require("./_twilio-webhook");
const { clean, supabaseJson } = require("./_communications");
function eventStatus(value) {
    const status = clean(value, 40).toLowerCase();
    if (status === "delivered")
        return "delivered";
    if (status === "sent")
        return "sent";
    if (["failed", "undelivered", "canceled"].includes(status))
        return "failed";
    return "queued";
}
async function handler(req, res) {
    if (req.method !== "POST")
        return res.status(405).send("Method not allowed.");
    if (!validateTwilioWebhook(req))
        return res.status(403).send("Invalid Twilio signature.");
    const sid = clean(req.body?.MessageSid, 200);
    if (!sid)
        return res.status(400).send("Message SID is required.");
    const status = eventStatus(req.body?.MessageStatus);
    const segments = Number.parseInt(clean(req.body?.NumSegments, 10), 10);
    await Promise.all([
        supabaseJson(`communications_message_events?provider_message_id=eq.${encodeURIComponent(sid)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({
                status,
                ...(Number.isFinite(segments) && segments > 0 ? { sms_segment_count: segments, billable_units: segments } : {}),
                occurred_at: new Date().toISOString(),
            }),
        }),
        supabaseJson(`communications_broadcast_recipients?provider_message_id=eq.${encodeURIComponent(sid)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ status: status === "failed" ? "failed" : "sent", error_message: status === "failed" ? `Twilio delivery failed${clean(req.body?.ErrorCode, 40) ? ` (${clean(req.body?.ErrorCode, 40)})` : ""}.` : null }),
        }),
    ]).catch((error) => console.error("Communications SMS status save failed:", error));
    return res.status(204).send("");
}
module.exports = Object.assign(handler, { eventStatus });
