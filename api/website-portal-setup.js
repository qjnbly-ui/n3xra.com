const { createHash } = require("node:crypto");
const {
  apiError, parseJson, serviceRequest, verifyAdminRequest,
} = require("./_website-proposal-ai-supabase");
const { advisePortalBrand } = require("./_ai-core/portalBrandAdvisor");
const { DEFAULT_BRAND, analyzePortalSetup, colorContrast } = require("./_website-portal-setup");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function analysisFingerprint(records, result) {
  const source = {
    version: 1,
    website_id: records.website.id,
    website_updated_at: records.website.updated_at || null,
    branding_updated_at: records.branding?.updated_at || null,
    proposed: {
      primary_color: result.proposed.primary_color,
      accent_color: result.proposed.accent_color,
      logo_asset_id: result.proposed.logo_asset_id,
    },
    colors: result.discovery.color_candidates,
    logos: result.discovery.logo_candidates?.map((logo) => ({
      id: logo.id,
      asset_key: logo.asset_key,
      public_url: logo.public_url,
      score: logo.score,
    })),
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

async function readCachedAdvice(websiteId, fingerprint) {
  const expires = encodeURIComponent(new Date().toISOString());
  const rows = await serviceRequest(
    `website_portal_brand_analysis_cache?select=analysis,provider,model,analyzed_at&website_id=eq.${encodeURIComponent(websiteId)}&source_fingerprint=eq.${fingerprint}&expires_at=gt.${expires}&limit=1`,
  );
  const row = one(rows);
  if (!row?.analysis || typeof row.analysis !== "object") return null;
  return { ...row.analysis, provider: row.provider, model: row.model, analyzedAt: row.analyzed_at, cached: true };
}

async function cacheAdvice(websiteId, fingerprint, advice) {
  const analyzedAt = new Date();
  const expiresAt = new Date(analyzedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  await serviceRequest("website_portal_brand_analysis_cache?on_conflict=website_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      website_id: websiteId,
      source_fingerprint: fingerprint,
      analysis: {
        primaryColor: advice.primaryColor,
        accentColor: advice.accentColor,
        logoAssetId: advice.logoAssetId,
        confidence: advice.confidence,
        reason: advice.reason,
      },
      provider: advice.provider,
      model: advice.model,
      analyzed_at: analyzedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }),
  });
}

function applyGuardedAdvice(result, records, advice) {
  const confidence = Number(advice?.confidence);
  const meta = {
    used: false,
    cached: advice?.cached === true,
    provider: clean(advice?.provider, 40) || null,
    model: clean(advice?.model, 120) || null,
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: clean(advice?.reason, 180) || null,
    protected_saved_colors: false,
    protected_saved_logo: false,
  };
  if (!advice || !Number.isFinite(confidence) || confidence < 0.72) return meta;

  const allowedColors = new Set((result.discovery.color_candidates || []).map((candidate) => candidate.value));
  const allowedLogos = new Set((result.discovery.logo_candidates || []).map((candidate) => candidate.id));
  const savedPrimary = clean(records.branding?.primary_color).toLowerCase();
  const savedAccent = clean(records.branding?.accent_color).toLowerCase();
  const colorsWereCustomized = (savedPrimary && savedPrimary !== DEFAULT_BRAND.primary_color)
    || (savedAccent && savedAccent !== DEFAULT_BRAND.accent_color);
  const logoWasSaved = Boolean(records.branding?.logo_asset_id);
  meta.protected_saved_colors = Boolean(colorsWereCustomized);
  meta.protected_saved_logo = logoWasSaved;

  if (!colorsWereCustomized) {
    const primary = allowedColors.has(advice.primaryColor) && colorContrast(advice.primaryColor, "#ffffff") >= 4.5
      ? advice.primaryColor
      : result.proposed.primary_color;
    const accent = allowedColors.has(advice.accentColor)
      && advice.accentColor !== primary
      && colorContrast(advice.accentColor, primary) >= 3
      ? advice.accentColor
      : result.proposed.accent_color;
    if (primary !== result.proposed.primary_color || accent !== result.proposed.accent_color) meta.used = true;
    result.proposed.primary_color = primary;
    result.proposed.accent_color = accent;
  }

  if (!logoWasSaved && allowedLogos.has(advice.logoAssetId)) {
    if (result.proposed.logo_asset_id !== advice.logoAssetId) meta.used = true;
    result.proposed.logo_asset_id = advice.logoAssetId;
    if (!records.branding?.favicon_asset_id && !result.proposed.favicon_asset_id) result.proposed.favicon_asset_id = advice.logoAssetId;
  }

  return meta;
}

async function addAiBrandAdvice(records, result) {
  const fingerprint = analysisFingerprint(records, result);
  let advice = null;
  let cacheAvailable = true;
  try {
    advice = await readCachedAdvice(records.website.id, fingerprint);
  } catch {
    cacheAvailable = false;
  }
  let warnings = [];
  if (!advice) {
    const response = await advisePortalBrand({
      websiteName: records.website.name,
      currentPrimaryColor: result.proposed.primary_color,
      currentAccentColor: result.proposed.accent_color,
      colorCandidates: (result.discovery.color_candidates || []).map((candidate) => ({
        value: candidate.value,
        score: candidate.score,
        primaryScore: candidate.primaryScore,
        accentScore: candidate.accentScore,
        evidence: candidate.evidence,
      })),
      logoCandidates: (result.discovery.logo_candidates || []).map((logo) => ({
        id: logo.id,
        label: logo.label,
        assetKey: logo.asset_key,
        publicUrl: logo.public_url,
        mimeType: logo.mime_type,
        score: logo.score,
      })),
    });
    advice = response.advice;
    warnings = response.warnings;
    if (advice && cacheAvailable) {
      try { await cacheAdvice(records.website.id, fingerprint, advice); } catch { cacheAvailable = false; }
    }
  }
  result.discovery.ai_brand_analysis = advice
    ? { ...applyGuardedAdvice(result, records, advice), available: true, warnings: warnings.slice(0, 2) }
    : { used: false, cached: false, available: false, warnings: warnings.slice(0, 2) };
  result.discovery.analysis_cache_available = cacheAvailable;
  return result;
}

async function loadRecords(websiteId) {
  const encoded = encodeURIComponent(websiteId);
  const [websites, domains, repositories, services, assets, branding, features, members] = await Promise.all([
    serviceRequest(`client_websites?select=id,name,slug,portal_slug,organization_id,status,live_url,repository_full_name,portal_enabled,portal_theme_id,updated_at&id=eq.${encoded}&limit=1`),
    serviceRequest(`website_domains?select=id,website_id,domain_name,status,is_primary,domain_purpose,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_repositories?select=id,website_id,provider,full_name,html_url,default_branch,visibility,access_status,last_synced_at,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_services?select=id,website_id,service_type,name,provider,status,account_identifier,public_url,metadata&website_id=eq.${encoded}`),
    serviceRequest(`website_assets?select=id,website_id,asset_key,label,category,status,current_version_id&website_id=eq.${encoded}`),
    serviceRequest(`website_portal_branding?select=*&website_id=eq.${encoded}&limit=1`),
    serviceRequest(`website_portal_features?select=feature_key,enabled&website_id=eq.${encoded}`),
    serviceRequest(`website_members?select=user_id,role,status&website_id=eq.${encoded}`),
  ]);
  const website = one(websites);
  if (!website) throw apiError("This managed website no longer exists.", 404);
  const assetIds = (assets || []).map((asset) => asset.id);
  const versions = assetIds.length ? await serviceRequest(
    `website_asset_versions?select=id,asset_id,public_url,mime_type,status&asset_id=in.(${assetIds.join(",")})`,
  ) : [];
  return { website, domains, repositories, services, assets, versions, branding: one(branding), features, members };
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
    let result = await analyzePortalSetup(records, {
      includeRemote: body.include_remote === true,
      token: String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim(),
      vercelToken: String(process.env.VERCEL_TOKEN || "").trim(),
      teamId: String(process.env.VERCEL_TEAM_ID || "").trim(),
      teamSlug: String(process.env.VERCEL_TEAM_SLUG || "").trim(),
      portalRootVerified: String(process.env.PORTAL_ROOT_VERIFIED || "").toLowerCase() === "true",
    });
    if (body.include_remote === true) result = await addAiBrandAdvice(records, result);
    return res.status(200).json(result);
  } catch (error) {
    const message = /Proposal AI is not configured/.test(String(error?.message))
      ? "Website Portal setup analysis is not configured for this deployment."
      : error?.message || "Website Portal setup could not be analyzed.";
    return res.status(error?.status || 500).json({ error: message, details: error?.details || undefined });
  }
};

module.exports.applyGuardedAdvice = applyGuardedAdvice;
