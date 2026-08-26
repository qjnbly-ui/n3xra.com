const { sendJson, supabaseJson } = require("./_communications");

const RESERVED = new Set([
  "account", "admin", "api", "assets", "blog", "card", "client-portal", "contact", "help", "login", "n3xra-admin", "privacy", "projects", "services", "shared", "support", "terms",
]);

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const slug = normalizeSlug(req.query?.slug);
    const current = normalizeSlug(req.query?.current);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || RESERVED.has(slug)) {
      return sendJson(res, 200, { slug, available: false });
    }
    if (current && slug === current) return sendJson(res, 200, { slug, available: true });
    const rows = await supabaseJson(`contact_card_profiles?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
    return sendJson(res, 200, { slug, available: !Array.isArray(rows) || rows.length === 0 });
  } catch (error) {
    return sendJson(res, Number(error?.status) || 500, { error: error?.message || "Card address availability could not be checked." });
  }
};
