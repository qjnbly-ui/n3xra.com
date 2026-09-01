const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function credentials(extra = {}) {
  const authorization = SERVICE_KEY.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${SERVICE_KEY}` };
  return { apikey: SERVICE_KEY, ...authorization, ...extra };
}

function encodeStoragePath(bucket, path) {
  return [bucket, ...String(path || "").split("/")].map(encodeURIComponent).join("/");
}

module.exports = async function projectCardFile(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("File delivery is not configured.");
    const slug = String(req.query?.slug || "").trim().toLowerCase();
    const resourceId = String(req.query?.resource || "").trim();
    if (!SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(resourceId)) return res.status(404).json({ error: "File not found." });

    const recordResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_project_card_file`, {
      method: "POST",
      headers: credentials({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ input_slug: slug, input_resource_id: resourceId }),
    });
    const record = await recordResponse.json().catch(() => null);
    if (!recordResponse.ok) throw new Error(String(record?.message || "Unable to verify this file."));
    if (!record?.bucket || !record?.path) return res.status(404).json({ error: "File not found." });

    const signResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${encodeStoragePath(record.bucket, record.path)}`, {
      method: "POST",
      headers: credentials({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ expiresIn: 300 }),
    });
    const signed = await signResponse.json().catch(() => null);
    if (!signResponse.ok || !signed?.signedURL) throw new Error(String(signed?.message || signed?.error || "Unable to prepare this file."));
    const destination = new URL(signed.signedURL, SUPABASE_URL).toString();
    res.setHeader("Location", destination);
    return res.status(302).end();
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to open this file." });
  }
};
