const {
  apiError, parseJson, serviceRequest, verifyAdminRequest,
} = require("./_website-proposal-ai-supabase");
const { analyzePortalSetup } = require("./_website-portal-setup");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadRecords(websiteId) {
  const encoded = encodeURIComponent(websiteId);
  const [websites, domains, repositories, services, assets, branding, features] = await Promise.all([
    serviceRequest(`client_websites?select=id,name,slug,status,live_url,repository_full_name,portal_enabled,portal_theme_id,updated_at&id=eq.${encoded}&limit=1`),
    serviceRequest(`website_domains?select=id,website_id,domain_name,status,is_primary,domain_purpose,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_repositories?select=id,website_id,provider,full_name,html_url,default_branch,visibility,access_status,last_synced_at,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_services?select=id,website_id,service_type,name,provider,status,account_identifier,public_url,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_assets?select=id,website_id,asset_key,label,category,status,current_version_id&website_id=eq.${encoded}`),
    serviceRequest(`website_portal_branding?select=*&website_id=eq.${encoded}&limit=1`),
    serviceRequest(`website_portal_features?select=feature_key,enabled&website_id=eq.${encoded}`),
  ]);
  const website = one(websites);
  if (!website) throw apiError("This managed website no longer exists.", 404);
  const assetIds = (assets || []).map((asset) => asset.id);
  const versions = assetIds.length ? await serviceRequest(
    `website_asset_versions?select=id,asset_id,public_url,mime_type,status&asset_id=in.(${assetIds.join(",")})`,
  ) : [];
  return { website, domains, repositories, services, assets, versions, branding: one(branding), features };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    await verifyAdminRequest(req);
    const body = await parseJson(req);
    const websiteId = String(body.website_id || "").trim();
    if (!UUID_PATTERN.test(websiteId)) throw apiError("Choose a valid managed website.", 400);
    const records = await loadRecords(websiteId);
    const result = await analyzePortalSetup(records, {
      includeRemote: body.include_remote === true,
      token: String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim(),
      vercelToken: String(process.env.VERCEL_TOKEN || "").trim(),
      teamId: String(process.env.VERCEL_TEAM_ID || "").trim(),
      teamSlug: String(process.env.VERCEL_TEAM_SLUG || "").trim(),
    });
    return res.status(200).json(result);
  } catch (error) {
    const message = /Proposal AI is not configured/.test(String(error?.message))
      ? "Website Portal setup analysis is not configured for this deployment."
      : error?.message || "Website Portal setup could not be analyzed.";
    return res.status(error?.status || 500).json({ error: message, details: error?.details || undefined });
  }
};
