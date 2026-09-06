"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneBuildConversation = void 0;
exports.phoneIntent = phoneIntent;
exports.isPhoneBuildRequest = isPhoneBuildRequest;
exports.phoneBuildConfigured = phoneBuildConfigured;
exports.signPhoneRequest = signPhoneRequest;
exports.createPhoneBuildRpc = createPhoneBuildRpc;
const node_crypto_1 = require("node:crypto");
const YES = /^(yes|yeah|yep|okay|ok|correct|confirm|go ahead|do it|please do)[.!\s]*$/i;
const NO = /^(no|nope|never mind|nevermind|cancel that)[.!\s]*$/i;
function phoneIntent(text) {
    const raw = text.toLowerCase().replace(/[’]/g, "'").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
    if (/\b(don't|do not|not yet|never mind)\b/.test(raw))
        return "clarify";
    const value = raw.replace(/^(?:(?:okay|ok|yeah|so|well|hey nex|nex|please) +)+/, "")
        .replace(/^(?:can you|could you|would you|will you|i want you to|i'd like you to|i want to|let's|lets) +/, "")
        .replace(/ +(?:please|now|for me)$/, "").trim();
    if (/^(?:save|push|publish|deploy)\b/.test(value)) {
        if (/\b(?:and|then|but|or)\b/.test(value))
            return "clarify";
        if (/\bmain\b/.test(value) || /\b(?:live|production)\b/.test(value))
            return "main";
        if (/\bbranch\b/.test(value))
            return "branch";
        if (/^(?:save|push)(?: (?:it|this|that|everything|my work|the work|these changes|the changes|to github))?$/.test(value))
            return "save";
        return "clarify";
    }
    if (/^(?:main|to main|the main branch|main branch)$/.test(value))
        return "main";
    if (/^(?:branch|the branch|working branch|the working branch|to the branch)$/.test(value))
        return "branch";
    if (/^(?:close|close (?:it|the project|the workspace|project|workspace))$/.test(value))
        return "close";
    if (/^(?:stop|cancel)(?: (?:the |my )?(?:request|edit|change|current request))?$/.test(value))
        return "cancel";
    if (/^(?:status|progress|what.*(?:doing|happening)|are you done|is it done|how is it going|what is the status)$/.test(value))
        return "status";
    if (/^(?:help|thanks|thank you|what can you do|how.*save|what.*(?:branch|main)|what do you mean)/.test(value))
        return "help";
    // Only an actual edit instruction enters the builder; other conversation asks for clarification.
    return /^(?:add|remove|change|update|make|move|replace|draw|create|fix|put|adjust|increase|decrease|use|set|build|redesign|hide|show|resize|delete|edit)\b/.test(value) ? "edit" : "clarify";
}
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
    sessionId = "";
    pending;
    choosingSave = false;
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
    constructor(rpc, say, websiteId, name = "N3XRA Build Studio Demo", now = () => Date.now()) {
        this.rpc = rpc;
        this.say = say;
        this.websiteId = websiteId;
        this.name = name;
        this.now = now;
        this.expiresAt = now() + 15 * 60_000;
    }
    begin() {
        this.pending = { action: "open" };
        this.speak(`Phone editing is available for ${this.name}. Is that the website you want to work on?`);
    }
    get active() { return !this.disposed; }
    dispose() { this.disposed = true; if (this.timer)
        clearInterval(this.timer); }
    speak(text) { if (!this.disposed) {
        this.lastSpokenAt = this.now();
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
        if (!this.valid())
            return;
        const clean = text.trim();
        if (!clean)
            return;
        const intent = phoneIntent(clean);
        if (/\b(call me back|callback)\b/i.test(clean)) {
            this.choosingSave = false;
            this.pending = undefined;
            this.speak("Automatic callbacks are not enabled in this first test. You can call back, enter your PIN, and reconnect to your workspace.");
            return;
        }
        if (intent === "cancel") {
            this.choosingSave = false;
            this.pending = undefined;
            if (this.state.cancellable && this.sessionId) {
                try {
                    await this.rpc(`/v1/sessions/${this.sessionId}/cancel`, {});
                    this.speak("I requested cancellation. Changes already made will remain for you to review.");
                }
                catch {
                    this.speak("I could not confirm cancellation. Check Build Studio before sending another edit.");
                }
            }
            else if (this.busy || this.uncertain) {
                this.speak("I have not confirmed the running request yet. Check status or use Cancel in the dashboard; I cannot confirm it stopped.");
            }
            else
                this.speak("I canceled the pending instruction. There is no confirmed running request to stop.");
            return;
        }
        if (this.busy) {
            this.speak("I am still checking that step. You can ask for status in a moment.");
            return;
        }
        if (NO.test(clean)) {
            this.choosingSave = false;
            this.pending = undefined;
            this.speak("Okay. I will not carry out that instruction.");
            return;
        }
        if (intent === "status") {
            this.choosingSave = false;
            this.pending = undefined;
            if (!this.sessionId)
                this.speak("Confirm the demo first so I can open its workspace.");
            else
                await this.poll(true);
            return;
        }
        if (YES.test(clean)) {
            if (this.choosingSave) {
                this.speak("Which destination: the working branch, or main for the live website?");
                return;
            }
            const instruction = this.pending;
            if (!instruction) {
                this.speak("Tell me the change you want to make.");
                return;
            }
            this.pending = undefined;
            this.busy = true;
            try {
                if (instruction.action === "open") {
                    this.speak("Opening the demo and checking for unfinished work.");
                    const result = await this.rpc("/v1/projects/open", { websiteId: this.websiteId });
                    this.sessionId = result.session.id;
                    this.state = result.session;
                    if (this.disposed)
                        return;
                    this.timer = setInterval(() => { void this.poll(); }, 5000);
                    this.timer.unref?.();
                    await this.poll(true);
                }
                else {
                    if (!this.sessionId || this.uncertain || this.state.state !== "ready") {
                        this.speak("Check the workspace status before trying another change.");
                        return;
                    }
                    const action = instruction.action === "edit" ? "messages" : instruction.action;
                    this.speak(action === "messages" ? "Sending your change to Build Studio." : action === "save" ? "Saving your work to its GitHub branch." : action === "publish" ? "Saving to main on GitHub." : "Verifying the saved work and closing the project.");
                    // Clear stale cancellable/ready state before awaiting the worker.
                    this.state = { ...this.state, state: "working", cancellable: false };
                    await this.rpc(`/v1/sessions/${this.sessionId}/${action}`, action === "messages" ? { text: instruction.text } : {});
                    if (action === "close") {
                        this.speak("Project closed. Your work is saved on GitHub.");
                        this.dispose();
                        return;
                    }
                    this.speak(action === "messages" ? "The builder accepted your request. I will let you know how it is progressing." : action === "publish" ? "Saved to main on GitHub. Your hosting service will deploy it next." : "Saved to the working branch on GitHub. The live website is unchanged.");
                    await this.poll();
                }
            }
            catch {
                this.uncertain = Boolean(this.sessionId);
                this.speak("I could not confirm that step. It may still be running. Ask for status or check Build Studio before retrying; I will not send it again automatically.");
            }
            finally {
                this.busy = false;
            }
            return;
        }
        if (!this.sessionId) {
            this.begin();
            return;
        }
        if (this.uncertain) {
            await this.poll(true);
            return;
        }
        if (this.state.state !== "ready") {
            this.speak("The workspace is still getting ready or working. Ask for status, or cancel the current request.");
            return;
        }
        if (["save", "main", "branch"].includes(intent)) {
            this.pending = undefined;
            if (intent === "save") {
                this.choosingSave = true;
                this.speak("Where should I save: the working branch to keep it as a draft, or main to update the live website?");
            }
            else {
                this.choosingSave = false;
                this.pending = { action: intent === "main" ? "publish" : "save" };
                this.speak(intent === "main" ? `Save all current changes for ${this.name} to main on GitHub? That triggers publishing to the live website. Say yes to confirm.`
                    : `Save all current changes for ${this.name} to the working branch on GitHub? Say yes to confirm.`);
            }
            return;
        }
        this.choosingSave = false;
        if (intent === "close") {
            this.pending = undefined;
            if (!this.state.canClose) {
                this.speak("Save your work to GitHub before closing the project. Say save to start.");
                return;
            }
            this.pending = { action: "close" };
            this.speak("Close the saved project and stop its editing workspace? Say yes to confirm.");
            return;
        }
        if (intent === "help" || intent === "clarify") {
            this.pending = undefined;
            this.speak(intent === "help" ? "I can make a website change, check progress, cancel a request, save to a branch or main, and close the saved project. Main updates the live website; a working branch keeps a draft."
                : "Do you want a website change, or an action such as save, status, cancel, or close? For saving, you can choose the working branch or main.");
            return;
        }
        if (this.state.codexAuthenticated === false) {
            this.speak("Connect Codex in the Build Studio dashboard first, then ask for status here.");
            return;
        }
        this.pending = { action: "edit", text: clean.slice(0, 2000) };
        this.speak(`For ${this.name}, you want: ${spoken(clean)}. Shall I make that change?`);
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
            if (this.pending || this.choosingSave || this.busy && !force)
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
