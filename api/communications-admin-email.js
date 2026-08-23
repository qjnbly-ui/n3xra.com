"use strict";
const { clean, firstRow, requirePlatformAdmin, sendJson, supabaseJson, } = require("./_communications");
const { sendResendEmail } = require("./_communications-resend");
const RESEND_DOMAINS_ENDPOINT = "https://api.resend.com/domains";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i;
const REGIONS = new Set(["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"]);
function providerError(message, status = 502) {
    const error = new Error(message);
    error.status = status;
    return error;
}
function requiredUuid(value, label) {
    const normalized = clean(value, 80);
    if (!UUID_PATTERN.test(normalized))
        throw providerError(`${label} is invalid.`, 400);
    return normalized;
}
function requiredDomain(value) {
    const normalized = clean(value, 253).toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!DOMAIN_PATTERN.test(normalized))
        throw providerError("Enter a valid sending domain without https:// or a path.", 400);
    return normalized;
}
function requiredText(value, label, minimum, maximum) {
    const normalized = clean(value, maximum);
    if (normalized.length < minimum)
        throw providerError(`${label} is required.`, 400);
    return normalized;
}
function asObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw providerError(`${label} returned an invalid response.`);
    }
    return value;
}
function configuredApiKey() {
    const apiKey = String(process.env.COMMUNICATIONS_RESEND_API_KEY ?? "").trim();
    if (!apiKey)
        throw providerError("Resend is not configured on this environment.", 503);
    return apiKey;
}
function providerCapabilities() {
    return {
        providerAvailable: Boolean(String(process.env.COMMUNICATIONS_RESEND_API_KEY ?? "").trim()),
        webhookAvailable: Boolean(String(process.env.COMMUNICATIONS_RESEND_WEBHOOK_SECRET ?? "").trim()),
    };
}
async function parseProviderResponse(response) {
    const text = await response.text();
    if (!text)
        return {};
    try {
        return asObject(JSON.parse(text), "Resend");
    }
    catch {
        return { message: text.slice(0, 1000) };
    }
}
async function resendRequest(path, options = {}) {
    const response = await fetch(`${RESEND_DOMAINS_ENDPOINT}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${configuredApiKey()}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers ?? {}),
        },
    });
    const payload = await parseProviderResponse(response);
    if (!response.ok) {
        throw providerError(String(payload.message ?? payload.error ?? `Resend returned HTTP ${response.status}.`).slice(0, 1000), response.status);
    }
    return payload;
}
function providerStatus(value) {
    const normalized = clean(value, 50).toLowerCase();
    const supported = new Set([
        "not_started", "pending", "verified", "partially_verified",
        "partially_failed", "failed", "temporary_failure",
    ]);
    if (!supported.has(normalized))
        throw providerError("Resend returned an unsupported domain status.");
    return normalized;
}
async function workspaceRow(workspaceId) {
    const workspace = firstRow(await supabaseJson(`communications_workspaces?select=id,organization_id,slug,program_name,sender_name,support_email,status&id=eq.${encodeURIComponent(workspaceId)}&limit=1`));
    if (!workspace)
        throw providerError("Communications workspace not found.", 404);
    return workspace;
}
async function domainRow(workspaceId) {
    return firstRow(await supabaseJson(`communications_sending_domains?select=id,workspace_id,domain,provider,provider_domain_id,status,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.resend&order=created_at.asc&limit=1`));
}
function publicDomain(domain, stored) {
    return {
        configured: true,
        domain: domain.name,
        providerStatus: domain.status,
        localStatus: stored?.status ?? null,
        region: domain.region ?? null,
        records: Array.isArray(domain.records) ? domain.records.map((record) => ({
            record: clean(record.record, 40),
            type: clean(record.type, 20),
            name: clean(record.name, 500),
            value: clean(record.value, 4000),
            ttl: clean(record.ttl, 40),
            status: clean(record.status, 50),
            priority: Number.isFinite(record.priority) ? record.priority : null,
        })) : [],
    };
}
async function getProviderDomain(stored) {
    const providerDomainId = requiredText(stored.provider_domain_id, "Resend domain identifier", 3, 200);
    const result = await resendRequest(`/${encodeURIComponent(providerDomainId)}`);
    const id = requiredText(result.id, "Resend domain identifier", 3, 200);
    const name = requiredDomain(result.name);
    return { ...result, id, name, status: providerStatus(result.status) };
}
async function recordDomain(actorUserId, idempotencyKey, workspaceId, domain) {
    return asObject(await supabaseJson("rpc/communications_admin_record_resend_domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input_actor_user_id: actorUserId,
            input_idempotency_key: idempotencyKey,
            input_workspace_id: workspaceId,
            input_domain: domain.name,
            input_provider_domain_id: domain.id,
            input_provider_status: domain.status,
        }),
    }), "Communications domain update");
}
async function readState(workspaceId) {
    await workspaceRow(workspaceId);
    const stored = await domainRow(workspaceId);
    const capabilities = providerCapabilities();
    if (!stored) {
        return { configured: false, ...capabilities };
    }
    if (!stored.provider_domain_id || !capabilities.providerAvailable) {
        return {
            configured: true,
            ...capabilities,
            domain: stored.domain,
            providerStatus: null,
            localStatus: stored.status,
            records: [],
        };
    }
    const domain = await getProviderDomain(stored);
    return { ...capabilities, ...publicDomain(domain, stored) };
}
async function createDomain(actorUserId, body) {
    const workspaceId = requiredUuid(body.workspaceId, "Workspace");
    const idempotencyKey = requiredUuid(body.idempotencyKey, "Idempotency key");
    await workspaceRow(workspaceId);
    if (await domainRow(workspaceId))
        throw providerError("This workspace already has a Resend sending domain.", 409);
    const domain = requiredDomain(body.domain);
    const region = clean(body.region, 30) || "us-east-1";
    if (!REGIONS.has(region))
        throw providerError("Choose a supported sending region.", 400);
    const created = await resendRequest("", {
        method: "POST",
        body: JSON.stringify({
            name: domain,
            region,
            capabilities: { sending: "enabled", receiving: "disabled" },
        }),
    });
    const normalized = {
        ...created,
        id: requiredText(created.id, "Resend domain identifier", 3, 200),
        name: requiredDomain(created.name ?? domain),
        status: providerStatus(created.status),
    };
    await recordDomain(actorUserId, idempotencyKey, workspaceId, normalized);
    return { ok: true, operation: "create_domain", ...providerCapabilities(), ...publicDomain(normalized, { status: normalized.status === "verified" ? "verified" : "pending_verification" }) };
}
async function refreshDomain(actorUserId, body, triggerVerification) {
    const workspaceId = requiredUuid(body.workspaceId, "Workspace");
    const idempotencyKey = requiredUuid(body.idempotencyKey, "Idempotency key");
    await workspaceRow(workspaceId);
    const stored = await domainRow(workspaceId);
    if (!stored)
        throw providerError("Add a Resend sending domain first.", 400);
    const providerDomainId = requiredText(stored.provider_domain_id, "Resend domain identifier", 3, 200);
    if (triggerVerification) {
        await resendRequest(`/${encodeURIComponent(providerDomainId)}/verify`, { method: "POST" });
    }
    const domain = await getProviderDomain(stored);
    const recorded = await recordDomain(actorUserId, idempotencyKey, workspaceId, domain);
    return { ok: true, operation: triggerVerification ? "verify_domain" : "refresh_domain", ...providerCapabilities(), ...publicDomain(domain, recorded) };
}
async function activateDomain(actorUserId, body) {
    const workspaceId = requiredUuid(body.workspaceId, "Workspace");
    const idempotencyKey = requiredUuid(body.idempotencyKey, "Idempotency key");
    await workspaceRow(workspaceId);
    const stored = await domainRow(workspaceId);
    if (!stored)
        throw providerError("Add a Resend sending domain first.", 400);
    const domain = await getProviderDomain(stored);
    if (domain.status !== "verified")
        throw providerError("Resend has not verified every required DNS record yet.", 409);
    if (!providerCapabilities().webhookAvailable)
        throw providerError("Configure the signed Resend webhook before activating email.", 409);
    await recordDomain(actorUserId, crypto.randomUUID(), workspaceId, domain);
    const result = asObject(await supabaseJson("rpc/communications_admin_activate_resend_email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input_actor_user_id: actorUserId,
            input_idempotency_key: idempotencyKey,
            input_workspace_id: workspaceId,
            input_provider_domain_id: domain.id,
        }),
    }), "Communications email activation");
    return { ...result, operation: "activate_email", ...providerCapabilities(), ...publicDomain(domain, { status: "verified" }) };
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
async function sendTestEmail(body) {
    const workspaceId = requiredUuid(body.workspaceId, "Workspace");
    const subscriberId = requiredUuid(body.subscriberId, "Subscriber");
    const idempotencyKey = requiredUuid(body.idempotencyKey, "Idempotency key");
    const workspace = await workspaceRow(workspaceId);
    const stored = await domainRow(workspaceId);
    if (!stored || stored.status !== "verified")
        throw providerError("Activate a verified sending domain before sending a test.", 409);
    const localPart = clean(body.fromLocalPart, 64).toLowerCase();
    if (!LOCAL_PART_PATTERN.test(localPart))
        throw providerError("From address name is invalid.", 400);
    const subject = requiredText(body.subject, "Subject", 1, 300);
    const message = requiredText(body.message, "Message", 1, 10000);
    const subscriber = firstRow(await supabaseJson(`communications_subscribers?select=id,email,email_status&workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(subscriberId)}&limit=1`));
    if (!subscriber?.email || subscriber.email_status !== "subscribed") {
        throw providerError("Choose a subscriber with active email consent.", 400);
    }
    const from = `${localPart}@${String(stored.domain)}`;
    const result = await sendResendEmail({
        workspaceId,
        subscriberId,
        idempotencyKey: `admin-test/${idempotencyKey}`,
        from,
        to: String(subscriber.email),
        subject,
        text: message,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div><hr><p style="color:#667085;font:12px Arial,sans-serif">Test email from ${escapeHtml(String(workspace.sender_name ?? workspace.program_name ?? "Nexra Communications"))}.</p>`,
        replyTo: String(workspace.support_email ?? ""),
    });
    return { ...result, operation: "send_test_email" };
}
async function parseBody(req) {
    let candidate;
    try {
        candidate = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }
    catch {
        throw providerError("Request body must be valid JSON.", 400);
    }
    return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
}
module.exports = async function handler(req, res) {
    if (!new Set(["GET", "POST"]).has(String(req.method ?? ""))) {
        res.setHeader("Allow", "GET, POST");
        return sendJson(res, 405, { error: "Method not allowed." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
        const { user } = await requirePlatformAdmin(req);
        if (req.method === "GET") {
            return sendJson(res, 200, await readState(requiredUuid(req.query?.workspaceId, "Workspace")));
        }
        const body = await parseBody(req);
        const operation = clean(body.operation, 50).toLowerCase();
        let result;
        if (operation === "create_domain")
            result = await createDomain(user.id, body);
        else if (operation === "refresh_domain")
            result = await refreshDomain(user.id, body, false);
        else if (operation === "verify_domain")
            result = await refreshDomain(user.id, body, true);
        else if (operation === "activate_email")
            result = await activateDomain(user.id, body);
        else if (operation === "send_test_email")
            result = await sendTestEmail(body);
        else
            throw providerError("Unknown Communications email operation.", 400);
        return sendJson(res, 200, result);
    }
    catch (caught) {
        const error = caught;
        const status = Number(error.status ?? 500);
        if (status >= 500)
            console.error("Communications email administration failed:", error);
        return sendJson(res, status >= 400 && status < 600 ? status : 500, {
            error: status >= 500 ? "Communications email setup is temporarily unavailable." : error.message,
        });
    }
};
module.exports.RESEND_DOMAINS_ENDPOINT = RESEND_DOMAINS_ENDPOINT;
module.exports.providerStatus = providerStatus;
module.exports.publicDomain = publicDomain;
module.exports.requiredDomain = requiredDomain;
