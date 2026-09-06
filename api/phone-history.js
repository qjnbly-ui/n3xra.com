"use strict";
const _phone_records_1 = require("./_phone-records");
const { authenticatedUser } = require("./_account-phone");
async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (!["GET", "POST"].includes(req.method))
        return res.status(405).json({ error: "Method not allowed." });
    try {
        const user = await authenticatedUser(req);
        if (!user?.id)
            return res.status(401).json({ error: "Sign in to view phone history." });
        if (!await (0, _phone_records_1.isPhoneRecordOwner)(user.id))
            return res.status(403).json({ error: "Phone history is available to the platform owner only." });
        const current = await (0, _phone_records_1.phoneInstruction)(user.id);
        const id = req.method === "GET" ? req.query?.id : req.body?.id;
        if (!id && req.method === "GET") {
            const calls = await (0, _phone_records_1.phoneRecordStore)(`ai_phone_conversations?user_id=eq.${user.id}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,created_at,status,dropped_events,review_note&order=created_at.desc&limit=50`);
            return res.status(200).json({ calls, instruction: current });
        }
        if (!(0, _phone_records_1.uuid)(id))
            return res.status(400).json({ error: "Choose a phone conversation." });
        const calls = await (0, _phone_records_1.phoneRecordStore)(`ai_phone_conversations?id=eq.${id}&user_id=eq.${user.id}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`);
        const call = calls?.[0];
        if (!call)
            return res.status(404).json({ error: "Conversation unavailable or expired." });
        if (req.method === "POST") {
            const body = req.body || {};
            if (body.action === "apply") {
                if (typeof body.instruction !== "string" || body.instruction.length > 1500 || typeof body.expectedEffect !== "string" || !body.expectedEffect.trim() || body.expectedEffect.length > 1000
                    || !(body.expectedVersion === null || (0, _phone_records_1.uuid)(body.expectedVersion)))
                    return res.status(400).json({ error: "Review the instruction and explain its expected effect first." });
                if ((0, _phone_records_1.redactPhoneText)(body.instruction, 1500) !== body.instruction || (0, _phone_records_1.redactPhoneText)(body.expectedEffect, 1000) !== body.expectedEffect)
                    return res.status(400).json({ error: "Remove links or sensitive details from the instruction and expected effect, then review it again." });
                // Reviewed owner text only; never interpret transcript content as an instruction to apply.
                const result = await (0, _phone_records_1.phoneRecordStore)("rpc/apply_ai_phone_instruction", { method: "POST", body: JSON.stringify({
                        p_user_id: user.id, p_conversation_id: id, p_expected_version: body.expectedVersion,
                        p_instruction: (0, _phone_records_1.redactPhoneText)(body.instruction, 1500), p_effect: (0, _phone_records_1.redactPhoneText)(body.expectedEffect, 1000),
                    }) });
                if (!result)
                    return res.status(409).json({ error: "The instruction changed in another window. Reload and review the current version." });
                return res.status(200).json({ instruction: result });
            }
            if (body.action !== "note" || typeof body.note !== "string" || body.note.length > 3000)
                return res.status(400).json({ error: "Enter a review note of at most 3,000 characters." });
            await (0, _phone_records_1.phoneRecordStore)(`ai_phone_conversations?id=eq.${id}&user_id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify({ review_note: (0, _phone_records_1.redactPhoneText)(body.note, 3000) }) });
            return res.status(200).json({ saved: true });
        }
        const events = await (0, _phone_records_1.phoneRecordStore)(`ai_phone_events?conversation_id=eq.${id}&select=id,sequence,kind,text,created_at&order=sequence.asc&limit=1000`);
        // Reuse existing builder history, including replies completed after hang-up. Match the
        // exact phone call, website and actor; stop each request at the next user message.
        const requests = await (0, _phone_records_1.phoneRecordStore)(`website_build_events?metadata->>callId=eq.${encodeURIComponent(call.call_id)}&website_id=eq.${call.website_id}&actor_user_id=eq.${user.id}&event_type=eq.user_message&select=id,session_id,message,created_at,metadata&order=id.asc&limit=50`);
        const builds = [];
        for (const request of requests || []) {
            const following = await (0, _phone_records_1.phoneRecordStore)(`website_build_events?session_id=eq.${request.session_id}&id=gt.${request.id}&event_type=in.(user_message,agent_message,error)&select=id,event_type,message,created_at&order=id.asc&limit=1`);
            const next = following?.[0];
            builds.push({ id: request.id, created_at: request.created_at, instruction: (0, _phone_records_1.redactPhoneText)(request.message),
                configuredModel: request.metadata?.model || null,
                reply: next && next.event_type !== "user_message" ? (0, _phone_records_1.redactPhoneText)(next.message) : null,
                replyAt: next && next.event_type !== "user_message" ? next.created_at : null,
                outcome: next?.event_type === "error" ? "error" : next?.event_type === "agent_message" ? "reply" : "unavailable" });
        }
        return res.status(200).json({ call, events, builds, buildsMayBeTruncated: requests?.length === 50, instruction: current });
    }
    catch {
        return res.status(503).json({ error: "Phone history is temporarily unavailable. Try again shortly." });
    }
}
module.exports = handler;
