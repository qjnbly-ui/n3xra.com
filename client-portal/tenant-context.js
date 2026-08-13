const BASE_HOSTNAMES = new Set(["", "localhost", "127.0.0.1", "::1", "n3xra.com", "www.n3xra.com"]);
const STANDARD_PORTAL_SUFFIX = ".portal.n3xra.com";
function currentHostname() {
    return typeof window === "undefined" ? "" : window.location.hostname;
}
export function normalizePortalHostname(value) {
    return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}
export function isUnboundPortalHostname(value) {
    const hostname = normalizePortalHostname(value);
    return BASE_HOSTNAMES.has(hostname) || hostname.endsWith(".vercel.app");
}
function asTenantRow(value) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (!candidate || typeof candidate !== "object")
        return null;
    const row = candidate;
    if (typeof row.website_id !== "string" || !row.website_id)
        return null;
    return {
        website_id: row.website_id,
        website_name: typeof row.website_name === "string" ? row.website_name : "Website portal",
        website_slug: typeof row.website_slug === "string" ? row.website_slug : "",
        portal_theme_id: typeof row.portal_theme_id === "string" ? row.portal_theme_id : null,
        branding: row.branding && typeof row.branding === "object" ? row.branding : {},
        features: row.features && typeof row.features === "object" ? row.features : {},
    };
}
export async function resolvePortalTenant(supabase, hostnameValue = currentHostname()) {
    const hostname = normalizePortalHostname(hostnameValue);
    if (isUnboundPortalHostname(hostname))
        return { mode: "unbound", hostname };
    const { data, error } = await supabase.rpc("resolve_website_portal", {
        portal_hostname: hostname,
    });
    if (error)
        throw new Error(error.message || "The website portal hostname could not be verified.");
    const tenant = asTenantRow(data);
    if (!tenant)
        return { mode: "not_found", hostname };
    return {
        mode: "tenant",
        hostname,
        hostType: hostname.endsWith(STANDARD_PORTAL_SUFFIX) ? "standard" : "custom",
        ...tenant,
    };
}
export function scopeWebsitesToPortalTenant(websites, resolution) {
    if (resolution.mode === "unbound")
        return [...websites];
    if (resolution.mode === "not_found")
        return [];
    return websites.filter((website) => website.id === resolution.website_id);
}
export function scopeRowsToPortalTenant(rows, resolution, websiteIdFor) {
    if (resolution.mode === "unbound")
        return [...rows];
    if (resolution.mode === "not_found")
        return [];
    return rows.filter((row) => websiteIdFor(row) === resolution.website_id);
}
export function portalTenantEmptyMessage(resolution) {
    if (resolution.mode === "not_found")
        return "This portal address is not active.";
    if (resolution.mode === "tenant")
        return "Your account does not have access to this website portal.";
    return "No website workspaces are assigned to this account.";
}
