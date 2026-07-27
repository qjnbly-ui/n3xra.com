const accountLinks = [
  ["/account/admin/accounts/", "Accounts & Access"],
  ["/account/admin/platform-admins/", "Platform Admins"],
  ["/account/admin/billing/", "Billing"],
  ["/account/admin/support/", "Support"],
  ["/account/notifications/", "Platform Notifications"],
];

const productLinks = [
  ["/n3xra-admin/websites/", "Website Admin"],
  ["/n3xra-admin/records/", "Records Admin"],
  ["/n3xra-admin/utilities/", "Utilities Admin"],
  ["/n3xra-admin/partners/", "Partner Admin"],
];

const resourceLinks = [
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

function isCurrentPath(href) {
  return window.location.pathname.replace(/\/+$/, "/") === href;
}

function linkMarkup([href, label], mobile = false) {
  const current = isCurrentPath(href) ? " is-current" : "";
  const className = mobile ? ` class="site-menu-link${current}"` : current ? ' class="is-current"' : "";
  return `<a${className} href="${href}">${label}</a>`;
}

function investmentMarkup(mobile = false) {
  const onInvestmentPage = isCurrentPath("/account/admin/investment/");
  const itemClass = mobile ? "site-menu-link admin-nav-child" : "admin-nav-child";
  return investmentLinks.map(([section, label]) => {
    const current = onInvestmentPage && window.location.hash === `#${section}` ? " is-current" : "";
    return `<a class="${itemClass}${current}" data-investment-section="${section}" href="/account/admin/investment/#${section}">${label}</a>`;
  }).join("");
}

function navigationMarkup(mobile = false) {
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
    productLinks.map((item) => linkMarkup(item, mobile)).join(""),
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
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    items.hidden = expanded;
  });
}

export function renderAdminNavigation() {
  document.querySelectorAll(".portal-nav").forEach((nav) => {
    nav.innerHTML = navigationMarkup(false);
    nav.setAttribute("aria-label", "N3XRA administration");
    bindInvestmentToggle(nav);
  });

  document.querySelectorAll(".site-mobile-menu").forEach((nav) => {
    nav.innerHTML = navigationMarkup(true);
    bindInvestmentToggle(nav);
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
  if (heading && workspace) workspace.prepend(heading);
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

export async function navigateAdminWorkspace(destination, { history = "push" } = {}) {
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
  renderAdminNavigation();

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
  const link = event.target.closest(".portal-nav a, .site-mobile-menu a");
  if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, window.location.origin);
  if (!isWorkspaceUrl(url)) return;
  event.preventDefault();
  navigateAdminWorkspace(url.href).catch(() => window.location.assign(url.href));
});

window.addEventListener("popstate", () => {
  navigateAdminWorkspace(window.location.href, { history: "none" }).catch(() => window.location.reload());
});

renderAdminNavigation();
