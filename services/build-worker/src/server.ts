import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createSign, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pipeline } from "node:stream/promises";
import { CodexAppServer } from "./codex-app-server.js";
import { signalProcessGroup as killProcessGroup, stopProcessGroup } from "./process-lifecycle.js";
import { VercelWorkspace } from "./vercel-workspace.js";

type Json = Record<string, any>;
type Identity = { id: string; email?: string };
type Session = {
  id: string; websiteId: string; userId: string; cwd: string; repositoryFullName: string;
  baseBranch: string; workingBranch: string; codexThreadId: string; previewPort: number;
  state: "preparing" | "ready" | "working" | "awaiting_approval" | "failed" | "stopped" | "archived";
  previewState: "offline" | "starting" | "ready" | "failed"; changedFileCount: number; previewToken: string; previewProcess?: ChildProcess; preparation?: Promise<void>; previewStarting?: Promise<void>; hasUnpushedCommits?: boolean; previewBasePath?: string; previewUsesAstro?: boolean; lastPreviewActivity?: number;
  codexAuthenticated?: boolean;
};

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "N3XRA_BUILD_WORKSPACE_ROOT", "CODEX_HOME", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID"] as const;
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
const env = process.env as NodeJS.ProcessEnv & Record<typeof required[number], string>;
const port = Number(process.env.PORT || 4317);
const host = String(process.env.N3XRA_BUILD_HOST || "127.0.0.1");
const allowedOrigins = new Set(
  String(process.env.N3XRA_BUILD_ALLOWED_ORIGIN || "https://n3xra.com,https://www.n3xra.com")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
);
const workspaceRoot = resolve(env.N3XRA_BUILD_WORKSPACE_ROOT);
const codex = new CodexAppServer();
const provider = process.env.N3XRA_BUILD_EXECUTION_PROVIDER || "local";
if (!["local", "vercel"].includes(provider)) throw new Error("Unsupported Build Studio execution provider.");
const isolated = provider === "vercel";
if (isolated) for (const key of ["N3XRA_VERCEL_TOKEN", "N3XRA_VERCEL_PROJECT_ID", "N3XRA_VERCEL_TEAM_ID", "N3XRA_BUILD_SANDBOX_SECRET"]) if (!process.env[key]) throw new Error(`${key} is required.`);
const remoteWorkspaces = new Map<string, VercelWorkspace>();
const sessions = new Map<string, Session>();
const listeners = new Map<string, Set<ServerResponse>>();
const turnSessions = new Map<string, string>();
const partialMessages = new Map<string, string>();
const lastMessageItems = new Map<string, string>();
const recovering = new Map<string, Promise<Session | null>>();
const opening = new Map<string, Promise<Session>>();
const commandChildren = new Set<ChildProcess>();
let shuttingDown = false;
// Serialize dependency installation/startup across projects on the shared worker.
let previewQueue: Promise<void> = Promise.resolve();
const idleSeconds = Number(process.env.N3XRA_BUILD_PREVIEW_IDLE_SECONDS || 900);
if (!Number.isFinite(idleSeconds) || idleSeconds < 1) throw new Error("N3XRA_BUILD_PREVIEW_IDLE_SECONDS must be a positive number.");

function remoteWorkspace(session: Session) {
  let remote = remoteWorkspaces.get(session.id);
  if (!remote) {
    remote = new VercelWorkspace(session);
    remote.onEvent((method, params) => handleCodexEvent(method, params, session.id));
    remoteWorkspaces.set(session.id, remote);
  }
  return remote;
}
function sessionCodex(session: Session) {
  if (!isolated) return codex;
  const remote = remoteWorkspace(session);
  return {
    account: () => remote.rpc("account/read", { refreshToken: false }),
    startThread: async (_cwd: string) => (await remote.rpc("thread/start", { cwd: "/vercel/repository", approvalPolicy: "never", sandbox: "workspace-write", personality: "pragmatic" })).thread.id as string,
    resumeThread: async (threadId: string, _cwd: string) => (await remote.rpc("thread/resume", { threadId, cwd: "/vercel/repository", approvalPolicy: "never", sandbox: "workspace-write" })).thread.id as string,
    startTurn: (threadId: string, _cwd: string, text: string) => remote.rpc("turn/start", { threadId, approvalPolicy: "never", input: [{ type: "text", text }] }),
  };
}

async function logResources(stage: string, session: Session) {
  const memory = await readFile("/sys/fs/cgroup/memory.current", "utf8").catch(() => "");
  const limit = await readFile("/sys/fs/cgroup/memory.max", "utf8").catch(() => "");
  const stat = Object.fromEntries((await readFile("/sys/fs/cgroup/memory.stat", "utf8").catch(() => "")).trim().split("\n").map(line => line.split(" ")));
  console.info(JSON.stringify({ event: "build-worker-resources", stage, sessionId: session.id, workerRssBytes: process.memoryUsage().rss, ...(memory.trim() ? { containerMemoryBytes: Number(memory), anonymousBytes: Number(stat.anon || 0), fileCacheBytes: Number(stat.file || 0) } : {}), ...(limit.trim() && limit.trim() !== "max" ? { containerLimitBytes: Number(limit) } : {}), previewProcesses: [...sessions.values()].filter(item => item.previewProcess).length }));
}

function headers(res: ServerResponse, status = 200, contentType = "application/json") {
  const requestOrigin = String((res as ServerResponse & { req?: IncomingMessage }).req?.headers.origin || "").replace(/\/$/, "");
  const allowOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : [...allowedOrigins][0];
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store", "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" });
}
function json(res: ServerResponse, status: number, value: unknown) { headers(res, status); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json : {}; }
function safePath(path: string) { const output = resolve(path); if (output !== workspaceRoot && !output.startsWith(`${workspaceRoot}${sep}`)) throw new Error("Unsafe workspace path."); return output; }
function bearer(req: IncomingMessage) { return String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); }

async function supabase(path: string, options: RequestInit = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, { ...options, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(options.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error_description || `Supabase returned ${response.status}.`);
  return data;
}

async function authenticate(req: IncomingMessage): Promise<Identity> {
  const token = bearer(req);
  if (!token) throw new Error("Authentication required.");
  const userResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!userResponse.ok) throw new Error("Your N3XRA session has expired.");
  const user = await userResponse.json() as Identity;
  const rows = await supabase(`/rest/v1/platform_admins?user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=user_id,role,access_scope`);
  const admin = Array.isArray(rows) ? rows[0] : null;
  if (!admin || !["owner", "admin", "operations_admin"].includes(String(admin.role))) throw new Error("Build Studio requires administrator access.");
  return user;
}

async function command(commandName: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}) {
  if (shuttingDown) throw new Error("Build worker is shutting down.");
  if (isolated) {
    const session = [...sessions.values()].find(item => item.cwd === cwd);
    if (session) return remoteWorkspace(session).command(commandName, args, extraEnv);
  }
  return new Promise<string>((resolveCommand, reject) => {
    const child = spawn(commandName, args, { cwd: safePath(cwd), env: { ...process.env, ...extraEnv }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      killProcessGroup(child, "SIGKILL");
      reject(new Error(`${commandName} timed out after five minutes.`));
    }, 300_000);
    commandChildren.add(child);
    child.once("close", () => commandChildren.delete(child));
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-100_000); }); child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-100_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolveCommand(stdout.trim()) : reject(new Error((stderr || stdout || `${commandName} failed`).trim().slice(-2000))); });
  });
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function githubInstallationToken(repositoryFullName: string) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repositoryFullName)) throw new Error("Invalid GitHub repository.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  const jwt = `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
  const repository = repositoryFullName.split("/")[1];
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID)}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ repositories: [repository], permissions: { contents: "write" } }),
  });
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok || !data.token) throw new Error(String(data.message || "GitHub App authentication failed."));
  return String(data.token);
}

async function gitEnvironment(sessionId: string, repositoryFullName: string) {
  const token = await githubInstallationToken(repositoryFullName);
  const script = safePath(join(workspaceRoot, ".credentials", `${sessionId}-askpass.sh`));
  await mkdir(dirname(script), { recursive: true });
  await writeFile(script, "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s' 'x-access-token' ;; *) printf '%s' \"$N3XRA_GITHUB_TOKEN\" ;; esac\n", { mode: 0o700 });
  await chmod(script, 0o700);
  return { GIT_ASKPASS: script, GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: token };
}

async function emit(session: Session, eventType: string, message = "", metadata: Json = {}) {
  const rows = await supabase("/rest/v1/website_build_events", { method: "POST", body: JSON.stringify({ session_id: session.id, website_id: session.websiteId, actor_user_id: session.userId, event_type: eventType, message: message || null, metadata }) });
  const event = Array.isArray(rows) ? rows[0] : { event_type: eventType, message, metadata };
  listeners.get(session.id)?.forEach((res) => res.write(`data: ${JSON.stringify({ id: event.id, eventType, message, metadata })}\n\n`));
}

function publicSession(session: Session) {
  const publicUrl = process.env.N3XRA_BUILD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  return { id: session.id, state: session.state, workingBranch: session.workingBranch, previewUrl: `${String(publicUrl).replace(/\/$/, "")}/preview/${session.id}/?token=${session.previewToken}`, previewState: session.previewState, changedFileCount: session.changedFileCount, hasUnpushedCommits: Boolean(session.hasUnpushedCommits), ...(isolated ? { codexAuthenticated: Boolean(session.codexAuthenticated) } : {}) };
}

async function sessionEvents(sessionId: string) {
  const rows = await supabase(`/rest/v1/website_build_events?session_id=eq.${encodeURIComponent(sessionId)}&select=id,event_type,message,metadata,created_at&order=created_at.asc,id.asc`);
  return (Array.isArray(rows) ? rows : []).map((event: Json) => ({ id: event.id, eventType: event.event_type, message: event.message, metadata: event.metadata || {} }));
}

async function updateStatus(session: Session) {
  const value = await command("git", ["status", "--short"], session.cwd);
  const remote = await command("git", ["branch", "-r", "--list", `origin/${session.workingBranch}`], session.cwd);
  const upstream = remote ? `origin/${session.workingBranch}` : `origin/${session.baseBranch}`;
  session.hasUnpushedCommits = Number(await command("git", ["rev-list", "--count", `${upstream}..HEAD`], session.cwd)) > 0;
  session.changedFileCount = value ? value.split("\n").length : 0;
  await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ state: session.state, changed_file_count: session.changedFileCount, preview_state: session.previewState, last_activity_at: new Date().toISOString() }) });
  return publicSession(session);
}

async function prepareRepository(session: Session) {
  if (isolated) { await remoteWorkspace(session).prepare(session.repositoryFullName, session.baseBranch, session.workingBranch, await githubInstallationToken(session.repositoryFullName)); return; }
  await mkdir(workspaceRoot, { recursive: true });
  const gitEnv = await gitEnvironment(session.id, session.repositoryFullName);
  if (!existsSync(join(session.cwd, ".git"))) {
    await mkdir(dirname(session.cwd), { recursive: true });
    await command("git", ["clone", `https://github.com/${session.repositoryFullName}.git`, session.cwd], workspaceRoot, gitEnv);
  }
  await command("git", ["fetch", "origin", session.baseBranch], session.cwd, gitEnv);
  const branches = await command("git", ["branch", "--list", session.workingBranch], session.cwd);
  if (branches) await command("git", ["checkout", session.workingBranch], session.cwd);
  else await command("git", ["checkout", "-b", session.workingBranch, `origin/${session.baseBranch}`], session.cwd);
}

async function startPreview(session: Session) {
  if (session.previewStarting) return session.previewStarting;
  const running = previewQueue.then(async () => {
    if (shuttingDown || sessions.get(session.id) !== session) return;
    await launchPreview(session);
  }).finally(() => { delete session.previewStarting; });
  previewQueue = running.catch(() => undefined);
  session.previewStarting = running;
  return running;
}

async function stopPreview(session: Session) {
  if (isolated) { const remote = remoteWorkspaces.get(session.id); if (remote?.running) await remote.rpc("preview/stop"); return; }
  const child = session.previewProcess;
  if (!child) return;
  child.removeAllListeners("exit");
  await stopProcessGroup(child);
  delete session.previewProcess;
}

async function launchPreview(session: Session) {
  if (isolated) return launchRemotePreview(session);
  await stopPreview(session);
  session.previewState = "starting";
  const packageJson = JSON.parse(await readFile(join(session.cwd, "package.json"), "utf8")) as Json;
  const packageManager = existsSync(join(session.cwd, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(session.cwd, "yarn.lock")) ? "yarn" : "npm";
  const installMarker = join(session.cwd, "node_modules", ".n3xra-installed");
  const fingerprint = createHash("sha256");
  for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    fingerprint.update(file).update(await readFile(join(session.cwd, file)).catch(() => Buffer.alloc(0)));
  }
  const installFingerprint = fingerprint.digest("hex");
  if ((await readFile(installMarker, "utf8").catch(() => "")) !== installFingerprint) {
    await emit(session, "status", "Installing the website dependencies. The first preview can take a minute.", { session: publicSession(session) });
    await logResources("install-start", session);
    if (packageManager === "npm") {
      const installArgs = existsSync(join(session.cwd, "package-lock.json")) ? ["ci", "--include=dev", "--no-audit", "--no-fund"] : ["install", "--include=dev", "--no-audit", "--no-fund"];
      try {
        await command("npm", installArgs, session.cwd, { NODE_ENV: "development" });
      } catch (error) {
        if (installArgs[0] !== "ci") throw error;
        await command("npm", ["install", "--package-lock=false", "--include=dev", "--no-audit", "--no-fund"], session.cwd, { NODE_ENV: "development" });
      }
    } else {
      await command(packageManager, ["install", "--frozen-lockfile"], session.cwd, { NODE_ENV: "development" });
    }
    await logResources("install-complete", session);
  }
  await mkdir(join(session.cwd, "node_modules"), { recursive: true });
  await writeFile(installMarker, installFingerprint);
  if (!sessions.has(session.id)) return;
  await emit(session, "status", "Starting the private live preview.", { session: publicSession(session) });
  const script = packageJson.scripts?.dev ? "dev" : packageJson.scripts?.start ? "start" : "preview";
  const args = packageManager === "npm" ? ["run", script, "--", "--host", "127.0.0.1", "--port", String(session.previewPort)] : [script, "--host", "127.0.0.1", "--port", String(session.previewPort)];
  // Astro/Vite need a session base so module requests and HMR stay on this preview.
  session.previewUsesAstro = /astro/.test(String(packageJson.scripts?.[script] || ""));
  session.previewBasePath = /astro|vite/.test(String(packageJson.scripts?.[script] || "")) ? `/preview/${session.id}/` : "/";
  if (session.previewBasePath !== "/") args.push("--base", session.previewBasePath);
  const previewProcess = spawn(packageManager, args, { cwd: session.cwd, env: { ...process.env, NODE_ENV: "development", ASTRO_DEV_BACKGROUND: "1", ASTRO_TELEMETRY_DISABLED: "1", BROWSER: "none" }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  session.previewProcess = previewProcess;
  let output = "";
  let failure = "";
  const log = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2000); };
  previewProcess.stdout?.on("data", log); previewProcess.stderr?.on("data", log);
  previewProcess.once("error", (error) => { failure = error.message; });
  previewProcess.once("exit", () => {
    if (session.previewProcess !== previewProcess) return;
    failure = output || "The preview process stopped.";
    session.previewState = "failed";
    void updateStatus(session).then((state) => emit(session, "error", failure, { session: state })).catch(() => null);
  });
  for (let attempt = 0; attempt < 90; attempt++) {
    if (failure) throw new Error(failure);
    if (!sessions.has(session.id)) return;
    try {
      const response = await fetch(`http://127.0.0.1:${session.previewPort}${session.previewBasePath}`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) {
        session.previewState = "ready";
        session.lastPreviewActivity = Date.now();
        await logResources("preview-ready", session);
        await emit(session, "preview", "Live preview is ready.", { session: await updateStatus(session) });
        return;
      }
    } catch { /* The dev server has not bound its port yet. */ }
    await delay(1000);
  }
  await stopPreview(session);
  throw new Error(`The preview did not become ready. ${output}`);
}

async function launchRemotePreview(session: Session) {
  const remote = remoteWorkspace(session);
  await remote.wake(); await remote.rpc("preview/stop");
  session.previewState = "starting";
  session.previewBasePath = `/preview/${session.id}/`;
  let packageJson: Json = {};
  if (await remote.exists("package.json")) packageJson = JSON.parse(await remote.read("package.json"));
  const script = packageJson.scripts?.dev ? "dev" : packageJson.scripts?.start ? "start" : packageJson.scripts?.preview ? "preview" : "";
  if (!script) {
    if (!(await remote.exists("index.html"))) throw new Error("This repository needs an index.html or a development/start script for preview.");
    await remote.rpc("preview/start", { cmd: "node", args: ["/vercel/.n3xra/static-preview.js", session.previewBasePath] });
  } else {
    const supported = /astro|vite/.test(String(packageJson.scripts[script]));
    if (!supported) throw new Error("This preview currently supports Astro, Vite, or static HTML. This repository’s development command needs a preview adapter.");
    const manager = await remote.exists("pnpm-lock.yaml") ? "pnpm" : await remote.exists("yarn.lock") ? "yarn" : "npm";
    const fingerprint = createHash("sha256");
    for (const file of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) fingerprint.update(file).update(await remote.read(file).catch(() => ""));
    const hash = fingerprint.digest("hex");
    if ((await remote.read("node_modules/.n3xra-installed").catch(() => "")) !== hash) {
      await emit(session, "status", "Installing this website’s dependencies in its isolated workspace.", { session: publicSession(session) });
      if (manager === "npm") await remote.installNpm();
      else await remote.command(manager, ["install", "--frozen-lockfile"], { NODE_ENV: "development" });
      await remote.command("mkdir", ["-p", "node_modules"]); await remote.write("node_modules/.n3xra-installed", hash);
    }
    session.previewUsesAstro = /astro/.test(String(packageJson.scripts[script]));
    const args = manager === "npm" ? ["run", script, "--"] : [script];
    args.push("--host", "127.0.0.1", "--port", "5173", "--base", session.previewBasePath);
    await remote.rpc("preview/start", { cmd: manager, args });
  }
  await emit(session, "status", "Starting the private live preview.", { session: publicSession(session) });
  for (let attempt = 0; attempt < 90; attempt++) {
    const target = remote.target;
    try {
      const response = await fetch(`${target.origin}${session.previewBasePath}`, { headers: { Authorization: target.authorization }, signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.ok) {
        session.previewState = "ready"; session.lastPreviewActivity = Date.now();
        await emit(session, "preview", "Live preview is ready.", { session: await updateStatus(session) }); return;
      }
    } catch { /* Preview has not started listening. */ }
    const status = await remote.rpc("preview/status");
    if (!status.running) throw new Error(status.output || "The preview process stopped.");
    await delay(1000);
  }
  await remote.rpc("preview/stop"); throw new Error("The preview did not become ready.");
}

// SSE heartbeats do not count as activity. Files and the conversation stay saved.
const previewIdleTimer = setInterval(() => {
  for (const session of sessions.values()) {
    if (isolated) {
      const remote = remoteWorkspaces.get(session.id);
      if (remote && !remote.running && session.state === "ready" && session.previewState === "ready" && !session.previewStarting) {
        session.previewState = "offline";
        void emit(session, "preview", "Workspace paused. Your work is saved; refresh the preview to resume.", { session: publicSession(session) }).catch(() => undefined);
      }
      if (session.state !== "ready" || session.previewStarting || !remote?.running || Date.now() - (session.lastPreviewActivity || Date.now()) < idleSeconds * 1000) continue;
      session.previewState = "offline";
      void remote.stop().then(() => emit(session, "preview", "Workspace paused after inactivity. Your files and conversation are saved. Refresh the preview to resume.", { session: publicSession(session) })).catch(error => console.error("Could not pause workspace:", String(error)));
      continue;
    }
    if (session.state !== "ready" || session.previewStarting || !session.previewProcess || session.previewState !== "ready") continue;
    if (Date.now() - (session.lastPreviewActivity || Date.now()) < idleSeconds * 1000) continue;
    session.previewState = "offline";
    void stopPreview(session).then(async () => {
      await emit(session, "preview", "Live preview paused after inactivity. Your work is saved. Refresh the preview to resume.", { session: await updateStatus(session) });
      await logResources("preview-idle-paused", session);
    }).catch(error => console.error("Could not pause idle preview:", String(error)));
  }
}, Math.min(30_000, idleSeconds * 1000));
previewIdleTimer.unref();

async function ensureThread(session: Session) {
  const codex = sessionCodex(session);
  if (session.codexThreadId) {
    try { session.codexThreadId = await codex.resumeThread(session.codexThreadId, session.cwd); return; }
    catch (error) {
      if (!/thread not found|no rollout found|unable to find.*thread/i.test(String((error as Error).message))) throw error;
      await emit(session, "status", "The saved Codex conversation is unavailable. Starting a new conversation with your existing files.");
    }
  }
  session.codexThreadId = await codex.startThread(session.cwd);
  await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ codex_thread_id: session.codexThreadId }) });
}

function prepareProject(session: Session): Promise<void> {
  if (session.preparation) return session.preparation;
  session.state = "preparing";
  session.previewState = "starting";
  const running = prepareProjectOnce(session).finally(() => { delete session.preparation; });
  session.preparation = running;
  return running;
}

async function prepareProjectOnce(session: Session) {
  try {
    if (isolated) {
      const remote = remoteWorkspace(session);
      const status = await remote.rpc("workspace/status");
      if (status.activeTurn?.turnId) {
        session.codexThreadId = String(status.activeTurn.threadId);
        session.codexAuthenticated = true;
        session.state = "working";
        session.previewBasePath = `/preview/${session.id}/`;
        session.previewState = status.previewRunning ? "ready" : "offline";
        session.lastPreviewActivity = Date.now();
        turnSessions.set(String(status.activeTurn.turnId), session.id);
        remote.recoverEvents(String(status.activeTurn.turnId));
        await emit(session, "session", "Reconnected to the change already running in this website’s workspace.", { session: publicSession(session) });
        return;
      }
    }
    await emit(session, "status", "Opening the connected GitHub repository.", { session: publicSession(session) });
    await prepareRepository(session);
    if (!sessions.has(session.id)) return;
    await emit(session, "status", "Starting the secure Codex workspace.", { session: publicSession(session) });
    if (isolated) session.codexAuthenticated = Boolean((await sessionCodex(session).account()).account);
    if (!isolated || session.codexAuthenticated) await ensureThread(session);
    if (!sessions.has(session.id)) return;
    session.state = "ready";
    session.lastPreviewActivity = Date.now();
    await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ codex_thread_id: session.codexThreadId, state: session.state, preview_state: "starting", error_message: null, last_activity_at: new Date().toISOString() }) });
    await emit(session, "session", `Build workspace opened on ${session.workingBranch}.`, { session: publicSession(session) });
    void startPreview(session).then(() => updateStatus(session)).catch(async (error) => {
      session.previewState = "failed";
      await emit(session, "error", String(error.message || error), { session: await updateStatus(session) });
    }).catch(() => null);
    await updateStatus(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The build workspace could not be prepared.";
    session.state = "failed";
    session.previewState = "failed";
    await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ state: session.state, preview_state: session.previewState, error_message: message, last_activity_at: new Date().toISOString() }) }).catch(() => null);
    await emit(session, "error", message, { session: publicSession(session) }).catch(() => null);
  }
}

function openProject(user: Identity, websiteId: string): Promise<Session> {
  const key = JSON.stringify([user.id, websiteId]);
  const existing = opening.get(key); if (existing) return existing;
  const task = openProjectOnce(user, websiteId).finally(() => opening.delete(key));
  opening.set(key, task); return task;
}
async function openProjectOnce(user: Identity, websiteId: string): Promise<Session> {
  const websites = await supabase(`/rest/v1/client_websites?id=eq.${encodeURIComponent(websiteId)}&select=id,name,organization_id`);
  const repositories = await supabase(`/rest/v1/website_repositories?website_id=eq.${encodeURIComponent(websiteId)}&provider=eq.github&select=full_name,default_branch&order=created_at.desc&limit=1`);
  const website = websites?.[0], repository = repositories?.[0];
  if (!website) throw new Error("Website not found."); if (!repository) throw new Error("Connect a GitHub repository before starting Build Studio.");
  const previousRows = await supabase(`/rest/v1/website_build_sessions?website_id=eq.${encodeURIComponent(websiteId)}&created_by_user_id=eq.${encodeURIComponent(user.id)}&archived_at=is.null&select=*&order=created_at.desc&limit=1`);
  const previous = previousRows?.[0];
  if (previous) {
    if (previous.repository_full_name !== repository.full_name) throw new Error("This website’s repository changed. Preserve the existing workspace before switching repositories.");
    let existing = sessions.get(String(previous.id));
    if (existing && existing.userId !== user.id) throw new Error("Workspace access denied.");
    if (!existing) {
      await supabase(`/rest/v1/website_build_sessions?id=eq.${encodeURIComponent(String(previous.id))}`, { method: "PATCH", body: JSON.stringify({ state: "preparing", error_message: null }) });
      existing = await recoverSession(user, String(previous.id)) || undefined;
    } else if (["failed", "stopped"].includes(existing.state)) void prepareProject(existing);
    if (existing) return existing;
    throw new Error("The saved workspace could not be recovered. Your saved files have not been deleted.");
  }
  await supabase(`/rest/v1/website_build_sessions?website_id=eq.${websiteId}&created_by_user_id=eq.${user.id}&archived_at=is.null`, { method: "PATCH", body: JSON.stringify({ state: "archived", archived_at: new Date().toISOString() }) });
  for (const [sessionId, existing] of sessions) {
    if (existing.websiteId !== websiteId || existing.userId !== user.id) continue;
    existing.state = "archived";
    if (isolated) await remoteWorkspaces.get(existing.id)?.stop(); else await stopPreview(existing);
    sessions.delete(sessionId);
  }
  const id = randomUUID(); const slug = String(website.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "website";
  const session: Session = { id, websiteId, userId: user.id, cwd: safePath(join(workspaceRoot, websiteId, id, "repository")), repositoryFullName: repository.full_name, baseBranch: repository.default_branch || "main", workingBranch: `n3xra/build-${slug}-${id.slice(0, 8)}`, codexThreadId: "", previewPort: 5000 + (Number.parseInt(createHash("sha1").update(id).digest("hex").slice(0, 4), 16) % 1000), state: "preparing", previewState: "offline", changedFileCount: 0, previewToken: createHash("sha256").update(randomUUID()).digest("hex") };
  sessions.set(id, session);
  await supabase("/rest/v1/website_build_sessions", { method: "POST", body: JSON.stringify({ id, website_id: websiteId, organization_id: website.organization_id, created_by_user_id: user.id, worker_session_id: id, repository_full_name: session.repositoryFullName, base_branch: session.baseBranch, working_branch: session.workingBranch, state: session.state, preview_state: session.previewState }) });
  void prepareProject(session);
  return session;
}

async function activeProject(user: Identity, websiteId: string) {
  const rows = await supabase(`/rest/v1/website_build_sessions?website_id=eq.${encodeURIComponent(websiteId)}&created_by_user_id=eq.${encodeURIComponent(user.id)}&archived_at=is.null&select=id,website_id,created_by_user_id,repository_full_name,base_branch,working_branch,codex_thread_id,state,preview_state,changed_file_count&order=created_at.desc&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { session: null, events: [] };
  if (["failed", "stopped"].includes(String(row.state))) return { session: null, events: [] };
  const session = await recoverSession(user, String(row.id));
  return { session: session ? publicSession(session) : null, events: session ? await sessionEvents(session.id) : [] };
}

async function recoverSession(user: Identity, id: string): Promise<Session | null> {
  const existing = sessions.get(id);
  if (existing) return existing.userId === user.id ? existing : null;
  const key = `${user.id}:${id}`;
  if (recovering.has(key)) return recovering.get(key)!;
  const load = (async () => {
    const rows = await supabase(`/rest/v1/website_build_sessions?id=eq.${encodeURIComponent(id)}&created_by_user_id=eq.${encodeURIComponent(user.id)}&archived_at=is.null&select=*`);
    const row = rows?.[0];
    if (!row || ["archived", "stopped", "failed"].includes(String(row.state))) return null;
    const session: Session = {
      id: String(row.id), websiteId: String(row.website_id), userId: String(row.created_by_user_id),
      cwd: safePath(join(workspaceRoot, String(row.website_id), String(row.id), "repository")),
      repositoryFullName: String(row.repository_full_name), baseBranch: String(row.base_branch || "main"),
      workingBranch: String(row.working_branch), codexThreadId: String(row.codex_thread_id || ""),
      previewPort: 5000 + (Number.parseInt(createHash("sha1").update(String(row.id)).digest("hex").slice(0, 4), 16) % 1000),
      state: "preparing", previewState: "starting", changedFileCount: Number(row.changed_file_count || 0),
      previewToken: createHash("sha256").update(randomUUID()).digest("hex"),
    };
    sessions.set(session.id, session);
    void prepareProject(session);
    return session;
  })().finally(() => recovering.delete(key));
  recovering.set(key, load);
  return load;
}

function handleCodexEvent(method: string, params: Json, sourceSessionId?: string) {
  if (sourceSessionId && method === "account/login/completed") {
    const session = sessions.get(sourceSessionId);
    if (session) {
      session.codexAuthenticated = params.success === true;
      session.lastPreviewActivity = Date.now();
      void emit(session, params.success ? "session" : "error", params.success ? "Codex connected to this website. You can now describe your changes." : "Codex sign-in did not finish. Try connecting again.", { session: publicSession(session) });
    }
    return;
  }
  if (method === "worker/disconnected") {
    for (const session of sessions.values()) {
      if (sourceSessionId && session.id !== sourceSessionId) continue;
      if (session.state !== "working") continue;
      session.state = "ready";
      void updateStatus(session).then((state) => emit(session, "error", "Codex disconnected. Your files are preserved; check changes before sending another request.", { session: state })).catch(() => null);
    }
    if (!sourceSessionId) { turnSessions.clear(); partialMessages.clear(); lastMessageItems.clear(); }
    else for (const [turnId, sessionId] of turnSessions) if (sessionId === sourceSessionId) { turnSessions.delete(turnId); partialMessages.delete(turnId); lastMessageItems.delete(turnId); }
    return;
  }
  const turn = params.turn as Json | undefined;
  const turnId = String(params.turnId || turn?.id || "");
  const sessionId = turnSessions.get(turnId);
  const session = (sessionId ? sessions.get(sessionId) : null) || [...sessions.values()].find((item) => item.codexThreadId === params.threadId && item.state === "working");
  if (!session) return;
  if (method === "item/agentMessage/delta") {
    const itemId = String(params.itemId || "");
    const previous = partialMessages.get(turnId) || "";
    const separator = previous && itemId && lastMessageItems.get(turnId) !== itemId ? "\n\n" : "";
    partialMessages.set(turnId, `${previous}${separator}${String(params.delta || "")}`);
    lastMessageItems.set(turnId, itemId);
  }
  if (method === "turn/completed") {
    const failed = turn?.status !== "completed";
    const message = failed ? String(turn?.error?.message || "The Codex turn was interrupted. Check the changes before retrying.") : partialMessages.get(turnId) || "Codex returned no message. Check the changes before continuing.";
    partialMessages.delete(turnId); turnSessions.delete(turnId); lastMessageItems.delete(turnId);
    session.state = "ready";
    session.lastPreviewActivity = Date.now();
    void updateStatus(session).then((state) => emit(session, failed ? "error" : "agent_message", message, { session: state })).catch(() => null);
  }
}
codex.onEvent(handleCodexEvent);

async function proxyPreview(req: IncomingMessage, res: ServerResponse, session: Session, pathname: string) {
  const query = new URL(req.url || "/", "http://local").searchParams;
  query.delete("token"); query.delete("refresh");
  const search = query.size ? `?${query}` : "";
  if (isolated && !remoteWorkspaces.get(session.id)?.running) { res.writeHead(503); res.end("Workspace paused. Refresh the preview from Build Studio to resume."); return; }
  const target = isolated ? remoteWorkspace(session).target : { origin: `http://127.0.0.1:${session.previewPort}`, authorization: "" };
  const upstream = await fetch(`${target.origin}${pathname}${search}`, { method: req.method || "GET", headers: { accept: String(req.headers.accept || "*/*"), ...(target.authorization ? { Authorization: target.authorization } : {}) }, signal: AbortSignal.timeout(30_000) });
  const excludedHeaders = new Set(["content-encoding", "content-length", "content-security-policy", "content-security-policy-report-only", "cross-origin-resource-policy", "x-frame-options"]);
  const responseHeaders = Object.fromEntries([...upstream.headers].filter(([key]) => !excludedHeaders.has(key.toLowerCase())));
  responseHeaders["Cache-Control"] = "no-store";
  responseHeaders["Content-Security-Policy"] = `frame-ancestors ${[...allowedOrigins].join(" ")}`;
  responseHeaders["Cross-Origin-Resource-Policy"] = "cross-origin";
  responseHeaders["Referrer-Policy"] = "no-referrer";
  responseHeaders["Set-Cookie"] = `n3xra_preview_${session.id}=${session.previewToken}; Path=/preview/${session.id}/; HttpOnly; SameSite=None; Secure; Partitioned`;
  const contentType = upstream.headers.get("content-type") || "";
  if (/text\/html|javascript|text\/css/.test(contentType)) {
    const prefix = `/preview/${session.id}/`;
    const content = (await upstream.text())
      .replace(/(["'`])\/(?!\/)([^"'`\s<>]*)/g, (match, quote: string, path: string) => path.startsWith(`preview/${session.id}/`) ? match : `${quote}${prefix}${path}`)
      .replace(/url\(\/(?!\/)([^)]+)\)/g, (match, path: string) => path.startsWith(`preview/${session.id}/`) ? match : `url(${prefix}${path})`);
    res.writeHead(upstream.status, responseHeaders);
    res.end(content);
    return;
  }
  res.writeHead(upstream.status, responseHeaders);
  if (upstream.body) await pipeline(upstream.body as any, res); else res.end();
}

function previewSession(req: IncomingMessage, url: URL) {
  const id = url.pathname.split("/")[2] || "";
  const session = sessions.get(id);
  if (!session) return null;
  const cookie = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`n3xra_preview_${id}=`))?.split("=")[1];
  return url.searchParams.get("token") === session.previewToken || cookie === session.previewToken ? session : null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://worker.local");
    if (req.method === "OPTIONS") { headers(res, 204); return res.end(); }
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin.replace(/\/$/, ""))) return json(res, 403, { error: "Origin not allowed." });
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/preview/")) {
      const session = previewSession(req, url);
      if (!session) return json(res, 404, { error: "Preview not found." });
      session.lastPreviewActivity = Date.now();
      return await proxyPreview(req, res, session, session.previewBasePath === "/" ? `/${url.pathname.split("/").slice(3).join("/")}` : url.pathname);
    }
    const user = await authenticate(req);
    if (url.pathname === "/v1/account" && req.method === "GET") {
      if (isolated) return json(res, 200, { ready: true, codexAuthenticated: false, requiresWorkspace: true });
      const account = await codex.account(); return json(res, 200, { ready: true, codexAuthenticated: Boolean(account.account), account: account.account ? { type: (account.account as Json).type } : null });
    }
    if (url.pathname === "/v1/account/connect" && req.method === "POST") {
      let result: Json;
      if (isolated) {
        const input = await body(req); const session = await recoverSession(user, String(input.sessionId || ""));
        if (!session) return json(res, 404, { error: "Open this website’s workspace before connecting Codex." });
        if (session.preparation) await session.preparation;
        session.lastPreviewActivity = Date.now(); result = await remoteWorkspace(session).rpc("account/login/start", { type: "chatgptDeviceCode" });
      } else result = await codex.connectChatGpt();
      const verification = new URL(String(result.verificationUrl || result.authUrl || ""));
      if (verification.protocol !== "https:" || verification.hostname !== "auth.openai.com") throw new Error("Codex returned an unexpected sign-in address.");
      return json(res, 200, { verificationUrl: result.verificationUrl || result.authUrl, userCode: result.userCode || result.code });
    }
    const activeProjectMatch = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/active$/);
    if (activeProjectMatch && req.method === "GET") return json(res, 200, await activeProject(user, activeProjectMatch[1] || ""));
    if (url.pathname === "/v1/projects/open" && req.method === "POST") { const input = await body(req); const session = await openProject(user, String(input.websiteId || "")); return json(res, 202, { session: publicSession(session) }); }
    const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)(?:\/(messages|checkpoint|push|events|pause|preview\/restart))?$/);
    if (!match) return json(res, 404, { error: "Not found." });
    const session = await recoverSession(user, match[1] || ""); if (!session) return json(res, 404, { error: "Build session not found." });
    const action = match[2] || "";
    if (action === "events" && req.method === "GET") {
      headers(res, 200, "text/event-stream"); res.write(": connected\n\n");
      const set = listeners.get(session.id) || new Set(); set.add(res); listeners.set(session.id, set);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
      res.once("close", () => { clearInterval(heartbeat); set.delete(res); if (!set.size) listeners.delete(session.id); });
      for (const event of await sessionEvents(session.id)) res.write(`data: ${JSON.stringify({ ...event, replay: true })}\n\n`);
      res.write(`data: ${JSON.stringify({ eventType: "session", metadata: { session: publicSession(session) } })}\n\n`);
      return;
    }
    if (session.preparation) await session.preparation;
    if (!action && req.method === "GET") return json(res, 200, { session: publicSession(session) });
    session.lastPreviewActivity = Date.now();
    if (session.state !== "ready") return json(res, 409, { error: session.state === "working" ? "Codex is still working. Wait for its reply." : "The workspace is not ready. Reopen Build Studio to retry." });
    if (action === "pause" && req.method === "POST") {
      if (session.previewStarting) return json(res, 409, { error: "Wait for preview preparation to finish before pausing." });
      session.state = "working";
      try {
        if (isolated) await remoteWorkspace(session).stop(); else await stopPreview(session);
        session.previewState = "offline"; session.state = "ready";
        await emit(session, "preview", "Workspace paused. Your files and conversation are saved.", { session: publicSession(session) });
        return json(res, 200, { session: publicSession(session) });
      } finally { session.state = "ready"; }
    }
    if (action === "messages" && req.method === "POST") {
      if (isolated && !session.codexAuthenticated) return json(res, 409, { error: "Connect Codex to this website’s workspace first." });
      const input = await body(req); const text = String(input.text || "").trim();
      if (!text) return json(res, 400, { error: "A build instruction is required." });
      // Reserve the session before any awaits so two requests cannot start overlapping turns.
      if (session.state !== "ready") return json(res, 409, { error: "Codex is still working." });
      session.state = "working";
      try {
        if (isolated) await remoteWorkspace(session).wake();
        await ensureThread(session);
        await emit(session, "user_message", text, { session: publicSession(session) });
        const guardrail = "Work only inside this repository. Do not commit, push, deploy, access secrets, or change files outside the current workspace. Make and verify the requested website changes.\n\n";
        const turn = await sessionCodex(session).startTurn(session.codexThreadId, session.cwd, `${guardrail}${text}`);
        if (session.state === "working") turnSessions.set(turn.turn.id, session.id);
        return json(res, 202, { accepted: true });
      } catch (error) {
        session.state = "ready";
        await emit(session, "error", String((error as Error).message), { session: await updateStatus(session) });
        throw error;
      }
    }
    if ((action === "checkpoint" || action === "push") && req.method === "POST") {
      // Reserve before reading the body or fetching credentials; exclude overlapping edits.
      session.state = "working";
      try {
        if (isolated) await remoteWorkspace(session).wake();
        if (action === "checkpoint") {
          const input = await body(req);
          await command("git", ["add", "--all"], session.cwd);
          await command("git", ["commit", "-m", String(input.message || "Build Studio checkpoint").slice(0, 120)], session.cwd);
        } else if (isolated) await remoteWorkspace(session).push(session.workingBranch, session.repositoryFullName, await githubInstallationToken(session.repositoryFullName));
        else await command("git", ["push", "-u", "origin", session.workingBranch], session.cwd, await gitEnvironment(session.id, session.repositoryFullName));
        session.state = "ready";
        const state = await updateStatus(session);
        await emit(session, action, action === "checkpoint" ? "Checkpoint saved to the branch." : "Branch pushed to GitHub.", { session: state });
        return json(res, 200, { session: state });
      } finally { session.state = "ready"; }
    }
    if (action === "preview/restart" && req.method === "POST") {
      if (session.previewStarting && session.previewState === "starting") return json(res, 202, { session: publicSession(session) });
      await session.previewStarting;
      session.previewState = "starting";
      void startPreview(session).catch(async (error) => {
        session.previewState = "failed";
        await emit(session, "error", error instanceof Error ? error.message : "The preview could not restart.", { session: publicSession(session) }).catch(() => null);
      });
      return json(res, 202, { session: publicSession(session) });
    }
    return json(res, 405, { error: "Method not allowed." });
  } catch (error) { json(res, /Authentication|required|expired|access/.test(String((error as Error).message)) ? 401 : 500, { error: error instanceof Error ? error.message : "Build worker error." }); }
});

// Vite/Astro hot reload uses a WebSocket on the same authenticated preview path.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://worker.local");
  const session = previewSession(req, url);
  if (!session || !url.pathname.startsWith("/preview/")) { socket.destroy(); return; }
  const origin = req.headers.origin;
  const publicOrigin = new URL(process.env.N3XRA_BUILD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).origin;
  if (origin && origin !== publicOrigin && !allowedOrigins.has(origin)) { socket.destroy(); return; }
  if (isolated && !remoteWorkspaces.get(session.id)?.running) { socket.destroy(); return; }
  const target = isolated ? remoteWorkspace(session).target : null;
  const endpoint = target ? new URL(target.origin) : null;
  const upstream = (endpoint ? httpsRequest : httpRequest)({ hostname: endpoint?.hostname || "127.0.0.1", port: endpoint ? 443 : session.previewPort, path: `${isolated ? url.pathname : session.previewUsesAstro ? `/${url.pathname.split("/").slice(3).join("/")}` : url.pathname}${url.search}`, headers: { ...req.headers, host: endpoint?.host || `127.0.0.1:${session.previewPort}`, cookie: "", authorization: target?.authorization || "" } });
  upstream.once("upgrade", (response, peer, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) peer.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    peer.on("error", () => socket.destroy()); socket.on("error", () => peer.destroy());
    socket.on("close", () => peer.destroy()); peer.on("close", () => socket.destroy());
    peer.pipe(socket); socket.pipe(peer);
  });
  upstream.once("response", () => { upstream.destroy(); socket.destroy(); });
  upstream.once("error", () => socket.destroy());
  upstream.setTimeout(10_000, () => upstream.destroy());
  upstream.end();
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(previewIdleTimer);
  for (const child of commandChildren) {
    try { killProcessGroup(child, "SIGKILL"); }
    catch (error) { console.error("Could not stop workspace command:", String(error)); }
  }
  for (const connections of listeners.values()) for (const response of connections) response.end();
  server.close();
  const stops = await Promise.allSettled(isolated ? [...remoteWorkspaces.values()].map(remote => remote.stop()) : [...sessions.values()].map(stopPreview));
  for (const result of stops) if (result.status === "rejected") console.error("Could not stop preview:", String(result.reason));
  codex.stop();
  process.exit(0);
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

void Promise.all([
  mkdir(workspaceRoot, { recursive: true }),
  mkdir(resolve(env.CODEX_HOME), { recursive: true }),
]).then(() => {
  server.listen(port, host, () => process.stdout.write(`N3XRA Build Worker listening on ${host}:${port}\n`));
});
