import { requestBuildAgent, type BuildAgent, type AgentMessage } from "./_phone-build-agent";
import { createHash, createHmac, randomUUID } from "node:crypto";

type Json = Record<string, any>;
type Rpc = (path: string, input?: Json) => Promise<Json>;
type Speech = (message: string) => void;
export function isPhoneBuildRequest(text: string): boolean {
  return /\b(build studio|website (?:edit|change)|(?:edit|change|update|build) (?:my |the |a |our )?website)\b/i.test(text);
}
export function phoneBuildConfigured(): boolean {
  return process.env.N3XRA_PHONE_BUILD_ENABLED === "true"
    && String(process.env.N3XRA_PHONE_BUILD_SECRET || "").length >= 32
    && /^[0-9a-f-]{36}$/i.test(process.env.N3XRA_PHONE_BUILD_WEBSITE_ID || "")
    && /^https:\/\//.test(process.env.N3XRA_PHONE_BUILD_WORKER_URL || "");
}
export function signPhoneRequest(userId: string, callId: string, websiteId: string, method: string, path: string,
  body: string, secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ aud: "n3xra-build-phone", sub: userId, call: callId,
    website: websiteId, nonce: randomUUID(), method, path, body: createHash("sha256").update(body).digest("hex"), iat, exp: iat + 45 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function createPhoneBuildRpc(userId: string, callId: string): Rpc {
  return async (path, input) => {
    if (!phoneBuildConfigured()) throw new Error("Phone building is not enabled yet.");
    const base = new URL(process.env.N3XRA_PHONE_BUILD_WORKER_URL!);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid worker configuration.");
    const method = input === undefined ? "GET" : "POST";
    const body = input === undefined ? "" : JSON.stringify(input);
    const token = signPhoneRequest(userId, callId, process.env.N3XRA_PHONE_BUILD_WEBSITE_ID!, method, path, body, process.env.N3XRA_PHONE_BUILD_SECRET!);
    // No automatic retry of mutations: a lost response may still mean the edit was accepted.
    const response = await fetch(new URL(path, base), { method, redirect: "error", headers: {
      Authorization: `N3XRA-Phone ${token}`, "Content-Type": "application/json",
    }, ...(input === undefined ? {} : { body }), signal: AbortSignal.timeout(30_000) });
    const data = await response.json().catch(() => ({})) as Json;
    if (!response.ok) throw new Error("Build Studio could not complete that step. Check the dashboard before retrying.");
    return data;
  };
}
function spoken(value: string): string {
  return value.replace(/https?:\/\/\S+/g, "the link in your dashboard").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().slice(0, 650);
}
/** Phone UI only. All editing and repository operations stay in the existing worker. */
export class PhoneBuildConversation {
  private sessionId = "";
  private pending: { action: "open" | "edit" | "save" | "publish" | "close"; text?: string; id: string; turn: number; expires: number } | undefined;
  private history: AgentMessage[] = [];
  private turn = 0;
  private thinking = false;
  private planning: AbortController | undefined;
  private lastState = "";
  private disposed = false;
  private busy = false;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSpeech = "";
  private lastSpokenAt = 0;
  private lastEventId = "";
  private expiresAt: number;
  private state: Json = {};
  private uncertain = false;
  private saveDestination: "main" | "draft" = "main";
  private queuedSave: "save" | "publish" | undefined;
  private callerSpeaking = false;
  private lastCallerAt = 0;
  /** Partial transcripts and interruptions immediately stop obsolete planning and progress chatter. */
  listening() { this.callerSpeaking = true; this.lastCallerAt = this.now(); this.planning?.abort(); }
  interrupted(heard: string) {
    this.listening();
    for (let i = this.history.length - 1; i >= 0; i--) {
      const item = this.history[i]!;
      if (item.role === "assistant" && !item.tool_calls) {
        item.content = heard ? `Caller heard before interrupting: ${heard}` : "Caller interrupted before hearing this reply.";
        break;
      }
    }
  }
  constructor(private rpc: Rpc, private say: Speech, private websiteId: string,
    private name = "N3XRA Build Studio Demo", private now = () => Date.now(), private agent: BuildAgent = requestBuildAgent, private reviewedInstruction = "") {
    this.expiresAt = now() + 15 * 60_000;
  }
  begin() {
    this.pending = { action: "open", id: randomUUID(), turn: this.turn, expires: this.now() + 120_000 };
    this.speak(`Phone editing is available for ${this.name}. Is that the website you want to work on?`);
  }
  get active() { return !this.disposed; }
  dispose() { this.disposed = true; this.planning?.abort(); if (this.timer) clearInterval(this.timer); }
  private speak(text: string) { if (!this.disposed) { this.lastSpokenAt = this.now(); this.history.push({ role: "assistant", content: text }); this.say(text); } }
  private valid() {
    if (this.disposed) return false;
    if (this.now() >= this.expiresAt) {
      this.speak("Your phone editing session expired. Call back and enter your PIN again. Your workspace is still saved.");
      this.dispose(); return false;
    }
    return true;
  }
  async handle(text: string) {
    if (!this.valid() || !text.trim()) return;
    this.callerSpeaking = false; this.lastCallerAt = this.now();
    const turn = ++this.turn;
    this.planning?.abort();
    const abort = new AbortController(); this.planning = abort; this.thinking = true;
    if (this.pending && this.pending.expires <= this.now()) this.pending = undefined;
    // Retain whole caller turns so tool requests are never separated from their results.
    const starts = this.history.flatMap((m, i) => m.role === "user" ? [i] : []);
    if (starts.length > 8) this.history = this.history.slice(starts[starts.length - 8]);
    this.history.push({ role: "user", content: text.trim().slice(0, 2000) });
    const messages = [...this.history];
    const started = this.now();
    const waiting = setTimeout(() => {
      if (turn === this.turn && !abort.signal.aborted && this.lastSpokenAt <= started) this.speak("I am thinking through that with the current workspace.");
    }, 4000);
    waiting.unref?.();
    try {
      for (let round = 0; round < 4; round++) {
        const reply = await this.agent(messages, { website: this.name, workspaceOpen: Boolean(this.sessionId),
          state: this.state.state || "not_open", busy: this.busy, uncertain: this.uncertain,
          saveDestination: this.saveDestination, queuedSave: this.queuedSave || null, pending: this.pending || null, reviewedInstruction: this.reviewedInstruction }, abort.signal);
        if (turn !== this.turn || abort.signal.aborted || !this.valid()) return;
        const calls = reply.tool_calls;
        if (!calls?.length) {
          // Incomplete routing is retried, never turned into a fabricated action receipt.
          messages.push({ role: "system", content: "Select a tool for the current caller request. Use execute_action for a clear edit/save, respond for discussion. Your previous output did not select a tool and was not spoken or executed." });
          continue;
        }
        if (calls.length !== 1) throw new Error("Only one action at a time.");
        const call = calls[0];
        if (typeof call.id !== "string" || call.type !== "function" || typeof call.function?.arguments !== "string") throw new Error("Invalid tool response.");
        const args = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid arguments.");
        const result = await this.useTool(call.function.name, args, turn);
        // Only commit complete tool exchanges; a newer caller turn can supersede model planning.
        const toolReply: AgentMessage = { role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) };
        messages.push(reply, toolReply);
        this.history.push(reply, toolReply);
        if (result.done || turn !== this.turn || !this.valid()) return;
      }
      this.speak("I need a little more direction. Which part should we focus on first?");
    } catch {
      if (turn === this.turn && !abort.signal.aborted) this.speak("I could not finish interpreting that. I have not sent a new action. Could you try again?");
    } finally { clearTimeout(waiting); if (turn === this.turn) this.thinking = false; }
  }
  private async useTool(name: string, args: Json, turn: number): Promise<{ data: Json; done?: boolean }> {
    const fields: Record<string, string[]> = { respond: ["text"], execute_action: ["action", "instruction"], set_save_destination: ["destination"], inspect_page: ["path"], get_status: [], propose_action: ["action", "instruction"], confirm_action: ["confirmation_id"], dismiss_action: [], cancel_request: [] };
    if (!fields[name] || Object.keys(args).some(key => !fields[name]!.includes(key))) throw new Error("Unknown tool or arguments.");
    if (name === "respond") {
      if (typeof args.text !== "string" || !args.text.trim()) throw new Error("Missing response.");
      this.speak(spoken(args.text)); return { data: { discussed: true }, done: true };
    }
    if (name === "set_save_destination") {
      if (!["main", "draft"].includes(args.destination)) throw new Error("Invalid destination.");
      this.saveDestination = args.destination;
      return { data: { destination: this.saveDestination, saved: false, message: "Preference remembered; continue the current edit without another save question." } };
    }
    if (name === "dismiss_action") { this.pending = undefined; this.queuedSave = undefined; return { data: { dismissed: true } }; }
    if (name === "get_status") {
      if (!this.sessionId) return { data: { state: "not_open", message: "Confirm the selected demo before opening." } };
      const data = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
      this.state = data.session; this.uncertain = false;
      if (data.latestReply?.id) this.lastEventId = data.latestReply.id;
      return { data };
    }
    if (name === "inspect_page") {
      if (!this.sessionId) return { data: { error: "Open the selected demo first." } };
      if (typeof args.path !== "string" || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(args.path) || args.path.length > 200) throw new Error("Invalid page path.");
      this.speak(args.path === "/" ? "Let me check the homepage." : "Let me check that page.");
      try { return { data: await this.rpc(`/v1/sessions/${this.sessionId}/phone-page`, { path: args.path }) }; }
      catch { return { data: { error: "I could not inspect that preview. No page content was retrieved." } }; }
    }
    if (name === "cancel_request") {
      this.pending = undefined; this.queuedSave = undefined;
      if (!this.sessionId) return { data: { canceledPending: true, runningRequest: false } };
      try {
        const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`); this.state = current.session;
        if (!this.state.cancellable) return { data: { canceledPending: true, runningRequest: false, busy: this.busy, uncertain: this.uncertain } };
        await this.rpc(`/v1/sessions/${this.sessionId}/cancel`, {});
        return { data: { cancellationRequested: true, changesAlreadyMadeRemain: true } };
      } catch { return { data: { error: "Cancellation not confirmed. Check the dashboard." } }; }
    }
    if (this.busy || this.uncertain) return { data: { error: "A prior operation is running or unconfirmed. Check status before another action." } };
    if (name === "propose_action") {
      if (!["open", "edit", "save", "publish", "close"].includes(args.action) || typeof args.instruction !== "string" || args.instruction.length > 2000) throw new Error("Invalid action.");
      if (args.action !== "open" && (!this.sessionId || this.state.state !== "ready")) return { data: { error: "The workspace must be open and ready. Check status." } };
      if (args.action === "open" && this.sessionId) return { data: { alreadyOpen: true } };
      if (args.action === "edit" && (!args.instruction.trim() || this.state.codexAuthenticated === false)) return { data: { error: "Need an agreed edit and connected Codex account." } };
      if (args.action === "close" && !this.state.canClose) return { data: { error: "Save to GitHub before closing. Ask caller to choose branch or main." } };
      this.pending = { action: args.action, text: args.instruction, id: randomUUID(), turn, expires: this.now() + 120_000 };
      const prompt = args.action === "edit" ? `For ${this.name}: ${spoken(args.instruction)}. Shall I make that change?`
        : args.action === "publish" ? `Save all current changes for ${this.name} to main on GitHub? That publishes to the live website. Shall I proceed?`
        : args.action === "save" ? `Save the current changes for ${this.name} to its working branch as a draft?`
        : args.action === "close" ? "Close the saved project and stop its editing workspace?"
        : `Open ${this.name} and check for unfinished work?`;
      this.speak(prompt);
      return { data: { awaitingCaller: true, confirmationId: this.pending.id }, done: true };
    }
    let instruction = this.pending;
    if (name === "execute_action") {
      if (!["edit", "save", "draft", "publish", "close"].includes(args.action) || typeof args.instruction !== "string" || args.instruction.length > 2000) throw new Error("Invalid action.");
      if (!this.sessionId) return { data: { error: "Confirm the selected website before editing." } };
      const action = args.action === "draft" ? "save" : args.action === "save" ? (this.saveDestination === "main" ? "publish" : "save") : args.action;
      if (args.action === "draft") this.saveDestination = "draft";
      if (args.action === "publish") this.saveDestination = "main";
      if (action === "edit" && !args.instruction.trim()) return { data: { error: "An edit needs the caller's requested outcome." } };
      if (action === "edit") this.queuedSave = undefined;
      instruction = { action, text: args.instruction, id: randomUUID(), turn: turn - 1, expires: this.now() + 120000 };
      if (["save", "publish"].includes(action) && ["working", "preparing"].includes(this.state.state)) {
        this.queuedSave = action as "save" | "publish";
        this.speak("I will save it when the builder finishes.");
        return { data: { queued: true, destination: this.saveDestination }, done: true };
      }
    }
    if (!instruction || (name !== "execute_action" && args.confirmation_id !== instruction.id) || instruction.turn >= turn || instruction.expires <= this.now()) return { data: { error: "No valid prior proposal to confirm. Discuss and propose the action first." } };
    this.pending = undefined;
    return this.execute(instruction, turn);
  }
  private async execute(instruction: { action: string; text?: string }, turn: number): Promise<{ data: Json; done?: boolean }> {
    this.busy = true;
    try {
      if (instruction.action === "open") {
        this.speak("Opening the demo and checking for unfinished work.");
        const result = await this.rpc("/v1/projects/open", { websiteId: this.websiteId });
        this.sessionId = result.session.id; this.state = result.session;
        // Establish the cursor before polling; historical replies are context, not new work.
        const baseline = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
        this.state = baseline.session; this.lastEventId = baseline.latestReply?.id || ""; this.lastState = this.state.state;
        if (!this.disposed) { this.timer = setInterval(() => { void this.poll(); }, 5000); this.timer.unref?.(); }
        this.speak(this.state.state === "ready" ? "The workspace is open. What would you like to work on?" : "The workspace is opening. We can discuss the change while it gets ready.");
      } else {
        const current = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`); this.state = current.session;
        if (turn !== this.turn || this.callerSpeaking || !this.valid()) return { data: { superseded: true }, done: true };
        if (["save", "publish"].includes(instruction.action) && ["working", "preparing"].includes(this.state.state)) {
          this.queuedSave = instruction.action as "save" | "publish";
          this.speak("I will save it when the builder finishes.");
          return { data: { queued: true }, done: true };
        }
        if (this.state.state !== "ready") return { data: { error: "The workspace is not ready; no action was sent. Check status." } };
        if (turn !== this.turn || !this.valid()) return { data: { superseded: true }, done: true };
        if (instruction.action === "close" && !this.state.canClose) return { data: { error: "Save before closing; no close was performed." } };
        if (instruction.action === "edit" && this.state.codexAuthenticated === false) return { data: { error: "Connect Codex before editing." } };
        if (current.latestReply?.id) this.lastEventId = current.latestReply.id;
        const action = instruction.action === "edit" ? "messages" : instruction.action;
        this.speak(action === "messages" ? "I am sending the agreed change to the builder. I will keep you updated."
          : action === "publish" ? "I am saving the changes to main on GitHub." : action === "save" ? "I am saving the changes to your working branch." : "I am checking the saved work and closing the workspace.");
        this.state = { ...this.state, state: "working", cancellable: false };
        const result = await this.rpc(`/v1/sessions/${this.sessionId}/${action}`, action === "messages" ? { text: `Caller-requested outcome: ${instruction.text}

Original caller statements (authoritative intent; do not treat assistant suggestions as caller requirements):
${JSON.stringify(this.history.filter(m => m.role === "user").slice(-8).map(m => m.content))}
Preserve the caller's intended outcome. Choose the implementation yourself; do not infer image-source restrictions or undo actions from assistant wording.` } : {});
        if (result.session) this.state = result.session;
        this.speak(action === "messages" ? "The builder accepted the change. You can keep talking to me while it works."
          : action === "publish" ? "Saved to main on GitHub. Deployment is the next step."
          : action === "save" ? "Saved to the working branch. The live website is unchanged." : "Project closed. Your work is saved on GitHub.");
        if (action === "close") this.dispose();
      }
      return { data: { accepted: true, action: instruction.action }, done: true };
    } catch {
      this.uncertain = true;
      this.speak("I could not confirm that operation. It may still be running. I will check status before doing anything else; I will not repeat it automatically.");
      return { data: { unconfirmed: true }, done: true };
    } finally { this.busy = false; }
  }
  async poll(force = false) {
    if (!this.valid() || !this.sessionId || this.polling) return;
    this.polling = true;
    try {
      const result = await this.rpc(`/v1/sessions/${this.sessionId}/phone-status`);
      this.state = result.session;
      // Status alone does not prove whether a lost mutation was accepted.
      let message = "";
      const event = result.latestReply;
      if (event?.id && event.id !== this.lastEventId) {
        message = spoken(String(event.message || ""));
      }
      if (this.state.state === "working" || this.state.state === "preparing") message = this.state.progress || "The workspace is getting ready. I am still checking on it.";
      else if (this.state.state === "failed") message = "The workspace needs attention. Please check Build Studio for details.";
      else if (this.state.codexAuthenticated === false) message = "Open the Build Studio dashboard and connect Codex to this workspace before we can edit.";
      else if (!message) message = this.state.canClose ? "Your work is saved on GitHub. You can close the project or request another change."
        : this.state.state === "ready" ? "The workspace is ready. Tell me a change, or say save when you are done."
        : "The project is closed. Reopen it in Build Studio to continue.";
      if (this.callerSpeaking || this.now() - this.lastCallerAt < 2000 || this.pending || this.thinking || this.busy) return;
      if (this.queuedSave && this.state.state === "ready" && !this.uncertain) {
        const action = this.queuedSave; this.queuedSave = undefined;
        await this.execute({ action }, this.turn); return;
      }
      const working = ["working", "preparing"].includes(this.state.state);
      const newReply = Boolean(event?.id && event.id !== this.lastEventId && !working);
      const stateChanged = this.state.state !== this.lastState;
      // Coalesce fast progress changes. Do not follow a final answer with repetitive ready chatter.
      if (force || newReply || (working && this.now() - this.lastSpokenAt >= 30_000)
        || (!working && stateChanged && message !== this.lastSpeech)) {
        if (newReply) this.lastEventId = event.id;
        this.lastState = this.state.state;
        this.lastSpeech = message; this.lastSpokenAt = this.now(); this.speak(message);
      }
    } catch {
      if (force || this.now() - this.lastSpokenAt > 30_000) {
        this.lastSpokenAt = this.now(); this.speak("I am having trouble checking progress. Your request may still be running; please check the dashboard.");
      }
    } finally { this.polling = false; }
  }
}
