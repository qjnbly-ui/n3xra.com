import { renderAdminNavigation } from "/account/admin/admin-navigation.js?v=7";
import { initializeAdminSelects } from "/account/admin/admin-select.js?v=1";

function createNativeLayout(main) {
  const layout = document.createElement("div");
  layout.className = "portal-layout";
  const nav = document.createElement("nav");
  nav.className = "portal-nav";
  nav.setAttribute("aria-label", "N3XRA administration");
  const workspace = document.createElement("section");
  workspace.className = "portal-workspace";
  [...main.children].forEach((child) => workspace.append(child));
  layout.append(nav, workspace);
  main.append(layout);
}

function prepareNativeProductShell() {
  const main = document.querySelector("main");
  if (!main) return;

  main.classList.add("portal-shell", "account-admin-page", "product-native-page");
  document.body.classList.add("product-native-admin");
  document.querySelector(".site-topbar")?.classList.add("admin-topbar");
  document.querySelectorAll("footer").forEach((footer) => { footer.hidden = true; });

  const layout = main.querySelector(":scope > .portal-layout");
  if (!layout) {
    createNativeLayout(main);
  } else {
    const workspace = layout.querySelector(":scope > .portal-workspace");
    const leadingContent = [...main.children].filter((child) => child !== layout);
    leadingContent.reverse().forEach((child) => workspace?.prepend(child));
  }
}

function addRecordsNavigationCompatibility() {
  if (!window.location.pathname.startsWith("/n3xra-admin/records/")) return;
  document.querySelectorAll(".portal-nav, .site-mobile-menu").forEach((nav) => {
    nav.insertAdjacentHTML("beforeend", '<a class="hidden" href="#organizations" data-organizations-link>Organizations</a><a class="hidden" href="#support-workspace" data-support-workspace-link>Support workspace</a>');
  });
}

prepareNativeProductShell();
renderAdminNavigation();
initializeAdminSelects();
addRecordsNavigationCompatibility();
