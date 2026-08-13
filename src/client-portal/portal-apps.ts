import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
import { resolvePortalTenant } from "./tenant-context.js";

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

const appGrid = document.querySelector<HTMLElement>("#portal-app-grid");
const appStatus = document.querySelector<HTMLElement>("#portal-app-status");
const appSummary = document.querySelector<HTMLElement>("#portal-app-summary");

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
  if (appSummary) {
    appSummary.textContent = apps.length === 1
      ? "Your website workspace is ready. Other subscribed business tools will appear here automatically."
      : `${apps.length} business tools are available through this portal.`;
  }
  if (appStatus) appStatus.hidden = true;
}

function openOnlyAvailableApp(app: PortalApp): void {
  if (app.organizationId) setStoredActiveOrganizationId(app.organizationId);
  window.location.replace(app.href);
}

function routeOrRenderApps(apps: PortalApp[]): void {
  const [onlyApp] = apps;
  if (apps.length === 1 && onlyApp) {
    openOnlyAvailableApp(onlyApp);
    return;
  }
  renderApps(apps);
}

function websiteApp(): PortalApp {
  return {
    key: "website",
    name: "Website Management",
    description: "Website progress, files, services, billing, and support.",
    href: "/project-workspace/",
    iconKey: "website",
    badge: "Included",
    sortOrder: 10,
  };
}

async function loadPortalApps(): Promise<void> {
  if (!appGrid || !hasConfig()) return;
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) return;

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
  if (websiteError) throw websiteError;

  const apps = [websiteApp()];
  const organizationId = String(website?.organization_id || "");
  if (!organizationId) {
    routeOrRenderApps(apps);
    return;
  }

  const { data, error } = await supabase
    .from("organization_product_entitlements")
    .select("organization_id,product_key,status,portal_enabled,product:n3xra_product_catalog(product_key,name,description,portal_path,icon_key,sort_order,status,client_portal_available)")
    .eq("organization_id", organizationId)
    .eq("portal_enabled", true)
    .in("status", ["trialing", "active", "past_due"]);
  if (error) throw error;

  for (const entitlement of (data || []) as EntitlementRow[]) {
    const product = productFrom(entitlement);
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

  routeOrRenderApps(apps);
}

appGrid?.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-portal-app-organization]");
  if (!link) return;
  setStoredActiveOrganizationId(link.dataset.portalAppOrganization || "");
});

void loadPortalApps().catch((error: unknown) => {
  renderApps([websiteApp()]);
  if (appStatus) {
    appStatus.hidden = false;
    appStatus.textContent = error instanceof Error
      ? "Your additional subscribed tools could not be loaded right now."
      : "Your subscribed tools are temporarily unavailable.";
  }
});
