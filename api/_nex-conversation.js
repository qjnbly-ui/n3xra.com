"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMS_INSTRUCTIONS = void 0;
exports.generateNexConversationReply = generateNexConversationReply;
const { getSiteContext } = require("./_ai-core/local-knowledge");
const { createProviderChain, completeWithFallback } = require("./_ai-core/providers");
const { redactSensitiveText } = require("./_ai-core/security");
const SMS_INSTRUCTIONS = [
    "You are replying as Nex in a one-to-one N3XRA text conversation.",
    "Be warm, direct, and useful. Keep the reply under 600 characters and normally under four short sentences.",
    "Never imply that you are Quentin or another human. If identity matters, say that you are Nex, N3XRA's AI assistant.",
    "Do not claim to complete purchases, account changes, approvals, refunds, legal decisions, or other consequential actions.",
    "For anything requiring private account data or a human decision, explain the next safe step and say the N3XRA team can follow up.",
    "Do not include markdown, internal implementation details, or more than one link.",
].join(" ");
exports.SMS_INSTRUCTIONS = SMS_INSTRUCTIONS;
function normalizeHistory(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(-10).flatMap((message) => {
        if (!message || !["user", "assistant"].includes(message.role))
            return [];
        const content = String(message.content || "").trim().slice(0, 1600);
        return content ? [{ role: message.role, content }] : [];
    });
}
function cleanReply(value) {
    return redactSensitiveText(String(value || "").replace(/\n{3,}/g, "\n\n").trim(), 600).trim();
}
async function generateNexConversationReply(input, dependencies = {}) {
    const body = String(input.body || "").trim().slice(0, 1600);
    if (!body)
        return null;
    const history = normalizeHistory(input.history);
    const identity = input.accountKnown
        ? { audience: "account", user: { id: "sms-contact", email: "", displayName: "Text contact" }, adminRole: null }
        : { audience: "public", user: null, adminRole: null };
    const context = await (dependencies.getContext ?? getSiteContext)(body, history, identity, { path: "/support", title: "N3XRA text conversation" }, input.accountKnown ? "account" : "public_site");
    const providers = dependencies.providers ?? createProviderChain(process.env, fetch, 8_000).slice(0, 1);
    if (!providers.length)
        return null;
    const completion = await (dependencies.complete ?? completeWithFallback)(providers, {
        maxTokens: 240,
        temperature: 0.15,
        messages: [
            { role: "system", content: `${context}\n\nTEXT CONVERSATION RULES:\n${SMS_INSTRUCTIONS}` },
            ...history,
            { role: "user", content: body },
        ],
    });
    const reply = cleanReply(completion.result?.text || "");
    return reply || null;
}
