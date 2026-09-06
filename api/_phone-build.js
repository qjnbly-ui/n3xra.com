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
    reviewedInstruction;
    endCall;
    sessionId = "";
    requestId = "";
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
    previewInspectionFailed = false;
    inspectedTurn = -1;
    saveDestination = "main";
    queue = [];
    queuePaused = false;
    queueRunning = false;
    queueRevision = 0;
    queueRequestId = "";
    queueSummary = "";
    queuedSave;
    hasUnsavedChanges = false;
    callerSpeaking = false;
    lastCallerAt = 0;
    /** Partial transcripts and interruptions immediately stop obsolete planning and progress chatter. */
    listening() { this.callerSpeaking = true; this.lastCallerAt = this.now(); this.planning?.abort(); }
    interrupted(heard) {
        this.listening();
        for (let i = this.history.length - 1; i >= 0; i--) {
            const item = this.history[i];
            if (item.role === "assistant" && !item.tool_calls) {
                item.content = heard ? `Caller heard before interrupting: ${heard}` : "Caller interrupted before hearing this reply.";
                break;
            }
        }
    }
    constructor(rpc, say, websiteId, name = "N3XRA Build Studio Demo", now = () => Date.now(), agent = _phone_build_agent_1.requestBuildAgent, reviewedInstruction = "", endCall = () => { }) {
        this.rpc = rpc;
        this.say = say;
        this.websiteId = websiteId;
        this.name = name;
        this.now = now;
        this.agent = agent;
        this.reviewedInstruction = reviewedInstruction;
        this.endCall = endCall;
        this.expiresAt = now() + 15 * 60_000;
    }
    begin() {
        this.pending = { action: "open", id: (0, node_crypto_1.randomUUID)(), turn: this.turn, expires: this.now() + 120_000 };
        this.speak(`Phone editing is available for ${this.name}. Is that the website you want to work on?`);
    }
    async resumeCallback(sessionId, request, result) {
        this.sessionId = sessionId;
        const current = await this.rpc(`/v1/sessions/${sessionId}/phone-status`);
        this.state = current.session;
        this.lastState = this.state.state;
        this.hasUnsavedChanges = Number(this.state.changedFileCount || 0) > 0;
        this.lastEventId = current.latestReply?.id || "";
        this.history.push({ role: "user", content: `Earlier request, for context only: ${request.slice(0, 2000)}` });
        this.speak(`Thanks for verifying. ${spoken(result)} Would you like to review it, make another change, or save?`);
        this.timer = setInterval(() => { void this.poll(); }, 5000);
        this.timer.unref?.();
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
        this.callerSpeaking = false;
        this.lastCallerAt = this.now();
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
                    callbackAvailable: Boolean(this.requestId),
                    currentDate: new Date(this.now()).toISOString(), timeZone: "America/Los_Angeles",
                    taskQueue: this.queue, queuePaused: this.queuePaused, queueWaitingForBuilder: Boolean(this.queueRequestId),
                    previewInspectionAvailable: !this.previewInspectionFailed && this.inspectedTurn !== turn,
                    state: this.state.state || "not_open", busy: this.busy, uncertain: this.uncertain,
                    saveDestination: this.saveDestination, hasUnsavedChanges: this.hasUnsavedChanges,
                    canClose: Boolean(this.state.canClose), queuedSave: this.queuedSave || null,
                    pending: this.pending || null, reviewedInstruction: this.reviewedInstruction }, abort.signal);
                if (turn !== this.turn || abort.signal.aborted || !this.valid())
                    return;
                const calls = reply.tool_calls;
                if (!calls?.length) {
                    // Keep the undelivered response in the retry so the provider can convert it to a
                    // tool call instead of generating the same plain response until routing fails.
                    if (typeof reply.content === "string" && reply.content.trim())
                        messages.push(reply);
                    messages.push({ role: "system", content: "Your previous response was not delivered because it did not select a tool. Convert it into exactly one tool call now: respond for conversation, execute_action for an edit or saved-work close, or request_save for saving. No action has run." });
                    continue;
                }
                if (calls.length !== 1) {
                    messages.push({ role: "system", content: "Select exactly one tool for the current caller turn. No action from the prior response was run." });
                    continue;
                }
                const call = calls[0];
                if (typeof call.id !== "string" || call.type !== "function" || typeof call.function?.arguments !== "string") {
                    messages.push({ role: "system", content: "The tool response was malformed and no action ran. Return one valid tool call." });
                    continue;
                }
                let args;
                try {
                    args = JSON.parse(call.function.arguments);
                    if (!args || typeof args !== "object" || Array.isArray(args))
                        throw new Error("Invalid arguments.");
                }
                catch {
                    messages.push(reply, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Invalid tool arguments; no action ran. Return one corrected tool call." }) });
                    continue;
                }
                let result;
                try {
                    result = await this.useTool(call.function.name, args, turn);
                }
                catch {
                    messages.push(reply, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Invalid tool request; no action ran. Return one corrected tool call." }) });
                    continue;
                }
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
            if (turn === this.turn) {
                this.thinking = false;
                await this.drainQueue();
            }
        }
    }
    async useTool(name, args, turn) {
        const fields = { queue_actions: ["steps", "mode"], control_queue: ["operation"], completion_delivery: ["mode"], respond: ["text"], execute_action: ["action", "instruction"], request_save: ["destination"], set_save_destination: ["destination"], inspect_page: ["path"], get_status: [], propose_action: ["action", "instruction"], confirm_action: ["confirmation_id"], dismiss_action: [], cancel_request: [] };
        if (!fields[name] || Object.keys(args).some(key => !fields[name].includes(key)))
            throw new Error("Unknown tool or arguments.");
        if (name === "control_queue") {
            if (!["pause", "resume", "cancel"].includes(args.operation))
                throw Error("Invalid queue operation.");
            this.queuePaused = args.operation !== "resume";
            if (args.operation === "cancel") {
                this.queueRevision++;
                this.queue = [];
                this.pending = undefined;
                this.queuedSave = undefined;
            }
            this.speak(args.operation === "pause" ? "Okay, I will pause after the current step." : args.operation === "cancel" ? "Okay, I have cleared the remaining steps. Any work already running may still finish." : "Okay, I will continue.");
            return { data: { queued: this.queue.length, paused: this.queuePaused }, done: true };
        }
        if (name === "queue_actions") {
            if (!this.sessionId || !Array.isArray(args.steps) || !args.steps.length || args.steps.length > 8 || !["append", "replace"].includes(args.mode))
                throw Error("Invalid task list.");
            const steps = args.steps.map((step) => {
                if (!step || Object.keys(step).some(k => !["action", "instruction"].includes(k)) || !["edit", "save", "publish", "close"].includes(step.action)
                    || (step.instruction !== undefined && (typeof step.instruction !== "string" || step.instruction.length > 2000))
                    || (step.action === "edit" && !step.instruction?.trim()))
                    throw Error("Invalid step.");
                return { action: step.action, text: step.instruction || "" };
            });
            const combined = [...(args.mode === "append" ? this.queue : []), ...steps];
            if (combined.length > 8 || combined.some((step, i) => step.action === "close" && i !== combined.length - 1))
                throw Error("Close must be the final step.");
            // Replacing the list never cancels a mutation already accepted by the worker.
            this.queueRevision++;
            this.queue = [];
            this.queuePaused = false;
            this.queuedSave = undefined;
            if (combined.some(step => ["save", "publish"].includes(step.action))) {
                this.pending = { action: "queue", steps: combined, id: (0, node_crypto_1.randomUUID)(), turn, expires: this.now() + 120_000 };
                const description = combined.map(step => step.action === "edit" ? spoken(step.text || "") : step.action === "publish" ? "save to main" : step.action === "save" ? "save a draft" : "close the workspace").join(", then ");
                this.speak(`Shall I ${description}?`);
                return { data: { awaitingCaller: true, confirmationId: this.pending.id }, done: true };
            }
            this.pending = undefined;
            this.queue = combined;
            this.speak("Okay, I will do those steps in order.");
            return { data: { queued: combined.length }, done: true };
        }
        if (name === "completion_delivery") {
            if (!["wait", "callback"].includes(args.mode) || !this.requestId || !this.sessionId)
                return { data: { error: "A callback requires an accepted builder request first." } };
            if (args.mode === "callback" && (this.queue.length || this.queueRequestId))
                return { data: { error: "Finish or cancel the remaining task list before choosing a callback." } };
            const saved = await this.rpc(`/v1/sessions/${this.sessionId}/callback`, { requestId: this.requestId, mode: args.mode });
            if (saved.saved !== true)
                throw Error("Callback choice was not saved.");
            this.speak(args.mode === "callback" ? "Okay, I’ll give you a call back." : "Of course. Stay on the line and I will let you know when it finishes.");
            if (args.mode === "callback") {
                this.dispose();
                this.endCall();
            }
            return { data: saved, done: true };
        }
        if (name === "respond") {
            if (typeof args.text !== "string" || !args.text.trim())
                throw new Error("Missing response.");
            this.speak(spoken(args.text));
            return { data: { discussed: true }, done: true };
        }
        if (name === "set_save_destination") {
            if (!["main", "draft"].includes(args.destination))
                throw new Error("Invalid destination.");
            this.saveDestination = args.destination;
            return { data: { destination: this.saveDestination, saved: false, message: "Preference remembered; continue the current edit without another save question." } };
        }
        // Enforce confirmation even if a model emits an obsolete save tool shape.
        if (name === "execute_action" && ["save", "draft", "publish"].includes(args.action)) {
            return this.useTool("request_save", { destination: args.action === "draft" ? "draft" : args.action === "publish" ? "main" : "remembered" }, turn);
        }
        if (["execute_action", "request_save", "propose_action"].includes(name) && (this.queue.length || this.queueRequestId))
            return { data: { error: "A task list is active. Use queue_actions to append or revise steps; do not bypass their order." } };
        if (name === "request_save") {
            if (this.busy || this.uncertain)
                return { data: { error: "A prior operation is unconfirmed. Check status before saving." } };
            if (!this.sessionId)
                return { data: { error: "Confirm the selected website before saving." } };
            if (args.destination !== undefined && !["remembered", "main", "draft"].includes(args.destination))
                throw new Error("Invalid destination.");
            if (args.destination === "main")
                this.saveDestination = "main";
            if (args.destination === "draft")
                this.saveDestination = "draft";
            const action = this.saveDestination === "main" ? "publish" : "save";
            this.pending = { action, text: "", id: (0, node_crypto_1.randomUUID)(), turn, expires: this.now() + 120_000 };
            this.speak(action === "publish" ? "Save these changes to the live site?" : "Save these changes as a draft to the working branch?");
            return { data: { awaitingCaller: true, confirmationId: this.pending.id, destination: this.saveDestination }, done: true };
        }
        if (name === "dismiss_action") {
            this.pending = undefined;
            this.queuedSave = undefined;
            this.queueRevision++;
            this.queue = [];
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
            if (this.previewInspectionFailed || this.inspectedTurn === turn)
                return { data: { error: "Preview inspection is unavailable for this request. Do not inspect again. For a clear edit, send the requested outcome to execute_action; the builder can inspect its source. For discussion, use respond without claiming to see the page." } };
            this.inspectedTurn = turn;
            if (!this.sessionId)
                return { data: { error: "Open the selected demo first." } };
            if (typeof args.path !== "string" || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(args.path) || args.path.length > 200)
                throw new Error("Invalid page path.");
            this.speak(args.path === "/" ? "Let me check the homepage." : "Let me check that page.");
            try {
                return { data: await this.rpc(`/v1/sessions/${this.sessionId}/phone-page`, { path: args.path }) };
            }
            catch {
                this.previewInspectionFailed = true;
                return { data: { error: "Preview unavailable. No page content was retrieved. Do not retry inspection. A clear edit can still be sent to execute_action so the builder can inspect and change its source. Otherwise respond honestly." } };
            }
        }
        if (name === "cancel_request") {
            this.pending = undefined;
            this.queuedSave = undefined;
            this.queueRevision++;
            this.queue = [];
            this.queuePaused = true;
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
            const proposedInstruction = args.instruction === undefined ? "" : args.instruction;
            if (!["open", "edit", "save", "publish", "close"].includes(args.action) || typeof proposedInstruction !== "string" || proposedInstruction.length > 2000)
                throw new Error("Invalid action.");
            if (args.action !== "open" && (!this.sessionId || this.state.state !== "ready"))
                return { data: { error: "The workspace must be open and ready. Check status." } };
            if (args.action === "open" && this.sessionId)
                return { data: { alreadyOpen: true } };
            if (args.action === "edit" && (!proposedInstruction.trim() || this.state.codexAuthenticated === false))
                return { data: { error: "Need an agreed edit and connected Codex account." } };
            if (args.action === "close" && !this.state.canClose)
                return { data: { error: "Save to GitHub before closing." } };
            this.pending = { action: args.action, text: proposedInstruction, id: (0, node_crypto_1.randomUUID)(), turn, expires: this.now() + 120_000 };
            const prompt = args.action === "edit" ? `For ${this.name}: ${spoken(proposedInstruction)}. Shall I make that change?`
                : args.action === "publish" ? `Save all current changes for ${this.name} to main on GitHub? That publishes to the live website. Shall I proceed?`
                    : args.action === "save" ? `Save the current changes for ${this.name} to its working branch as a draft?`
                        : args.action === "close" ? "Close the saved project and stop its editing workspace?"
                            : `Open ${this.name} and check for unfinished work?`;
            this.speak(prompt);
            return { data: { awaitingCaller: true, confirmationId: this.pending.id }, done: true };
        }
        let instruction = this.pending;
        if (name === "execute_action") {
            const requestedInstruction = args.instruction === undefined ? "" : args.instruction;
            if (!["edit", "close"].includes(args.action) || typeof requestedInstruction !== "string" || requestedInstruction.length > 2000)
                throw new Error("Invalid action.");
            if (!this.sessionId)
                return { data: { error: "Confirm the selected website before editing." } };
            const action = args.action;
            if (action === "edit" && !requestedInstruction.trim())
                return { data: { error: "An edit needs the caller's requested outcome." } };
            if (action === "edit")
                this.queuedSave = undefined;
            instruction = { action, text: requestedInstruction, id: (0, node_crypto_1.randomUUID)(), turn: turn - 1, expires: this.now() + 120000 };
        }
        if (!instruction || (name !== "execute_action" && args.confirmation_id !== instruction.id) || instruction.turn >= turn || instruction.expires <= this.now())
            return { data: { error: "No valid prior proposal to confirm. Discuss and propose the action first." } };
        this.pending = undefined;
        if (instruction.action === "queue") {
            this.queue = instruction.steps || [];
            this.queuePaused = false;
            this.speak("Okay, I will do those steps in order.");
            return { data: { queued: this.queue.length }, done: true };
        }
        return this.execute(instruction, turn);
    }
    async execute(instruction, turn, quiet = false) {
        this.busy = true;
        try {
            if (instruction.action === "open") {
                this.speak("Opening the demo and checking for unfinished work.");
                const result = await this.rpc("/v1/projects/open", { websiteId: this.websiteId });
                this.sessionId = result.session.id;
                this.state = result.session;
                // Establish the cursor before polling; historical replies are context, not new work.
                const baseline = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                this.state = baseline.session;
                this.lastEventId = baseline.latestReply?.id || "";
                this.lastState = this.state.state;
                this.hasUnsavedChanges = Number(this.state.changedFileCount || 0) > 0;
                if (!this.disposed) {
                    this.timer = setInterval(() => { void this.poll(); }, 5000);
                    this.timer.unref?.();
                }
                this.speak(this.state.state === "ready" ? "The workspace is open. What would you like to work on?" : "The workspace is opening. We can discuss the change while it gets ready.");
            }
            else {
                const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                this.state = current.session;
                if (turn !== this.turn || this.callerSpeaking || !this.valid())
                    return { data: { superseded: true }, done: true };
                if (["save", "publish"].includes(instruction.action) && ["working", "preparing"].includes(this.state.state)) {
                    if (quiet)
                        return { data: { waiting: true }, done: true };
                    this.queuedSave = instruction.action;
                    this.speak("I will save it when the builder finishes.");
                    return { data: { queued: true }, done: true };
                }
                if (this.state.state !== "ready")
                    return { data: { error: "The workspace is not ready; no action was sent. Check status." } };
                if (turn !== this.turn || !this.valid())
                    return { data: { superseded: true }, done: true };
                if (instruction.action === "close" && !this.state.canClose)
                    return { data: { error: "Save before closing; no close was performed." } };
                if (instruction.action === "edit" && this.state.codexAuthenticated === false)
                    return { data: { error: "Connect Codex before editing." } };
                if (current.latestReply?.id)
                    this.lastEventId = current.latestReply.id;
                const action = instruction.action === "edit" ? "messages" : instruction.action;
                if (!quiet)
                    this.speak(action === "messages" ? "I am sending the agreed change to the builder. I will keep you updated."
                        : action === "publish" ? "I am saving the changes to main on GitHub." : action === "save" ? "I am saving the changes to your working branch." : "I am checking the saved work and closing the workspace.");
                this.state = { ...this.state, state: "working", cancellable: false };
                const result = await this.rpc(`/v1/sessions/${this.sessionId}/${action}`, action === "messages" ? { text: String(instruction.text || "").trim() } : {});
                if (action === "messages" && result.accepted !== true)
                    throw new Error("Builder did not accept the edit.");
                if (result.session)
                    this.state = result.session;
                if (action === "messages") {
                    this.hasUnsavedChanges = true;
                    this.requestId = String(result.requestId || "");
                }
                if (action === "publish" || action === "save")
                    this.hasUnsavedChanges = false;
                if (!quiet)
                    this.speak(action === "messages" ? (this.requestId ? "The builder accepted the change. Would you like to wait on the line, or have me call you back when it finishes?" : "The builder accepted the change. You can keep talking to me while it works.")
                        : action === "publish" ? "Saved to main on GitHub. Deployment is the next step."
                            : action === "save" ? "Saved to the working branch. The live website is unchanged." : "Project closed. Your work is saved on GitHub.");
                if (action !== "messages" && action !== "close") {
                    // The save response already supplied its outcome; do not replay its event on the next poll.
                    try {
                        const baseline = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                        this.state = baseline.session;
                        this.lastEventId = baseline.latestReply?.id || this.lastEventId;
                    }
                    catch { /* A read failure does not undo a confirmed save. */ }
                }
                this.lastState = this.state.state;
                if (action === "close")
                    this.dispose();
            }
            return { data: { accepted: true, action: instruction.action,
                    result: { accepted: true, state: this.state.state || null, canClose: Boolean(this.state.canClose) } }, done: true };
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
    async drainQueue() {
        if (!this.valid() || this.queueRunning || this.queuePaused || this.busy || this.uncertain || this.thinking || this.pending || this.callerSpeaking)
            return;
        if (!this.queue.length && !this.queueRequestId)
            return;
        this.queueRunning = true;
        try {
            while (this.valid() && !this.queuePaused && !this.thinking && !this.pending && !this.callerSpeaking) {
                const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
                this.state = current.session;
                if (this.thinking || this.callerSpeaking || this.queuePaused || this.pending)
                    return;
                if (this.queueRequestId) {
                    if (String(current.latestReply?.completedRequestId || "") !== this.queueRequestId)
                        return;
                    this.queueRequestId = "";
                    this.lastEventId = current.latestReply.id;
                    if (current.latestReply.type === "error") {
                        this.queuePaused = true;
                        this.speak("That step failed. I have paused the remaining tasks.");
                        return;
                    }
                    this.queueSummary = spoken(current.latestReply.message || "Changes completed.");
                }
                if (this.state.state === "failed") {
                    this.queuePaused = true;
                    this.speak("The workspace needs attention. I have paused the remaining tasks.");
                    return;
                }
                if (this.state.state !== "ready")
                    return;
                const step = this.queue[0];
                if (!step) {
                    if (this.queueSummary)
                        this.speak(this.queueSummary);
                    this.queueSummary = "";
                    this.lastState = this.state.state;
                    return;
                }
                // Remove the in-flight step before an await so a concurrent append cannot copy/replay it.
                const revision = this.queueRevision;
                this.queue.shift();
                const result = await this.execute(step, this.turn, true);
                if (!result.data.accepted) {
                    if (revision === this.queueRevision)
                        this.queue.unshift(step);
                    if (result.data.superseded || result.data.waiting)
                        return;
                    this.queuePaused = true;
                    if (result.data.error)
                        this.speak("I could not complete that step. The remaining tasks are paused.");
                    return;
                }
                this.queueSummary = step.action === "publish" ? "Saved to main." : step.action === "save" ? "Draft saved." : step.action === "close" ? "Saved and closed." : "Changes completed.";
                if (step.action === "close") {
                    this.say(this.queueSummary);
                    this.queueSummary = "";
                    return;
                }
                if (step.action === "edit") {
                    this.queueRequestId = this.requestId;
                    if (!this.queueRequestId) {
                        this.queuePaused = true;
                        this.speak("I cannot track that step yet. The remaining tasks are paused.");
                    }
                    return;
                }
            }
        }
        catch {
            this.queuePaused = true;
            this.speak("I could not check the next step. The remaining tasks are paused.");
        }
        finally {
            this.queueRunning = false;
        }
    }
    async poll(force = false) {
        if (!this.valid() || !this.sessionId || this.polling)
            return;
        if (this.queue.length || this.queueRequestId) {
            await this.drainQueue();
            return;
        }
        this.polling = true;
        try {
            const result = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
            this.state = result.session;
            if (this.state.canClose)
                this.hasUnsavedChanges = false;
            else if (Number(this.state.changedFileCount || 0) > 0)
                this.hasUnsavedChanges = true;
            // Status alone does not prove whether a lost mutation was accepted.
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
            if (this.callerSpeaking || this.now() - this.lastCallerAt < 2000 || this.pending || this.thinking || this.busy)
                return;
            if (this.queuedSave && this.state.state === "ready" && !this.uncertain) {
                const action = this.queuedSave;
                this.queuedSave = undefined;
                await this.execute({ action }, this.turn);
                return;
            }
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
