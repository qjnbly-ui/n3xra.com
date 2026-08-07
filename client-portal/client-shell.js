import { initializeClientWorkspaceContext } from "/client-portal/client-workspace-context.js?v=1";

const clientSections = [
  { key: "overview", label: "Overview", href: "/client-portal/", path: "/client-portal/", view: "overview" },
  { key: "services", label: "Services & Ownership", href: "/client-portal/services/", path: "/client-portal/services/" },
  { key: "progress", label: "Progress", href: "/project-workspace/", path: "/project-workspace/" },
  { key: "proposals", label: "Proposals", href: "/proposals/", path: "/proposals/" },
  { key: "onboarding", label: "Onboarding", href: "/website-onboarding/", path: "/website-onboarding/" },
  { key: "assets", label: "Files & Assets", href: "/client-portal/#files-assets", path: "/client-portal/", hash: "#files-assets", view: "files" },
  { key: "billing", label: "Billing", href: "/client-portal/billing/", path: "/client-portal/billing/" },
  { key: "support", label: "Support", href: "/client-portal/#support", path: "/client-portal/", hash: "#support", view: "support" },
];

const routeDetails = {
  "/client-portal/": { key: "overview", kicker: "Website workspace", title: "Overview", description: "Website details, access, and the work connected to this organization." },
  "/client-portal/services/": { key: "services", kicker: "Website workspace", title: "Services & Ownership", description: "Services, domains, source code, and ownership records for this organization." },
  "/project-workspace/": { key: "progress", kicker: "Website workspace", title: "Progress", description: "Current stage, milestones, timing, and the next step for this website." },
  "/proposals/": { key: "proposals", kicker: "Website workspace", title: "Proposals", description: "Review proposal details, versions, pricing, and decisions." },
  "/website-onboarding/": { key: "onboarding", kicker: "Website workspace", title: "Onboarding", description: "Provide the information and files needed to move this website forward." },
  "/client-portal/billing/": { key: "billing", kicker: "Website workspace", title: "Billing", description: "Payment status, invoices, subscriptions, and secure billing controls." },
};

const homeViews = {
  "#files-assets": { key: "assets", kicker: "Website workspace", title: "Files & Assets", description: "Open folders, preview files, upload assets, and manage approved website content." },
  "#support": { key: "support", kicker: "Website workspace", title: "Support", description: "Get help with this website, account access, billing, or active project work." },
  "#new-project": { key: "overview", kicker: "New work", title: "Start a new project", description: "Request separate work without changing the organization selected here." },
};

function normalizePath(pathname) {
  const value = String(pathname || "/").replace(/\/+$/, "");
  return value ? `${value}/` : "/";
}

function currentDetails() {
  const path = normalizePath(window.location.pathname);
  return path === "/client-portal/" && homeViews[window.location.hash]
    ? homeViews[window.location.hash]
    : routeDetails[path];
}

function isCurrentSection(section) {
  if (normalizePath(window.location.pathname) !== normalizePath(section.path)) return false;
  if (section.hash) return window.location.hash === section.hash;
  return section.path !== "/client-portal/" || !["#files-assets", "#support", "#new-project"].includes(window.location.hash);
}

function sectionMarkup(section, onPortalHome) {
  const current = isCurrentSection(section) ? " is-current" : "";
  if (onPortalHome && section.view) return `<button class="${current.trim()}" type="button" data-portal-view="${section.view}">${section.label}</button>`;
  return `<a class="${current.trim()}" href="${section.href}">${section.label}</a>`;
}

function renderClientNavigation(layout) {
  const nav = layout.querySelector(":scope > .portal-nav");
  if (!nav) return;
  const onPortalHome = normalizePath(window.location.pathname) === "/client-portal/";
  nav.innerHTML = `
    <p class="portal-nav-label">Website portal</p>
    ${clientSections.map((section) => sectionMarkup(section, onPortalHome)).join("")}
    <div class="portal-nav-divider"></div>
    <p class="portal-nav-label">New work</p>
    ${onPortalHome ? '<button type="button" data-portal-view="new-request">Start a new project</button>' : '<a href="/client-portal/#new-project">Start a new project</a>'}
  `;
  const mobileNav = document.querySelector(".site-mobile-menu");
  if (mobileNav) {
    mobileNav.innerHTML = `<div class="site-mobile-menu-head"><p class="site-mobile-menu-title">Website portal</p></div>${clientSections.map((section) => `<a class="site-menu-link${isCurrentSection(section) ? " is-current" : ""}" href="${section.href}">${section.label}</a>`).join("")}<a class="site-menu-link" href="/client-portal/#new-project">Start a new project</a>`;
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
  bar.innerHTML = '<div class="client-workspace-page-title"><p class="portal-kicker"></p><h1></h1><p class="client-workspace-page-description"></p></div>';
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
  initializeClientWorkspaceContext(contextPanel, { pageKey: details.key }).catch((error) => {
    contextPanel.innerHTML = '<div class="website-organization-context-error"><strong>Organization workspace unavailable</strong><p></p></div>';
    contextPanel.querySelector("p").textContent = error?.message || "Unable to load your organizations.";
  });

  window.addEventListener("hashchange", () => updatePageState(frame));
  layout.addEventListener("click", (event) => {
    if (event.target.closest("[data-portal-view]")) window.requestAnimationFrame(() => updatePageState(frame));
  });
}

buildClientWorkspace();
