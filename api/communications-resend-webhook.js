"use strict";
const node_crypto_1 = require("node:crypto");
const { supabaseJson } = require("./_communications");
const { verifyResendWebhook } = require("./_communications-resend");
const MAX_WEBHOOK_BYTES = 256 * 1024;
const SUPPORTED_EVENTS = new Set([
    "email.scheduled",
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.failed",
    "email.bounced",
    "email.complained",
    "email.suppressed",
    "email.opened",
    "email.clicked",
    "suppression.added",
    "suppression.removed",
]);
function header(req, name) {
    const value = req.headers[name.toLowerCase()];
    return value ?? "";
}
function sendJson(res, statusCode, body) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (res.status && res.json) {
        const response = res.status(statusCode);
        return response.json ? response.json(body) : response.end(JSON.stringify(body));
    }
    res.statusCode = statusCode;
    return res.end(JSON.stringify(body));
}
async function readRawBody(req, maximumBytes = MAX_WEBHOOK_BYTES) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
        bytes += buffer.length;
        if (bytes > maximumBytes) {
            const error = new Error("Webhook payload is too large.");
            error.status = 413;
            throw error;
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}
function requiredPayloadObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Webhook payload is invalid.");
    return value;
}
async function processResendWebhook(rawBody, headers, dependencies = {}) {
    const valid = verifyResendWebhook({
        payload: rawBody,
        svixId: headers.svixId,
        svixTimestamp: headers.svixTimestamp,
        svixSignature: headers.svixSignature,
        ...(dependencies.secret ? { secret: dependencies.secret } : {}),
        ...(dependencies.nowSeconds !== undefined ? { nowSeconds: dependencies.nowSeconds } : {}),
    });
    if (!valid) {
        const error = new Error("Webhook signature is invalid or expired.");
        error.status = 400;
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        const error = new Error("Webhook payload must be valid JSON.");
        error.status = 400;
        throw error;
    }
    const payload = requiredPayloadObject(parsed);
    const type = String(payload.type ?? "").trim().toLowerCase();
    if (!SUPPORTED_EVENTS.has(type)) {
        const error = new Error("Webhook event type is unsupported.");
        error.status = 400;
        throw error;
    }
    const createdAt = String(payload.created_at ?? "").trim();
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
        const error = new Error("Webhook occurrence time is invalid.");
        error.status = 400;
        throw error;
    }
    const data = requiredPayloadObject(payload.data);
    const providerMessageId = String(data.email_id ?? "").trim() || null;
    const database = dependencies.database ?? supabaseJson;
    const result = await database("rpc/communications_process_resend_webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input_svix_id: headers.svixId,
            input_event_type: type,
            input_provider_message_id: providerMessageId,
            input_payload_hash: (0, node_crypto_1.createHash)("sha256").update(rawBody).digest("hex"),
            input_event_payload: payload,
            input_occurred_at: new Date(createdAt).toISOString(),
        }),
    });
    return requiredPayloadObject(result);
}
async function handleResendWebhookRequest(req, res, dependencies = {}) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, 405, { error: "Method not allowed." });
    }
    try {
        const rawBody = await readRawBody(req);
        const svixIdValue = header(req, "svix-id");
        const svixTimestampValue = header(req, "svix-timestamp");
        const svixSignatureValue = header(req, "svix-signature");
        const svixId = Array.isArray(svixIdValue) ? String(svixIdValue[0] ?? "") : String(svixIdValue);
        const svixTimestamp = Array.isArray(svixTimestampValue)
            ? String(svixTimestampValue[0] ?? "")
            : String(svixTimestampValue);
        if (!svixId || !svixTimestamp || !svixSignatureValue) {
            return sendJson(res, 400, { error: "Required webhook signature headers are missing." });
        }
        const result = await processResendWebhook(rawBody, {
            svixId,
            svixTimestamp,
            svixSignature: svixSignatureValue,
        }, dependencies);
        return sendJson(res, 200, { ok: true, result });
    }
    catch (caught) {
        const error = caught;
        const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
        if (status >= 500)
            console.error("Resend webhook processing failed:", error);
        return sendJson(res, status, {
            error: status >= 500 ? "Resend webhook processing failed." : error.message,
        });
    }
}
const handler = Object.assign((req, res) => handleResendWebhookRequest(req, res), {
    config: { api: { bodyParser: false } },
    handleResendWebhookRequest,
    processResendWebhook,
    readRawBody,
});
module.exports = handler;
