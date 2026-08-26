import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void };

export type CodexEventHandler = (method: string, params: JsonObject) => void;

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Set<CodexEventHandler>();

  async start() {
    if (this.process && !this.process.killed) return;
    this.process = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.process.stderr.on("data", (chunk) => process.stderr.write(`[codex] ${chunk}`));
    this.process.once("exit", (code) => {
      const error = new Error(`Codex App Server stopped with code ${code ?? "unknown"}.`);
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
      this.process = null;
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.receive(line));
    await this.request("initialize", { clientInfo: { name: "n3xra-build-worker", title: "N3XRA Build Studio", version: "1.0.0" } });
    this.notify("initialized", {});
  }

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
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve, reject }));
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

  async startTurn(threadId: string, cwd: string, text: string) {
    return this.request<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false },
      input: [{ type: "text", text }],
    });
  }
}
