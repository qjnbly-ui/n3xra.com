import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void };

export const CODEX_RUNTIME_VERSION = "0.153.4";
export const ISOLATED_CODEX_BINARY = "/vercel/.n3xra/codex-runtime/node_modules/.bin/codex";

export type CodexEventHandler = (method: string, params: JsonObject) => void;

export class CodexAppServer {
  constructor(private readonly externallyIsolated = false) {}
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Set<CodexEventHandler>();

  private starting: Promise<void> | null = null;

  async start() {
    if (this.starting) return this.starting;
    if (this.process && this.process.exitCode === null && !this.process.killed) return;
    this.starting = this.initialize().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async initialize() {
    const child = spawn(this.externallyIsolated ? ISOLATED_CODEX_BINARY : "codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.process = child;
    child.stderr.on("data", (chunk) => process.stderr.write(`[codex] ${chunk}`));
    const stopped = (error: Error) => {
      if (this.process !== child) return;
      this.process = null;
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
      this.handlers.forEach((handler) => handler("worker/disconnected", { message: error.message }));
    };
    child.once("error", stopped);
    child.once("exit", (code) => stopped(new Error(`Codex App Server stopped with code ${code ?? "unknown"}.`)));
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    try {
      await this.request("initialize", { clientInfo: { name: "n3xra-build-worker", title: "N3XRA Build Studio", version: "1.0.0" } });
      this.notify("initialized", {});
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  stop() { this.process?.kill(); }

  private receive(line: string) {
    let message: JsonObject;
    try { message = JSON.parse(line) as JsonObject; } catch { return; }
    const id = typeof message.id === "number" ? message.id : null;
    if (id !== null && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      if (message.error) pending.reject(new Error(String((message.error as JsonObject).message || "Codex request failed.")));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      const params = (message.params || {}) as JsonObject;
      this.handlers.forEach((handler) => handler(message.method as string, params));
    }
  }

  request<T = any>(method: string, params: JsonObject): Promise<T> {
    if (!this.process) return Promise.reject(new Error("Codex App Server is not running."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out. Check the workspace before retrying.`));
      }, 120_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.process!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (error) { this.pending.get(id)?.reject(error); this.pending.delete(id); }
      });
    });
  }

  notify(method: string, params: JsonObject) {
    this.process?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  onEvent(handler: CodexEventHandler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }

  async account() {
    await this.start();
    return this.request<JsonObject>("account/read", { refreshToken: false });
  }

  async connectChatGpt() {
    await this.start();
    return this.request<JsonObject>("account/login/start", { type: "chatgptDeviceCode" });
  }

  async startThread(cwd: string) {
    await this.start();
    const result = await this.request<{ thread: { id: string } }>("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      personality: "pragmatic",
      serviceName: "n3xra-build-studio",
    });
    return result.thread.id;
  }

  async resumeThread(threadId: string, cwd: string) {
    await this.start();
    const result = await this.request<{ thread: { id: string } }>("thread/resume", {
      threadId, cwd, approvalPolicy: "never", sandbox: "workspace-write",
    });
    return result.thread.id;
  }

  async startTurn(threadId: string, cwd: string, text: string, outputSchema?: Record<string, unknown>, settings: { model?: string; effort?: string } = {}) {
    await this.start();
    return this.request<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: this.externallyIsolated
        ? { type: "externalSandbox", networkAccess: "restricted" }
        : { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false },
      outputSchema,
      ...settings,
      input: [{ type: "text", text }],
    });
  }
}
