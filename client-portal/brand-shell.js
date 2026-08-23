import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { applyPortalTenantBranding, isBrandedPortalHostname, resolvePortalTenant, } from "./tenant-context.js";
const BRAND_CACHE_KEY = "n3xra.portal.brand.v1";
function readCachedPortalBrand() {
    try {
        const stored = JSON.parse(window.sessionStorage.getItem(BRAND_CACHE_KEY) || "null");
        return stored?.hostname === window.location.hostname && stored.resolution?.mode === "tenant" ? stored.resolution : null;
    }
    catch {
        return null;
    }
}
function writeCachedPortalBrand(resolution) {
    try {
        if (resolution.mode === "tenant")
            window.sessionStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({ hostname: window.location.hostname, resolution }));
        else
            window.sessionStorage.removeItem(BRAND_CACHE_KEY);
    }
    catch {
        // Branding cache is an optional visual optimization.
    }
}
function showGenericPortalIdentity() {
    document.documentElement.classList.add("portal-white-label-host", "portal-white-label-ready");
    document.title = "Client Management Portal";
    document.querySelectorAll(".site-brand").forEach((brand) => {
        brand.href = "/client-portal/login";
        brand.setAttribute("aria-label", "Client management portal");
        const label = brand.querySelector("span");
        if (label)
            label.textContent = "Client Portal";
        const image = brand.querySelector("img");
        if (image) {
            image.hidden = true;
            image.alt = "";
            image.removeAttribute("src");
        }
    });
    document.querySelectorAll('.site-nav-actions a[href^="/account"], [data-site-assistant-open], [data-site-assistant-layer]').forEach((element) => element.remove());
    document.documentElement.classList.remove("portal-brand-pending");
    return null;
}
function showN3xraPortalIdentity() {
    document.title = "N3XRA | Website Management";
    document.querySelectorAll(".site-brand").forEach((brand) => {
        brand.href = "/";
        brand.setAttribute("aria-label", "N3XRA home");
        const label = brand.querySelector("span");
        if (label)
            label.textContent = "N3XRA";
        const image = brand.querySelector("img");
        if (image) {
            image.hidden = false;
            image.alt = "";
            image.src = "/assets/n3xra_logo_transparent_small.png";
        }
    });
    document.documentElement.classList.remove("portal-brand-pending");
    return null;
}
export async function initializePortalBrandShell() {
    if (!isBrandedPortalHostname())
        return showN3xraPortalIdentity();
    document.documentElement.classList.add("portal-white-label-host");
    if (!hasConfig()) {
        showGenericPortalIdentity();
        return null;
    }
    try {
        const cachedBrand = readCachedPortalBrand();
        if (cachedBrand)
            applyPortalTenantBranding(cachedBrand);
        const supabase = createBrowserSupabase();
        if (!supabase)
            throw new Error("Portal configuration is unavailable.");
        const resolution = await resolvePortalTenant(supabase);
        writeCachedPortalBrand(resolution);
        const identity = applyPortalTenantBranding(resolution) || showGenericPortalIdentity();
        document.documentElement.classList.remove("portal-brand-pending");
        return identity;
    }
    catch {
        return showGenericPortalIdentity();
    }
}
