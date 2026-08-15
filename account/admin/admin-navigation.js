import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { setStoredActiveOrganizationId } from "/shared/lib/orgs.js";

const overviewLinks = [
  ["/account/", "Dashboard"],
  ["/account/admin/inbox/", "Admin Inbox"],
];

const peopleLinks = [
  ["/account/admin/accounts/", "Accounts"],
  ["/account/admin/platform-admins/", "Administrators"],
];

const customerOperationsLinks = [
  ["/account/admin/support/", "Support Requests"],
  ["/account/admin/billing/", "Billing & Plans"],
  ["/account/admin/operations/", "Operations"],
  ["/account/admin/analytics/", "Site Analytics"],
];

const productWorkspacePaths = new Set([
  "/n3xra-admin/websites/",
  "/n3xra-admin/website-portal/",
  "/n3xra-admin/services/",
  "/n3xra-admin/requests/",
  "/n3xra-admin/proposals/",
  "/n3xra-admin/projects/",
  "/n3xra-admin/onboarding/",
  "/n3xra-admin/assets/",
  "/n3xra-admin/billing/",
  "/n3xra-admin/communications/",
  "/n3xra-admin/communications/websites-forms/",
  "/n3xra-admin/communications/subscribers/",
  "/n3xra-admin/communications/topics-signup/",
  "/n3xra-admin/communications/activity-usage/",
  "/n3xra-admin/communications/email-readiness/",
  "/n3xra-admin/communications/texting-readiness/",
  "/n3xra-admin/communications/pricing-activation/",
  "/n3xra-admin/communications/requests/",
]);

let softNavigationSequence = 0;

const productApps = [
  {
    key: "websites",
    label: "Websites",
    sections: [
      ["workspace", "Organization Workspace", "/n3xra-admin/websites/"],
      ["requests", "Requests", "/n3xra-admin/requests/"],
    ],
    paths: [
      "/n3xra-admin/websites/",
      "/n3xra-admin/website-portal/",
      "/n3xra-admin/services/",
      "/n3xra-admin/requests/",
      "/n3xra-admin/proposals/",
      "/n3xra-admin/projects/",
      "/n3xra-admin/onboarding/",
      "/n3xra-admin/assets/",
      "/n3xra-admin/billing/",
    ],
  },
  {
    key: "records",
    label: "Records",
    sections: [
      ["organizations", "Organizations", "/n3xra-admin/records/organizations/"],
      ["usage", "Usage", "/n3xra-admin/records/usage/"],
    ],
  },
  {
    key: "partners",
    label: "Partners",
    sections: [["applications", "Review applications", "/n3xra-admin/partners/"]],
  },
  {
    key: "communications",
    label: "Communications",
    sections: [
      ["workspace", "Organization Workspace", "/n3xra-admin/communications/"],
      ["requests", "Requests", "/n3xra-admin/communications/requests/"],
    ],
    paths: [
      "/n3xra-admin/communications/",
      "/n3xra-admin/communications/websites-forms/",
      "/n3xra-admin/communications/subscribers/",
      "/n3xra-admin/communications/topics-signup/",
      "/n3xra-admin/communications/activity-usage/",
      "/n3xra-admin/communications/email-readiness/",
      "/n3xra-admin/communications/texting-readiness/",
      "/n3xra-admin/communications/pricing-activation/",
      "/n3xra-admin/communications/requests/",
    ],
  },
];

const companyLinks = [
  ["/account/admin/applications/", "Career Applications"],
  ["/account/admin/business-info/", "Company Information"],
  ["/account/admin/files/", "Internal Files"],
  ["/account/admin/business-framework/", "Strategy & Policies"],
];

const toolLinks = [
  ["/account/admin/codebase-ai/", "Codebase AI"],
  ["/account/notifications/", "Account Announcements"],
];

const ownershipLinks = [
  ["/account/admin/investment/", "Ownership & Governance"],
];

const archivedLinks = [
  ["/virals/", "Virals"],
  ["/ai-music-generator/app/", "AI Music"],
];

function normalizePath(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "");
  return path ? `${path}/` : "/";
}

function isCurrentPath(href) {
  return normalizePath(window.location.pathname) === normalizePath(href);
}

function linkMarkup([href, label], mobile = false) {
  const current = isCurrentPath(href) ? " is-current" : "";
  const hasInboxBadge = normalizePath(href) === "/account/admin/inbox/";
  const classes = [mobile ? "site-menu-link" : "", current.trim(), hasInboxBadge ? "has-admin-inbox-badge" : ""].filter(Boolean).join(" ");
  const className = classes ? ` class="${classes}"` : "";
  const badge = hasInboxBadge ? '<span class="admin-inbox-nav-badge" data-admin-inbox-count hidden></span>' : "";
  const content = hasInboxBadge ? `<span class="admin-inbox-nav-label">${label}</span>${badge}` : label;
  return `<a${className} href="${href}">${content}</a>`;
}

export async function refreshAdminInboxBadge() {
  const badges = [...document.querySelectorAll("[data-admin-inbox-count]")];
  if (!badges.length || !hasConfig()) return;
  try {
    const supabase = createBrowserSupabase();
    const { count, error } = await supabase.from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .neq("product", "utilities")
      .is("read_at", null)
      .is("archived_at", null)
      .is("deleted_at", null);
    if (error) throw error;
    const unreadCount = Number(count || 0);
    badges.forEach((badge) => {
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badge.hidden = unreadCount < 1;
      badge.setAttribute("aria-label", `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`);
    });
  } catch {
    badges.forEach((badge) => { badge.hidden = true; });
  }
}

function productAppFromUrl() {
  if (isCurrentPath("/account/admin/product-apps/")) {
    const key = new URLSearchParams(window.location.search).get("app");
    return productApps.find((app) => app.key === key) || null;
  }
  const currentPath = normalizePath(window.location.pathname);
  return productApps.find((app) => {
    const paths = app.paths || app.sections.map(([, , href]) => href);
    return paths.some((href) => normalizePath(href) === currentPath);
  }) || null;
}

function productHref(app, section = app.sections[0]?.[0]) {
  return app.sections.find(([key]) => key === section)?.[2] || app.sections[0]?.[2] || "/account/admin/";
}

function productMarkup(app, mobile = false) {
  const activeApp = productAppFromUrl();
  const onApp = activeApp?.key === app.key;
  const currentPath = normalizePath(window.location.pathname);
  const selectedSection = isCurrentPath("/account/admin/product-apps/")
    ? new URLSearchParams(window.location.search).get("section") || app.sections[0]?.[0]
    : app.sections.find(([, , href]) => href === currentPath)?.[0] || app.sections[0]?.[0];
  const itemClass = mobile ? "site-menu-link admin-nav-child" : "admin-nav-child";
  const parentClass = mobile ? "site-menu-link admin-nav-product" : "admin-nav-product";
  const children = app.sections.map(([section, label]) => {
    const current = onApp && section === selectedSection ? " is-current" : "";
    return `<a class="${itemClass}${current}" href="${productHref(app, section)}">${label}</a>`;
  }).join("");
  return `<a class="${parentClass}${onApp ? " is-current" : ""}" href="${productHref(app)}" aria-expanded="${onApp}">${app.label}</a><div class="admin-nav-children" data-product-app-items="${app.key}"${onApp ? "" : " hidden"}>${children}</div>`;
}

function mobileSection({ title, meta = "", className = "", content }) {
  return `
    <section class="admin-mobile-nav-section${className ? ` ${className}` : ""}">
      <div class="admin-mobile-nav-heading">
        <p class="site-mobile-menu-title">${title}</p>
        ${meta ? `<span>${meta}</span>` : ""}
      </div>
      ${content}
    </section>
  `;
}

function mobileNavigationMarkup() {
  const activeApp = productAppFromUrl();
  const links = (items) => `<div class="admin-mobile-link-grid">${items.map((item) => linkMarkup(item, true)).join("")}</div>`;
  const productContent = `<div class="admin-mobile-product-list">${productApps.map((app) => {
    const isActive = activeApp?.key === app.key;
    return `
      <div class="admin-mobile-product${isActive ? " is-active" : ""}">
        ${productMarkup(app, true)}
      </div>
    `;
  }).join("")}</div>`;

  return `
    <div class="admin-mobile-menu-intro">
      <div>
        <span>Admin workspace</span>
        <strong>Navigation</strong>
      </div>
      <span class="admin-mobile-menu-hint">Choose an area</span>
    </div>
    <div class="admin-mobile-menu-utilities">
      <a class="site-menu-link" href="/account/">Dashboard</a>
      <button class="site-menu-link" type="button" data-admin-mobile-sign-out>Sign out</button>
    </div>
    ${mobileSection({ title: "Overview", content: links(overviewLinks.slice(1)) })}
    ${mobileSection({ title: "People & Access", content: links(peopleLinks) })}
    ${mobileSection({ title: "Customer Operations", content: links(customerOperationsLinks) })}
    ${mobileSection({ title: "Products", meta: `${productApps.length} workspaces`, className: "admin-mobile-products", content: productContent })}
    ${mobileSection({ title: "Company", content: links(companyLinks) })}
    ${mobileSection({ title: "Tools", content: `${links(toolLinks)}<button class="site-menu-link admin-nav-action" type="button" data-open-internal-records>Internal Records</button>` })}
    ${mobileSection({ title: "Ownership", content: links(ownershipLinks) })}
    ${mobileSection({ title: "Archived Apps", content: links(archivedLinks) })}
  `;
}

function navigationMarkup(mobile = false) {
  if (mobile) return mobileNavigationMarkup();

  const labelClass = mobile ? "site-mobile-menu-head" : "";
  const label = (text) => mobile
    ? `<div class="${labelClass}"><p class="site-mobile-menu-title">${text}</p></div>`
    : `<p class="portal-nav-label">${text}</p>`;
  const divider = mobile ? "" : '<div class="portal-nav-divider"></div>';

  return [
    label("Overview"),
    overviewLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("People & Access"),
    peopleLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Customer Operations"),
    customerOperationsLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Products"),
    productApps.map((app) => productMarkup(app, mobile)).join(""),
    divider,
    label("Company"),
    companyLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Tools"),
    toolLinks.map((item) => linkMarkup(item, mobile)).join(""),
    '<button class="admin-nav-action" type="button" data-open-internal-records>Internal Records</button>',
    divider,
    label("Ownership"),
    ownershipLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Archived Apps"),
    archivedLinks.map((item) => linkMarkup(item, mobile)).join(""),
  ].join("");
}

function closeMobileMenu() {
  const menu = document.querySelector(".site-mobile-menu.is-open");
  if (!menu) return;
  menu.classList.remove("is-open");
  menu.hidden = true;
  document.querySelector(`[data-site-menu-toggle][aria-controls="${menu.id}"]`)?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("site-menu-is-open");
}

export function renderAdminNavigation({ desktopScrollTop } = {}) {
  document.querySelector(".site-topbar")?.classList.add("admin-topbar");
  document.querySelectorAll(".portal-nav").forEach((nav) => {
    const scrollTop = Number.isFinite(desktopScrollTop) ? desktopScrollTop : nav.scrollTop;
    nav.innerHTML = navigationMarkup(false);
    nav.setAttribute("aria-label", "N3XRA administration");
    requestAnimationFrame(() => { nav.scrollTop = scrollTop; });
  });

  document.querySelectorAll(".site-mobile-menu").forEach((nav) => {
    const scrollTop = nav.scrollTop;
    nav.innerHTML = navigationMarkup(true);
    nav.setAttribute("aria-label", "N3XRA administration menu");
    requestAnimationFrame(() => { nav.scrollTop = scrollTop; });
  });

  if (isCurrentPath("/account/admin/investment/")) {
    window.dispatchEvent(new Event("hashchange"));
  }
  refreshAdminInboxBadge();
}

async function openInternalRecords(button) {
  if (!hasConfig() || !button) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Opening Internal Records…";
  try {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "open-admin-records-workspace" },
    });
    if (error || data?.error) throw new Error(error?.message || data?.error || "Internal Records is unavailable.");
    const organizationId = String(data?.organizationId || "").trim();
    if (!organizationId) throw new Error("Internal Records is unavailable.");
    setStoredActiveOrganizationId(organizationId);
    window.location.assign("/n3xra-records/library");
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    window.alert(error instanceof Error ? error.message : "Internal Records could not be opened.");
  }
}

export function arrangeAdminWorkspace() {
  const main = document.querySelector("main.account-admin-page");
  main?.querySelectorAll(":scope > .portal-heading, :scope > .portal-layout > .portal-workspace > .admin-workspace-banner")
    .forEach((heading) => heading.remove());
}

function isWorkspaceUrl(url) {
  if (url.pathname === "/account/admin/inbox/") return false;
  return url.origin === window.location.origin
    && (url.pathname.startsWith("/account/admin/")
      || url.pathname === "/account/notifications/"
      || productWorkspacePaths.has(normalizePath(url.pathname)));
}

function installWorkspaceStyles(page) {
  document.getElementById("admin-soft-view-style")?.remove();
  const styles = [...page.head.querySelectorAll("style")].map((style) => style.textContent).join("\n").trim();
  if (styles) {
    const style = document.createElement("style");
    style.id = "admin-soft-view-style";
    style.textContent = styles;
    document.head.append(style);
  }

  page.head.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = new URL(link.getAttribute("href"), window.location.origin).href;
    const alreadyLoaded = [...document.head.querySelectorAll('link[rel="stylesheet"]')]
      .some((existing) => existing.href === href);
    if (!alreadyLoaded) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = href;
      document.head.append(stylesheet);
    }
  });
}

function syncAdminPageClasses(page) {
  const isAdminPageClass = (className) => className.endsWith("-admin-page")
    || className.startsWith("admin-")
    || className.startsWith("website-admin-")
    || ["portal-loading", "portal-denied", "product-native-admin"].includes(className);
  [...document.body.classList].filter(isAdminPageClass).forEach((className) => document.body.classList.remove(className));
  [...page.body.classList].filter(isAdminPageClass).forEach((className) => document.body.classList.add(className));
}

function syncAdminPageOverlays(page) {
  const selector = ":scope > dialog, :scope > .portal-status";
  document.body.querySelectorAll(selector).forEach((element) => element.remove());
  page.body.querySelectorAll(selector).forEach((element) => {
    document.body.append(document.importNode(element, true));
  });
}

function websitePageController(page) {
  const excluded = new Set([
    "/account/admin/product-shell.js",
    "/n3xra-admin/website-admin-workspace.js",
    "/client-portal/portal-shell.js",
  ]);
  return [...page.querySelectorAll('script[type="module"][src]')]
    .map((script) => new URL(script.getAttribute("src"), window.location.origin))
    .reverse()
    .find((scriptUrl) => !excluded.has(scriptUrl.pathname));
}

async function startWebsiteWorkspace(page) {
  const productShell = await import("/account/admin/product-shell.js?v=10");
  await productShell.startProductShell();
  const websiteWorkspace = await import("/n3xra-admin/website-admin-workspace.js?v=12");
  websiteWorkspace.startWebsiteAdminWorkspace();

  const controllerUrl = websitePageController(page);
  if (!controllerUrl) throw new Error("This Websites page has no controller.");
  softNavigationSequence += 1;
  controllerUrl.searchParams.set("admin_view", String(softNavigationSequence));
  await import(controllerUrl.href);
}

export async function navigateAdminWorkspace(destination, { history = "push", desktopScrollTop } = {}) {
  const url = new URL(destination, window.location.origin);
  if (!isWorkspaceUrl(url)) {
    window.location.assign(url.href);
    return;
  }

  if (url.href === window.location.href) return;

  if (url.pathname === window.location.pathname && url.hash) {
    window.location.hash = url.hash;
    renderAdminNavigation();
    return;
  }

  const response = await fetch(url.href, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Unable to open that admin workspace.");
  const page = new DOMParser().parseFromString(await response.text(), "text/html");
  const nextMain = page.querySelector("main.portal-shell");
  const currentMain = document.querySelector("main.portal-shell");
  if (!nextMain || !currentMain) {
    window.location.assign(url.href);
    return;
  }

  installWorkspaceStyles(page);
  document.body.classList.remove("admin-ready");
  syncAdminPageClasses(page);
  const importedMain = document.importNode(nextMain, true);
  const currentNavigation = currentMain.querySelector(":scope > .portal-layout > .portal-nav");
  const importedNavigation = importedMain.querySelector(":scope > .portal-layout > .portal-nav");
  if (currentNavigation && importedNavigation) importedNavigation.replaceWith(currentNavigation);
  currentMain.replaceWith(importedMain);
  syncAdminPageOverlays(page);
  document.documentElement.classList.toggle("website-admin-root", websiteWorkspacePaths.has(normalizePath(url.pathname)));
  document.body.dataset.adminView = page.body.dataset.adminView || "";
  document.title = page.title || document.title;
  if (history === "push") window.history.pushState({}, "", url.href);
  renderAdminNavigation({ desktopScrollTop });

  window.__n3xraAdminSoftNavigation = true;
  try {
    if (websiteWorkspacePaths.has(normalizePath(url.pathname))) {
      await startWebsiteWorkspace(page);
    } else if (url.pathname === "/account/notifications/") {
      const notifications = await import("/account/notifications/notifications.js");
      await notifications.startNotifications();
    } else {
      const admin = await import("/account/admin/admin.js?v=28");
      await admin.startAdmin();
    }
  } finally {
    window.__n3xraAdminSoftNavigation = false;
  }
}

document.addEventListener("click", (event) => {
  const internalRecordsButton = event.target.closest("[data-open-internal-records]");
  if (internalRecordsButton) {
    openInternalRecords(internalRecordsButton);
    return;
  }

  const mobileSignOut = event.target.closest("[data-admin-mobile-sign-out]");
  if (mobileSignOut) {
    closeMobileMenu();
    document.getElementById("admin-sign-out")?.click();
    return;
  }

  const link = event.target.closest(".portal-nav a, .site-mobile-menu a, .website-organization-navigation a, .website-project-stage-navigation a");
  if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, window.location.origin);
  if (link.closest(".site-mobile-menu")) closeMobileMenu();
  if (!isWorkspaceUrl(url)) return;
  event.preventDefault();
  const desktopScrollTop = document.querySelector(".portal-nav")?.scrollTop;
  navigateAdminWorkspace(url.href, { desktopScrollTop }).catch(() => window.location.assign(url.href));
});

window.addEventListener("popstate", () => {
  navigateAdminWorkspace(window.location.href, { history: "none" }).catch(() => window.location.reload());
});

renderAdminNavigation();
