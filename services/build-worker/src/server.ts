import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createSign, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { CodexAppServer } from "./codex-app-server.js";

type Json = Record<string, any>;
type Identity = { id: string; email?: string };
type Session = {
  id: string; websiteId: string; userId: string; cwd: string; repositoryFullName: string;
  baseBranch: string; workingBranch: string; codexThreadId: string; previewPort: number;
  state: "preparing" | "ready" | "working" | "awaiting_approval" | "failed" | "stopped" | "archived";
  previewState: "offline" | "starting" | "ready" | "failed"; changedFileCount: number; previewToken: string; previewProcess?: ChildProcess;
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
const sessions = new Map<string, Session>();
const listeners = new Map<string, Set<ServerResponse>>();
const turnSessions = new Map<string, string>();
const partialMessages = new Map<string, string>();

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
  return new Promise<string>((resolveCommand, reject) => {
    const child = spawn(commandName, args, { cwd: safePath(cwd), env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolveCommand(stdout.trim()) : reject(new Error((stderr || stdout || `${commandName} failed`).trim().slice(-2000))));
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
  return { id: session.id, state: session.state, workingBranch: session.workingBranch, previewUrl: `${String(publicUrl).replace(/\/$/, "")}/preview/${session.id}/?token=${session.previewToken}`, previewState: session.previewState, changedFileCount: session.changedFileCount };
}

async function sessionEvents(sessionId: string) {
  const rows = await supabase(`/rest/v1/website_build_events?session_id=eq.${encodeURIComponent(sessionId)}&select=id,event_type,message,metadata,created_at&order=created_at.asc,id.asc`);
  return (Array.isArray(rows) ? rows : []).map((event: Json) => ({ id: event.id, eventType: event.event_type, message: event.message, metadata: event.metadata || {} }));
}

async function updateStatus(session: Session) {
  const value = await command("git", ["status", "--short"], session.cwd);
  session.changedFileCount = value ? value.split("\n").length : 0;
  await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ changed_file_count: session.changedFileCount, preview_state: session.previewState, last_activity_at: new Date().toISOString() }) });
  return publicSession(session);
}

async function prepareRepository(session: Session) {
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
  if (session.previewProcess) {
    session.previewProcess.removeAllListeners("exit");
    session.previewProcess.kill("SIGTERM");
  }
  session.previewState = "starting";
  const packageJson = JSON.parse(await readFile(join(session.cwd, "package.json"), "utf8")) as Json;
  const packageManager = existsSync(join(session.cwd, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(session.cwd, "yarn.lock")) ? "yarn" : "npm";
  if (!existsSync(join(session.cwd, "node_modules"))) {
    await emit(session, "status", "Installing the website dependencies. The first preview can take a minute.", { session: publicSession(session) });
    if (packageManager === "npm") {
      const installArgs = existsSync(join(session.cwd, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"];
      try {
        await command("npm", installArgs, session.cwd);
      } catch (error) {
        if (installArgs[0] !== "ci") throw error;
        await command("npm", ["install", "--package-lock=false", "--no-audit", "--no-fund"], session.cwd);
      }
    } else {
      await command(packageManager, ["install", "--frozen-lockfile"], session.cwd);
    }
  }
  await emit(session, "status", "Starting the private live preview.", { session: publicSession(session) });
  const script = packageJson.scripts?.dev ? "dev" : packageJson.scripts?.start ? "start" : "preview";
  const args = packageManager === "npm" ? ["run", script, "--", "--host", "127.0.0.1", "--port", String(session.previewPort)] : [script, "--host", "127.0.0.1", "--port", String(session.previewPort)];
  const previewProcess = spawn(packageManager, args, { cwd: session.cwd, env: { ...process.env, BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"] });
  session.previewProcess = previewProcess;
  let previewReady = false;
  const ready = (chunk: Buffer) => {
    if (!previewReady && /localhost|127\.0\.0\.1|ready|started/i.test(chunk.toString())) {
      previewReady = true;
      session.previewState = "ready";
      void updateStatus(session).then((state) => emit(session, "preview", "Live preview is ready.", { session: state }));
    }
  };
  previewProcess.stdout?.on("data", ready); previewProcess.stderr?.on("data", ready);
  previewProcess.once("exit", () => {
    if (session.previewProcess !== previewProcess) return;
    session.previewState = "failed";
    void emit(session, "error", "The preview process stopped.", { session: publicSession(session) });
  });
}

async function prepareProject(session: Session) {
  try {
    await emit(session, "status", "Opening the connected GitHub repository.", { session: publicSession(session) });
    await prepareRepository(session);
    if (!sessions.has(session.id)) return;
    await emit(session, "status", "Starting the secure Codex workspace.", { session: publicSession(session) });
    if (!session.codexThreadId) session.codexThreadId = await codex.startThread(session.cwd);
    if (!sessions.has(session.id)) return;
    session.state = "ready";
    await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ codex_thread_id: session.codexThreadId, state: session.state, preview_state: "starting", error_message: null, last_activity_at: new Date().toISOString() }) });
    await emit(session, "session", `Build workspace opened on ${session.workingBranch}.`, { session: publicSession(session) });
    await startPreview(session);
    await updateStatus(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The build workspace could not be prepared.";
    session.state = "failed";
    session.previewState = "failed";
    await supabase(`/rest/v1/website_build_sessions?id=eq.${session.id}`, { method: "PATCH", body: JSON.stringify({ state: session.state, preview_state: session.previewState, error_message: message, last_activity_at: new Date().toISOString() }) }).catch(() => null);
    await emit(session, "error", message, { session: publicSession(session) }).catch(() => null);
  }
}

async function openProject(user: Identity, websiteId: string) {
  const websites = await supabase(`/rest/v1/client_websites?id=eq.${encodeURIComponent(websiteId)}&select=id,name,organization_id`);
  const repositories = await supabase(`/rest/v1/website_repositories?website_id=eq.${encodeURIComponent(websiteId)}&provider=eq.github&select=full_name,default_branch&order=created_at.desc&limit=1`);
  const website = websites?.[0], repository = repositories?.[0];
  if (!website) throw new Error("Website not found."); if (!repository) throw new Error("Connect a GitHub repository before starting Build Studio.");
  await supabase(`/rest/v1/website_build_sessions?website_id=eq.${websiteId}&created_by_user_id=eq.${user.id}&archived_at=is.null`, { method: "PATCH", body: JSON.stringify({ state: "archived", archived_at: new Date().toISOString() }) });
  for (const [sessionId, existing] of sessions) {
    if (existing.websiteId !== websiteId || existing.userId !== user.id) continue;
    existing.state = "archived";
    existing.previewProcess?.kill("SIGTERM");
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
  let session = sessions.get(String(row.id));
  if (!session) {
    session = {
      id: String(row.id), websiteId: String(row.website_id), userId: String(row.created_by_user_id),
      cwd: safePath(join(workspaceRoot, String(row.website_id), String(row.id), "repository")),
      repositoryFullName: String(row.repository_full_name), baseBranch: String(row.base_branch || "main"),
      workingBranch: String(row.working_branch), codexThreadId: String(row.codex_thread_id || ""),
      previewPort: 5000 + (Number.parseInt(createHash("sha1").update(String(row.id)).digest("hex").slice(0, 4), 16) % 1000),
      state: row.state || "preparing", previewState: row.preview_state || "offline", changedFileCount: Number(row.changed_file_count || 0),
      previewToken: createHash("sha256").update(randomUUID()).digest("hex"),
    };
    sessions.set(session.id, session);
    if (session.state !== "failed" && session.state !== "stopped") void prepareProject(session);
  }
  return { session: publicSession(session), events: await sessionEvents(session.id) };
}

codex.onEvent((method, params) => {
  const turn = params.turn as Json | undefined; const turnId = String(params.turnId || turn?.id || ""); const sessionId = turnSessions.get(turnId); const session = sessionId ? sessions.get(sessionId) : null; if (!session) return;
  if (method === "item/agentMessage/delta") partialMessages.set(turnId, `${partialMessages.get(turnId) || ""}${String(params.delta || "")}`);
  if (method === "turn/completed") { const message = partialMessages.get(turnId) || "The requested work is complete."; partialMessages.delete(turnId); void updateStatus(session).then((state) => emit(session, "agent_message", message, { session: state })); }
});

async function proxyPreview(req: IncomingMessage, res: ServerResponse, session: Session, pathname: string) {
  const upstream = await fetch(`http://127.0.0.1:${session.previewPort}${pathname}${new URL(req.url || "/", "http://local").search}`, { method: req.method || "GET", headers: { accept: String(req.headers.accept || "*/*") } });
  const excludedHeaders = new Set(["content-encoding", "content-length", "content-security-policy", "content-security-policy-report-only", "cross-origin-resource-policy", "x-frame-options"]);
  const responseHeaders = Object.fromEntries([...upstream.headers].filter(([key]) => !excludedHeaders.has(key.toLowerCase())));
  responseHeaders["Cache-Control"] = "no-store";
  responseHeaders["Content-Security-Policy"] = `frame-ancestors ${[...allowedOrigins].join(" ")}`;
  responseHeaders["Cross-Origin-Resource-Policy"] = "cross-origin";
  res.writeHead(upstream.status, responseHeaders);
  if (upstream.body) await pipeline(upstream.body as any, res); else res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://worker.local");
    if (req.method === "OPTIONS") { headers(res, 204); return res.end(); }
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin.replace(/\/$/, ""))) return json(res, 403, { error: "Origin not allowed." });
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/preview/")) { const [, , sessionId, ...parts] = url.pathname.split("/"); const session = sessions.get(sessionId || ""); if (!session || url.searchParams.get("token") !== session.previewToken) return json(res, 404, { error: "Preview not found." }); return await proxyPreview(req, res, session, `/${parts.join("/")}`); }
    const user = await authenticate(req);
    if (url.pathname === "/v1/account" && req.method === "GET") { const account = await codex.account(); return json(res, 200, { ready: true, codexAuthenticated: Boolean(account.account), account: account.account ? { type: (account.account as Json).type } : null }); }
    if (url.pathname === "/v1/account/connect" && req.method === "POST") { const result = await codex.connectChatGpt(); return json(res, 200, { verificationUrl: result.verificationUrl || result.authUrl, userCode: result.userCode || result.code }); }
    const activeProjectMatch = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/active$/);
    if (activeProjectMatch && req.method === "GET") return json(res, 200, await activeProject(user, activeProjectMatch[1] || ""));
    if (url.pathname === "/v1/projects/open" && req.method === "POST") { const input = await body(req); const session = await openProject(user, String(input.websiteId || "")); return json(res, 202, { session: publicSession(session) }); }
    const match = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)(?:\/(messages|checkpoint|push|events|preview\/restart))?$/);
    if (!match) return json(res, 404, { error: "Not found." });
    const session = sessions.get(match[1] || ""); if (!session || session.userId !== user.id) return json(res, 404, { error: "Build session not found." });
    const action = match[2] || "";
    if (action === "events" && req.method === "GET") { headers(res, 200, "text/event-stream"); res.write(": connected\n\n"); const set = listeners.get(session.id) || new Set(); set.add(res); listeners.set(session.id, set); req.once("close", () => set.delete(res)); return; }
    if (action === "messages" && req.method === "POST") { const input = await body(req); const text = String(input.text || "").trim(); if (!text) return json(res, 400, { error: "A build instruction is required." }); await emit(session, "user_message", text); const guardrail = "Work only inside this repository. Do not commit, push, deploy, access secrets, or change files outside the current workspace. Make and verify the requested website changes.\n\n"; const turn = await codex.startTurn(session.codexThreadId, session.cwd, `${guardrail}${text}`); turnSessions.set(turn.turn.id, session.id); return json(res, 202, { accepted: true }); }
    if (action === "checkpoint" && req.method === "POST") { const input = await body(req); await command("git", ["add", "--all"], session.cwd); await command("git", ["commit", "-m", String(input.message || "Build Studio checkpoint").slice(0, 120)], session.cwd); const state = await updateStatus(session); await emit(session, "checkpoint", "Checkpoint saved to the branch.", { session: state }); return json(res, 200, { session: state }); }
    if (action === "push" && req.method === "POST") { await command("git", ["push", "-u", "origin", session.workingBranch], session.cwd, await gitEnvironment(session.id, session.repositoryFullName)); const state = await updateStatus(session); await emit(session, "push", "Branch pushed to GitHub.", { session: state }); return json(res, 200, { session: state }); }
    if (action === "preview/restart" && req.method === "POST") {
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

void Promise.all([
  mkdir(workspaceRoot, { recursive: true }),
  mkdir(resolve(env.CODEX_HOME), { recursive: true }),
]).then(() => {
  server.listen(port, host, () => process.stdout.write(`N3XRA Build Worker listening on ${host}:${port}\n`));
});
