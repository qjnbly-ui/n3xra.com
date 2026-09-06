"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneBuildConversation = void 0;
exports.isPhoneBuildRequest = isPhoneBuildRequest;
exports.phoneBuildConfigured = phoneBuildConfigured;
exports.signPhoneRequest = signPhoneRequest;
exports.createPhoneBuildRpc = createPhoneBuildRpc;
const _phone_build_agent_1 = require("./_phone-build-agent");
const node_crypto_1 = require("node:crypto");
function isPhoneBuildRequest(text) {
    return /\b(build studio|website (?:edit|change)|(?:edit|change|update|build) (?:my |the |a |our )?website)\b/i.test(text);
}
function phoneBuildConfigured() {
    return process.env.N3XRA_PHONE_BUILD_ENABLED === "true"
        && String(process.env.N3XRA_PHONE_BUILD_SECRET || "").length >= 32
        && /^[0-9a-f-]{36}$/i.test(process.env.N3XRA_PHONE_BUILD_WEBSITE_ID || "")
        && /^https:\/\//.test(process.env.N3XRA_PHONE_BUILD_WORKER_URL || "");
}
function signPhoneRequest(userId, callId, websiteId, method, path, body, secret, now = Date.now()) {
    const iat = Math.floor(now / 1000);
    const payload = Buffer.from(JSON.stringify({ aud: "n3xra-build-phone", sub: userId, call: callId,
        website: websiteId, nonce: (0, node_crypto_1.randomUUID)(), method, path, body: (0, node_crypto_1.createHash)("sha256").update(body).digest("hex"), iat, exp: iat + 45 })).toString("base64url");
    return `${payload}.${(0, node_crypto_1.createHmac)("sha256", secret).update(payload).digest("base64url")}`;
}
function createPhoneBuildRpc(userId, callId) {
    return async (path, input) => {
        if (!phoneBuildConfigured())
            throw new Error("Phone building is not enabled yet.");
        const base = new URL(process.env.N3XRA_PHONE_BUILD_WORKER_URL);
        if (base.protocol !== "https:" || base.username || base.password)
            throw new Error("Invalid worker configuration.");
        const method = input === undefined ? "GET" : "POST";
        const body = input === undefined ? "" : JSON.stringify(input);
        const token = signPhoneRequest(userId, callId, process.env.N3XRA_PHONE_BUILD_WEBSITE_ID, method, path, body, process.env.N3XRA_PHONE_BUILD_SECRET);
        // No automatic retry of mutations: a lost response may still mean the edit was accepted.
        const response = await fetch(new URL(path, base), { method, redirect: "error", headers: {
                Authorization: `N3XRA-Phone ${token}`, "Content-Type": "application/json",
            }, ...(input === undefined ? {} : { body }), signal: AbortSignal.timeout(30_000) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error("Build Studio could not complete that step. Check the dashboard before retrying.");
        return data;
    };
}
function spoken(value) {
    return value.replace(/https?:\/\/\S+/g, "the link in your dashboard").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().slice(0, 650);
}
/** Phone UI only. All editing and repository operations stay in the existing worker. */
class PhoneBuildConversation {
    rpc;
    say;
    websiteId;
    name;
    now;
    agent;
    sessionId = "";
    pending;
    history = [];
    turn = 0;
    thinking = false;
    planning;
    lastState = "";
    disposed = false;
    busy = false;
    polling = false;
    timer;
    lastSpeech = "";
    lastSpokenAt = 0;
    lastEventId = "";
    expiresAt;
    state = {};
    uncertain = false;
    constructor(rpc, say, websiteId, name = "N3XRA Build Studio Demo", now = () => Date.now(), agent = _phone_build_agent_1.requestBuildAgent) {
        this.rpc = rpc;
        this.say = say;
        this.websiteId = websiteId;
        this.name = name;
        this.now = now;
        this.agent = agent;
        this.expiresAt = now() + 15 * 60_000;
    }
    begin() {
        this.pending = { action: "open", id: (0, node_crypto_1.randomUUID)(), turn: this.turn, expires: this.now() + 120_000 };
        this.speak(`Phone editing is available for ${this.name}. Is that the website you want to work on?`);
    }
    get active() { return !this.disposed; }
    dispose() { this.disposed = true; this.planning?.abort(); if (this.timer)
        clearInterval(this.timer); }
    speak(text) { if (!this.disposed) {
        this.lastSpokenAt = this.now();
        this.history.push({ role: "assistant", content: text });
        this.say(text);
    } }
    valid() {
        if (this.disposed)
            return false;
        if (this.now() >= this.expiresAt) {
            this.speak("Your phone editing session expired. Call back and enter your PIN again. Your workspace is still saved.");
            this.dispose();
            return false;
        }
        return true;
    }
    async handle(text) {
        if (!this.valid() || !text.trim())
            return;
        const turn = ++this.turn;
        this.planning?.abort();
        const abort = new AbortController();
        this.planning = abort;
        this.thinking = true;
        if (this.pending && this.pending.expires <= this.now())
            this.pending = undefined;
        // Retain whole caller turns so tool requests are never separated from their results.
        const starts = this.history.flatMap((m, i) => m.role === "user" ? [i] : []);
        if (starts.length > 8)
            this.history = this.history.slice(starts[starts.length - 8]);
        this.history.push({ role: "user", content: text.trim().slice(0, 2000) });
        const messages = [...this.history];
        const started = this.now();
        const waiting = setTimeout(() => {
            if (turn === this.turn && !abort.signal.aborted && this.lastSpokenAt <= started)
                this.speak("I am thinking through that with the current workspace.");
        }, 4000);
        waiting.unref?.();
        try {
            for (let round = 0; round < 4; round++) {
                const reply = await this.agent(messages, { website: this.name, workspaceOpen: Boolean(this.sessionId),
                    state: this.state.state || "not_open", busy: this.busy, uncertain: this.uncertain,
                    pending: this.pending || null }, abort.signal);
                if (turn !== this.turn || abort.signal.aborted || !this.valid())
                    return;
                const calls = reply.tool_calls;
                if (!calls?.length) {
                    this.speak(spoken(String(reply.content || "Could you clarify what you want to change?")));
                    return;
                }
                if (calls.length !== 1)
                    throw new Error("Only one action at a time.");
                const call = calls[0];
                if (typeof call.id !== "string" || call.type !== "function" || typeof call.function?.arguments !== "string")
                    throw new Error("Invalid tool response.");
                const args = JSON.parse(call.function.arguments);
                if (!args || typeof args !== "object" || Array.isArray(args))
                    throw new Error("Invalid arguments.");
                const result = await this.useTool(call.function.name, args, turn);
                // Only commit complete tool exchanges; a newer caller turn can supersede model planning.
                const toolReply = { role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) };
                messages.push(reply, toolReply);
                this.history.push(reply, toolReply);
                if (result.done || turn !== this.turn || !this.valid())
                    return;
            }
            this.speak("I need a little more direction. Which part should we focus on first?");
        }
        catch {
            if (turn === this.turn && !abort.signal.aborted)
                this.speak("I could not finish interpreting that. I have not sent a new action. Could you try again?");
        }
        finally {
            clearTimeout(waiting);
            if (turn === this.turn)
                this.thinking = false;
        }
    }
    async useTool(name, args, turn) {
        const fields = { inspect_page: ["path"], get_status: [], propose_action: ["action", "instruction"], confirm_action: ["confirmation_id"], dismiss_action: [], cancel_request: [] };
        if (!fields[name] || Object.keys(args).some(key => !fields[name].includes(key)))
            throw new Error("Unknown tool or arguments.");
        if (name === "dismiss_action") {
            this.pending = undefined;
            return { data: { dismissed: true } };
        }
        if (name === "get_status") {
            if (!this.sessionId)
                return { data: { state: "not_open", message: "Confirm the selected demo before opening." } };
            const data = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
            this.state = data.session;
            this.uncertain = false;
            if (data.latestReply?.id)
                this.lastEventId = data.latestReply.id;
            return { data };
        }
        if (name === "inspect_page") {
            if (!this.sessionId)
                return { data: { error: "Open the selected demo first." } };
            if (typeof args.path !== "string" || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(args.path) || args.path.length > 200)
                throw new Error("Invalid page path.");
            this.speak(args.path === "/" ? "Let me check the homepage." : "Let me check that page.");
            try {
                return { data: await this.rpc(`/v1/sessions/${this.sessionId}/phone-page`, { path: args.path }) };
            }
            catch {
                return { data: { error: "I could not inspect that preview. No page content was retrieved." } };
            }
        }
        if (name === "cancel_request") {
            this.pending = undefined;
            if (!this.sessionId)
                return { data: { canceledPending: true, runningRequest: false } };
            try {
                const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                this.state = current.session;
                if (!this.state.cancellable)
                    return { data: { canceledPending: true, runningRequest: false, busy: this.busy, uncertain: this.uncertain } };
                await this.rpc(`/v1/sessions/${this.sessionId}/cancel`, {});
                return { data: { cancellationRequested: true, changesAlreadyMadeRemain: true } };
            }
            catch {
                return { data: { error: "Cancellation not confirmed. Check the dashboard." } };
            }
        }
        if (this.busy || this.uncertain)
            return { data: { error: "A prior operation is running or unconfirmed. Check status before another action." } };
        if (name === "propose_action") {
            if (!["open", "edit", "save", "publish", "close"].includes(args.action) || typeof args.instruction !== "string" || args.instruction.length > 2000)
                throw new Error("Invalid action.");
            if (args.action !== "open" && (!this.sessionId || this.state.state !== "ready"))
                return { data: { error: "The workspace must be open and ready. Check status." } };
            if (args.action === "open" && this.sessionId)
                return { data: { alreadyOpen: true } };
            if (args.action === "edit" && (!args.instruction.trim() || this.state.codexAuthenticated === false))
                return { data: { error: "Need an agreed edit and connected Codex account." } };
            if (args.action === "close" && !this.state.canClose)
                return { data: { error: "Save to GitHub before closing. Ask caller to choose branch or main." } };
            this.pending = { action: args.action, text: args.instruction, id: (0, node_crypto_1.randomUUID)(), turn, expires: this.now() + 120_000 };
            const prompt = args.action === "edit" ? `For ${this.name}: ${spoken(args.instruction)}. Shall I make that change?`
                : args.action === "publish" ? `Save all current changes for ${this.name} to main on GitHub? That publishes to the live website. Shall I proceed?`
                    : args.action === "save" ? `Save the current changes for ${this.name} to its working branch as a draft?`
                        : args.action === "close" ? "Close the saved project and stop its editing workspace?"
                            : `Open ${this.name} and check for unfinished work?`;
            this.speak(prompt);
            return { data: { awaitingCaller: true, confirmationId: this.pending.id }, done: true };
        }
        const instruction = this.pending;
        if (!instruction || args.confirmation_id !== instruction.id || instruction.turn >= turn || instruction.expires <= this.now())
            return { data: { error: "No valid prior proposal to confirm. Discuss and propose the action first." } };
        this.pending = undefined;
        this.busy = true;
        try {
            if (instruction.action === "open") {
                this.speak("Opening the demo and checking for unfinished work.");
                const result = await this.rpc("/v1/projects/open", { websiteId: this.websiteId });
                this.sessionId = result.session.id;
                this.state = result.session;
                if (!this.disposed) {
                    this.timer = setInterval(() => { void this.poll(); }, 5000);
                    this.timer.unref?.();
                }
                this.speak(this.state.state === "ready" ? "The workspace is open. What would you like to work on?" : "The workspace is opening. We can discuss the change while it gets ready.");
            }
            else {
                const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                this.state = current.session;
                if (this.state.state !== "ready")
                    return { data: { error: "The workspace is not ready; the proposal was cleared. Check status." } };
                if (turn !== this.turn || !this.valid())
                    return { data: { superseded: true }, done: true };
                const action = instruction.action === "edit" ? "messages" : instruction.action;
                this.speak(action === "messages" ? "I am sending the agreed change to the builder. I will keep you updated."
                    : action === "publish" ? "I am saving the changes to main on GitHub." : action === "save" ? "I am saving the changes to your working branch." : "I am checking the saved work and closing the workspace.");
                this.state = { ...this.state, state: "working", cancellable: false };
                const result = await this.rpc(`/v1/sessions/${this.sessionId}/${action}`, action === "messages" ? { text: instruction.text } : {});
                if (result.session)
                    this.state = result.session;
                this.speak(action === "messages" ? "The builder accepted the change. You can keep talking to me while it works."
                    : action === "publish" ? "Saved to main on GitHub. Deployment is the next step."
                        : action === "save" ? "Saved to the working branch. The live website is unchanged." : "Project closed. Your work is saved on GitHub.");
                if (action === "close")
                    this.dispose();
            }
            return { data: { accepted: true, action: instruction.action }, done: true };
        }
        catch {
            this.uncertain = true;
            this.speak("I could not confirm that operation. It may still be running. I will check status before doing anything else; I will not repeat it automatically.");
            return { data: { unconfirmed: true }, done: true };
        }
        finally {
            this.busy = false;
        }
    }
    async poll(force = false) {
        if (!this.valid() || !this.sessionId || this.polling)
            return;
        this.polling = true;
        try {
            const result = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
            this.state = result.session;
            this.uncertain = false;
            let message = "";
            const event = result.latestReply;
            if (event?.id && event.id !== this.lastEventId) {
                message = spoken(String(event.message || ""));
            }
            if (this.state.state === "working" || this.state.state === "preparing")
                message = this.state.progress || "The workspace is getting ready. I am still checking on it.";
            else if (this.state.state === "failed")
                message = "The workspace needs attention. Please check Build Studio for details.";
            else if (this.state.codexAuthenticated === false)
                message = "Open the Build Studio dashboard and connect Codex to this workspace before we can edit.";
            else if (!message)
                message = this.state.canClose ? "Your work is saved on GitHub. You can close the project or request another change."
                    : this.state.state === "ready" ? "The workspace is ready. Tell me a change, or say save when you are done."
                        : "The project is closed. Reopen it in Build Studio to continue.";
            if (this.pending || this.thinking || this.busy && !force)
                return;
            const working = ["working", "preparing"].includes(this.state.state);
            const newReply = Boolean(event?.id && event.id !== this.lastEventId && !working);
            const stateChanged = this.state.state !== this.lastState;
            // Coalesce fast progress changes. Do not follow a final answer with repetitive ready chatter.
            if (force || newReply || (working && this.now() - this.lastSpokenAt >= 30_000)
                || (!working && stateChanged && message !== this.lastSpeech)) {
                if (newReply)
                    this.lastEventId = event.id;
                this.lastState = this.state.state;
                this.lastSpeech = message;
                this.lastSpokenAt = this.now();
                this.speak(message);
            }
        }
        catch {
            if (force || this.now() - this.lastSpokenAt > 30_000) {
                this.lastSpokenAt = this.now();
                this.speak("I am having trouble checking progress. Your request may still be running; please check the dashboard.");
            }
        }
        finally {
            this.polling = false;
        }
    }
}
exports.PhoneBuildConversation = PhoneBuildConversation;
