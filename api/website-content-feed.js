const { serviceRequest } = require("./_website-proposal-ai-supabase");
const { publicAssetVersion, websiteBySlug, websiteSlug } = require("./_website-asset-bridge");

const MAX_POSTS = 100;

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function mediaItem(row, version) {
  const url = publicAssetVersion(version);
  if (!url) return null;
  return {
    id: row.id,
    url,
    altText: row.alt_text || "",
    caption: row.caption || "",
    width: version.width || null,
    height: version.height || null,
    mimeType: version.mime_type || "",
  };
}

async function contentFeed(slug) {
  const website = await websiteBySlug(websiteSlug(slug));
  const [settingsRows, posts] = await Promise.all([
    serviceRequest(`website_publishing_settings?select=page_title,page_kicker,page_intro,hero_asset_version_id,public_submissions_enabled&website_id=eq.${encodeURIComponent(website.id)}&limit=1`),
    serviceRequest(`website_posts?select=id,post_type,slug,title,excerpt,body,featured,published_at,updated_at&website_id=eq.${encodeURIComponent(website.id)}&status=eq.published&published_at=lte.${encodeURIComponent(new Date().toISOString())}&order=featured.desc,published_at.desc&limit=${MAX_POSTS}`),
  ]);
  const settings = one(settingsRows) || {};
  const postRows = Array.isArray(posts) ? posts : [];
  const postIds = postRows.map((post) => String(post.id));
  const media = postIds.length
    ? await serviceRequest(`website_post_media?select=id,post_id,asset_version_id,sort_order,alt_text,caption&post_id=in.(${postIds.map(encodeURIComponent).join(",")})&order=sort_order.asc,created_at.asc&limit=1000`)
    : [];
  const mediaRows = Array.isArray(media) ? media : [];
  const versionIds = [...new Set([
    ...mediaRows.map((row) => String(row.asset_version_id)),
    ...(settings.hero_asset_version_id ? [String(settings.hero_asset_version_id)] : []),
  ])];
  const versions = versionIds.length
    ? await serviceRequest(`website_asset_versions?select=id,status,public_url,width,height,mime_type&id=in.(${versionIds.map(encodeURIComponent).join(",")})&limit=1001`)
    : [];
  const versionById = new Map((Array.isArray(versions) ? versions : []).map((version) => [String(version.id), version]));
  const mediaByPost = new Map();
  for (const row of mediaRows) {
    const item = mediaItem(row, versionById.get(String(row.asset_version_id)));
    if (!item) continue;
    const list = mediaByPost.get(String(row.post_id)) || [];
    list.push(item);
    mediaByPost.set(String(row.post_id), list);
  }
  const heroVersion = settings.hero_asset_version_id
    ? versionById.get(String(settings.hero_asset_version_id))
    : null;

  return {
    generatedAt: new Date().toISOString(),
    website: { name: website.name, slug: website.slug, liveUrl: website.live_url || "" },
    page: {
      title: settings.page_title || "From the Greenhouse",
      kicker: settings.page_kicker || "Stories, finds, and life on the farm",
      intro: settings.page_intro || "",
      heroUrl: publicAssetVersion(heroVersion) || "",
      submissionsEnabled: settings.public_submissions_enabled === true,
    },
    posts: postRows.map((post) => ({ ...post, media: mediaByPost.get(String(post.id)) || [] })),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    return res.status(200).json(await contentFeed(req.query?.slug));
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({ error: error?.message || "Website content is unavailable." });
  }
};

module.exports.contentFeed = contentFeed;
module.exports.mediaItem = mediaItem;
