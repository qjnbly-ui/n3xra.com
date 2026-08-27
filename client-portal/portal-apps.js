import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
import { isBrandedPortalHostname, resolvePortalTenant } from "./tenant-context.js";
const appGrid = document.querySelector("#portal-app-grid");
const appStatus = document.querySelector("#portal-app-status");
const HIDDEN_CUSTOMER_PRODUCT_KEYS = new Set(["ai_music", "music", "virals"]);
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function safePortalPath(value) {
    const path = String(value || "").trim();
    return /^\/(?!\/)[^\s]*$/.test(path) ? path : "";
}
function productFrom(row) {
    if (Array.isArray(row.product))
        return row.product[0] || null;
    return row.product;
}
function statusBadge(value) {
    if (value === "trialing")
        return "Trial";
    if (value === "past_due")
        return "Payment attention";
    return "Available";
}
function appMarkup(app) {
    const organizationAttribute = app.organizationId
        ? ` data-portal-app-organization="${escapeHtml(app.organizationId)}"`
        : "";
    return `<a class="portal-app-card" href="${escapeHtml(app.href)}" data-portal-app="${escapeHtml(app.key)}"${organizationAttribute}>
    <span class="portal-app-icon is-${escapeHtml(app.iconKey)}" aria-hidden="true"></span>
    <span class="portal-app-copy">
      <span class="portal-app-badge">${escapeHtml(app.badge)}</span>
      <strong>${escapeHtml(app.name)}</strong>
      <small>${escapeHtml(app.description)}</small>
    </span>
    <span class="portal-app-open" aria-hidden="true">Open</span>
  </a>`;
}
function renderApps(apps) {
    if (!appGrid)
        return;
    appGrid.innerHTML = apps.sort((a, b) => a.sortOrder - b.sortOrder).map(appMarkup).join("");
    if (appStatus)
        appStatus.hidden = true;
}
function openOnlyAvailableApp(app) {
    if (app.organizationId)
        setStoredActiveOrganizationId(app.organizationId);
    window.location.replace(app.href);
}
function routeOrRenderApps(apps, { preferWebsite = false } = {}) {
    const website = apps.find((app) => app.key === "website");
    if (preferWebsite && website && apps.length === 1) {
        openOnlyAvailableApp(website);
        return;
    }
    if (preferWebsite && apps.length > 1) {
        renderApps(apps);
        return;
    }
    const subscribedApps = apps.filter((app) => app.key !== "website");
    const [onlySubscribedApp] = subscribedApps;
    if (subscribedApps.length === 1 && onlySubscribedApp) {
        openOnlyAvailableApp(onlySubscribedApp);
        return;
    }
    if (subscribedApps.length > 1) {
        renderApps(subscribedApps);
        return;
    }
    if (website)
        openOnlyAvailableApp(website);
}
function defaultWebsiteHref(features = {}) {
    if (features.progress !== false)
        return "/project-workspace/";
    if (features.files_assets !== false)
        return "/client-portal/#files-assets";
    if (features.services !== false)
        return "/client-portal/services/";
    if (features.analytics === true)
        return "/client-portal/analytics/";
    if (features.billing !== false)
        return "/client-portal/billing/";
    if (features.support !== false)
        return "/client-portal/#support";
    return "/client-portal/#new-project";
}
function websiteApp(features = {}) {
    return {
        key: "website",
        name: "Website Management",
        description: "Website progress, files, services, billing, and support.",
        href: defaultWebsiteHref(features),
        iconKey: "website",
        badge: "",
        sortOrder: 10,
    };
}
function organizationAdminApp(organizationId) {
    return {
        key: "organization_admin",
        name: "Organization Admin",
        description: "Invite team members, assign organization roles, and manage access.",
        href: `/client-portal/team/?organization=${encodeURIComponent(organizationId)}`,
        iconKey: "organization-admin",
        badge: "Owner controls",
        sortOrder: 90,
        organizationId,
    };
}
async function canManageOrganization(supabase, organizationId) {
    const { data, error } = await supabase.rpc("client_portal_team_snapshot", { input_organization_id: organizationId });
    if (error)
        return false;
    return Boolean(data?.can_manage);
}
async function loadPortalApps() {
    if (!appGrid || !hasConfig())
        return;
    // Hash routes are website-workspace sections, not the application chooser.
    // Leaving early prevents the single-app dashboard redirect from replacing
    // Files & Assets, Support, or New Project with Project Workspace.
    if (window.location.hash && window.location.hash !== "#overview")
        return;
    const supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user)
        return;
    const tenant = await resolvePortalTenant(supabase);
    if (tenant.mode === "unbound") {
        window.location.replace(websiteApp().href);
        return;
    }
    if (tenant.mode !== "tenant") {
        return;
    }
    const { data: website, error: websiteError } = await supabase
        .from("client_websites")
        .select("id,organization_id")
        .eq("id", tenant.website_id)
        .maybeSingle();
    if (websiteError)
        throw websiteError;
    const { data: featureRows, error: featureError } = await supabase
        .from("website_portal_features")
        .select("feature_key,enabled")
        .eq("website_id", tenant.website_id);
    if (featureError)
        throw featureError;
    const features = Object.fromEntries((featureRows || []).map((feature) => [feature.feature_key, feature.enabled]));
    const apps = [websiteApp(features)];
    const organizationId = String(website?.organization_id || "");
    if (!organizationId) {
        routeOrRenderApps(apps, { preferWebsite: isBrandedPortalHostname() });
        return;
    }
    const { data, error } = await supabase
        .from("organization_product_entitlements")
        .select("organization_id,product_key,status,portal_enabled,product:n3xra_product_catalog(product_key,name,description,portal_path,icon_key,sort_order,status,client_portal_available)")
        .eq("organization_id", organizationId)
        .eq("portal_enabled", true)
        .in("status", ["trialing", "active", "past_due"]);
    if (error)
        throw error;
    for (const entitlement of (data || [])) {
        const product = productFrom(entitlement);
        if (HIDDEN_CUSTOMER_PRODUCT_KEYS.has(String(product?.product_key || "").toLowerCase()))
            continue;
        const path = safePortalPath(product?.portal_path || "");
        if (!product || !path || product.status !== "active" || !product.client_portal_available)
            continue;
        const href = product.product_key === "records"
            ? `${path}?support_org=${encodeURIComponent(organizationId)}`
            : path;
        apps.push({
            key: product.product_key,
            name: product.name,
            description: product.description,
            href,
            iconKey: product.icon_key,
            badge: statusBadge(entitlement.status),
            sortOrder: Number(product.sort_order || 100),
            organizationId,
        });
    }
    if (await canManageOrganization(supabase, organizationId)) {
        apps.push(organizationAdminApp(organizationId));
    }
    routeOrRenderApps(apps, { preferWebsite: isBrandedPortalHostname() });
}
appGrid?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-portal-app-organization]");
    if (!link)
        return;
    setStoredActiveOrganizationId(link.dataset.portalAppOrganization || "");
});
void loadPortalApps().catch((error) => {
    console.warn("Portal applications could not be loaded.", error);
    openOnlyAvailableApp(websiteApp());
});
