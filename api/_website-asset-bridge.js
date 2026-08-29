const { apiError, serviceRequest } = require("./_website-proposal-ai-supabase");

const WEBSITE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ASSETS = 5000;

function websiteSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!WEBSITE_SLUG_PATTERN.test(slug)) throw apiError("A valid website slug is required.", 400);
  return slug;
}

async function websiteBySlug(slug) {
  const rows = await serviceRequest(
    `client_websites?select=id,name,slug,live_url,status&slug=eq.${encodeURIComponent(slug)}&status=neq.archived&limit=1`,
  );
  if (!Array.isArray(rows) || !rows.length) throw apiError("Website not found.", 404);
  return rows[0];
}

function publicAssetVersion(version) {
  const url = String(version?.public_url || "").trim();
  if (version?.status !== "published" || !url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.pathname.includes("/storage/v1/object/public/website-assets-public/")) return null;
    return url;
  } catch {
    return null;
  }
}

async function publishedAssetManifest(website) {
  const assets = await serviceRequest(
    `website_assets?select=id,asset_key,label,category,alt_text,current_version_id,status,created_at,updated_at&website_id=eq.${encodeURIComponent(website.id)}&status=eq.active&order=created_at.asc&limit=${MAX_ASSETS}`,
  );
  const activeAssets = Array.isArray(assets) ? assets.filter((asset) => asset.current_version_id) : [];
  const versionIds = activeAssets.map((asset) => String(asset.current_version_id));
  if (!versionIds.length) return [];
  const versions = await serviceRequest(
    `website_asset_versions?select=id,asset_id,version_number,status,public_url,original_filename,mime_type,size_bytes,width,height,published_at,updated_at&id=in.(${versionIds.map(encodeURIComponent).join(",")})&limit=${MAX_ASSETS}`,
  );
  const versionById = new Map((Array.isArray(versions) ? versions : []).map((version) => [String(version.id), version]));

  return activeAssets.flatMap((asset) => {
    const version = versionById.get(String(asset.current_version_id));
    const url = publicAssetVersion(version);
    if (!version || !url) return [];
    return [{
      assetKey: asset.asset_key,
      label: `${asset.label} · v${version.version_number}`,
      filename: version.original_filename,
      localReference: null,
      url,
      category: asset.category,
      altText: asset.alt_text || "",
      version: version.version_number,
      mimeType: version.mime_type || "",
      sizeBytes: version.size_bytes ?? null,
      width: version.width ?? null,
      height: version.height ?? null,
      publishedAt: version.published_at || null,
      updatedAt: version.updated_at || asset.updated_at,
    }];
  });
}

function liveUsageReportUrl(liveUrl) {
  let parsed;
  try { parsed = new URL(String(liveUrl || "")); } catch { throw apiError("This website does not have a valid live URL.", 409); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !hostname || hostname === "localhost" || hostname.endsWith(".local") || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    throw apiError("This website does not have a safe public HTTPS URL.", 409);
  }
  parsed.pathname = "/.well-known/n3xra-asset-usage.json";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function normalizedUsageReport(payload, slug) {
  if (!payload || payload.schemaVersion !== 1 || payload.websiteSlug !== slug || !Array.isArray(payload.assets)) {
    throw apiError("The live website returned an invalid asset usage report.", 502);
  }
  const assets = payload.assets.slice(0, MAX_ASSETS).flatMap((asset) => {
    const assetKey = String(asset?.assetKey || "").trim();
    const filename = String(asset?.filename || "").trim();
    if (!assetKey || !filename) return [];
    const locations = (Array.isArray(asset.locations) ? asset.locations : []).slice(0, 100).flatMap((location) => {
      const route = String(location?.route || "").trim();
      if (!route.startsWith("/") || route.includes("..")) return [];
      return [{
        route,
        sourceFile: String(location?.sourceFile || "").slice(0, 500),
        occurrences: Math.max(1, Math.min(Number(location?.occurrences) || 1, 1000)),
      }];
    });
    return [{ assetKey, filename, locations, occurrenceCount: locations.reduce((total, item) => total + item.occurrences, 0) }];
  });
  return {
    schemaVersion: 1,
    websiteSlug: slug,
    generatedAt: payload.generatedAt || null,
    commitSha: String(payload.commitSha || "").slice(0, 100) || null,
    assets,
  };
}

module.exports = {
  liveUsageReportUrl,
  normalizedUsageReport,
  publicAssetVersion,
  publishedAssetManifest,
  websiteBySlug,
  websiteSlug,
};
