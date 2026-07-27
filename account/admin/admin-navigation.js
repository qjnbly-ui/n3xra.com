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

function renderAdminNavigation() {
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

renderAdminNavigation();
