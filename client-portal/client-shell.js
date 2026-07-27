const clientSections = [
  { label: "Overview", href: "/client-portal/", path: "/client-portal/", view: "overview" },
  { label: "Services & Ownership", href: "/client-portal/services/", path: "/client-portal/services/" },
  { label: "Progress", href: "/project-workspace/", path: "/project-workspace/" },
  { label: "Proposals", href: "/proposals/", path: "/proposals/" },
  { label: "Onboarding", href: "/website-onboarding/", path: "/website-onboarding/" },
  { label: "Files & Assets", href: "/client-portal/#files-assets", path: "/client-portal/", hash: "#files-assets", view: "files" },
  { label: "Billing", href: "/client-portal/billing/", path: "/client-portal/billing/" },
  { label: "Renewals", placeholder: true },
  { label: "Support", href: "/client-portal/#support", path: "/client-portal/", hash: "#support", view: "support" },
];

function normalizePath(pathname) {
  const value = String(pathname || "/").replace(/\/+$/, "");
  return value ? `${value}/` : "/";
}

function isCurrentSection(section) {
  if (!section.path) return false;
  if (normalizePath(window.location.pathname) !== normalizePath(section.path)) return false;
  if (section.hash) return window.location.hash === section.hash;
  return section.path !== "/client-portal/" || !["#files-assets", "#support", "#new-project"].includes(window.location.hash);
}

function sectionMarkup(section, onPortalHome) {
  if (section.placeholder) return `<span class="is-placeholder">${section.label}</span>`;
  const current = isCurrentSection(section) ? " is-current" : "";
  if (onPortalHome && section.view) {
    return `<button class="${current.trim()}" type="button" data-portal-view="${section.view}">${section.label}</button>`;
  }
  return `<a class="${current.trim()}" href="${section.href}">${section.label}</a>`;
}

function renderClientNavigation(layout) {
  const nav = layout.querySelector(":scope > .portal-nav");
  if (!nav) return;

  const onPortalHome = normalizePath(window.location.pathname) === "/client-portal/";
  nav.innerHTML = `
    <p class="portal-nav-label">Project sections</p>
    ${clientSections.map((section) => sectionMarkup(section, onPortalHome)).join("")}
    <div class="portal-nav-divider"></div>
    <p class="portal-nav-label">New work</p>
    ${onPortalHome
      ? '<button type="button" data-portal-view="new-request">Start a new project</button>'
      : '<a href="/client-portal/#new-project">Start a new project</a>'}
  `;

  const mobileNav = document.querySelector(".site-mobile-menu");
  if (mobileNav) {
    mobileNav.innerHTML = `
      <div class="site-mobile-menu-head"><p class="site-mobile-menu-title">Website portal</p></div>
      ${clientSections.filter((section) => !section.placeholder).map((section) => `
        <a class="site-menu-link${isCurrentSection(section) ? " is-current" : ""}" href="${section.href}">${section.label}</a>
      `).join("")}
      <a class="site-menu-link" href="/client-portal/#new-project">Start a new project</a>
    `;
  }
}

function prepareClientPortalShell() {
  const topbar = document.querySelector(".site-topbar");
  const shell = document.querySelector("main.portal-shell");
  const layout = shell?.querySelector(":scope > .portal-layout");
  const workspace = layout?.querySelector(":scope > .portal-workspace");
  const heading = shell?.querySelector(":scope > .portal-heading");
  const picker = shell?.querySelector(":scope > .portal-project-picker");

  if (!shell || !layout || !workspace) return;

  document.body.classList.add("client-portal-shell");
  topbar?.classList.add("client-portal-topbar");
  shell.classList.add("client-portal-page");
  renderClientNavigation(layout);

  if (!workspace.querySelector(":scope > .client-workspace-banner")) {
    const banner = document.createElement("div");
    banner.className = "client-workspace-banner";
    banner.innerHTML = `
      <p class="portal-kicker">${heading?.querySelector(".portal-kicker")?.textContent?.trim() || "Client services"}</p>
      <strong>${heading?.querySelector("h1")?.textContent?.trim() || "Website Client Portal"}</strong>
      <span>Client workspace</span>
    `;
    workspace.prepend(banner);
  }

  if (picker && picker.parentElement !== workspace) {
    workspace.querySelector(":scope > .client-workspace-banner")?.insertAdjacentElement("afterend", picker);
  }

  heading?.remove();
}

prepareClientPortalShell();
