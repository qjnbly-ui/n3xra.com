import { initializePortalBrandShell } from "./brand-shell.js";
import { isBrandedPortalHostname } from "./tenant-context.js";
export async function initializeRecordsPortalShell() {
    if (!isBrandedPortalHostname())
        return;
    const identity = await initializePortalBrandShell();
    if (!identity)
        return;
    document.body.classList.add("records-portal-host");
    document.title = `${identity.websiteName} | Records`;
    const desktopBrand = document.querySelector(".records-desktop-app-brand");
    if (desktopBrand) {
        desktopBrand.href = "/client-portal/";
        desktopBrand.setAttribute("aria-label", `${identity.websiteName} portal home`);
        const image = desktopBrand.querySelector("img");
        if (image) {
            image.hidden = !identity.logoUrl;
            image.alt = identity.logoUrl ? `${identity.websiteName} logo` : "";
            if (identity.logoUrl)
                image.src = identity.logoUrl;
        }
        const name = desktopBrand.querySelector("span");
        if (name)
            name.textContent = identity.websiteName;
    }
    const mobileBrand = document.querySelector(".brand-home-link");
    if (mobileBrand) {
        mobileBrand.href = "/client-portal/";
        mobileBrand.setAttribute("aria-label", `${identity.websiteName} portal home`);
        const image = mobileBrand.querySelector("img");
        if (image) {
            image.hidden = !identity.logoUrl;
            image.alt = identity.logoUrl ? `${identity.websiteName} logo` : "";
            if (identity.logoUrl)
                image.src = identity.logoUrl;
        }
    }
    document.querySelectorAll(".records-desktop-nav-label").forEach((label) => {
        label.textContent = "Records";
    });
    const actions = document.querySelector(".records-desktop-app-actions");
    const dashboardLink = actions?.querySelector('a[href="/account/"]');
    if (dashboardLink) {
        dashboardLink.href = "/client-portal/";
        dashboardLink.textContent = "Portal home";
    }
    if (actions && identity.websiteUrl && !actions.querySelector("[data-records-portal-return]")) {
        const returnLink = document.createElement("a");
        returnLink.href = identity.websiteUrl;
        returnLink.textContent = `Back to ${identity.websiteName} Website`;
        returnLink.dataset.recordsPortalReturn = "";
        actions.insertBefore(returnLink, actions.querySelector("button"));
    }
}
