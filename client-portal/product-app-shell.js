import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { isBrandedPortalHostname, portalBrandIdentity, resolvePortalTenant } from "./tenant-context.js";

async function initializeProductAppShell() {
  const brand = document.querySelector(".product-app-brand");
  if (!brand || !isBrandedPortalHostname() || !hasConfig()) return;

  try {
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    const identity = portalBrandIdentity(await resolvePortalTenant(supabase));
    if (!identity) return;

    const productName = String(document.body.dataset.assistantProduct || "N3XRA App").trim();
    document.title = `${identity.websiteName} | ${productName}`;
    brand.href = "/client-portal/";
    brand.setAttribute("aria-label", `${identity.websiteName} ${productName} home`);

    const image = brand.querySelector("img");
    if (image) {
      image.hidden = !identity.logoUrl;
      image.alt = identity.logoUrl ? `${identity.websiteName} logo` : "";
      if (identity.logoUrl) image.src = identity.logoUrl;
      else image.removeAttribute("src");
    }

    const name = brand.querySelector("span");
    if (name) name.textContent = identity.websiteName;

    const dashboard = document.querySelector('.product-app-actions a[href="/account/"]');
    if (dashboard) {
      dashboard.href = "/client-portal/";
      dashboard.textContent = "Return to dashboard";
    }
  } catch {
    // Keep the standard N3XRA product identity if tenant branding cannot load.
  }
}

initializeProductAppShell();
