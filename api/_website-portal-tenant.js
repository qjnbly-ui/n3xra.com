const DEFAULT_PORTAL_ROOT = "portal.n3xra.com";

function normalizeHostname(value = "") {
  const text = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!text) return "";
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function normalizePortalSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function portalRootDomain(value = DEFAULT_PORTAL_ROOT) {
  return normalizeHostname(value) || DEFAULT_PORTAL_ROOT;
}

function standardPortalHostname(website = {}, rootDomain = DEFAULT_PORTAL_ROOT) {
  const slug = normalizePortalSlug(website.portal_slug || website.slug);
  return slug ? `${slug}.${portalRootDomain(rootDomain)}` : "";
}

function portalSlugFromHostname(hostname, rootDomain = DEFAULT_PORTAL_ROOT) {
  const host = normalizeHostname(hostname);
  const root = portalRootDomain(rootDomain);
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return "";
  const slug = host.slice(0, -suffix.length);
  return slug && !slug.includes(".") ? normalizePortalSlug(slug) : "";
}

function activeCustomPortalDomain(records = {}) {
  return (records.domains || []).find((row) => row.domain_purpose === "portal" && row.status === "active") || null;
}

function resolvePortalTenant(records = {}, hostname, rootDomain = DEFAULT_PORTAL_ROOT) {
  const website = records.website || {};
  const host = normalizeHostname(hostname);
  if (!host || website.status !== "active" || !website.portal_enabled) return null;
  const standardHost = standardPortalHostname(website, rootDomain);
  const customDomain = activeCustomPortalDomain(records);
  const customHost = normalizeHostname(customDomain?.domain_name);
  if (host !== standardHost && host !== customHost) return null;
  return {
    website_id: website.id,
    organization_id: website.organization_id || null,
    portal_slug: normalizePortalSlug(website.portal_slug || website.slug),
    hostname: host,
    host_type: host === standardHost ? "standard" : "custom",
  };
}

function hasActiveWebsiteAccess(members = [], userId = "", isPlatformAdmin = false) {
  if (isPlatformAdmin) return true;
  return members.some((member) => member.user_id === userId && member.status === "active");
}

module.exports = {
  DEFAULT_PORTAL_ROOT,
  hasActiveWebsiteAccess,
  normalizeHostname,
  normalizePortalSlug,
  portalSlugFromHostname,
  resolvePortalTenant,
  standardPortalHostname,
};
