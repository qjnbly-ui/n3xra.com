const path = require("node:path");
const { downloadObject, getRun, safeRelativePath, validRunToken } = require("./_website-live-preview");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function previewPrefix(runId, token) {
  return `/website-preview/${encodeURIComponent(runId)}/${encodeURIComponent(token)}/`;
}

function rewriteText(bytes, contentType, prefix) {
  let text = bytes.toString("utf8");
  if (contentType.startsWith("text/html")) {
    text = text.replace(/\b(href|src|poster|action)=(['"])\/(?!\/)/gi, `$1=$2${prefix}`);
    if (!/<base\b/i.test(text)) text = text.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<base href="${prefix}">`);
  } else if (contentType.startsWith("text/css")) {
    text = text.replace(/url\((['"]?)\/(?!\/)/gi, `url($1${prefix}`);
  }
  return Buffer.from(text);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self' https:; frame-ancestors 'self' https://n3xra.com https://www.n3xra.com https://*.portal.n3xra.com; form-action 'none'; base-uri 'self'");
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  try {
    const runId = String(req.query?.run || "").trim();
    const token = String(req.query?.token || "").trim();
    let requestedPath = safeRelativePath(req.query?.path || "index.html") || "index.html";
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return res.status(404).end();
    const run = await getRun(runId);
    if (!validRunToken(run, token, "view")) return res.status(404).end();
    let object = await downloadObject(`runs/${runId}/site/${requestedPath}`);
    if (!object && !path.extname(requestedPath)) {
      requestedPath = `${requestedPath.replace(/\/$/, "")}/index.html`;
      object = await downloadObject(`runs/${runId}/site/${requestedPath}`);
    }
    if (!object && req.headers.accept?.includes("text/html")) {
      requestedPath = "index.html";
      object = await downloadObject(`runs/${runId}/site/index.html`);
    }
    if (!object) return res.status(404).send("This preview page was not found.");
    const contentType = TYPES[path.extname(requestedPath).toLowerCase()] || object.contentType;
    const body = /^(text\/html|text\/css)/.test(contentType) ? rewriteText(object.bytes, contentType, previewPrefix(runId, token)) : object.bytes;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(body.length));
    return req.method === "HEAD" ? res.status(200).end() : res.status(200).send(body);
  } catch {
    return res.status(500).send("The preview is temporarily unavailable.");
  }
};

module.exports._internal = { previewPrefix, rewriteText };
