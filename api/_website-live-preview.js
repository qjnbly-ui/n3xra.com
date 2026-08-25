const { createHash, timingSafeEqual } = require("node:crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const BUCKET = "website-change-previews";

const digest = (value) => createHash("sha256").update(String(value || "")).digest("hex");
const sameHash = (left, right) => {
  try { return timingSafeEqual(Buffer.from(String(left), "hex"), Buffer.from(String(right), "hex")); }
  catch { return false; }
};
const storagePath = (value) => String(value || "").split("/").map(encodeURIComponent).join("/");
const serviceHeaders = (extra = {}) => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  ...extra,
});

function safeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.length > 500 || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return normalized;
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(String(data?.message || data?.error || `Supabase request failed (${response.status}).`));
  return data;
}

async function getRun(runId) {
  if (!SERVICE_KEY) throw new Error("Live preview storage is not configured.");
  const fields = "id,request_id,website_id,state,preview_mode,preview_token_hash,preview_expires_at,callback_token_hash,callback_expires_at,base_sha,source_manifest_path,storage_prefix,pending_storage_prefix,pending_source_manifest_path";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/website_change_runs?select=${fields}&id=eq.${encodeURIComponent(runId)}&limit=1`, { headers: serviceHeaders() });
  const rows = await readJson(response);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function safeLiveOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return "";
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0" || hostname === "::1" || /^127[.]/.test(hostname) || /^10[.]/.test(hostname) || /^192[.]168[.]/.test(hostname) || /^169[.]254[.]/.test(hostname) || /^172[.](1[6-9]|2\d|3[01])[.]/.test(hostname)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

async function getLiveOrigin(websiteId) {
  if (!SERVICE_KEY || !websiteId) return "";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/client_websites?select=live_url&id=eq.${encodeURIComponent(websiteId)}&limit=1`, { headers: serviceHeaders() });
  const rows = await readJson(response);
  return safeLiveOrigin(Array.isArray(rows) ? rows[0]?.live_url : "");
}

function validRunToken(run, token, purpose) {
  if (!run || run.preview_mode !== "n3xra_live") return false;
  if (purpose === "upload") return Date.parse(run.callback_expires_at || "") > Date.now() && sameHash(digest(token), run.callback_token_hash);
  return (["preview_ready", "client_ready"].includes(run.state) || Boolean(["queued", "coding"].includes(run.state) && run.storage_prefix))
    && Date.parse(run.preview_expires_at || "") > Date.now()
    && sameHash(digest(token), run.preview_token_hash);
}

async function uploadObject(path, bytes, contentType) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath(path)}`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" }),
    body: bytes,
  });
  return readJson(response);
}

async function downloadObject(path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath(path)}`, { headers: serviceHeaders() });
  if (!response.ok) return null;
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" };
}

module.exports = { BUCKET, digest, downloadObject, getLiveOrigin, getRun, safeLiveOrigin, safeRelativePath, uploadObject, validRunToken };
