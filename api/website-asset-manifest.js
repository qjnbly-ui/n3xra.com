const { publishedAssetManifest, websiteBySlug, websiteSlug } = require("./_website-asset-bridge");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const slug = websiteSlug(req.query?.slug);
    const website = await websiteBySlug(slug);
    const images = await publishedAssetManifest(website);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
    return res.status(200).json({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      website: { name: website.name, slug: website.slug },
      policy: "Published website assets supplied by N3XRA. Private originals are never included.",
      images,
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({ error: error?.message || "Unable to load website assets." });
  }
};
