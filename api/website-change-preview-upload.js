const { getRun, safeRelativePath, uploadObject, validRunToken } = require("./_website-live-preview");

const MAX_FILE_BYTES = 4 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) throw Object.assign(new Error("This preview file is too large for Fast Live Preview."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const runId = String(req.query?.run || "").trim();
    const token = String(req.headers["x-n3xra-preview-token"] || "").trim();
    const kind = String(req.query?.kind || "").trim();
    const relativePath = safeRelativePath(req.query?.path);
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !["site", "source"].includes(kind) || !relativePath) return res.status(400).json({ error: "Invalid preview upload." });
    const run = await getRun(runId);
    if (!validRunToken(run, token, "upload") || !["queued", "coding"].includes(run.state)) return res.status(403).json({ error: "This preview upload is not authorized." });
    const bytes = await readBody(req);
    const objectPath = `runs/${runId}/${kind}/${relativePath}`;
    await uploadObject(objectPath, bytes, String(req.headers["content-type"] || "application/octet-stream"));
    return res.status(201).json({ ok: true, path: objectPath, bytes: bytes.length });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({ error: error instanceof Error ? error.message : "The preview file could not be stored." });
  }
};

module.exports.config = { api: { bodyParser: false } };
