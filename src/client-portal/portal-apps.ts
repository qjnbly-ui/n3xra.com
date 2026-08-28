import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
import { isBrandedPortalHostname, resolvePortalTenant } from "./tenant-context.js";

interface ProductRow {
  product_key: string;
  name: string;
  description: string;
  portal_path: string;
  icon_key: string;
  sort_order: number;
  status: string;
  client_portal_available: boolean;
}

interface EntitlementRow {
  organization_id: string;
  product_key: string;
  status: string;
  portal_enabled: boolean;
  product: ProductRow | ProductRow[] | null;
}

interface ProductMemberAccessRow {
  product_key: string;
}

interface PortalApp {
  key: string;
  name: string;
  description: string;
  href: string;
  iconKey: string;
  badge: string;
  sortOrder: number;
  organizationId?: string;
}

interface PortalFeatureRow {
  feature_key: string;
  enabled: boolean;
}

const appGrid = document.querySelector<HTMLElement>("#portal-app-grid");
const appStatus = document.querySelector<HTMLElement>("#portal-app-status");
const HIDDEN_CUSTOMER_PRODUCT_KEYS = new Set(["ai_music", "music", "virals"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safePortalPath(value: string): string {
  const path = String(value || "").trim();
  return /^\/(?!\/)[^\s]*$/.test(path) ? path : "";
}

function productFrom(row: EntitlementRow): ProductRow | null {
  if (Array.isArray(row.product)) return row.product[0] || null;
  return row.product;
}

function statusBadge(value: string): string {
  if (value === "trialing") return "Trial";
  if (value === "past_due") return "Payment attention";
  return "Available";
}

function appMarkup(app: PortalApp): string {
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

function renderApps(apps: PortalApp[]): void {
  if (!appGrid) return;
  appGrid.innerHTML = apps.sort((a, b) => a.sortOrder - b.sortOrder).map(appMarkup).join("");
  if (appStatus) appStatus.hidden = true;
}

function openOnlyAvailableApp(app: PortalApp): void {
  if (app.organizationId) setStoredActiveOrganizationId(app.organizationId);
  window.location.replace(app.href);
}

function routeOrRenderApps(apps: PortalApp[], { preferWebsite = false } = {}): void {
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
  if (website) openOnlyAvailableApp(website);
}

function defaultWebsiteHref(features: Record<string, boolean> = {}): string {
  if (features.progress !== false) return "/project-workspace/";
  if (features.files_assets !== false) return "/client-portal/#files-assets";
  if (features.services !== false) return "/client-portal/services/";
  if (features.analytics === true) return "/client-portal/analytics/";
  if (features.billing !== false) return "/client-portal/billing/";
  if (features.support !== false) return "/client-portal/#support";
  return "/client-portal/#new-project";
}

function websiteApp(features: Record<string, boolean> = {}): PortalApp {
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

function requestedWebsiteHref(href: string): string {
  const websiteId = new URLSearchParams(window.location.search).get("website") || "";
  if (!UUID_PATTERN.test(websiteId)) return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set("website", websiteId);
  return `${url.pathname}${url.search}${url.hash}`;
}

function organizationAdminApp(organizationId: string): PortalApp {
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

async function canManageOrganization(supabase: NonNullable<ReturnType<typeof createBrowserSupabase>>, organizationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("client_portal_team_snapshot", { input_organization_id: organizationId });
  if (error) return false;
  return Boolean((data as { can_manage?: boolean } | null)?.can_manage);
}

async function loadPortalApps(): Promise<void> {
  if (!appGrid || !hasConfig()) return;
  // Hash routes are website-workspace sections, not the application chooser.
  // Leaving early prevents the single-app dashboard redirect from replacing
  // Files & Assets, Support, or New Project with Project Workspace.
  if (window.location.hash && window.location.hash !== "#overview") return;
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) return;

  const tenant = await resolvePortalTenant(supabase);
  if (tenant.mode === "unbound") {
    window.location.replace(requestedWebsiteHref(websiteApp().href));
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
  if (websiteError) throw websiteError;

  const { data: featureRows, error: featureError } = await supabase
    .from("website_portal_features")
    .select("feature_key,enabled")
    .eq("website_id", tenant.website_id);
  if (featureError) throw featureError;
  const features = Object.fromEntries(((featureRows || []) as PortalFeatureRow[]).map((feature) => [feature.feature_key, feature.enabled]));
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
  if (error) throw error;

  const [{ data: memberAccess, error: memberAccessError }, { data: platformAdmin, error: platformAdminError }] = await Promise.all([
    supabase
      .from("organization_product_member_access")
      .select("product_key")
      .eq("organization_id", organizationId)
      .eq("user_id", session.user.id)
      .eq("status", "active"),
    supabase.rpc("is_platform_admin"),
  ]);
  if (memberAccessError) throw memberAccessError;
  if (platformAdminError) throw platformAdminError;
  const allowedProductKeys = new Set(((memberAccess || []) as ProductMemberAccessRow[]).map((access) => access.product_key));

  for (const entitlement of (data || []) as EntitlementRow[]) {
    const product = productFrom(entitlement);
    if (platformAdmin !== true && !allowedProductKeys.has(String(product?.product_key || ""))) continue;
    if (HIDDEN_CUSTOMER_PRODUCT_KEYS.has(String(product?.product_key || "").toLowerCase())) continue;
    const path = safePortalPath(product?.portal_path || "");
    if (!product || !path || product.status !== "active" || !product.client_portal_available) continue;
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
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-portal-app-organization]");
  if (!link) return;
  setStoredActiveOrganizationId(link.dataset.portalAppOrganization || "");
});

void loadPortalApps().catch((error: unknown) => {
  console.warn("Portal applications could not be loaded.", error);
  openOnlyAvailableApp(websiteApp());
});
