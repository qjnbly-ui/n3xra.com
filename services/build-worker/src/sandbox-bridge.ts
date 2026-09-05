// Runs only inside one Vercel microVM. No platform or Vercel credentials belong here.
import { createServer, request as httpRequest } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { CodexAppServer } from "./codex-app-server.js";
import { stopProcessGroup, removeStaleAstroLock } from "./process-lifecycle.js";

type Json = Record<string, any>;
const config = JSON.parse(readFileSync("/vercel/.n3xra/config.json", "utf8")) as { secret: string; sessionId: string; version: string };
const generation = randomUUID();
const codex = new CodexAppServer(true);
let preview: ChildProcess | undefined;
let previewOutput = "";
let sequence = 0;
let activeTurn: { threadId: string; turnId: string } | null = null;
const events: { sequence: number; method: string; params: Json }[] = [];
codex.onEvent((method, params) => {
  if (method === "turn/started") activeTurn = { threadId: String(params.threadId), turnId: String((params.turn as Json)?.id || "") };
  if (method === "turn/completed" || method === "worker/disconnected") activeTurn = null;
  if (!["item/started", "item/completed", "item/agentMessage/delta", "turn/completed", "account/login/completed", "account/updated", "worker/disconnected"].includes(method)) return;
  // Reasoning items are not troubleshooting notes and must not be forwarded.
  if ((method === "item/started" || method === "item/completed") && !["agentMessage", "commandExecution", "fileChange", "webSearch", "mcpToolCall", "contextCompaction"].includes(String((params.item as Json | undefined)?.type))) return;
  events.push({ sequence: ++sequence, method, params });
  if (events.length > 2000) events.shift();
});
function authorized(value: string | undefined) {
  const actual = Buffer.from(value || ""), expected = Buffer.from(`Bearer ${config.secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function stopPreview() { if (preview) { const child = preview; preview = undefined; await stopProcessGroup(child); } }
const server = createServer(async (req, res) => {
  if (!authorized(req.headers.authorization)) { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url || "/", "http://bridge");
  try {
    if (url.pathname === "/health") { res.end(JSON.stringify({ ok: true, version: config.version, generation, sequence, previewRunning: Boolean(preview && preview.exitCode === null) })); return; }
    if (url.pathname === "/events") { res.end(JSON.stringify(events.filter(event => event.sequence > Number(url.searchParams.get("after") || 0)))); return; }
    if (url.pathname.startsWith(`/preview/${config.sessionId}/`)) {
      const upstream = httpRequest({ hostname: "127.0.0.1", port: 5173, path: req.url, method: req.method, headers: { accept: req.headers.accept || "*/*", host: "127.0.0.1:5173" } }, response => {
        res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
      });
      upstream.once("error", () => { res.writeHead(502); res.end("Preview is not running."); });
      req.pipe(upstream); return;
    }
    if (req.method !== "POST" || url.pathname !== "/rpc") { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
    const input = JSON.parse(Buffer.concat(chunks).toString()) as Json;
    let result: unknown;
    if (input.method === "workspace/status") { res.end(JSON.stringify({ result: { activeTurn, previewRunning: Boolean(preview && preview.exitCode === null) } })); return; }
    if (input.method === "bridge/stop") { await stopPreview(); codex.stop(); res.end(JSON.stringify({ result: {} })); server.close(); setTimeout(() => process.exit(0), 50); return; }
    if (input.method === "preview/stop") { await stopPreview(); result = {}; }
    else if (input.method === "preview/start") {
      await stopPreview(); previewOutput = "";
      const { cmd, args, astro } = input.params as { cmd: string; args: string[]; astro?: boolean };
      if (astro) await removeStaleAstroLock("/vercel/repository");
      preview = spawn(cmd, args, { cwd: "/vercel/repository", env: { ...process.env, NODE_ENV: "development", ASTRO_DEV_BACKGROUND: "1", ASTRO_TELEMETRY_DISABLED: "1", BROWSER: "none" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      preview.stdout?.on("data", chunk => { previewOutput = (previewOutput + chunk).slice(-4000); });
      preview.stderr?.on("data", chunk => { previewOutput = (previewOutput + chunk).slice(-4000); });
      preview.on("error", error => { previewOutput = error.message; });
      result = {};
    } else if (input.method === "preview/status") result = { running: Boolean(preview && preview.exitCode === null && !preview.killed), output: previewOutput };
    else {
      const allowed = new Set(["account/read", "account/login/start", "account/logout", "thread/start", "thread/resume", "turn/start"]);
      if (!allowed.has(String(input.method))) throw new Error("Unsupported workspace operation.");
      const params = input.params || {};
      // The coordinator chooses the workspace; callers cannot select another root.
      if (/^(thread|turn)\//.test(input.method)) params.cwd = "/vercel/repository";
      if (input.method === "turn/start") params.sandboxPolicy = { type: "externalSandbox", networkAccess: "restricted" };
      await codex.start(); result = await codex.request(input.method, params);
    }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ result }));
  } catch (error) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Workspace operation failed." })); }
});
server.on("upgrade", (req, socket, head) => {
  if (!authorized(req.headers.authorization) || !(req.url || "").startsWith(`/preview/${config.sessionId}/`)) { socket.destroy(); return; }
  const path = (req.url || "").replace(`/preview/${config.sessionId}/`, "/");
  const upstream = httpRequest({ hostname: "127.0.0.1", port: 5173, path, headers: { ...req.headers, authorization: "", cookie: "", host: "127.0.0.1:5173" } });
  upstream.on("upgrade", (response, peer, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) peer.write(head); if (upstreamHead.length) socket.write(upstreamHead);
    peer.on("error", () => socket.destroy()); socket.on("error", () => peer.destroy());
    peer.on("close", () => socket.destroy()); socket.on("close", () => peer.destroy()); peer.pipe(socket); socket.pipe(peer);
  });
  upstream.on("error", () => socket.destroy()); upstream.on("response", () => socket.destroy()); upstream.end();
});
async function shutdown() { await stopPreview(); codex.stop(); server.close(); process.exit(0); }
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
// File is outside the repository; used only for restarting the bridge after recovery.
void writeFile("/vercel/.n3xra/bridge.pid", String(process.pid)).then(() => server.listen(8080, "0.0.0.0"));
