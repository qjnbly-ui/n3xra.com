const {
  apiError, parseJson, serviceRequest, verifyAdminRequest,
} = require("./_website-proposal-ai-supabase");
const { verifyVercel } = require("./_website-portal-setup");
const { syncAnalyticsConnection } = require("./_client-analytics-archive");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadWebsiteRecords(websiteId) {
  const encoded = encodeURIComponent(websiteId);
  const [websites, repositories, services, existing] = await Promise.all([
    serviceRequest(`client_websites?select=id,name,slug,live_url,repository_full_name&id=eq.${encoded}&limit=1`),
    serviceRequest(`website_repositories?select=provider,full_name,default_branch,access_status&website_id=eq.${encoded}&order=created_at.asc`),
    serviceRequest(`website_services?select=service_type,name,provider,status,account_identifier,public_url,metadata&website_id=eq.${encoded}&order=sort_order.asc`),
    serviceRequest(`website_analytics_connections?select=website_id,provider,project_id,project_name,team_id,status,last_verified_at,archive_status,archive_started_on,archive_last_synced_at&website_id=eq.${encoded}&limit=1`),
  ]);
  const website = one(websites);
  if (!website) throw apiError("This managed website no longer exists.", 404);
  return { website, repositories, services, existing: one(existing) };
}

function publicConnection(row) {
  return row ? {
    provider: row.provider,
    projectId: row.project_id,
    projectName: row.project_name,
    status: row.status,
    verifiedAt: row.last_verified_at,
    archiveStatus: row.archive_status || "pending",
    archiveStartedOn: row.archive_started_on || null,
    archiveLastSyncedAt: row.archive_last_synced_at || null,
  } : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    await verifyAdminRequest(req);
    const body = await parseJson(req);
    const websiteId = String(body.website_id || "").trim();
    if (!UUID_PATTERN.test(websiteId)) throw apiError("Choose a valid managed website.", 400);
    const records = await loadWebsiteRecords(websiteId);
    const verifiedAt = Date.parse(String(records.existing?.last_verified_at || ""));
    const recentlyVerified = Number.isFinite(verifiedAt) && Date.now() - verifiedAt < 24 * 60 * 60 * 1000;
    if (records.existing?.status === "active" && records.existing?.project_id && body.refresh !== true && recentlyVerified) {
      let archive = null;
      let archiveWarning = "";
      if (records.existing.archive_status !== "healthy") {
        try {
          archive = await syncAnalyticsConnection(records.existing, { forceBackfill: true });
        } catch (error) {
          archiveWarning = error?.message || "The permanent analytics archive will retry during the nightly synchronization.";
        }
      }
      return res.status(200).json({ connection: publicConnection(records.existing), reused: true, archive, archiveWarning: archiveWarning || undefined });
    }

    const vercelToken = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();
    const teamId = String(process.env.VERCEL_ANALYTICS_TEAM_ID || process.env.VERCEL_TEAM_ID || "").trim();
    const teamSlug = String(process.env.VERCEL_ANALYTICS_TEAM_SLUG || process.env.VERCEL_TEAM_SLUG || "").trim();
    if (!vercelToken) {
      throw apiError("Add VERCEL_ACCESS_TOKEN to the N3XRA project before connecting client analytics.", 503, { missing: ["VERCEL_ACCESS_TOKEN"] });
    }

    const repository = records.repositories.find((row) => row.provider === "github" && row.access_status === "available")
      || records.repositories.find((row) => row.provider === "github")
      || (records.website.repository_full_name ? { provider: "github", full_name: records.website.repository_full_name } : null);
    const result = await verifyVercel(records, repository, { vercelToken, teamId, teamSlug });
    if (!result?.verified || !result.id) {
      throw apiError("N3XRA could not match this website to a Vercel project. Record its Vercel project name under Services & Ownership, then try again.", 409);
    }

    const verifiedAtValue = new Date().toISOString();
    const rows = await serviceRequest("website_analytics_connections?on_conflict=website_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        website_id: websiteId,
        provider: "vercel",
        project_id: result.id,
        project_name: result.name || null,
        team_id: teamId || null,
        status: result.live === false ? "attention" : "active",
        last_verified_at: verifiedAtValue,
        metadata: { framework: result.framework || null },
      }),
    });
    const connection = one(rows);
    let archive = null;
    let archiveWarning = "";
    if (connection?.status === "active") {
      try {
        archive = await syncAnalyticsConnection(connection, { forceBackfill: true });
      } catch (error) {
        archiveWarning = error?.message || "The permanent analytics archive will retry during the nightly synchronization.";
      }
    }
    return res.status(200).json({ connection: publicConnection(connection), reused: false, archive, archiveWarning: archiveWarning || undefined });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error?.message || "Client analytics could not be connected.",
      details: error?.details || undefined,
    });
  }
};
