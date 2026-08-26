const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const MEDIA_COLUMNS = {
  profile: "profile_image_path",
  logo: "company_logo_path",
  background: "background_image_path",
};

function fail(res, status, message) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error: message });
}

function serviceHeaders(extra = {}) {
  const credentials = SERVICE_KEY.startsWith("sb_secret_")
    ? { apikey: SERVICE_KEY }
    : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  return { ...credentials, ...extra };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "Method not allowed.");
  }
  const slug = String(req.query?.slug || "").trim().toLowerCase();
  const type = String(req.query?.type || "").trim().toLowerCase();
  const column = MEDIA_COLUMNS[type];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !column) return fail(res, 400, "Invalid card media request.");
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(res, 503, "Card media is temporarily unavailable.");

  try {
    const params = new URLSearchParams({ select: column, slug: `eq.${slug}`, status: "eq.published", limit: "1" });
    const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_card_profiles?${params}`, {
      headers: serviceHeaders({ Accept: "application/json" }),
    });
    if (!profileResponse.ok) return fail(res, 503, "Card media is temporarily unavailable.");
    const rows = await profileResponse.json();
    const path = Array.isArray(rows) ? String(rows[0]?.[column] || "") : "";
    if (!path) return fail(res, 404, "Card media not found.");
    const objectPath = path.split("/").map(encodeURIComponent).join("/");
    const mediaResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/contact-card-media/${objectPath}`, {
      headers: serviceHeaders(),
    });
    if (!mediaResponse.ok) return fail(res, mediaResponse.status === 404 ? 404 : 503, "Card media not found.");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", mediaResponse.headers.get("content-type") || "application/octet-stream");
    const bytes = Buffer.from(await mediaResponse.arrayBuffer());
    return res.status(200).send(bytes);
  } catch {
    return fail(res, 503, "Card media is temporarily unavailable.");
  }
}
