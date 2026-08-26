import { initializeWebsiteOrganizationContext } from "/n3xra-admin/website-admin-context.js?v=7";

const projectStageRoutes = [
  ["progress", "Progress", "/n3xra-admin/projects/"],
  ["onboarding", "Onboarding", "/n3xra-admin/onboarding/"],
  ["proposals", "Proposal", "/n3xra-admin/proposals/"],
];

const mobileWorkspaceRoutes = [
  { keys: ["overview", "new"], label: "Overview", href: "/n3xra-admin/websites/" },
  { keys: ["requests"], label: "Requests", href: "/n3xra-admin/requests/" },
  { keys: ["progress", "onboarding", "proposals"], label: "Project", href: "/n3xra-admin/projects/" },
  { keys: ["assets"], label: "Files", href: "/n3xra-admin/assets/" },
  { keys: ["build"], label: "Build", href: "/n3xra-admin/build-studio/" },
  { keys: ["services"], label: "Services", href: "/n3xra-admin/services/" },
  { keys: ["billing"], label: "Billing", href: "/n3xra-admin/billing/" },
  { keys: ["portal"], label: "Portal", href: "/n3xra-admin/website-portal/" },
];

const routeDetails = {
  "/n3xra-admin/websites/": { key: "overview", kicker: "Websites", title: "Overview", description: "Managed websites, client access, and connected project workspaces." },
  "/n3xra-admin/websites/new/": { key: "new", kicker: "Websites", title: "Add website", description: "Create a managed website record and prepare its client workspace." },
  "/n3xra-admin/website-portal/": { key: "portal", kicker: "Websites", title: "Website Portal", description: "Activate and configure the client-branded website management portal." },
  "/n3xra-admin/services/": { key: "services", kicker: "Websites", title: "Services & Ownership", description: "Providers, domains, repositories, renewals, and ownership records." },
  "/n3xra-admin/requests/": { key: "requests", kicker: "Websites", title: "Requests", description: "Qualify incoming work before it becomes a proposal or project." },
  "/n3xra-admin/proposals/": { key: "proposals", kicker: "Websites", title: "Proposals", description: "Build, review, send, and track client proposals." },
  "/n3xra-admin/projects/": { key: "progress", kicker: "Websites", title: "Progress", description: "Control project status, milestones, dates, and client-facing next steps." },
  "/n3xra-admin/onboarding/": { key: "onboarding", kicker: "Websites", title: "Onboarding", description: "Review intake responses and files after proposal approval." },
  "/n3xra-admin/assets/": { key: "assets", kicker: "Websites", title: "Files & Assets", description: "Review, publish, and manage website files." },
  "/n3xra-admin/build-studio/": { key: "build", kicker: "Websites", title: "Build Studio", description: "Build against the selected website repository with Codex and a live preview." },
  "/n3xra-admin/billing/": { key: "billing", kicker: "Websites", title: "Billing", description: "Manage approved charges, invoices, subscriptions, and Stripe state." },
};

function normalizePath(pathname) {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function prepareWebsiteAdminViewport() {
  const path = normalizePath(window.location.pathname);
  if (!routeDetails[path]) return;

  document.documentElement.classList.add("website-admin-root");
  document.body.classList.add("website-admin-product");
  if (window.matchMedia("(min-width: 801px)").matches && (window.scrollX || window.scrollY)) {
    window.scrollTo(0, 0);
  }
}

function directChildren(parent, selector) {
  return [...parent.children].filter((child) => child.matches(selector));
}

function createMobileWorkspaceNavigation(pageKey) {
  const navigation = document.createElement("nav");
  navigation.className = "website-admin-mobile-navigation";
  navigation.setAttribute("aria-label", "Website workspace sections");
  navigation.innerHTML = mobileWorkspaceRoutes.map(({ keys, label, href }) => {
    const current = keys.includes(pageKey);
    return `<a class="${current ? "is-current" : ""}" href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  const current = navigation.querySelector(".is-current");
  requestAnimationFrame(() => {
    if (!current || navigation.scrollWidth <= navigation.clientWidth) return;
    navigation.scrollLeft = Math.max(0, current.offsetLeft - ((navigation.clientWidth - current.offsetWidth) / 2));
  });
  return navigation;
}

export function startWebsiteAdminWorkspace() {
  const path = normalizePath(window.location.pathname);
  const details = routeDetails[path];
  if (!details) return;
  prepareWebsiteAdminViewport();

  const main = document.querySelector("main");
  if (!main?.classList.contains("product-native-page")) return;
  document.body.classList.add("website-admin-product", `website-admin-view-${details.key}`);
  main?.classList.add("website-admin-page");

  const workspace = main?.querySelector(":scope > .portal-layout > .portal-workspace");
  if (!workspace || workspace.querySelector(":scope > .website-admin-frame")) return;

  if (details.key === "assets") {
    const manager = workspace.querySelector(":scope > .website-assets-manager");
    if (!manager) return;
    // The upload drawer is a sibling of the manager. Keep it in the rebuilt
    // product layout so the Upload images button can reveal and submit it.
    const uploadDrawer = workspace.querySelector(":scope > #admin-asset-upload-form");
    const frame = document.createElement("div");
    frame.className = "website-admin-frame website-admin-assets-frame";
    const contextLayout = document.createElement("div");
    contextLayout.className = "website-admin-context-layout";
    const contextPanel = document.createElement("aside");
    contextPanel.className = "website-admin-organization-panel";
    contextPanel.setAttribute("aria-label", "Current organization");
    const content = document.createElement("div");
    content.className = "website-admin-content-column";
    content.append(manager);
    if (uploadDrawer) content.append(uploadDrawer);
    contextLayout.append(contextPanel, createMobileWorkspaceNavigation(details.key), content);
    frame.append(contextLayout);
    initializeWebsiteOrganizationContext(contextPanel, { pageKey: details.key }).catch((error) => {
      contextPanel.innerHTML = '<div class="website-organization-context-error"><strong>Organization workspace unavailable</strong><p></p></div>';
      contextPanel.querySelector("p").textContent = error?.message || "Unable to load organizations.";
    });
    workspace.replaceChildren(frame);
    return;
  }

  const heading = directChildren(workspace, ".portal-heading")[0];
  const picker = directChildren(workspace, ".portal-project-picker")[0];
  const pageHeads = directChildren(workspace, ".portal-workspace-head");
  const title = heading?.querySelector("h1")?.textContent?.trim() || details.title;
  const kicker = heading?.querySelector(".portal-kicker")?.textContent?.trim() || details.kicker;

  const frame = document.createElement("div");
  frame.className = "website-admin-frame";
  const bar = document.createElement("header");
  bar.className = "website-admin-pagebar";
  bar.innerHTML = `<div class="website-admin-page-title"><p class="portal-kicker"></p><h1></h1><p class="website-admin-page-description"></p></div><div class="website-admin-page-actions"></div>`;
  bar.querySelector(".portal-kicker").textContent = kicker;
  bar.querySelector("h1").textContent = title;
  bar.querySelector(".website-admin-page-description").textContent = details.description;
  const actions = bar.querySelector(".website-admin-page-actions");
  if (["proposals", "onboarding", "progress"].includes(details.key)) {
    const stageNavigation = document.createElement("nav");
    stageNavigation.className = "website-project-stage-navigation";
    stageNavigation.setAttribute("aria-label", "Project stages");
    stageNavigation.innerHTML = projectStageRoutes.map(([key, label, href]) => `<a class="${key === details.key ? "is-current" : ""}" href="${href}">${label}</a>`).join("");
    actions.append(stageNavigation);
  }

  const pickerLabel = picker?.querySelector("label");
  if (pickerLabel) {
    const organizationPicker = details.key !== "requests";
    if (organizationPicker) {
      pickerLabel.classList.add("website-admin-native-context");
    } else {
      pickerLabel.classList.add("website-admin-context-select");
      actions.append(pickerLabel);
    }
  }
  pageHeads.forEach((head) => {
    [...head.children].forEach((child, index) => {
      if (index === 0 && !child.matches("button, a")) return;
      if (child.matches("button, a")) actions.append(child);
      else child.querySelectorAll(":scope > button, :scope > a").forEach((control) => actions.append(control));
    });
  });

  const scroll = document.createElement("div");
  scroll.className = "website-admin-scroll-region";
  [...workspace.children].forEach((child) => {
    if (child === heading || child === picker || pageHeads.includes(child)) return;
    scroll.append(child);
  });
  heading?.remove();
  picker?.remove();
  pageHeads.forEach((head) => head.remove());
  const content = document.createElement("div");
  content.className = "website-admin-content-column";
  content.append(bar, scroll);
  if (pickerLabel?.classList.contains("website-admin-native-context")) content.append(pickerLabel);
  if (details.key === "requests") {
    frame.append(createMobileWorkspaceNavigation(details.key), content);
  } else {
    const contextLayout = document.createElement("div");
    contextLayout.className = "website-admin-context-layout";
    const contextPanel = document.createElement("aside");
    contextPanel.className = "website-admin-organization-panel";
    contextPanel.setAttribute("aria-label", "Current organization");
    contextLayout.append(contextPanel, createMobileWorkspaceNavigation(details.key), content);
    frame.append(contextLayout);
    initializeWebsiteOrganizationContext(contextPanel, { pageKey: details.key }).catch((error) => {
      contextPanel.innerHTML = '<div class="website-organization-context-error"><strong>Organization workspace unavailable</strong><p></p></div>';
      contextPanel.querySelector("p").textContent = error?.message || "Unable to load organizations.";
    });
  }
  workspace.replaceChildren(frame);
}

prepareWebsiteAdminViewport();
window.addEventListener("pageshow", prepareWebsiteAdminViewport);
document.addEventListener("n3xra:product-shell-ready", startWebsiteAdminWorkspace);
if (!window.__n3xraAdminSoftNavigation) startWebsiteAdminWorkspace();
