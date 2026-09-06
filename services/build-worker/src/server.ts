import { ConversationRepairs } from "./conversation-repair.js";
import { phonePagePath, inspectPhonePage } from "./phone-page";
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
import { gitCommitIdentity } from "./git-identity.js";
import { ConversationTurn, conversationSchema, readableError, redactNotes } from "./conversation.js";

import { verifyPhoneRequest } from "./phone-access.js";

import { organizeTasks } from "./task-history.js";
import { syncWorkingCopy, verifyRemoteHead } from "./workspace-sync.js";

type Json = Record<string, any>;
type Identity = { id: string; email?: string; phoneWebsiteId?: string; phoneCallId?: string };
type Session = {
  id: string; websiteId: string; userId: string; cwd: string; repositoryFullName: string;
  baseBranch: string; workingBranch: string; codexThreadId: string; previewPort: number;
  state: "preparing" | "ready" | "working" | "awaiting_approval" | "failed" | "stopped" | "archived";
  previewState: "offline" | "starting" | "ready" | "failed"; changedFileCount: number; previewToken: string; previewProcess?: ChildProcess; preparation?: Promise<void>; previewStarting?: Promise<void>; hasUnpushedCommits?: boolean; previewBasePath?: string; previewUsesAstro?: boolean; lastPreviewActivity?: number;
  codexAuthenticated?: boolean; progress?: string; progressDetail?: string; taskNeedsContext?: boolean; savedHead?: string; savedBranch?: string; operation?: "request" | "sync" | "close" | "publish" | "save"; activeTurnId?: string; cancelRequested?: boolean; syncIssue?: string; selectedModel?: string; selectedEffort?: string; models?: Json[];
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
const conversationTurns = new Map<string, ConversationTurn>();
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
    startTurn: (threadId: string, _cwd: string, text: string, _schema?: unknown, settings: Json = {}) => remote.rpc("turn/start", { threadId, approvalPolicy: "never", outputSchema: conversationSchema, ...settings, input: [{ type: "text", text }] }),
  };
}

async function codexRequest(session: Session, method: string, params: Json = {}) {
  if (isolated) return remoteWorkspace(session).rpc(method, params);
  await codex.start(); return codex.request<Json>(method, params);
}
async function modelCatalog(session: Session) {
  // Refresh the catalog so a resumed workspace runtime upgrade is immediately visible.
  const models: Json[] = []; let cursor: string | undefined;
  do {
    const page = await codexRequest(session, "model/list", { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) });
    models.push(...(page.data || [])); cursor = page.nextCursor || undefined;
  } while (cursor && models.length < 500);
  session.models = models.filter(item => !item.hidden).map(item => ({ model: item.model, displayName: item.displayName, isDefault: item.model === "gpt-5.6-sol", defaultReasoningEffort: item.defaultReasoningEffort, supportedReasoningEfforts: item.supportedReasoningEfforts || [] }));
  return session.models;
}
async function syncRepository(session: Session) {
  await prepareRepository(session);
  const auth = isolated ? { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: await githubInstallationToken(session.repositoryFullName) } : await gitEnvironment(session.id, session.repositoryFullName);
  let identity: NodeJS.ProcessEnv = {};
  try { identity = gitCommitIdentity(); } catch { /* Fast-forward sync does not need a commit author. */ }
  await syncWorkingCopy(args => command("git", args, session.cwd, { ...auth, ...identity }), session.baseBranch, session.workingBranch);
  session.syncIssue = "";
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
const requestBodies = new WeakMap<IncomingMessage, string>();
async function rawBody(req: IncomingMessage) {
  if (requestBodies.has(req)) return requestBodies.get(req)!;
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 64 * 1024) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
  const raw = Buffer.concat(chunks).toString("utf8"); requestBodies.set(req, raw); return raw;
}
async function body(req: IncomingMessage) { const raw = await rawBody(req); return raw ? JSON.parse(raw) as Json : {}; }
function safePath(path: string) { const output = resolve(path); if (output !== workspaceRoot && !output.startsWith(`${workspaceRoot}${sep}`)) throw new Error("Unsafe workspace path."); return output; }
function bearer(req: IncomingMessage) { return String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); }

async function supabase(path: string, options: RequestInit = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, { ...options, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(options.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error_description || `Supabase returned ${response.status}.`);
  return data;
}

async function authenticate(req: IncomingMessage): Promise<Identity> {
  const phoneHeader = String(req.headers.authorization || "");
  if (phoneHeader.startsWith("N3XRA-Phone ")) {
    if (process.env.N3XRA_PHONE_BUILD_ENABLED !== "true") throw new Error("Phone access is disabled.");
    const user = verifyPhoneRequest(phoneHeader.slice(12), req.method || "GET", req.url || "/", await rawBody(req),
      process.env.N3XRA_PHONE_BUILD_SECRET || "", process.env.N3XRA_PHONE_BUILD_WEBSITE_ID || "");
    // Phone privileges are deliberately narrower than dashboard administrator privileges.
    const admins = await supabase(`/rest/v1/platform_admins?user_id=eq.${user.id}&status=eq.active&role=eq.owner&select=user_id&limit=1`);
    const credentials = await supabase(`/rest/v1/account_phone_credentials?user_id=eq.${user.id}&select=last_authenticated_at,locked_until&limit=1`);
    const profiles = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=account_status&limit=1`);
    const credential = credentials?.[0];
    const verifiedAt = Date.parse(credential?.last_authenticated_at || "");
    if (!admins?.length || !profiles?.length || !["active", "trialing"].includes(profiles[0].account_status || "active")
      || !Number.isFinite(verifiedAt) || verifiedAt < Date.now() - 15 * 60_000 || verifiedAt > Date.now() + 5000
      || Date.parse(credential?.locked_until || "") > Date.now()) throw new Error("Verified owner phone access required.");
    return user;
  }
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

function broadcast(session: Session, event: Json) {
  listeners.get(session.id)?.forEach((res) => res.write(`data: ${JSON.stringify(event)}\n\n`));
}
function progress(session: Session, message: string, detail = "") {
  if (session.progress === message && session.progressDetail === detail) return;
  session.progress = message; session.progressDetail = redactNotes(detail);
  broadcast(session, { eventType: "progress", message, metadata: { session: publicSession(session) } });
}
async function emit(session: Session, eventType: string, message = "", metadata: Json = {}, technicalNotes = "") {
  if (eventType === "error") {
    technicalNotes = [technicalNotes, message].filter(Boolean).join("\n\n");
    message = readableError(message);
  }
  technicalNotes = redactNotes(technicalNotes);
  metadata = { ...metadata, conversationVersion: 2, ...(session.codexThreadId ? { taskThreadId: session.codexThreadId } : {}) };
  const rows = await supabase("/rest/v1/website_build_events", { method: "POST", body: JSON.stringify({ session_id: session.id, website_id: session.websiteId, actor_user_id: session.userId, event_type: eventType, message: message || null, technical_notes: technicalNotes || null, metadata }) });
  const event = Array.isArray(rows) ? rows[0] : {};
  broadcast(session, { id: event.id, eventType, message, technicalNotes, metadata });
}

function publicSession(session: Session) {
  const publicUrl = process.env.N3XRA_BUILD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  return { id: session.id, state: session.state, canClose: Boolean(session.savedHead && session.state === "ready" && !session.changedFileCount && !session.hasUnpushedCommits), cancellable: session.operation === "request" && !session.cancelRequested, syncIssue: session.syncIssue || "", selectedModel: session.selectedModel || "", selectedEffort: session.selectedEffort || "", progressDetail: session.state === "working" ? session.progressDetail || "" : "", progress: session.state === "working" ? session.progress || "Working on your request…" : "", workingBranch: session.workingBranch, previewUrl: `${String(publicUrl).replace(/\/$/, "")}/preview/${session.id}/?token=${session.previewToken}`, previewState: session.previewState, changedFileCount: session.changedFileCount, hasUnpushedCommits: Boolean(session.hasUnpushedCommits), ...(isolated ? { codexAuthenticated: Boolean(session.codexAuthenticated) } : {}) };
}

async function storedEvents(sessionId: string): Promise<Json[]> {
  const events: Json[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await supabase(`/rest/v1/website_build_events?session_id=eq.${encodeURIComponent(sessionId)}&select=id,event_type,message,technical_notes,metadata,created_at&order=created_at.asc,id.asc&limit=500&offset=${offset}`);
    if (!Array.isArray(rows)) break;
    events.push(...rows);
    if (rows.length < 500) break;
  }
  return events;
}
async function sessionEvents(sessionId: string) {
  const events = await storedEvents(sessionId);
  const grouped = organizeTasks(events as any);
  return events.map(event => ({ id: event.id, history: grouped.eventTasks.get(event.id) !== grouped.currentId, eventType: event.event_type, message: event.message, technicalNotes: event.technical_notes, metadata: event.metadata || {} }));
}
async function savedTasks(user: Identity, websiteId: string) {
  // Database-only history lookup: never recover or wake a workspace to browse tasks.
  const rows = await supabase(`/rest/v1/website_build_sessions?website_id=eq.${encodeURIComponent(websiteId)}&created_by_user_id=eq.${encodeURIComponent(user.id)}&archived_at=is.null&select=id&order=created_at.desc&limit=1`);
  if (!rows?.[0]) return { tasks: [] };
  const grouped = organizeTasks(await storedEvents(rows[0].id) as any);
  return { tasks: grouped.tasks.map(({ threadId, ...task }) => task) };
}

async function updateStatus(session: Session) {
  const value = await command("git", ["status", "--short"], session.cwd);
  const remote = await command("git", ["branch", "-r", "--list", `origin/${session.workingBranch}`], session.cwd);
  const upstream = remote ? `origin/${session.workingBranch}` : `origin/${session.baseBranch}`;
  session.hasUnpushedCommits = Number(await command("git", ["rev-list", "--count", `${upstream}..HEAD`], session.cwd)) > 0;
  session.changedFileCount = value ? value.split("\n").length : 0;
  if (session.savedHead && (session.changedFileCount || session.hasUnpushedCommits || (await command("git", ["rev-parse", "HEAD"], session.cwd)).trim() !== session.savedHead)) { delete session.savedHead; delete session.savedBranch; }
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
  const remoteWork = await command("git", ["ls-remote", "--heads", "origin", session.workingBranch], session.cwd, gitEnv);
  if (remoteWork) await command("git", ["fetch", "origin", `${session.workingBranch}:refs/remotes/origin/${session.workingBranch}`], session.cwd, gitEnv);
  if (branches) await command("git", ["checkout", session.workingBranch], session.cwd);
  else await command("git", ["checkout", "-b", session.workingBranch, `origin/${remoteWork ? session.workingBranch : session.baseBranch}`], session.cwd);
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
    await remote.rpc("preview/start", { cmd: manager, args, astro: session.previewUsesAstro });
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
  session.taskNeedsContext = true;
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
        session.state = "working"; session.operation = "request"; session.activeTurnId = String(status.activeTurn.turnId);
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
    try { await syncRepository(session); }
    catch (error) { session.syncIssue = readableError(String(error)); await emit(session, "error", String(error)); }
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

function openProject(user: Identity, websiteId: string, taskId = ""): Promise<Session> {
  const key = JSON.stringify([user.id, websiteId]);
  const existing = opening.get(key); if (existing) return existing;
  const task = openProjectOnce(user, websiteId, taskId).finally(() => opening.delete(key));
  opening.set(key, task); return task;
}
async function openProjectOnce(user: Identity, websiteId: string, taskId = ""): Promise<Session> {
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
    if (taskId && previous.state !== "stopped") throw new Error("Close your current project before reopening a saved task.");
    const selectedTask = taskId ? organizeTasks(await storedEvents(String(previous.id)) as any).tasks.find(task => task.id === taskId) : undefined;
    if (taskId && !selectedTask) throw new Error("Saved task not found for this website.");
    if (previous.state === "stopped") {
      // A deliberate reopen starts a new conversation; recovery of an open session does not.
      await supabase("/rest/v1/website_build_events", { method: "POST", body: JSON.stringify({ session_id: previous.id, website_id: websiteId, actor_user_id: user.id, event_type: "status", message: selectedTask ? `Reopening task: ${selectedTask.title}. Syncing the latest GitHub files.` : "New conversation. Syncing your saved workspace with GitHub.", metadata: { conversationVersion: 2, conversationStart: true, taskId: selectedTask?.id || randomUUID() } }) });
      await supabase(`/rest/v1/website_build_sessions?id=eq.${encodeURIComponent(String(previous.id))}`, { method: "PATCH", body: JSON.stringify({ codex_thread_id: selectedTask?.threadId || null }) });
      if (existing) existing.codexThreadId = selectedTask?.threadId || "";
    }
    if (!existing) {
      await supabase(`/rest/v1/website_build_sessions?id=eq.${encodeURIComponent(String(previous.id))}`, { method: "PATCH", body: JSON.stringify({ state: "preparing", error_message: null }) });
      existing = await recoverSession(user, String(previous.id)) || undefined;
    } else if (["failed", "stopped"].includes(existing.state)) void prepareProject(existing);
    if (existing) return existing;
    throw new Error("The saved workspace could not be recovered. Your saved files have not been deleted.");
  }
  if (taskId) throw new Error("Saved task not found for this website.");
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
  if (["failed", "stopped"].includes(String(row.state))) return { session: null, events: [], closed: row.state === "stopped" };
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
    const choices = await supabase(`/rest/v1/website_build_events?session_id=eq.${session.id}&event_type=eq.user_message&select=metadata&order=id.desc&limit=1`);
    if (choices?.[0]?.metadata?.model) session.selectedModel = String(choices[0].metadata.model);
    if (choices?.[0]?.metadata?.effort) session.selectedEffort = String(choices[0].metadata.effort);
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
      session.state = "ready"; session.progress = ""; delete session.operation; delete session.activeTurnId; session.cancelRequested = false;
      const detail = String(params.message || "Codex disconnected");
      void updateStatus(session).catch(() => publicSession(session)).then((state) => emit(session, "error", "The builder was disconnected before finishing.", { session: state }, detail)).catch(() => broadcast(session, { eventType: "error", message: readableError(detail), metadata: { session: publicSession(session) } }));
    }
    if (!sourceSessionId) { turnSessions.clear(); conversationTurns.clear(); }
    else for (const [turnId, sessionId] of turnSessions) if (sessionId === sourceSessionId) { turnSessions.delete(turnId); conversationTurns.delete(turnId); }
    return;
  }
  const turn = params.turn as Json | undefined;
  const turnId = String(params.turnId || turn?.id || "");
  const sessionId = turnSessions.get(turnId);
  const session = (sessionId ? sessions.get(sessionId) : null) || [...sessions.values()].find((item) => item.codexThreadId === params.threadId && item.state === "working");
  if (!session) return;
  if (sourceSessionId && session.id !== sourceSessionId) return;
  if (!turnId) return;
  let conversation = conversationTurns.get(turnId);
  if (!conversation) { conversation = new ConversationTurn(); conversationTurns.set(turnId, conversation); }
  if (method === "item/agentMessage/delta") conversation.delta(String(params.itemId || ""), String(params.delta || ""));
  if (method === "item/started" || method === "item/completed") {
    const update = conversation.item(params.item || {}, method === "item/completed");
    if (update && !session.cancelRequested) progress(session, update, JSON.stringify(params.item || {}));
  }
  if (method === "turn/completed") {
    for (const item of turn?.items || []) conversation.item(item, true);
    const cancelled = turn?.status === "interrupted" && session.cancelRequested;
    const failed = turn?.status !== "completed" && !cancelled;
    const failure = failed ? String(turn?.error?.message || "The builder was interrupted before finishing.") : undefined;
    const result = conversation.finish(failure);
    if (cancelled) result.message = "Request canceled. Any changes already made are still here for you to review.";
    conversationTurns.delete(turnId); turnSessions.delete(turnId); delete session.operation; delete session.activeTurnId;
    progress(session, "Finishing the update…");
    session.lastPreviewActivity = Date.now();
    void (async () => {
      let diagnostics = result.technicalNotes;
      try { await updateStatus(session); }
      catch (error) { diagnostics += `\nChange check failed: ${String(error)}`; result.message += " I couldn’t refresh the list of changed files. Refresh before saving."; }
      session.state = "ready"; session.progress = ""; delete session.operation; delete session.activeTurnId; session.cancelRequested = false;
      await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ state: "ready" }) }).catch(() => null);
      await emit(session, failed ? "error" : "agent_message", result.message, { session: publicSession(session) }, diagnostics);
    })().catch(() => broadcast(session, { eventType: "error", message: "Your reply could not be saved. Refresh before continuing.", metadata: { session: publicSession(session) } }));
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

const repairs = new ConversationRepairs(supabase, githubInstallationToken, workspaceRoot);
const repairRecovery = isolated ? repairs.recover().catch(error => { console.error("Repair recovery unavailable:", redactNotes(String(error))); throw error; }) : Promise.resolve();
void repairRecovery.catch(() => undefined);

const server = createServer(async (req, res) => {
  let requestSession: Session | undefined;
  try {
    const url = new URL(req.url || "/", "http://worker.local");
    if (req.method === "OPTIONS") { headers(res, 204); return res.end(); }
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin.replace(/\/$/, ""))) return json(res, 403, { error: "Origin not allowed." });
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, commit: process.env.RENDER_GIT_COMMIT || null });
    if (url.pathname.startsWith("/preview/")) {
      const session = previewSession(req, url);
      if (!session || session.state === "stopped") return json(res, 404, { error: "Preview not found. Open the workspace first." });
      session.lastPreviewActivity = Date.now();
      return await proxyPreview(req, res, session, session.previewBasePath === "/" ? `/${url.pathname.split("/").slice(3).join("/")}` : url.pathname);
    }
    const user = await authenticate(req);
    const repairMatch = url.pathname.match(/^\/v1\/conversation-repairs(?:\/(start|stop|connect))?$/);
    if (repairMatch) {
      if (user.phoneWebsiteId || !isolated) return json(res, 403, { error: "Conversation repairs require owner dashboard access and the isolated builder." });
      await repairRecovery;
      try { return json(res, 200, await repairs.handle(user.id, req.method || "GET", repairMatch[1] || "", req.method === "GET" ? Object.fromEntries(url.searchParams) : await body(req))); }
      catch (error) { return json(res, 409, { error: redactNotes(String((error as Error).message)) }); }
    }
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
    const tasksMatch = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/tasks$/);
    if (tasksMatch && req.method === "GET") return json(res, 200, await savedTasks(user, tasksMatch[1]!));
    const activeProjectMatch = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/active$/);
    if (activeProjectMatch && user.phoneWebsiteId && activeProjectMatch[1] !== user.phoneWebsiteId) throw new Error("Phone website access denied.");
    if (activeProjectMatch && req.method === "GET") return json(res, 200, await activeProject(user, activeProjectMatch[1] || ""));
    if (url.pathname === "/v1/projects/open" && req.method === "POST") { const input = await body(req); if (user.phoneWebsiteId && (input.websiteId !== user.phoneWebsiteId || input.taskId)) throw new Error("Phone website access denied."); const session = await openProject(user, String(input.websiteId || ""), String(input.taskId || "")); return json(res, 202, { session: publicSession(session) }); }
    const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)(?:\/(messages|checkpoint|push|events|pause|close|save|publish|sync|cancel|models|phone-status|phone-page|preview\/restart))?$/);
    if (!match) return json(res, 404, { error: "Not found." });
    if (user.phoneWebsiteId) {
      // Check tenancy before recovery can start a machine or touch another repository.
      const owned = await supabase(`/rest/v1/website_build_sessions?id=eq.${match[1]}&website_id=eq.${user.phoneWebsiteId}&created_by_user_id=eq.${user.id}&archived_at=is.null&select=id&limit=1`);
      if (!owned?.length) throw new Error("Phone workspace access denied.");
    }
    const session = await recoverSession(user, match[1] || ""); if (!session) return json(res, 404, { error: "Build session not found." });
    requestSession = session;
    const action = match[2] || "";
    if (action === "phone-page" && req.method === "POST") {
      const input = await body(req); const path = phonePagePath(input.path);
      if (session.previewState !== "ready" || (isolated && !remoteWorkspaces.get(session.id)?.running)) return json(res, 409, { error: "Open the live preview before inspecting it." });
      const target = isolated ? remoteWorkspace(session).target : { origin: `http://127.0.0.1:${session.previewPort}`, authorization: "" };
      const pathname = session.previewBasePath === "/" ? path : `/preview/${session.id}${path}`;
      return json(res, 200, await inspectPhonePage(target.origin, target.authorization, pathname, path));
    }
    if (action === "phone-status" && req.method === "GET") {
      // Read progress before awaiting preparation; polling must not renew workspace lifetime.
      const recent = await supabase(`/rest/v1/website_build_events?session_id=eq.${session.id}&select=id,event_type,message,metadata&order=created_at.desc,id.desc&limit=50`);
      let latestReply = null;
      for (const event of recent || []) {
        if (event.metadata?.conversationStart || event.event_type === "user_message") break;
        if (["agent_message", "error"].includes(event.event_type)) { latestReply = { id: event.id, message: event.message }; break; }
      }
      const state = publicSession(session);
      return json(res, 200, { session: { id: state.id, state: state.state, progress: state.progress,
        previewState: state.previewState, cancellable: state.cancellable, canClose: state.canClose,
        codexAuthenticated: state.codexAuthenticated, changedFileCount: state.changedFileCount }, latestReply });
    }
    if (action === "events" && req.method === "GET") {
      headers(res, 200, "text/event-stream"); res.write(": connected\n\n");
      const set = listeners.get(session.id) || new Set(); set.add(res); listeners.set(session.id, set);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
      res.once("close", () => { clearInterval(heartbeat); set.delete(res); if (!set.size) listeners.delete(session.id); });
      for (const event of await sessionEvents(session.id)) res.write(`data: ${JSON.stringify({ ...event, replay: true })}\n\n`);
      res.write(`data: ${JSON.stringify({ eventType: "session", metadata: { session: publicSession(session) } })}\n\n`);
      return;
    }
    if (action === "cancel" && req.method === "POST") {
      if (session.operation !== "request") return json(res, 409, { error: "There is no active request to cancel." });
      session.cancelRequested = true;
      progress(session, "Canceling your request…");
      if (session.activeTurnId) {
        try { await codexRequest(session, "turn/interrupt", { threadId: session.codexThreadId, turnId: session.activeTurnId }); }
        catch (error) { session.cancelRequested = false; throw error; }
      }
      return json(res, 202, { session: publicSession(session) });
    }
    if (session.preparation) await session.preparation;
    if (action === "models" && req.method === "GET") {
      if (session.state === "stopped") return json(res, 409, { error: "Open the workspace first." });
      return json(res, 200, { models: await modelCatalog(session) });
    }
    if (!action && req.method === "GET") return json(res, 200, { session: publicSession(session) });
    session.lastPreviewActivity = Date.now();
    if (session.state !== "ready") return json(res, 409, { error: session.state === "working" ? "Codex is still working. Wait for its reply." : "The workspace is not ready. Reopen Build Studio to retry." });
    if ((action === "save" || action === "sync" || action === "publish") && req.method === "POST") {
      delete session.savedHead; delete session.savedBranch;
      session.state = "working"; session.operation = action;
      progress(session, action !== "sync" ? "Saving your work…" : "Checking GitHub for changes…");
      try {
        if (session.previewStarting) await session.previewStarting;
        if (isolated) await remoteWorkspace(session).wake();
        const identity = gitCommitIdentity();
        if (action !== "sync" && (await command("git", ["status", "--porcelain"], session.cwd)).trim()) {
          await command("git", ["add", "--all"], session.cwd);
          await command("git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", action === "publish" ? "Save Build Studio work for publishing" : "Save Build Studio work"], session.cwd, identity);
        }
        progress(session, "Syncing with GitHub…");
        await syncRepository(session);
        if (action === "sync") {
          session.state = "ready"; delete session.operation;
          await emit(session, "status", "Workspace synced with GitHub.", { session: await updateStatus(session) });
          void startPreview(session).catch(error => emit(session, "error", String(error), { session: publicSession(session) }));
          return json(res, 200, { session: publicSession(session) });
        }
        const publishAuth = isolated ? { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: await githubInstallationToken(session.repositoryFullName) } : await gitEnvironment(session.id, session.repositoryFullName);
        if (action === "publish") {
          progress(session, "Checking the latest main branch…");
          // Fetch the exact existing main branch; never create a missing main silently.
          await command("git", ["fetch", "origin", "refs/heads/main:refs/remotes/origin/main"], session.cwd, publishAuth);
          await syncWorkingCopy(args => command("git", args, session.cwd, { ...publishAuth, ...identity }), "main", session.workingBranch);
        }
        progress(session, "Pushing your changes to GitHub…");
        if (isolated) await remoteWorkspace(session).push(session.workingBranch, session.repositoryFullName, await githubInstallationToken(session.repositoryFullName));
        else await command("git", ["push", "-u", "origin", session.workingBranch], session.cwd, await gitEnvironment(session.id, session.repositoryFullName));
        const auth = isolated ? { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: await githubInstallationToken(session.repositoryFullName) } : await gitEnvironment(session.id, session.repositoryFullName);
        const head = await verifyRemoteHead(args => command("git", args, session.cwd, auth), session.workingBranch);
        await updateStatus(session);
        if (action === "publish") {
          progress(session, "Publishing to main…");
          // A normal push rejects concurrent main changes and respects branch protection.
          await command("git", ["push", "origin", "HEAD:refs/heads/main"], session.cwd, publishAuth);
          const publishedHead = await verifyRemoteHead(args => command("git", args, session.cwd, publishAuth), "main");
          session.savedHead = publishedHead; session.savedBranch = "main";
          session.state = "ready"; delete session.operation; delete session.syncIssue;
          await emit(session, "push", "Published to main on GitHub. Your connected hosting service handles deployment next.", { session: await updateStatus(session), commit: publishedHead, branch: "main" });
          return json(res, 200, { session: publicSession(session) });
        }
        session.savedHead = head; session.savedBranch = session.workingBranch;
        session.state = "ready"; delete session.operation; delete session.syncIssue;
        await emit(session, "push", "Saved to your working branch on GitHub. You can now close the project.", { session: await updateStatus(session), commit: head, branch: session.workingBranch });
        return json(res, 200, { session: publicSession(session) });
      } catch (error) {
        session.state = "ready"; delete session.operation; session.syncIssue = readableError(String(error));
        await updateStatus(session).catch(() => null);
        await emit(session, "error", String(error), { session: publicSession(session) });
        return json(res, 409, { error: readableError(String(error)), session: publicSession(session) });
      }
    }
    if (action === "close" && req.method === "POST") {
      if (!session.savedHead || !session.savedBranch) return json(res, 409, { error: "Save your work before closing the project." });
      session.state = "working"; session.operation = "close";
      progress(session, "Verifying your saved work…");
      try {
        if (session.previewStarting) await session.previewStarting;
        if (isolated) await remoteWorkspace(session).wake();
        const auth = isolated ? { GIT_ASKPASS: "/vercel/.n3xra/askpass.sh", GIT_TERMINAL_PROMPT: "0", N3XRA_GITHUB_TOKEN: await githubInstallationToken(session.repositoryFullName) } : await gitEnvironment(session.id, session.repositoryFullName);
        const head = await verifyRemoteHead(args => command("git", args, session.cwd, auth), session.savedBranch);
        if (head !== session.savedHead) throw new Error("Close found changes since your last save. Save again before closing.");
        progress(session, "Closing your workspace…");
        if (isolated) await remoteWorkspace(session).stop(); else await stopPreview(session);
        await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ state: "stopped", preview_state: "offline", changed_file_count: 0 }) });
        session.state = "stopped"; session.previewState = "offline"; delete session.operation;
        delete session.savedHead; delete session.savedBranch;
        await emit(session, "status", "Project closed. Your work is saved on GitHub.", { session: publicSession(session) });
        return json(res, 200, { session: publicSession(session) });
      } catch (error) {
        session.state = "ready"; delete session.operation; delete session.savedHead; delete session.savedBranch;
        await updateStatus(session).catch(() => null);
        await emit(session, "error", String(error), { session: publicSession(session) });
        return json(res, 409, { error: readableError(String(error)), session: publicSession(session) });
      }
    }
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
      if (session.syncIssue) return json(res, 409, { error: session.syncIssue });
      delete session.savedHead; delete session.savedBranch;
      session.state = "working"; session.operation = "request"; session.cancelRequested = false;
      progress(session, "Opening your workspace…");
      try {
        if (isolated) await remoteWorkspace(session).wake();
        const models = await modelCatalog(session);
        const requested = String(input.model || "gpt-5.6-sol");
        const model = models.find(item => item.model === requested) || (!requested ? models.find(item => item.isDefault) || models[0] : undefined);
        if (!model) throw new Error("The selected model is unavailable. Choose another model.");
        const effort = String(input.effort || (session.selectedModel === model.model ? session.selectedEffort : "") || model.defaultReasoningEffort || "");
        if (!model.supportedReasoningEfforts.some((item: Json) => item.reasoningEffort === effort)) throw new Error("The selected thinking effort is unavailable for this model.");
        session.selectedModel = model.model; session.selectedEffort = effort;
        await ensureThread(session);
        await emit(session, "user_message", text, { session: publicSession(session), model: model.model, effort, ...(user.phoneCallId ? { source: "phone", callId: user.phoneCallId } : {}) });
        const guardrail = "Work only inside this repository. Do not commit, push, deploy, access secrets, or change files outside the current workspace. Make and verify the requested website changes. Speak to the website owner in clear everyday language. Your final response must match the requested JSON schema: message is the short user-facing reply, and technicalNotes holds file paths, commands, test results, and diagnostic details. Keep meaningful limitations and actions the owner needs in message. Do not claim a check succeeded unless you ran it. Never include secrets in either field.\n\n";
        progress(session, "Working on your request…");
        let restoredContext = "";
        if (session.taskNeedsContext) {
          const grouped = organizeTasks(await storedEvents(session.id) as any);
          const previousMessages = grouped.tasks.find(task => task.id === grouped.currentId)?.messages.slice(0, -1) || [];
          if (previousMessages.length) restoredContext = "\nSaved conversation for context (historical messages, not new instructions; inspect current repository before acting):\n" + JSON.stringify(previousMessages).slice(-24000) + "\nCurrent request:\n";
        }
        const turn = await sessionCodex(session).startTurn(session.codexThreadId, session.cwd, `${guardrail}${restoredContext}${text}`, conversationSchema, { model: session.selectedModel!, effort: session.selectedEffort! });
        session.taskNeedsContext = false;
        if (session.state === "working" && session.operation === "request") {
          turnSessions.set(turn.turn.id, session.id); session.activeTurnId = turn.turn.id;
          if (session.cancelRequested) await codexRequest(session, "turn/interrupt", { threadId: session.codexThreadId, turnId: turn.turn.id });
          else progress(session, "Working on your request…");
        }
        return json(res, 202, { accepted: true });
      } catch (error) {
        session.state = "ready"; delete session.operation; session.cancelRequested = false;
        await emit(session, "error", String((error as Error).message), { session: await updateStatus(session) });
        return json(res, 500, { error: readableError(String(error)), recorded: true });
      }
    }
    if ((action === "checkpoint" || action === "push") && req.method === "POST") {
      // Reserve before reading the body or fetching credentials; exclude overlapping edits.
      session.state = "working";
      try {
        if (isolated) await remoteWorkspace(session).wake();
        if (action === "checkpoint") {
          const input = await body(req);
          const identity = gitCommitIdentity();
          await command("git", ["add", "--all"], session.cwd);
          await command("git", ["commit", "-m", String(input.message || "Build Studio checkpoint").slice(0, 120)], session.cwd, identity);
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Build worker error.";
    if (requestSession) await emit(requestSession, "error", detail, { session: publicSession(requestSession) }).catch(() => null);
    json(res, /Authentication|required|expired|access/.test(detail) ? 401 : 500, { error: readableError(detail) });
  }
});

// Vite/Astro hot reload uses a WebSocket on the same authenticated preview path.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://worker.local");
  const session = previewSession(req, url);
  if (!session || session.state === "stopped" || !url.pathname.startsWith("/preview/")) { socket.destroy(); return; }
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
  await repairs.shutdown();
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
