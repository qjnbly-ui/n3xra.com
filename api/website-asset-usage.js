const { verifyAdminRequest } = require("./_website-proposal-ai-supabase");
const { liveUsageReportUrl, normalizedUsageReport, websiteBySlug, websiteSlug } = require("./_website-asset-bridge");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    await verifyAdminRequest(req);
    const slug = websiteSlug(req.query?.slug);
    const website = await websiteBySlug(slug);
    if (!website.live_url) return res.status(200).json({ available: false, reason: "missing_live_url", websiteSlug: slug, assets: [] });
    const reportUrl = liveUsageReportUrl(website.live_url);
    const response = await fetch(reportUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 404) return res.status(200).json({ available: false, reason: "not_deployed", websiteSlug: slug, assets: [] });
    if (!response.ok) throw Object.assign(new Error(`The live website usage report returned ${response.status}.`), { status: 502 });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 2 * 1024 * 1024) throw Object.assign(new Error("The live website usage report is too large."), { status: 502 });
    const reportText = await response.text();
    if (reportText.length > 2 * 1024 * 1024) throw Object.assign(new Error("The live website usage report is too large."), { status: 502 });
    let payload;
    try { payload = JSON.parse(reportText); } catch { throw Object.assign(new Error("The live website returned invalid usage JSON."), { status: 502 }); }
    const report = normalizedUsageReport(payload, slug);
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(200).json({ available: true, liveUrl: website.live_url, ...report });
  } catch (error) {
    const status = error?.name === "TimeoutError" ? 504 : Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || "Unable to load live asset usage." });
  }
};
