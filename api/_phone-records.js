"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneRecorder = exports.uuid = exports.phoneRecordStore = void 0;
exports.redactPhoneText = redactPhoneText;
exports.isPhoneRecordOwner = isPhoneRecordOwner;
exports.phoneInstruction = phoneInstruction;
exports.cleanupPhoneRecords = cleanupPhoneRecords;
const node_crypto_1 = require("node:crypto");
const _phone_build_agent_1 = require("./_phone-build-agent");
const phoneRecordStore = async (path, options = {}) => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
    const base = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";
    if (!key)
        throw new Error("Phone history storage unavailable.");
    const response = await fetch(`${base.replace(/\/$/, "")}/rest/v1/${path}`, {
        ...options, signal: AbortSignal.timeout(2000), headers: {
            apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
            Prefer: "return=representation", ...options.headers,
        },
    });
    if (!response.ok)
        throw new Error("Phone history storage unavailable.");
    return response.status === 204 ? null : response.json();
};
exports.phoneRecordStore = phoneRecordStore;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
exports.uuid = uuid;
function redactPhoneText(value, max = 8000) {
    // Store selected text fields only. Never serialize provider requests, headers or PIN frames.
    const clean = String(value || "")
        .replace(/https?:\/\/\S+/gi, "[link omitted]")
        .replace(/\b(?:sk[-_]|gsk_|sb_secret_)[A-Za-z0-9_-]+/g, "[credential omitted]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[credential omitted]")
        .replace(/\b(?:authorization|password|passcode|pin|api[ _-]?key|secret)\b[^.!?\n]*/gi, "[sensitive text omitted]")
        .replace(/\b\d{4}\b/g, "[four digits omitted]");
    return clean.length > max ? clean.slice(0, max - 24) + " [text truncated]" : clean;
}
async function isPhoneRecordOwner(userId, store = exports.phoneRecordStore) {
    if (!(0, exports.uuid)(userId))
        return false;
    const rows = await store(`platform_admins?user_id=eq.${userId}&role=eq.owner&status=eq.active&select=user_id&limit=1`);
    return Boolean(rows?.length);
}
async function phoneInstruction(userId, store = exports.phoneRecordStore) {
    const rows = await store(`ai_phone_instructions?user_id=eq.${userId}&select=instruction,expected_effect,version&limit=1`);
    return rows?.[0] || { instruction: "", expected_effect: "", version: null };
}
/** Bounded, in-process, best-effort text capture. A crash can leave an open/incomplete record. */
class PhoneRecorder {
    store;
    id = (0, node_crypto_1.randomUUID)();
    sequence = 0;
    queue = [];
    saving;
    closed = false;
    dropped = 0;
    captured = 0;
    started = Date.now();
    constructor(store) {
        this.store = store;
    }
    static async start(userId, callId, websiteId, store = exports.phoneRecordStore) {
        if (!(0, exports.uuid)(websiteId) || !/^CA[0-9a-f]{32}$/i.test(callId) || !await isPhoneRecordOwner(userId, store))
            return null;
        const recorder = new PhoneRecorder(store);
        const instruction = await phoneInstruction(userId, store);
        await store("ai_phone_conversations", { method: "POST", body: JSON.stringify({
                id: recorder.id, user_id: userId, call_id: callId, website_id: websiteId,
                configured_model: process.env.GROQ_RECEPTIONIST_MODEL || process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b",
                instruction_version: instruction.version,
                rules_version: (0, node_crypto_1.createHash)("sha256").update(_phone_build_agent_1.phoneBuildRules).digest("hex"),
            }) });
        recorder.record("notice", "Text capture starts after verified phone access. Earlier speech and PIN entry are excluded. This is a transcript, not audio; recognition can be inaccurate.");
        return { recorder, instruction };
    }
    record(kind, text) {
        if (this.closed)
            return;
        if (Date.now() - this.started > 15 * 60_000 || this.captured >= 1000 || this.queue.length >= 50) {
            this.dropped++;
            return;
        }
        this.captured++;
        this.queue.push({ id: (0, node_crypto_1.randomUUID)(), conversation_id: this.id, sequence: ++this.sequence,
            kind, text: redactPhoneText(text), created_at: new Date().toISOString() });
        void this.flush();
    }
    async flush() {
        if (this.saving)
            return this.saving;
        this.saving = (async () => {
            while (this.queue.length) {
                const batch = this.queue.splice(0, 10);
                let saved = false;
                // Stable event IDs make one retry safe after a lost response.
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        await this.store("ai_phone_events?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(batch) });
                        saved = true;
                        break;
                    }
                    catch { /* No text or credentials in application logs. */ }
                }
                if (!saved) {
                    this.dropped += batch.length;
                    console.warn("Phone history batch could not be saved.");
                }
                try {
                    await this.store(`ai_phone_conversations?id=eq.${this.id}`, { method: "PATCH", body: JSON.stringify({ dropped_events: this.dropped, last_event_at: new Date().toISOString() }) });
                }
                catch {
                    this.dropped++;
                }
            }
        })().finally(() => { this.saving = undefined; });
        return this.saving;
    }
    async close() {
        if (this.closed)
            return;
        this.record("notice", "Phone connection ended.");
        this.closed = true;
        await this.flush();
        try {
            await this.store(`ai_phone_conversations?id=eq.${this.id}`, { method: "PATCH", body: JSON.stringify({
                    status: this.dropped ? "incomplete" : "closed", dropped_events: this.dropped, ended_at: new Date().toISOString(),
                }) });
        }
        catch {
            console.warn("Phone history close could not be saved.");
        }
    }
}
exports.PhoneRecorder = PhoneRecorder;
async function cleanupPhoneRecords(store = exports.phoneRecordStore) {
    await store(`ai_phone_conversations?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
