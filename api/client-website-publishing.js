const {
  SUPABASE_URL,
  apiError,
  downloadStorageObject,
  parseJson,
  serviceRequest,
  uploadStorageObject,
  verifyAuthenticatedRequest,
} = require("./_website-proposal-ai-supabase");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_BUCKET = "website-assets-public";
const PRIVATE_BUCKET = "website-assets-private";
const MAX_PUBLIC_IMAGE_BYTES = 10 * 1024 * 1024;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function safeFilename(value) {
  const clean = String(value || "image.jpg").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "image.jpg";
}

async function authorizeEditor(userId, websiteId) {
  const website = encodeURIComponent(websiteId);
  const user = encodeURIComponent(userId);
  const [websites, memberships, admins, features, settings] = await Promise.all([
    serviceRequest(`client_websites?select=id,name,slug,status&id=eq.${website}&status=neq.archived&limit=1`),
    serviceRequest(`website_members?select=website_id,user_id,role,status&website_id=eq.${website}&user_id=eq.${user}&status=eq.active&role=in.(owner,editor)&limit=1`),
    serviceRequest(`platform_admins?select=user_id,status&user_id=eq.${user}&status=eq.active&limit=1`),
    serviceRequest(`website_portal_features?select=website_id,enabled&website_id=eq.${website}&feature_key=eq.publishing&enabled=eq.true&limit=1`),
    serviceRequest(`website_publishing_settings?select=website_id,client_auto_publish&website_id=eq.${website}&limit=1`),
  ]);
  const websiteRow = one(websites);
  if (!websiteRow) throw apiError("This website workspace no longer exists.", 404);
  if (!one(memberships) && !one(admins)) throw apiError("Editor access is required to publish website content.", 403);
  if (!one(features)) throw apiError("Website publishing is not enabled for this website.", 403);
  if (one(settings)?.client_auto_publish !== true) throw apiError("Automatic client publishing is disabled for this website.", 403);
  return websiteRow;
}

async function publishAssetVersion(websiteId, versionId, userId) {
  const website = await authorizeEditor(userId, websiteId);
  const versions = await serviceRequest(
    `website_asset_versions?select=id,asset_id,version_number,status,storage_bucket,storage_path,public_url,original_filename,mime_type,size_bytes&` +
    `id=eq.${encodeURIComponent(versionId)}&limit=1`,
  );
  const version = one(versions);
  if (!version) throw apiError("The selected upload no longer exists.", 404);
  const assets = await serviceRequest(
    `website_assets?select=id,website_id,current_version_id&` +
    `id=eq.${encodeURIComponent(version.asset_id)}&website_id=eq.${encodeURIComponent(website.id)}&limit=1`,
  );
  const asset = one(assets);
  if (!asset) throw apiError("The selected upload does not belong to this website.", 403);
  if (version.status === "published" && version.public_url) {
    return { assetId: asset.id, versionId: version.id, publicUrl: version.public_url };
  }
  if (version.storage_bucket !== PRIVATE_BUCKET || !String(version.mime_type || "").startsWith("image/")) {
    throw apiError("Only private website images can be published automatically.", 400);
  }
  if (Number(version.size_bytes || 0) > MAX_PUBLIC_IMAGE_BYTES) {
    throw apiError("This image is larger than the 10 MB public CDN limit. Choose a smaller export.", 413);
  }

  const filename = safeFilename(version.original_filename);
  const publicPath = `${website.id}/${asset.id}/v${version.version_number}-${version.id}-${filename}`;
  const bytes = await downloadStorageObject(version.storage_bucket, version.storage_path);
  await uploadStorageObject(PUBLIC_BUCKET, publicPath, bytes, {
    contentType: version.mime_type || "application/octet-stream",
    cacheControl: "31536000",
    upsert: true,
  });
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${publicPath}`;
  const now = new Date().toISOString();

  await serviceRequest(`website_asset_versions?id=eq.${encodeURIComponent(version.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "published",
      public_url: publicUrl,
      approved_by_user_id: userId,
      approved_at: now,
      published_by_user_id: userId,
      published_at: now,
      cdn_size_bytes: bytes.length,
      cdn_mime_type: version.mime_type || null,
      cdn_optimized: false,
      cdn_processed_at: now,
    }),
  });
  await serviceRequest(`website_assets?id=eq.${encodeURIComponent(asset.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ current_version_id: version.id, updated_at: now }),
  });

  return { assetId: asset.id, versionId: version.id, publicUrl };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const { user } = await verifyAuthenticatedRequest(req);
    const body = await parseJson(req);
    const action = String(body?.action || "");
    const websiteId = String(body?.websiteId || "");
    if (!UUID_PATTERN.test(websiteId)) throw apiError("Choose a valid website.", 400);
    if (action !== "publish_asset_version") throw apiError("Choose a valid publishing action.", 400);
    const versionId = String(body?.versionId || "");
    if (!UUID_PATTERN.test(versionId)) throw apiError("Choose a valid uploaded image.", 400);
    return res.status(200).json(await publishAssetVersion(websiteId, versionId, user.id));
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({ error: error?.message || "Website publishing could not be completed." });
  }
};

module.exports.authorizeEditor = authorizeEditor;
module.exports.publishAssetVersion = publishAssetVersion;
module.exports.safeFilename = safeFilename;
