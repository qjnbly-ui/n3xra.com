import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import {
  applyPortalTenantBranding,
  isBrandedPortalHostname,
  resolvePortalTenant,
} from "./tenant-context.js";

function showGenericPortalIdentity(): void {
  document.documentElement.classList.add("portal-white-label-host", "portal-white-label-ready");
  document.title = "Client Management Portal";
  document.querySelectorAll<HTMLAnchorElement>(".site-brand").forEach((brand) => {
    brand.href = "/client-portal/login";
    brand.setAttribute("aria-label", "Client management portal");
    const label = brand.querySelector<HTMLElement>("span");
    if (label) label.textContent = "Client Portal";
    const image = brand.querySelector<HTMLImageElement>("img");
    if (image) {
      image.hidden = true;
      image.alt = "";
      image.removeAttribute("src");
    }
  });
  document.querySelectorAll<HTMLElement>('.site-nav-actions a[href^="/account"], [data-site-assistant-open], [data-site-assistant-layer]').forEach((element) => element.remove());
}

export async function initializePortalBrandShell(): Promise<void> {
  if (!isBrandedPortalHostname()) return;
  document.documentElement.classList.add("portal-white-label-host");
  if (!hasConfig()) {
    showGenericPortalIdentity();
    return;
  }

  try {
    const supabase = createBrowserSupabase();
    if (!supabase) throw new Error("Portal configuration is unavailable.");
    const resolution = await resolvePortalTenant(supabase);
    if (!applyPortalTenantBranding(resolution)) showGenericPortalIdentity();
  } catch {
    showGenericPortalIdentity();
  }
}
