import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
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
  product_key: string;
  status: string;
  portal_enabled: boolean;
  product: ProductRow | ProductRow[] | null;
}

interface OrganizationMembershipRow {
  organization_id: string | null;
}

interface PortalApp {
  key: string;
  name: string;
  description: string;
  href: string;
  iconKey: string;
  badge: string;
  sortOrder: number;
}

const appGrid = document.querySelector<HTMLElement>("#portal-app-grid");
const appStatus = document.querySelector<HTMLElement>("#portal-app-status");

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
  return `<a class="portal-app-card" href="${escapeHtml(app.href)}" data-portal-app="${escapeHtml(app.key)}">
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
  window.location.replace(app.href);
}

function routeOrRenderApps(apps: PortalApp[]): void {
  const [onlyApp] = apps;
  if (apps.length === 1 && onlyApp) {
    openOnlyAvailableApp(onlyApp);
    return;
  }
  renderApps(apps.filter((app) => app.key !== "website"));
}

function websiteApp(): PortalApp {
  return {
    key: "website",
    name: "Website Management",
    description: "Website progress, files, services, billing, and support.",
    href: "/project-workspace/",
    iconKey: "website",
    badge: "",
    sortOrder: 10,
  };
}

async function loadPortalApps(): Promise<void> {
  if (!appGrid || !hasConfig()) return;
  // Hash routes are website-workspace sections, not the application chooser.
  // Leaving early prevents the single-app dashboard redirect from replacing
  // Files & Assets, Support, or New Project with Project Workspace.
  if (window.location.hash) return;
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

  const apps = [websiteApp()];
  const { data: membershipRows, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", session.user.id);
  if (membershipError) throw membershipError;
  const organizationIds = [
    ...new Set(
      ((membershipRows || []) as OrganizationMembershipRow[])
        .map((row) => String(row.organization_id || ""))
        .filter(Boolean),
    ),
  ];
  if (!organizationIds.length) {
    routeOrRenderApps(apps);
    return;
  }

  const { data, error } = await supabase
    .from("organization_product_entitlements")
    .select("product_key,status,portal_enabled,product:n3xra_product_catalog(product_key,name,description,portal_path,icon_key,sort_order,status,client_portal_available)")
    .in("organization_id", organizationIds)
    .eq("portal_enabled", true)
    .in("status", ["trialing", "active", "past_due"]);
  if (error) throw error;

  const renderedProducts = new Set<string>();
  for (const entitlement of (data || []) as EntitlementRow[]) {
    const product = productFrom(entitlement);
    const path = safePortalPath(product?.portal_path || "");
    if (!product || !path || product.status !== "active" || !product.client_portal_available || renderedProducts.has(product.product_key)) continue;
    renderedProducts.add(product.product_key);
    apps.push({
      key: product.product_key,
      name: product.name,
      description: product.description,
      href: path,
      iconKey: product.icon_key,
      badge: statusBadge(entitlement.status),
      sortOrder: Number(product.sort_order || 100),
    });
  }

  routeOrRenderApps(apps);
}

void loadPortalApps().catch((error: unknown) => {
  console.warn("Portal applications could not be loaded.", error);
  openOnlyAvailableApp(websiteApp());
});
