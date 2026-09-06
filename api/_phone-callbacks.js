"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validCallbackDispatch = validCallbackDispatch;
exports.dispatchPhoneCallbacks = dispatchPhoneCallbacks;
exports.callbackForCall = callbackForCall;
const node_crypto_1 = require("node:crypto");
const _phone_records_1 = require("./_phone-records");
function validCallbackDispatch(time, signature, secret, now = Date.now()) {
    if (secret.length < 32 || !/^\d+$/.test(time) || Math.abs(now - Number(time)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature))
        return false;
    return (0, node_crypto_1.timingSafeEqual)(Buffer.from(signature, "hex"), (0, node_crypto_1.createHmac)("sha256", secret).update(`phone-callback-dispatch:${time}`).digest());
}
async function patch(row, callback, store, expected = row.metadata.callback.state) {
    return store(`website_build_events?id=eq.${row.id}&metadata->callback->>state=eq.${expected}`, { method: "PATCH", body: JSON.stringify({ metadata: { ...row.metadata, callback } }) });
}
async function dispatchPhoneCallbacks(client, store = _phone_records_1.phoneRecordStore, now = Date.now()) {
    const rows = await store('website_build_events?event_type=eq.user_message&metadata->callback->>state=eq.pending&order=id.asc&limit=5');
    let dispatched = 0;
    for (const row of rows || []) {
        const job = row.metadata.callback;
        if (Date.parse(job.expiresAt) <= now) {
            await patch(row, { ...job, state: "expired" }, store);
            continue;
        }
        if (!await (0, _phone_records_1.isPhoneRecordOwner)(row.actor_user_id, store)) {
            await patch(row, { ...job, state: "cancelled" }, store);
            continue;
        }
        const next = (await store(`website_build_events?session_id=eq.${row.session_id}&id=gt.${row.id}&event_type=in.(agent_message,error)&metadata->>completedRequestId=eq.${row.id}&order=id.asc&limit=1`))?.[0];
        if (!next)
            continue;
        // A newer request supersedes an unfinished one; never announce that newer work as this result.
        if (next.event_type === "user_message") {
            await patch(row, { ...job, state: "cancelled" }, store);
            continue;
        }
        const credential = (await store(`account_phone_credentials?user_id=eq.${row.actor_user_id}&select=phone_e164,locked_until&limit=1`))?.[0];
        if (!credential?.phone_e164 || Date.parse(credential.locked_until || '') > now) {
            await patch(row, { ...job, state: "cancelled" }, store);
            continue;
        }
        const original = await client.calls(row.metadata.callId).fetch();
        const recipient = original.direction === "inbound" ? original.from : original.to;
        const sender = original.direction === "inbound" ? original.to : original.from;
        if (recipient !== credential.phone_e164 || !/^\+[1-9]\d{7,14}$/.test(sender)) {
            await patch(row, { ...job, state: "cancelled" }, store);
            continue;
        }
        if (["queued", "ringing", "in-progress"].includes(original.status))
            continue;
        const claimed = { ...job, state: "dispatching", token: (0, node_crypto_1.randomUUID)(), resultId: String(next.id), claimedAt: new Date(now).toISOString() };
        if (!(await patch(row, claimed, store))?.length)
            continue;
        // Claim before dialing: ambiguous provider failures are never retried into duplicate calls.
        try {
            const url = `https://www.n3xra.com/api/phone-build-callback?request=${row.id}&token=${claimed.token}`;
            const call = await client.calls.create({ to: recipient, from: sender, url, method: "POST", timeout: 30,
                statusCallback: `${url}&status=1`, statusCallbackMethod: "POST", statusCallbackEvent: ["completed"] });
            await patch(row, { ...claimed, state: "called", callSid: call.sid }, store, "dispatching");
            dispatched++;
        }
        catch {
            await patch(row, { ...claimed, state: "unconfirmed" }, store, "dispatching");
        }
    }
    return { dispatched };
}
async function callbackForCall(callSid, store = _phone_records_1.phoneRecordStore) {
    if (!/^CA[0-9a-f]{32}$/i.test(callSid))
        return null;
    const row = (await store(`website_build_events?metadata->callback->>callSid=eq.${callSid}&event_type=eq.user_message&limit=1`))?.[0];
    if (!row || Date.parse(row.metadata.callback.expiresAt) <= Date.now() || !await (0, _phone_records_1.isPhoneRecordOwner)(row.actor_user_id, store))
        return null;
    const credential = (await store(`account_phone_credentials?user_id=eq.${row.actor_user_id}&select=phone_e164&limit=1`))?.[0];
    if (!credential?.phone_e164)
        return null;
    const result = (await store(`website_build_events?id=eq.${row.metadata.callback.resultId}&session_id=eq.${row.session_id}&limit=1`))?.[0];
    return { userId: row.actor_user_id, phone: credential.phone_e164, sessionId: row.session_id, request: row.message, result: result?.message || "The request needs attention. Please check Build Studio." };
}
