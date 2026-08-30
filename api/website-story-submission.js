const crypto = require("crypto");
const {
  SUPABASE_URL,
  apiError,
  createSignedStorageUpload,
  parseJson,
  serviceRequest,
  storageObjectExists,
} = require("./_website-proposal-ai-supabase");
const { websiteBySlug, websiteSlug } = require("./_website-asset-bridge");

const PRIVATE_BUCKET = "website-assets-private";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function clean(value, maximum) { return String(value || "").trim().slice(0, maximum); }
function requestIp(req) { return String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim(); }
function hash(value) {
  const secret = String(process.env.STORY_SUBMISSION_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "n3xra-story-submission");
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}
function safeFilename(value) { return clean(value, 180).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "customer-photo.jpg"; }
function imageMimeType(filename) {
  const extension = String(filename || "").toLowerCase().split(".").pop();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" })[extension] || "application/octet-stream";
}
function allowedOrigin(req) {
  const origin = clean(req.headers?.origin, 300);
  if (!origin) return "*";
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "rootsandrelicsgreenhouse.com" || host === "www.rootsandrelicsgreenhouse.com" || host === "localhost" || host === "127.0.0.1" ? origin : "";
  } catch { return ""; }
}

async function settingsFor(websiteId) {
  const rows = await serviceRequest(`website_publishing_settings?select=public_submissions_enabled,public_submissions_auto_publish&website_id=eq.${encodeURIComponent(websiteId)}&limit=1`);
  const settings = Array.isArray(rows) ? rows[0] : null;
  if (!settings?.public_submissions_enabled) throw apiError("Story submissions are not open for this website.", 403);
  return settings;
}

async function rateLimit(ipHash, websiteId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await serviceRequest(`website_story_submissions?select=id&website_id=eq.${encodeURIComponent(websiteId)}&source_ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(since)}&limit=4`);
  if (Array.isArray(rows) && rows.length >= 3) throw apiError("Please wait before sharing another story.", 429);
}

async function prepare(body, req) {
  if (clean(body.company, 100)) return { accepted: true };
  const website = await websiteBySlug(websiteSlug(body.slug));
  await settingsFor(website.id);
  const name = clean(body.name, 160), email = clean(body.email, 320), story = clean(body.story, 5000);
  const title = clean(body.title, 180), filename = safeFilename(body.filename), mimeType = clean(body.mimeType, 100);
  const sizeBytes = Number(body.sizeBytes || 0);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !story) throw apiError("Add your name, email, and story.", 400);
  if (body.permissionToPublish !== true) throw apiError("Permission to share the story and photograph is required.", 400);
  if (!ALLOWED_TYPES.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) throw apiError("Choose a JPG, PNG, WebP, or GIF smaller than 10 MB.", 400);
  const ipHash = hash(requestIp(req));
  await rateLimit(ipHash, website.id);
  const submissionId = crypto.randomUUID(), uploadSecret = crypto.randomBytes(32).toString("base64url");
  const uploadPath = `${website.id}/story-submissions/${submissionId}/${filename}`;
  await serviceRequest("website_story_submissions", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: submissionId, website_id: website.id, submitter_name: name, submitter_email: email, story_title: title || null, story_body: story, display_name_preference: ["full_name", "first_name", "anonymous"].includes(body.displayNamePreference) ? body.displayNamePreference : "first_name", permission_to_publish: true, status: "pending", source_ip_hash: ipHash, upload_path: uploadPath, upload_secret_hash: hash(uploadSecret) }) });
  const signed = await createSignedStorageUpload(PRIVATE_BUCKET, uploadPath);
  const signedPath = String(signed.url || signed.signedURL || "");
  if (!signedPath) throw apiError("The private photo upload could not be prepared.", 502);
  return { submissionId, uploadSecret, uploadPath, uploadUrl: `${SUPABASE_URL}/storage/v1${signedPath}` };
}

async function finalize(body) {
  const submissionId = clean(body.submissionId, 80), uploadSecret = clean(body.uploadSecret, 200);
  const rows = await serviceRequest(`website_story_submissions?select=id,website_id,story_title,upload_path,upload_secret_hash,asset_id&id=eq.${encodeURIComponent(submissionId)}&status=eq.pending&limit=1`);
  const submission = Array.isArray(rows) ? rows[0] : null;
  if (!submission || !uploadSecret || submission.upload_secret_hash !== hash(uploadSecret)) throw apiError("This submission session is no longer valid.", 403);
  if (submission.asset_id) return { accepted: true, submissionId };
  if (!await storageObjectExists(PRIVATE_BUCKET, submission.upload_path)) throw apiError("Finish uploading the photograph before submitting.", 409);
  const assetId = crypto.randomUUID(), versionId = crypto.randomUUID();
  const filename = submission.upload_path.split("/").pop() || "customer-photo.jpg";
  await serviceRequest("website_assets", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: assetId, website_id: submission.website_id, asset_key: `customer_story_${submission.id.replaceAll("-", "")}`, label: submission.story_title || "Customer story photograph", category: "visitor_submission", replacement_type: "html_src", status: "active" }) });
  await serviceRequest("website_asset_versions", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: versionId, asset_id: assetId, version_number: 1, status: "pending_review", storage_bucket: PRIVATE_BUCKET, storage_path: submission.upload_path, original_filename: filename, mime_type: imageMimeType(filename), change_note: "Submitted through Share Your Find" }) });
  await serviceRequest(`website_story_submissions?id=eq.${encodeURIComponent(submission.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ asset_id: assetId, asset_version_id: versionId, upload_secret_hash: null }) });
  return { accepted: true, submissionId };
}

module.exports = async function handler(req, res) {
  const origin = allowedOrigin(req);
  if (!origin) return res.status(403).json({ error: "This origin is not allowed." });
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); return res.status(204).end(); }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const body = await parseJson(req);
    return res.status(200).json(body.action === "finalize" ? await finalize(body) : await prepare(body, req));
  } catch (error) { return res.status(Number(error?.status || 500)).json({ error: error?.message || "The story could not be submitted." }); }
};

module.exports.allowedOrigin = allowedOrigin;
module.exports.imageMimeType = imageMimeType;
module.exports.safeFilename = safeFilename;
