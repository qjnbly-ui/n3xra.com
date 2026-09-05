import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const base = process.argv[2] || "/";
const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".pdf": "application/pdf" };
createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://preview").pathname);
    if (!pathname.startsWith(base)) throw new Error("Not found");
    const relative = pathname.slice(base.length);
    if (relative.split("/").some(part => part.startsWith("."))) throw new Error("Not found");
    let path = resolve(root, relative);
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    path = await realpath(path);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Not found");
    const content = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(5173, "127.0.0.1");
