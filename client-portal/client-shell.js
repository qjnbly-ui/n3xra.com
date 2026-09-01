import { initializeClientWorkspaceContext } from "/client-portal/client-workspace-context.js?v=23";
import { initializePortalBrandShell } from "/client-portal/brand-shell.js?v=2";
import { initializePendingProposalNotice } from "/client-portal/pending-proposal-notice.js?v=2";
import { isBrandedPortalHostname } from "/client-portal/tenant-context.js";

void initializePortalBrandShell();

const brandedPortal = isBrandedPortalHostname();
const projectCardsRoute = normalizePath(window.location.pathname).startsWith("/client-portal/project-cards/");
const appSections = [
  ...(brandedPortal
    ? [{ key: "dashboard", label: "Apps Dashboard", href: "/client-portal/", path: "/client-portal/", view: "dashboard", requiresAdditionalApps: true }]
    : []),
  ...(brandedPortal
    ? [{ key: "records", label: "Records", href: "/n3xra-records/library", path: "/n3xra-records/library", requiresRecordsApp: true }]
    : []),
  { key: "team", label: "Organization Admin", href: "/client-portal/team/", path: "/client-portal/team/", requiresOrganizationAdmin: true },
  ...(brandedPortal || normalizePath(window.location.pathname) === "/client-portal/communications/"
    ? [{ key: "communications", label: "Communications", href: "/client-portal/communications/", path: "/client-portal/communications/", requiresCommunicationsApp: brandedPortal }]
    : []),
  ...(projectCardsRoute
    ? [{ key: "project-cards", label: "Project Cards", href: "/client-portal/project-cards/", path: "/client-portal/project-cards/" }]
    : []),
  { key: "support", label: "Support", href: "/client-portal/#support", path: "/client-portal/", hash: "#support", view: "support", feature: "support" },
];
const websiteSections = [
  { key: "project", label: "Progress", href: "/project-workspace/", path: "/project-workspace/", feature: "progress" },
  { key: "assets", label: "Files & Assets", href: "/client-portal/#files-assets", path: "/client-portal/", hash: "#files-assets", view: "files", feature: "files_assets" },
  { key: "publishing", label: "Website Publishing", href: "/client-portal/publishing/", path: "/client-portal/publishing/", feature: "publishing" },
  { key: "services", label: "Services & Ownership", href: "/client-portal/services/", path: "/client-portal/services/", feature: "services" },
  { key: "analytics", label: "Analytics", href: "/client-portal/analytics/", path: "/client-portal/analytics/", feature: "analytics" },
  { key: "billing", label: "Billing", href: "/client-portal/billing/", path: "/client-portal/billing/", feature: "billing" },
  { key: "new-request", label: "Start a New Project", href: "/client-portal/#new-project", path: "/client-portal/", hash: "#new-project", view: "new-request" },
];

const projectStageRoutes = [
  ["progress", "Progress", "/project-workspace/"],
  ["onboarding", "Onboarding", "/website-onboarding/"],
  ["proposals", "Proposal", "/proposals/"],
];

const routeDetails = {
  "/client-portal/": { key: "dashboard", kicker: "Business portal", title: "Apps Dashboard", description: "Open the business tools and subscriptions available to this organization." },
  "/client-portal/services/": { key: "services", kicker: "Website workspace", title: "Services & Ownership", description: "Services, domains, source code, and ownership records for this organization." },
  "/client-portal/analytics/": { key: "analytics", kicker: "Website performance", title: "Analytics", description: "A clear view of traffic, popular content, referrals, audience, and devices." },
  "/client-portal/publishing/": { key: "publishing", kicker: "Website publishing", title: "From the Greenhouse", description: "Create and publish new pieces, farm stories, updates, and customer moments." },
  "/client-portal/team/": { key: "team", kicker: "Owner controls", title: "Organization Admin", description: "Invite people, assign organization roles, and manage access from one shared control center." },
  "/client-portal/communications/": { key: "communications", kicker: "Organization workspace", title: "N3XRA Communications", description: "Send permission-based text and email updates, manage subscribers, and review delivery activity." },
  "/client-portal/project-cards/": { key: "project-cards", kicker: "Your workspace", title: "Project Cards", description: "Build reusable resource hubs and control where every physical NFC card opens." },
  "/client-portal/project-cards/editor/": { key: "project-cards-editor", kicker: "Project cards", title: "Project Editor", description: "Arrange the resources people see when they scan a card assigned to this project." },
  "/client-portal/project-cards/activate/": { key: "project-cards-activate", kicker: "Project cards", title: "Activate a Card", description: "Create a permanent card identity and prepare a physical NFC card for use." },
  "/project-workspace/": { key: "progress", kicker: "Website workspace", title: "Progress", description: "Current stage, milestones, timing, and the next step for this website." },
  "/proposals/": { key: "proposals", kicker: "Website workspace", title: "Proposals", description: "Review proposal details, versions, pricing, and decisions." },
  "/website-onboarding/": { key: "onboarding", kicker: "Website workspace", title: "Onboarding", description: "Provide the information and files needed to move this website forward." },
  "/client-portal/billing/": { key: "billing", kicker: "Account services", title: "Payments & Billing", description: "Activate services, review subscriptions, invoices, and secure payment controls in one place." },
};

const homeViews = {
  "": { key: "dashboard", kicker: "Business portal", title: "Apps Dashboard", description: "Open the business tools and subscriptions available to this organization." },
  "#files-assets": { key: "assets", kicker: "Website workspace", title: "Files & Assets", description: "Open folders, preview files, upload assets, and manage approved website content." },
  "#support": { key: "support", kicker: "Business portal", title: "Support", description: "Get help with this website, subscribed apps, account access, billing, or active project work." },
  "#new-project": { key: "new-request", kicker: "New work", title: "Start a new project", description: "Request separate work without changing the organization selected here." },
};

function normalizePath(pathname) {
  const value = String(pathname || "/").replace(/\/+$/, "");
  return value ? `${value}/` : "/";
}

function currentDetails() {
  const path = normalizePath(window.location.pathname);
  return path === "/client-portal/" && homeViews[window.location.hash] !== undefined
    ? homeViews[window.location.hash]
    : routeDetails[path];
}

function isCurrentSection(section) {
  if (section.key === "project" && ["/project-workspace/", "/proposals/", "/website-onboarding/"].includes(normalizePath(window.location.pathname))) return true;
  if (section.key === "project-cards" && normalizePath(window.location.pathname).startsWith("/client-portal/project-cards/")) return true;
  if (normalizePath(window.location.pathname) !== normalizePath(section.path)) return false;
  if (section.hash) return window.location.hash === section.hash;
  return section.path !== "/client-portal/" || (section.key === "dashboard" && !window.location.hash);
}

function sectionMarkup(section, onPortalHome) {
  const current = isCurrentSection(section) ? " is-current" : "";
  const availability = `${section.requiresAdditionalApps ? " data-client-app-dashboard hidden" : ""}${section.requiresRecordsApp ? " data-client-records-app hidden" : ""}${section.requiresCommunicationsApp ? " data-client-communications-app hidden" : ""}${section.requiresOrganizationAdmin ? " data-client-organization-admin hidden" : ""}${section.feature ? ` data-client-feature="${section.feature}" hidden` : ""}${section.key === "project" ? " data-client-project-progress" : ""}`;
  if (onPortalHome && section.view) return `<button class="${current.trim()}" type="button" data-portal-view="${section.view}"${availability}>${section.label}</button>`;
  return `<a class="${current.trim()}" href="${section.href}"${availability}>${section.label}</a>`;
}

function mobileSectionMarkup(section) {
  const availability = `${section.requiresAdditionalApps ? " data-client-app-dashboard hidden" : ""}${section.requiresRecordsApp ? " data-client-records-app hidden" : ""}${section.requiresCommunicationsApp ? " data-client-communications-app hidden" : ""}${section.requiresOrganizationAdmin ? " data-client-organization-admin hidden" : ""}${section.feature ? ` data-client-feature="${section.feature}" hidden` : ""}${section.key === "project" ? " data-client-project-progress" : ""}`;
  return `<a class="site-menu-link${isCurrentSection(section) ? " is-current" : ""}" href="${section.href}"${availability}>${section.label}</a>`;
}

function closeClientMobileMenu(menu, toggle) {
  menu.classList.remove("is-open");
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("site-menu-is-open");
}

function ensureClientMobileNavigation(topbar) {
  const inner = topbar?.querySelector(".site-topbar-inner");
  const row = inner?.querySelector(".site-topbar-row");
  const actions = row?.querySelector(".site-nav-actions");
  if (!inner || !row || !actions) return null;

  let menu = inner.querySelector(":scope > .site-mobile-menu");
  if (!menu) {
    menu = document.createElement("nav");
    menu.className = "site-mobile-menu client-mobile-menu";
    menu.id = "client-workspace-menu";
    menu.hidden = true;
    menu.setAttribute("aria-label", "Client portal navigation");
    inner.append(menu);
  }

  let toggle = actions.querySelector("[data-site-menu-toggle]");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.className = "site-menu-toggle";
    toggle.type = "button";
    toggle.dataset.siteMenuToggle = "";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open portal navigation");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    actions.append(toggle);
  }
  toggle.setAttribute("aria-controls", menu.id);

  if (toggle.dataset.siteMenuBound !== "true") {
    toggle.dataset.siteMenuBound = "true";
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("is-open");
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("site-menu-is-open", open);
    });
  }
  if (menu.dataset.clientMenuBound !== "true") {
    menu.dataset.clientMenuBound = "true";
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeClientMobileMenu(menu, toggle);
    });
  }
  return menu;
}

function renderClientNavigation(layout) {
  const nav = layout.querySelector(":scope > .portal-nav");
  if (!nav) return;
  const onPortalHome = normalizePath(window.location.pathname) === "/client-portal/";
  nav.innerHTML = `
    <p class="portal-nav-label">${brandedPortal ? "Apps" : "N3XRA"}</p>
    ${appSections.map((section) => sectionMarkup(section, onPortalHome)).join("")}
    <div class="portal-nav-divider"></div>
    <p class="portal-nav-label">Website Workspace</p>
    ${websiteSections.map((section) => sectionMarkup(section, onPortalHome)).join("")}
  `;
  const mobileNav = document.querySelector(".site-mobile-menu");
  if (mobileNav) {
    mobileNav.innerHTML = `<div class="site-mobile-menu-head"><p class="site-mobile-menu-title">${brandedPortal ? "Apps" : "N3XRA"}</p></div>${appSections.map(mobileSectionMarkup).join("")}<div class="site-mobile-menu-head"><p class="site-mobile-menu-title">Website Workspace</p></div>${websiteSections.map(mobileSectionMarkup).join("")}<div class="client-mobile-menu-utilities"><a class="site-menu-link client-mobile-return" href="${brandedPortal ? "/client-portal/" : "/account/"}" data-client-website-return>${brandedPortal ? "Return to Website" : "Return to Dashboard"}</a><button class="site-menu-link" type="button" data-portal-logout>Sign out</button></div>`;
  }
}

function updatePageState(frame) {
  const details = currentDetails();
  if (!details) return;
  document.body.dataset.clientWorkspaceView = details.key;
  frame.querySelector(".client-workspace-page-title .portal-kicker").textContent = details.kicker;
  frame.querySelector(".client-workspace-page-title h1").textContent = details.title;
  frame.querySelector(".client-workspace-page-description").textContent = details.description;
  frame.querySelectorAll(".website-organization-navigation a").forEach((link) => link.classList.toggle("is-current", link.getAttribute("href") === window.location.pathname || link.getAttribute("href") === `${window.location.pathname}${window.location.hash}`));
}

function buildClientWorkspace() {
  const details = currentDetails();
  const topbar = document.querySelector(".site-topbar");
  const shell = document.querySelector("main.portal-shell");
  const layout = shell?.querySelector(":scope > .portal-layout");
  const workspace = layout?.querySelector(":scope > .portal-workspace");
  const heading = shell?.querySelector(":scope > .portal-heading");
  const picker = shell?.querySelector(":scope > .portal-project-picker");
  if (!details || !shell || !layout || !workspace || workspace.querySelector(":scope > .client-workspace-frame")) return;

  document.body.classList.add("client-portal-shell");
  topbar?.classList.add("client-portal-topbar");
  shell.classList.add("client-portal-page");
  ensureClientMobileNavigation(topbar);
  renderClientNavigation(layout);

  const frame = document.createElement("div");
  frame.className = "client-workspace-frame";
  const contextLayout = document.createElement("div");
  contextLayout.className = "client-workspace-context-layout";
  const contextPanel = document.createElement("aside");
  contextPanel.className = "client-workspace-organization-panel website-admin-organization-panel";
  contextPanel.setAttribute("aria-label", "Current organization");
  const content = document.createElement("div");
  content.className = "client-workspace-content-column";
  const bar = document.createElement("header");
  bar.className = "client-workspace-pagebar";
  bar.innerHTML = '<div class="client-workspace-page-title"><p class="portal-kicker"></p><h1></h1><p class="client-workspace-page-description"></p></div><div class="client-workspace-page-actions"></div>';
  if (["proposals", "onboarding", "progress"].includes(details.key)) {
    bar.querySelector(".client-workspace-page-actions").innerHTML = `<nav class="website-project-stage-navigation" aria-label="Project stages">${projectStageRoutes.map(([key, label, href]) => `<a class="${key === details.key ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}</nav>`;
  }
  const scroll = document.createElement("div");
  scroll.className = "client-workspace-scroll-region";
  [...workspace.children].forEach((child) => scroll.append(child));
  content.append(bar, scroll);
  contextLayout.append(contextPanel, content);
  frame.append(contextLayout);
  workspace.replaceChildren(frame);

  if (picker) {
    picker.classList.add("client-workspace-legacy-picker");
    frame.append(picker);
  }
  heading?.remove();
  updatePageState(frame);
  initializeClientWorkspaceContext(contextPanel, { pageKey: details.key }).then(() => initializePendingProposalNotice()).catch((error) => {
    contextPanel.innerHTML = '<div class="website-organization-context-error"><strong>Organization workspace unavailable</strong><p></p></div>';
    contextPanel.querySelector("p").textContent = error?.message || "Unable to load your organizations.";
  });

  window.addEventListener("hashchange", () => updatePageState(frame));
  layout.addEventListener("click", (event) => {
    if (event.target.closest("button[data-portal-view]")) window.requestAnimationFrame(() => updatePageState(frame));
  });
}

buildClientWorkspace();
