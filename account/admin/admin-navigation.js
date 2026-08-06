const accountLinks = [
  ["/account/admin/accounts/", "Accounts & Access"],
  ["/account/admin/platform-admins/", "Platform Admins"],
  ["/account/admin/billing/", "Billing"],
  ["/account/admin/operations/", "Operations"],
  ["/account/admin/support/", "Support"],
  ["/account/notifications/", "Platform Notifications"],
  ["/account/admin/analytics/", "Analytics"],
];

const productApps = [
  {
    key: "websites",
    label: "Website Admin",
    sections: [
      ["overview", "Overview", "/n3xra-admin/websites/"],
      ["services", "Services & Ownership", "/n3xra-admin/services/"],
      ["requests", "Requests", "/n3xra-admin/requests/"],
      ["proposals", "Proposals", "/n3xra-admin/proposals/"],
      ["progress", "Progress", "/n3xra-admin/projects/"],
      ["onboarding", "Onboarding", "/n3xra-admin/onboarding/"],
      ["assets", "Files & Assets", "/n3xra-admin/assets/"],
      ["billing", "Billing", "/n3xra-admin/billing/"],
    ],
  },
  {
    key: "records",
    label: "Records Admin",
    sections: [
      ["organizations", "Organizations", "/n3xra-admin/records/organizations/"],
      ["usage", "Usage", "/n3xra-admin/records/usage/"],
    ],
  },
  {
    key: "utilities",
    label: "Utilities Admin",
    sections: [
      ["organizations", "Organizations", "/n3xra-admin/utilities/"],
      ["onboarding", "Onboarding", "/utilities/onboarding/"],
    ],
  },
  {
    key: "partners",
    label: "Partner Admin",
    sections: [["applications", "Review applications", "/n3xra-admin/partners/"]],
  },
];

const resourceLinks = [
  ["/account/admin/files/", "N3XRA Files"],
  ["/account/admin/business-framework/", "Business Framework"],
  ["/account/admin/codebase-ai/", "Codebase AI"],
];

const investmentLinks = [
  ["shareholders", "Shareholders"],
  ["share-classes", "Share Classes"],
  ["share-ledger", "Share Ledger"],
  ["board-resolutions", "Board Resolutions"],
  ["dividend-history", "Dividend History"],
  ["cap-table", "Cap Table"],
  ["valuation-history", "Company Valuation"],
  ["vesting", "Vesting Schedules"],
  ["voting", "Voting Rights"],
  ["certificates", "Stock Certificates"],
  ["transfers", "Share Transfer Requests"],
  ["buybacks", "Company Buyback Requests"],
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
  const className = mobile ? ` class="site-menu-link${current}"` : current ? ' class="is-current"' : "";
  return `<a${className} href="${href}">${label}</a>`;
}

function productAppFromUrl() {
  if (isCurrentPath("/account/admin/product-apps/")) {
    const key = new URLSearchParams(window.location.search).get("app");
    return productApps.find((app) => app.key === key) || null;
  }
  const currentPath = normalizePath(window.location.pathname);
  return productApps.find((app) => app.sections.some(([, , href]) => href === currentPath)) || null;
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

function investmentMarkup(mobile = false) {
  const onInvestmentPage = isCurrentPath("/account/admin/investment/");
  const itemClass = mobile ? "site-menu-link admin-nav-child" : "admin-nav-child";
  return investmentLinks.map(([section, label]) => {
    const current = onInvestmentPage && window.location.hash === `#${section}` ? " is-current" : "";
    return `<a class="${itemClass}${current}" data-investment-section="${section}" href="/account/admin/investment/#${section}">${label}</a>`;
  }).join("");
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
  const accountContent = `<div class="admin-mobile-link-grid">${accountLinks.map((item) => linkMarkup(item, true)).join("")}</div>`;
  const productContent = `<div class="admin-mobile-product-list">${productApps.map((app) => {
    const isActive = activeApp?.key === app.key;
    return `
      <div class="admin-mobile-product${isActive ? " is-active" : ""}">
        ${productMarkup(app, true)}
      </div>
    `;
  }).join("")}</div>`;
  const resourceContent = `<div class="admin-mobile-link-grid">${resourceLinks.map((item) => linkMarkup(item, true)).join("")}</div>`;
  const onInvestmentPage = isCurrentPath("/account/admin/investment/");

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
    ${mobileSection({ title: "N3XRA Accounts", meta: `${accountLinks.length} areas`, content: accountContent })}
    ${mobileSection({ title: "Product Admin Apps", meta: `${productApps.length} apps`, className: "admin-mobile-products", content: productContent })}
    ${mobileSection({ title: "Internal Resources", content: resourceContent })}
    ${mobileSection({
      title: "Investment",
      content: `
        <button class="site-menu-link admin-nav-expander${onInvestmentPage ? " is-current" : ""}" type="button" data-investment-nav-toggle aria-expanded="${onInvestmentPage}">Investment workspace</button>
        <div class="admin-nav-children" data-investment-nav-items${onInvestmentPage ? "" : " hidden"}>${investmentMarkup(true)}</div>
      `,
    })}
  `;
}

function navigationMarkup(mobile = false) {
  if (mobile) return mobileNavigationMarkup();

  const labelClass = mobile ? "site-mobile-menu-head" : "";
  const label = (text) => mobile
    ? `<div class="${labelClass}"><p class="site-mobile-menu-title">${text}</p></div>`
    : `<p class="portal-nav-label">${text}</p>`;
  const divider = mobile ? "" : '<div class="portal-nav-divider"></div>';
  const onInvestmentPage = isCurrentPath("/account/admin/investment/");
  const buttonClass = mobile ? "site-menu-link admin-nav-expander" : "admin-nav-expander";

  return [
    label("N3XRA Accounts"),
    accountLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Product Admin Apps"),
    productApps.map((app) => productMarkup(app, mobile)).join(""),
    divider,
    label("Internal Resources"),
    resourceLinks.map((item) => linkMarkup(item, mobile)).join(""),
    divider,
    label("Investment"),
    `<button class="${buttonClass}${onInvestmentPage ? " is-current" : ""}" type="button" data-investment-nav-toggle aria-expanded="${onInvestmentPage}">Investment workspace</button>`,
    `<div class="admin-nav-children" data-investment-nav-items${onInvestmentPage ? "" : " hidden"}>${investmentMarkup(mobile)}</div>`,
  ].join("");
}

function bindInvestmentToggle(container) {
  const button = container.querySelector("[data-investment-nav-toggle]");
  const items = container.querySelector("[data-investment-nav-items]");
  if (!button || !items) return;
  button.addEventListener("click", () => {
    const scrollTop = container.scrollTop;
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    items.hidden = expanded;
    requestAnimationFrame(() => { container.scrollTop = scrollTop; });
  });
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
    bindInvestmentToggle(nav);
    requestAnimationFrame(() => { nav.scrollTop = scrollTop; });
  });

  document.querySelectorAll(".site-mobile-menu").forEach((nav) => {
    const scrollTop = nav.scrollTop;
    nav.innerHTML = navigationMarkup(true);
    nav.setAttribute("aria-label", "N3XRA administration menu");
    bindInvestmentToggle(nav);
    requestAnimationFrame(() => { nav.scrollTop = scrollTop; });
  });

  if (isCurrentPath("/account/admin/investment/")) {
    window.dispatchEvent(new Event("hashchange"));
  }
}

export function arrangeAdminWorkspace() {
  const main = document.querySelector("main.account-admin-page");
  const layout = main?.querySelector(":scope > .portal-layout");
  const heading = main?.querySelector(":scope > .portal-heading");
  const workspace = layout?.querySelector(":scope > .portal-workspace");
  if (heading && workspace) {
    const pageName = heading.querySelector("h1")?.textContent?.trim() || "Admin";
    heading.classList.add("admin-workspace-banner");
    heading.innerHTML = `<p class="portal-kicker">N3XRA Administration</p><strong>${pageName}</strong><span>Platform workspace</span>`;
    workspace.prepend(heading);
  }
}

function isWorkspaceUrl(url) {
  return url.origin === window.location.origin
    && (url.pathname.startsWith("/account/admin/") || url.pathname === "/account/notifications/");
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

export async function navigateAdminWorkspace(destination, { history = "push", desktopScrollTop } = {}) {
  const url = new URL(destination, window.location.origin);
  if (!isWorkspaceUrl(url)) {
    window.location.assign(url.href);
    return;
  }

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
  currentMain.replaceWith(document.importNode(nextMain, true));
  document.body.dataset.adminView = page.body.dataset.adminView || "";
  document.title = page.title || document.title;
  if (history === "push") window.history.pushState({}, "", url.href);
  renderAdminNavigation({ desktopScrollTop });

  window.__n3xraAdminSoftNavigation = true;
  try {
    if (url.pathname === "/account/notifications/") {
      const notifications = await import("/account/notifications/notifications.js");
      await notifications.startNotifications();
    } else {
      const admin = await import("/account/admin/admin.js");
      await admin.startAdmin();
    }
  } finally {
    window.__n3xraAdminSoftNavigation = false;
  }
}

document.addEventListener("click", (event) => {
  const mobileSignOut = event.target.closest("[data-admin-mobile-sign-out]");
  if (mobileSignOut) {
    closeMobileMenu();
    document.getElementById("admin-sign-out")?.click();
    return;
  }

  const link = event.target.closest(".portal-nav a, .site-mobile-menu a");
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
