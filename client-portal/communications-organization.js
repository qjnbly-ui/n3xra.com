const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = ["trialing", "active", "past_due"];
function clientWorkspaceWebsiteId(userId) {
    const tenantWebsiteId = String(document.body.dataset.portalWebsiteId || "").trim();
    if (UUID_PATTERN.test(tenantWebsiteId))
        return tenantWebsiteId;
    try {
        const context = JSON.parse(localStorage.getItem("n3xra-client-workspace-context") || "{}");
        if (context?.userId && context.userId !== userId)
            return "";
        return UUID_PATTERN.test(String(context?.websiteId || "")) ? String(context.websiteId) : "";
    }
    catch {
        return "";
    }
}
async function organizationForWebsite(supabase, websiteId) {
    if (!websiteId)
        return "";
    const { data, error } = await supabase.from("client_websites")
        .select("organization_id")
        .eq("id", websiteId)
        .maybeSingle();
    if (error)
        throw error;
    return String(data?.organization_id || "");
}
async function hasActiveEntitlement(supabase, organizationId) {
    if (!UUID_PATTERN.test(organizationId))
        return false;
    const { data, error } = await supabase.from("organization_product_entitlements")
        .select("organization_id")
        .eq("organization_id", organizationId)
        .eq("product_key", "communications")
        .eq("portal_enabled", true)
        .in("status", ACTIVE_STATUSES)
        .maybeSingle();
    if (error)
        throw error;
    return data?.organization_id === organizationId;
}
async function canAdministerOrganization(supabase, organizationId, userId) {
    const [membershipResult, ownerResult, platformAdminResult] = await Promise.all([
        supabase.from("organization_memberships").select("organization_id").eq("organization_id", organizationId).eq("user_id", userId).eq("role", "account_admin").maybeSingle(),
        supabase.from("organizations").select("id").eq("id", organizationId).eq("owner_user_id", userId).maybeSingle(),
        supabase.rpc("is_platform_admin"),
    ]);
    if (membershipResult.error)
        throw membershipResult.error;
    if (ownerResult.error)
        throw ownerResult.error;
    if (platformAdminResult.error)
        throw platformAdminResult.error;
    return Boolean(membershipResult.data?.organization_id || ownerResult.data?.id || platformAdminResult.data === true);
}
async function eligibleOrganization(supabase, organizationId, userId, options) {
    if (!await hasActiveEntitlement(supabase, organizationId))
        return "";
    if (options.requireAccountAdmin && !await canAdministerOrganization(supabase, organizationId, userId))
        return "";
    return organizationId;
}
export async function resolveSelectedCommunicationsOrganization(supabase, userId, options = {}) {
    const selectedWebsiteId = clientWorkspaceWebsiteId(userId);
    const selectedWebsiteOrganizationId = await organizationForWebsite(supabase, selectedWebsiteId);
    const isTenantPortal = Boolean(document.body.dataset.portalWebsiteId);
    if (isTenantPortal) {
        return eligibleOrganization(supabase, selectedWebsiteOrganizationId, userId, options);
    }
    const requestedOrganizationId = String(new URLSearchParams(window.location.search).get("organization") || "").trim();
    if (requestedOrganizationId) {
        return eligibleOrganization(supabase, requestedOrganizationId, userId, options);
    }
    if (selectedWebsiteOrganizationId) {
        return eligibleOrganization(supabase, selectedWebsiteOrganizationId, userId, options);
    }
    const { data, error } = await supabase.from("organization_product_entitlements")
        .select("organization_id")
        .eq("product_key", "communications")
        .eq("portal_enabled", true)
        .in("status", ACTIVE_STATUSES)
        .limit(2);
    if (error)
        throw error;
    const organizationIds = [...new Set((data || []).map((row) => String(row.organization_id || "")).filter(Boolean))];
    return organizationIds.length === 1
        ? eligibleOrganization(supabase, organizationIds[0] || "", userId, options)
        : "";
}
