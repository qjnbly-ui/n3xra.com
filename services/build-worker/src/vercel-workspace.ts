import { Sandbox } from "@vercel/sandbox";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

type Json = Record<string, any>;
export type WorkspaceIdentity = { id: string; websiteId: string; userId: string; cwd: string };
type EventHandler = (method: string, params: Json) => void;
export function workspaceName(identity: WorkspaceIdentity) {
  return `n3xra-${createHash("sha256").update(JSON.stringify([identity.websiteId, identity.userId, identity.id])).digest("hex").slice(0, 40)}`;
}
export class VercelWorkspace {
  private sandbox: Sandbox | undefined;
  private starting: Promise<void> | undefined;
  private cursor = 0;
  private polling: ReturnType<typeof setInterval> | undefined;
  private reading = false;
  private stopping: Promise<void> | undefined;
  private secret: string;
  private endpoint = "";
  private generation = "";
  private recoveredTurn: string | undefined;
  private credentials: { token: string; projectId: string; teamId: string };
  private readonly timeout = 15 * 60_000;
  private expiresAt = 0;
  private readonly handlers = new Set<EventHandler>();
  constructor(readonly identity: WorkspaceIdentity, env: NodeJS.ProcessEnv = process.env, private readonly sdk: Pick<typeof Sandbox, "get" | "create"> = Sandbox) {
    for (const key of ["N3XRA_VERCEL_TOKEN", "N3XRA_VERCEL_PROJECT_ID", "N3XRA_VERCEL_TEAM_ID", "N3XRA_BUILD_SANDBOX_SECRET"]) if (!env[key]) throw new Error(`${key} is required for isolated Build Studio workspaces.`);
    this.credentials = { token: env.N3XRA_VERCEL_TOKEN!, projectId: env.N3XRA_VERCEL_PROJECT_ID!, teamId: env.N3XRA_VERCEL_TEAM_ID! };
    this.secret = createHmac("sha256", env.N3XRA_BUILD_SANDBOX_SECRET!).update(workspaceName(identity)).digest("hex");
  }
  onEvent(handler: EventHandler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  private emit(method: string, params: Json) { this.handlers.forEach(handler => handler(method, params)); }
  get running() { return Boolean(this.sandbox) && !this.stopping && Date.now() < this.expiresAt; }
  get target() { if (!this.endpoint) throw new Error("The workspace is paused. Refresh the preview to resume."); return { origin: this.endpoint, authorization: `Bearer ${this.secret}` }; }
  async start() {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    if (this.sandbox && Date.now() < this.expiresAt) return;
    this.sandbox = undefined; this.endpoint = "";
    this.starting = this.boot().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async wake() {
    if (this.stopping) await this.stopping;
    if (this.starting) await this.starting;
    if (this.sandbox) {
      try { await this.http("/health"); await this.sandbox.extendTimeout(this.timeout); this.expiresAt = Date.now() + this.timeout; return; }
      catch { this.sandbox = undefined; this.endpoint = ""; }
    }
    await this.start();
  }
  private async boot() {
    const name = workspaceName(this.identity);
    let sandbox: Sandbox;
    try { sandbox = await this.sdk.get({ ...this.credentials, name, resume: true }); }
    catch (error) {
      if ((error as { response?: { status?: number } }).response?.status !== 404) throw error;
      sandbox = await this.sdk.create({ ...this.credentials, name, image: "vercel/sandbox/universal:latest", timeout: this.timeout, persistent: true, snapshotExpiration: 0, keepLastSnapshots: { count: 2, expiration: 0, deleteEvicted: true }, resources: { vcpus: 1 }, ports: [8080], networkPolicy: { allow: ["auth.openai.com", "*.openai.com", "chatgpt.com", "*.chatgpt.com", "registry.npmjs.org", "registry.yarnpkg.com", "github.com", "api.github.com", "codeload.github.com", "*.githubusercontent.com", ...String(process.env.N3XRA_BUILD_SANDBOX_ALLOWED_DOMAINS || "").split(",").map(item => item.trim()).filter(Boolean)] } });
    }
    this.sandbox = sandbox; this.endpoint = sandbox.domain(8080);
    try {
      await sandbox.extendTimeout(this.timeout);
      this.expiresAt = Date.now() + this.timeout;
      const runtimeFiles = await Promise.all(["sandbox-bridge.js", "codex-app-server.js", "process-lifecycle.js", "static-preview.js"].map(async file => ({ path: `/vercel/.n3xra/${file}`, content: await readFile(join(__dirname, file)) })));
      const version = createHash("sha256").update(Buffer.concat(runtimeFiles.map(file => file.content))).digest("hex");
      let healthy = false;
      try {
        const health = await this.http("/health"); healthy = health.ok === true && health.version === version;
        if (health.generation !== this.generation) this.cursor = 0; this.generation = health.generation;
        if (health.ok && !healthy) await this.http("/rpc", { method: "bridge/stop", params: {} });
      } catch { /* A stopped machine resumes files, not processes. */ }
      if (!healthy) {
        this.cursor = 0;
        await sandbox.runCommand("mkdir", ["-p", "/vercel/.n3xra"]);
        await sandbox.writeFiles(runtimeFiles);
        await sandbox.writeFiles([{ path: "/vercel/.n3xra/config.json", content: Buffer.from(JSON.stringify({ secret: this.secret, sessionId: this.identity.id, version })), mode: 0o600 }]);
        await sandbox.runCommand({ cmd: "node", args: ["/vercel/.n3xra/sandbox-bridge.js"], detached: true });
        for (let attempt = 0; attempt < 30; attempt++) {
          try { const health = await this.http("/health"); if (health.ok && health.version === version) { healthy = true; this.generation = health.generation; break; } } catch { /* Still starting. */ }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!healthy) throw new Error("The isolated workspace did not become ready.");
      }
    } catch (error) { await sandbox.stop().catch(() => undefined); this.sandbox = undefined; this.endpoint = ""; throw error; }
  }
  private async http(path: string, input?: Json) {
    const response = await fetch(`${this.endpoint}${path}`, { method: input ? "POST" : "GET", headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(input ? 120_000 : 5000) });
    const data = await response.json().catch(() => ({})) as Json;
    if (!response.ok) throw new Error(data.error || `The isolated workspace returned ${response.status}.`);
    return data;
  }
  async rpc(method: string, params: Json = {}) {
    await this.start();
    if (["turn/start", "account/login/start"].includes(method)) { await this.sandbox!.extendTimeout(this.timeout); this.expiresAt = Date.now() + this.timeout; this.poll(); }
    return (await this.http("/rpc", { method, params })).result as Json;
  }
  recoverEvents(turnId: string) { this.recoveredTurn = turnId; this.poll(); }
  private poll() {
    if (this.polling) return;
    this.polling = setInterval(() => { void this.readEvents(); }, 750); this.polling.unref();
  }
  private async readEvents() {
    if (this.reading || !this.sandbox || this.stopping) return;
    this.reading = true;
    try {
      const response = await fetch(`${this.endpoint}/events?after=${this.cursor}`, { headers: { Authorization: `Bearer ${this.secret}` }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("The isolated Codex connection was interrupted.");
      for (const event of await response.json() as { sequence: number; method: string; params: Json }[]) {
        this.cursor = event.sequence;
        const turnId = String(event.params.turnId || event.params.turn?.id || "");
        if (this.recoveredTurn && turnId !== this.recoveredTurn && event.method !== "worker/disconnected") continue;
        this.emit(event.method, event.params);
        if (["turn/completed", "account/login/completed", "worker/disconnected"].includes(event.method)) { clearInterval(this.polling); this.polling = undefined; }
        if (event.method === "turn/completed" || event.method === "worker/disconnected") this.recoveredTurn = undefined;
      }
    } catch (error) { clearInterval(this.polling); this.polling = undefined; this.emit("worker/disconnected", { message: error instanceof Error ? error.message : "Workspace disconnected." }); }
    finally { this.reading = false; }
  }
  async command(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd = "/vercel/repository") {
    await this.start();
    const cleanEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    // Disable repository-controlled hooks and helpers on trusted Git operations.
    const actualArgs = cmd === "git" ? ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", ...args] : args;
    const result = await this.sandbox!.runCommand({ cmd, args: actualArgs, cwd, env: cleanEnv, timeoutMs: 300_000 });
    if (result.exitCode !== 0) {
      let message = (await result.stderr() || await result.stdout() || `${cmd} failed`).slice(-2000);
      for (const value of Object.values(cleanEnv)) if (value.length > 15) message = message.replaceAll(value, "[redacted]");
      throw new Error(message);
    }
    return (await result.stdout()).trim();
  }
  async read(path: string) { await this.start(); return (await this.sandbox!.readFileToBuffer({ path: `/vercel/repository/${path}` }))?.toString("utf8") || ""; }
  async write(path: string, content: string) { await this.start(); await this.sandbox!.writeFiles([{ path: `/vercel/repository/${path}`, content: Buffer.from(content) }]); }
  async exists(path: string) { await this.start(); const result = await this.sandbox!.runCommand("test", ["-e", `/vercel/repository/${path}`]); return result.exitCode === 0; }
  async prepare(repository: string, baseBranch: string, workingBranch: string, token: string) {
    await this.start();
    if (!(await this.exists(".git")) && existsSync(join(this.identity.cwd, ".git"))) await this.importExisting();
    await this.sandbox!.writeFiles([{ path: "/vercel/.n3xra/askpass.sh", content: Buffer.from('#!/bin/sh\ncase "$1" in *Username*) printf "%s" x-access-token ;; *) printf "%s" "$N3XRA_GITHUB_TOKEN" ;; esac\n'), mode: 0o700 }]);
    const env = { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: token };
    if (!(await this.exists(".git"))) await this.command("git", ["clone", `https://github.com/${repository}.git`, "/vercel/repository"], env, "/vercel");
    await this.command("git", ["fetch", "origin", baseBranch], env);
    // Fetch the work branch if it exists; a new workspace may not have pushed it yet.
    const remote = await this.command("git", ["ls-remote", "--heads", "origin", workingBranch], env);
    if (remote) await this.command("git", ["fetch", "origin", `${workingBranch}:refs/remotes/origin/${workingBranch}`], env);
    const local = await this.command("git", ["branch", "--list", workingBranch]);
    await this.command("git", local ? ["checkout", workingBranch] : ["checkout", "-b", workingBranch, `origin/${remote ? workingBranch : baseBranch}`]);
    await this.command("git", ["config", "user.name", "N3XRA Build Studio"]);
    await this.command("git", ["config", "user.email", "build-studio@n3xra.com"]);
  }
  private async importExisting() {
    // Stream bounded chunks: never load a customer's entire repository into Render RAM.
    const child = spawn("tar", ["-czf", "-", "--exclude=node_modules", "--exclude=.astro", "--exclude=.next", "-C", this.identity.cwd, "."], { stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; child.stderr.on("data", chunk => { error = (error + chunk).slice(-2000); });
    const finished = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(error || "Workspace transfer failed."))); });
    // Attach rejection handling immediately while stdout is consumed.
    void finished.catch(() => undefined);
    const parts: string[] = [];
    try {
      for await (const chunk of child.stdout) { const path = `/vercel/.n3xra/import-${parts.length}`; await this.sandbox!.writeFiles([{ path, content: Buffer.from(chunk) }]); parts.push(path); }
      await finished;
      await this.sandbox!.runCommand("mkdir", ["-p", "/vercel/repository"]);
      await this.command("sh", ["-c", 'cat "$@" | tar -xzf - --no-same-owner -C /vercel/repository', "import", ...parts], {}, "/vercel");
    } finally { child.kill(); if (parts.length) await this.sandbox!.runCommand("rm", ["-f", ...parts]); }
  }
  async push(branch: string, repository: string, token: string) {
    // A push never force-overwrites a change made from another editor.
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error("Invalid repository.");
    await this.command("git", ["push", "-u", `https://github.com/${repository}.git`, `HEAD:refs/heads/${branch}`], { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: token });
    await this.command("git", ["update-ref", `refs/remotes/origin/${branch}`, "HEAD"]);
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.starting) await this.starting;
      clearInterval(this.polling); this.polling = undefined;
      if (this.sandbox) {
        await this.http("/rpc", { method: "preview/stop", params: {} }).catch(() => undefined);
        await this.sandbox.stop();
      }
      this.sandbox = undefined; this.endpoint = "";
    })().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
}
