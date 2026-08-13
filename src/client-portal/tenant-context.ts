export type PortalTenantMode = "unbound" | "tenant" | "not_found";

export interface PortalTenantRow {
  website_id: string;
  website_name: string;
  website_slug: string;
  portal_theme_id: string | null;
  branding: Record<string, unknown>;
  features: Record<string, boolean>;
}

export interface PortalBrandIdentity {
  websiteName: string;
  logoUrl: string;
  faviconUrl: string;
  websiteUrl: string;
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  poweredByLabel: string;
}

export type PortalTenantResolution =
  | { mode: "unbound"; hostname: string }
  | { mode: "not_found"; hostname: string }
  | ({ mode: "tenant"; hostname: string; hostType: "standard" | "custom" } & PortalTenantRow);

interface RpcError {
  message?: string;
}

interface PortalSupabaseClient {
  rpc(
    functionName: string,
    args: Record<string, string>,
  ): Promise<{ data: unknown; error: RpcError | null }>;
}

interface WebsiteIdentity {
  id: string;
}

const BASE_HOSTNAMES = new Set(["", "localhost", "127.0.0.1", "::1", "n3xra.com", "www.n3xra.com"]);
const STANDARD_PORTAL_SUFFIX = ".portal.n3xra.com";
const DEFAULT_PRIMARY_COLOR = "#17231b";
const DEFAULT_ACCENT_COLOR = "#b77946";

function currentHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

export function normalizePortalHostname(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}

export function isUnboundPortalHostname(value: string): boolean {
  const hostname = normalizePortalHostname(value);
  return BASE_HOSTNAMES.has(hostname) || hostname.endsWith(".vercel.app");
}

export function isBrandedPortalHostname(value: string = currentHostname()): boolean {
  return !isUnboundPortalHostname(value);
}

export function portalLoginUrl(nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`): string {
  if (isBrandedPortalHostname()) return "/client-portal/login";
  return `/account?next=${encodeURIComponent(nextPath)}`;
}

export function portalSignedOutUrl(): string {
  if (isBrandedPortalHostname()) return "/client-portal/login?signed_out=1";
  return "/account/";
}

function brandingText(branding: Record<string, unknown>, key: string, fallback = ""): string {
  const value = branding[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function safeWebUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeFontName(value: string, fallback: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9 -]/g, "").trim();
  return normalized || fallback;
}

export function portalBrandIdentity(resolution: PortalTenantResolution): PortalBrandIdentity | null {
  if (resolution.mode !== "tenant") return null;
  const branding = resolution.branding;
  return {
    websiteName: resolution.website_name,
    logoUrl: safeWebUrl(brandingText(branding, "logo_url")),
    faviconUrl: safeWebUrl(brandingText(branding, "favicon_url")),
    websiteUrl: safeWebUrl(brandingText(branding, "website_url")),
    primaryColor: safeColor(brandingText(branding, "primary_color"), DEFAULT_PRIMARY_COLOR),
    accentColor: safeColor(brandingText(branding, "accent_color"), DEFAULT_ACCENT_COLOR),
    headingFont: safeFontName(brandingText(branding, "heading_font"), "Fraunces"),
    bodyFont: safeFontName(brandingText(branding, "body_font"), "Manrope"),
    poweredByLabel: brandingText(branding, "powered_by_label"),
  };
}

function updateFavicon(href: string): void {
  if (!href) return;
  let favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.append(favicon);
  }
  favicon.href = href;
}

export function applyPortalTenantBranding(resolution: PortalTenantResolution): PortalBrandIdentity | null {
  if (resolution.mode !== "tenant") return null;
  const identity = portalBrandIdentity(resolution);
  if (!identity) return null;

  const root = document.documentElement;
  root.classList.add("portal-white-label-host", "portal-white-label-ready");
  root.style.setProperty("--portal-deep", identity.primaryColor);
  root.style.setProperty("--portal-accent", identity.accentColor);
  root.style.setProperty("--portal-heading-font", `"${identity.headingFont}"`);
  root.style.setProperty("--portal-body-font", `"${identity.bodyFont}"`);
  document.body.dataset.portalWebsiteId = resolution.website_id;
  document.title = `${identity.websiteName} | Management Portal`;
  updateFavicon(identity.faviconUrl || identity.logoUrl);

  document.querySelectorAll<HTMLAnchorElement>(".site-brand").forEach((brand) => {
    brand.href = identity.websiteUrl || "/client-portal/";
    brand.setAttribute("aria-label", `${identity.websiteName} management portal`);
    const label = brand.querySelector<HTMLElement>("span");
    if (label) label.textContent = identity.websiteName;
    const image = brand.querySelector<HTMLImageElement>("img");
    if (image) {
      image.hidden = !identity.logoUrl;
      image.alt = identity.logoUrl ? `${identity.websiteName} logo` : "";
      if (identity.logoUrl) image.src = identity.logoUrl;
      else image.removeAttribute("src");
    }
  });

  document.querySelectorAll<HTMLElement>('.site-nav-actions a[href^="/account"], [data-site-assistant-open], [data-site-assistant-layer]').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>(".site-nav-actions").forEach((actions) => {
    let provider = actions.querySelector<HTMLElement>("[data-portal-provider-label]");
    if (!provider) {
      provider = document.createElement("span");
      provider.className = "portal-provider-label";
      provider.dataset.portalProviderLabel = "";
      actions.prepend(provider);
    }
    provider.hidden = !identity.poweredByLabel;
    provider.textContent = identity.poweredByLabel;
  });

  document.querySelectorAll<HTMLElement>('[data-portal-business-name]').forEach((element) => {
    element.textContent = identity.websiteName;
  });
  document.querySelectorAll<HTMLImageElement>('[data-portal-business-logo]').forEach((image) => {
    image.hidden = !identity.logoUrl;
    image.alt = identity.logoUrl ? `${identity.websiteName} logo` : "";
    if (identity.logoUrl) image.src = identity.logoUrl;
    else image.removeAttribute("src");
  });
  document.querySelectorAll<HTMLElement>('[data-portal-provider-label]').forEach((element) => {
    element.hidden = !identity.poweredByLabel;
    element.textContent = identity.poweredByLabel;
  });

  return identity;
}

function asTenantRow(value: unknown): PortalTenantRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Partial<PortalTenantRow>;
  if (typeof row.website_id !== "string" || !row.website_id) return null;
  return {
    website_id: row.website_id,
    website_name: typeof row.website_name === "string" ? row.website_name : "Website portal",
    website_slug: typeof row.website_slug === "string" ? row.website_slug : "",
    portal_theme_id: typeof row.portal_theme_id === "string" ? row.portal_theme_id : null,
    branding: row.branding && typeof row.branding === "object" ? row.branding : {},
    features: row.features && typeof row.features === "object" ? row.features : {},
  };
}

export async function resolvePortalTenant(
  supabase: PortalSupabaseClient,
  hostnameValue: string = currentHostname(),
): Promise<PortalTenantResolution> {
  const hostname = normalizePortalHostname(hostnameValue);
  if (isUnboundPortalHostname(hostname)) return { mode: "unbound", hostname };

  const { data, error } = await supabase.rpc("resolve_website_portal", {
    portal_hostname: hostname,
  });
  if (error) throw new Error(error.message || "The website portal hostname could not be verified.");

  const tenant = asTenantRow(data);
  if (!tenant) return { mode: "not_found", hostname };
  return {
    mode: "tenant",
    hostname,
    hostType: hostname.endsWith(STANDARD_PORTAL_SUFFIX) ? "standard" : "custom",
    ...tenant,
  };
}

export function scopeWebsitesToPortalTenant<T extends WebsiteIdentity>(
  websites: readonly T[],
  resolution: PortalTenantResolution,
): T[] {
  if (resolution.mode === "unbound") return [...websites];
  if (resolution.mode === "not_found") return [];
  return websites.filter((website) => website.id === resolution.website_id);
}

export function scopeRowsToPortalTenant<T>(
  rows: readonly T[],
  resolution: PortalTenantResolution,
  websiteIdFor: (row: T) => string | null | undefined,
): T[] {
  if (resolution.mode === "unbound") return [...rows];
  if (resolution.mode === "not_found") return [];
  return rows.filter((row) => websiteIdFor(row) === resolution.website_id);
}

export function portalTenantEmptyMessage(resolution: PortalTenantResolution): string {
  if (resolution.mode === "not_found") return "This portal address is not active.";
  if (resolution.mode === "tenant") return "Your account does not have access to this website portal.";
  return "No website workspaces are assigned to this account.";
}
