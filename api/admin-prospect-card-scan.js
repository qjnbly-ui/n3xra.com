const { requirePlatformAdmin, sendJson } = require("./_communications");
const { analyzeProspectBusinessCard } = require("./_ai-core/prospect-card");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    await requirePlatformAdmin(req);
    const imageDataUrl = String(req.body?.imageDataUrl || "");
    const result = await analyzeProspectBusinessCard(imageDataUrl);
    return sendJson(res, 200, { success: true, ...result });
  } catch (error) {
    return sendJson(res, Number(error?.status) || 400, {
      error: error?.message || "The business card could not be scanned.",
    });
  }
};
