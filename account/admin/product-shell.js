import { renderAdminNavigation } from "/account/admin/admin-navigation.js?v=10";
import { initializeAdminSelects } from "/account/admin/admin-select.js?v=1";
import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

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

async function hasFullAdminAccess() {
  if (!hasConfig()) return false;
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
    return false;
  }
  if (isPlatformAdminEmail(session.user.email)) return true;
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "get-platform-admin-access" },
  });
  if (error || !["owner", "admin"].includes(String(data?.admin?.role || ""))) {
    window.location.replace("/account");
    return false;
  }
  return true;
}

async function startProductShell() {
  if (!(await hasFullAdminAccess())) return;
  prepareNativeProductShell();
  renderAdminNavigation();
  initializeAdminSelects();
  addRecordsNavigationCompatibility();
}

startProductShell().catch(() => window.location.replace("/account"));
