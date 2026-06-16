import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";

const header = document.querySelector(".virals-topbar");
const toggle = document.getElementById("virals-nav-toggle");
const menu = document.getElementById("virals-menu");
const authLink = document.getElementById("virals-header-auth-link");
const mobileDockItems = [
  { href: "/virals/", label: "Analyze", icon: "analyze" },
  { href: "/virals/most-searched-videos/", label: "Most Searched", icon: "search" },
  { href: "/virals/saved-scripts/", label: "Saved Scripts", icon: "saved" },
];

let supabase = null;
let currentSession = null;

function normalizePath(path) {
  if (!path) return "/";
  const clean = path.split("#")[0].split("?")[0];
  return clean.endsWith("/") ? clean : `${clean}/`;
}

function isActivePath(href) {
  return normalizePath(window.location.pathname) === normalizePath(href);
}

function prepareMobileMenu() {
  return;
}

function renderMobileDock() {
  if (document.querySelector(".virals-mobile-dock")) return;
  const icons = {
    analyze: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M18.5 3.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"></path></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l5.5-5.5 4 4L20 9"></path><path d="M15 9h5v5"></path></svg>',
    saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.2L7 20z"></path></svg>',
  };
  const dock = document.createElement("nav");
  dock.className = "virals-mobile-dock";
  dock.setAttribute("aria-label", "N3XRA Virals mobile navigation");
  dock.innerHTML = mobileDockItems
    .map((item) => {
      const active = isActivePath(item.href) ? " is-active" : "";
      const primary = item.primary ? " is-primary" : "";
      return `
        <a class="mobile-dock-link${active}${primary}" href="${item.href}" aria-label="${item.label}">
          <span class="mobile-dock-icon mobile-dock-icon-${item.icon}">${icons[item.icon] || ""}</span>
          <span>${item.label}</span>
        </a>
      `;
    })
    .join("");
  document.body.appendChild(dock);
}

function closeMenu() {
  header?.classList.remove("is-menu-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function renderAuth() {
  if (!authLink) return;
  if (currentSession?.user) {
    authLink.textContent = "Account";
    authLink.href = document.getElementById("virals-account-modal") ? "#virals-account" : "/virals/";
    return;
  }
  authLink.textContent = "Login";
  authLink.href = "/n3xra-virals/login/?next=/virals/";
}

async function initAuth() {
  if (!hasConfig()) {
    renderAuth();
    return;
  }
  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase).catch(() => null);
  renderAuth();
  supabase?.auth?.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    renderAuth();
  });
}

toggle?.addEventListener("click", () => {
  const isOpen = header?.classList.toggle("is-menu-open");
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

menu?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

prepareMobileMenu();
renderMobileDock();
initAuth();
