"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTextedPin = isTextedPin;
exports.issueSmsLink = issueSmsLink;
exports.verifySmsLink = verifySmsLink;
exports.revokeSmsAccess = revokeSmsAccess;
exports.verifiedSmsUser = verifiedSmsUser;
exports.smsAccountStatus = smsAccountStatus;
const node_crypto_1 = require("node:crypto");
const { supabaseJson } = require("./_communications");
const { getCallerAccount, getCredentialByUser } = require("./_account-phone");
const uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const digest = (v) => (0, node_crypto_1.createHash)("sha256").update(v).digest("hex");
const headers = { "Content-Type": "application/json", Prefer: "return=representation" };
function isTextedPin(body) { return /^\s*\d{4}\s*$/.test(body) || /\b(?:my\s+)?(?:pin|verification code|passcode)\s*(?:is|:|=)?\s*\d{4}\b/i.test(body); }
async function issueSmsLink(threadId, phone, store = supabaseJson, now = Date.now()) {
    if (!uuid(threadId) || !/^\+[1-9]\d{7,14}$/.test(phone))
        throw Error("Invalid text conversation.");
    const existing = (await store(`nex_sms_sessions?thread_id=eq.${threadId}&select=requested_at&limit=1`))?.[0];
    if (existing && now - new Date(existing.requested_at).getTime() < 60_000)
        return "Please use the sign-in link I just sent, or wait a minute before requesting another.";
    const token = (0, node_crypto_1.randomBytes)(32).toString("hex");
    await store('nex_sms_sessions?on_conflict=thread_id', { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ thread_id: threadId, phone_e164: phone, token_hash: digest(token), requested_at: new Date(now).toISOString(), challenge_expires_at: new Date(now + 600_000).toISOString(), verified_user_id: null, verified_until: null, credential_version: null, consumed_at: null }) });
    return `Sign in to enable account-status replies for 30 minutes: https://www.n3xra.com/account/text-access/#${token} Link expires in 10 minutes. Do not text your PIN.`;
}
async function verifySmsLink(token, userId, store = supabaseJson, credentialLookup = getCredentialByUser, now = Date.now(), consume = true) {
    if (!/^[a-f0-9]{64}$/.test(token) || !uuid(userId))
        throw Error("Invalid verification link.");
    const filter = `token_hash=eq.${digest(token)}&consumed_at=is.null&challenge_expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}`;
    const row = (await store(`nex_sms_sessions?${filter}&select=*&limit=1`))?.[0];
    const credential = await credentialLookup(userId);
    if (!row || !credential?.updated_at || !credential.phone_e164 || credential.phone_e164 !== row.phone_e164)
        throw Error("Account does not match this text conversation.");
    if (!consume)
        return { phoneEnding: row.phone_e164.slice(-4) };
    const until = new Date(now + 1_800_000).toISOString();
    const changed = await store(`nex_sms_sessions?thread_id=eq.${row.thread_id}&${filter}`, { method: 'PATCH', headers, body: JSON.stringify({ consumed_at: new Date(now).toISOString(), verified_user_id: userId, verified_until: until, credential_version: credential.updated_at }) });
    if (!changed?.length)
        throw Error("Link already used or expired.");
    return { verified: true, expiresAt: until, phoneEnding: row.phone_e164.slice(-4) };
}
async function revokeSmsAccess(phone, store = supabaseJson) {
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
        return;
    await store(`nex_sms_sessions?phone_e164=eq.${encodeURIComponent(phone)}`, { method: 'DELETE' });
}
async function verifiedSmsUser(threadId, phone, store = supabaseJson, callerLookup = getCallerAccount, credentialLookup = getCredentialByUser, now = Date.now()) {
    if (!uuid(threadId))
        return null;
    const row = (await store(`nex_sms_sessions?thread_id=eq.${threadId}&verified_until=gt.${encodeURIComponent(new Date(now).toISOString())}&select=*&limit=1`))?.[0];
    if (!row || row.phone_e164 !== phone || !row.verified_user_id)
        return null;
    const caller = await callerLookup(phone), credential = await credentialLookup(row.verified_user_id);
    if (caller?.user_id !== row.verified_user_id || credential?.phone_e164 !== phone || credential.updated_at !== row.credential_version)
        return null;
    return { id: row.verified_user_id, expiresAt: row.verified_until };
}
async function smsAccountStatus(threadId, phone) {
    const user = await verifiedSmsUser(threadId, phone);
    if (!user)
        return "Please text VERIFY and sign in before requesting your account status.";
    const rows = await supabaseJson(`profiles?id=eq.${user.id}&select=account_status&limit=1`);
    const status = String(rows?.[0]?.account_status || "");
    const label = { active: "active", trialing: "on a trial" };
    if (!label[status])
        return "Your account status is unavailable by text. Please check your N3XRA account online.";
    return `Your N3XRA account is ${label[status]}. This text access lasts until ${new Date(user.expiresAt).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })} Pacific. Text LOCK to end it. Website editing is not enabled by text.`;
}
