import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";

const header = document.querySelector(".virals-topbar");
const toggle = document.getElementById("virals-nav-toggle");
const menu = document.getElementById("virals-menu");
const authLink = document.getElementById("virals-header-auth-link");
let accountModal = document.getElementById("virals-account-modal");
let accountCloseButton = document.getElementById("virals-account-close");
let accountSignoutButton = document.getElementById("virals-account-signout");
let accountEmail = document.getElementById("virals-account-email");
let accountPlan = document.getElementById("virals-account-plan");
let accountUsage = document.getElementById("virals-account-usage");
let accountSaved = document.getElementById("virals-account-saved");
let accountStatus = document.getElementById("virals-account-status");
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

function getLoginUrl() {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/virals/";
  return `/n3xra-virals/login/?next=${encodeURIComponent(next)}`;
}

function ensureAccountModal() {
  if (accountModal) return;
  const wrapper = document.createElement("div");
  wrapper.className = "virals-account-modal is-hidden";
  wrapper.id = "virals-account-modal";
  wrapper.setAttribute("role", "dialog");
  wrapper.setAttribute("aria-modal", "true");
  wrapper.setAttribute("aria-labelledby", "virals-account-title");
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <section class="virals-account-card">
      <button class="virals-account-close" id="virals-account-close" type="button" aria-label="Close account settings">Close</button>
      <p class="panel-kicker">N3XRA Virals</p>
      <h2 id="virals-account-title">Account Settings</h2>
      <div class="virals-account-grid">
        <article class="virals-account-stat">
          <span>Email</span>
          <strong id="virals-account-email">Signed in</strong>
        </article>
        <article class="virals-account-stat">
          <span>Plan</span>
          <strong id="virals-account-plan">Free Beta</strong>
        </article>
        <article class="virals-account-stat">
          <span>Usage</span>
          <strong id="virals-account-usage">Beta access</strong>
        </article>
        <article class="virals-account-stat">
          <span>Library</span>
          <strong id="virals-account-saved">Connected</strong>
        </article>
      </div>
      <div class="virals-plan-grid" aria-label="Virals plan options">
        <article class="virals-plan-card is-current">
          <span>Current</span>
          <h3>Free Beta</h3>
          <p>Test the analyzer, compare mode, transcript breakdowns, and saved script library.</p>
          <button type="button" disabled>Current Plan</button>
        </article>
        <article class="virals-plan-card">
          <span>Soon</span>
          <h3>Creator</h3>
          <p>Higher monthly analysis limits, saved cloud frameworks, and posting pack history.</p>
          <button type="button" disabled>Coming Soon</button>
        </article>
        <article class="virals-plan-card">
          <span>Soon</span>
          <h3>Agency</h3>
          <p>Batch comparison, client libraries, and expanded trend intelligence workflows.</p>
          <button type="button" disabled>Coming Soon</button>
        </article>
      </div>
      <div class="virals-account-actions">
        <button class="virals-access-secondary" id="virals-account-signout" type="button">Sign Out</button>
      </div>
      <p class="status" id="virals-account-status">Virals billing and plan management will stay inside this app.</p>
    </section>
  `;
  document.body.appendChild(wrapper);
  accountModal = wrapper;
  accountCloseButton = document.getElementById("virals-account-close");
  accountSignoutButton = document.getElementById("virals-account-signout");
  accountEmail = document.getElementById("virals-account-email");
  accountPlan = document.getElementById("virals-account-plan");
  accountUsage = document.getElementById("virals-account-usage");
  accountSaved = document.getElementById("virals-account-saved");
  accountStatus = document.getElementById("virals-account-status");
}

function renderAccountModal() {
  if (accountEmail) accountEmail.textContent = currentSession?.user?.email || "Signed in";
  if (accountPlan) accountPlan.textContent = "Free Beta";
  if (accountUsage) accountUsage.textContent = currentSession?.user ? "Beta access" : "0 / 3";
  if (accountSaved) accountSaved.textContent = "Connected";
  if (accountStatus) {
    accountStatus.textContent = currentSession?.user
      ? "Virals billing and plan management will stay inside this app."
      : "Log in to connect usage and saved scripts to your Virals account.";
    accountStatus.className = "status";
  }
}

function showAccountModal() {
  if (!currentSession?.user) {
    window.location.assign(getLoginUrl());
    return;
  }
  ensureAccountModal();
  renderAccountModal();
  accountModal?.classList.remove("is-hidden");
  if (accountModal) accountModal.hidden = false;
  document.body.classList.add("modal-open");
  accountCloseButton?.focus();
}

function hideAccountModal() {
  accountModal?.classList.add("is-hidden");
  if (accountModal) accountModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function handleAccountSignout() {
  if (!supabase) return;
  if (accountSignoutButton) accountSignoutButton.disabled = true;
  if (accountStatus) {
    accountStatus.textContent = "Signing out...";
    accountStatus.className = "status";
  }
  try {
    await supabase.auth.signOut();
    currentSession = null;
    hideAccountModal();
    renderAuth();
  } catch (error) {
    if (accountStatus) {
      accountStatus.textContent = error instanceof Error ? error.message : "Unable to sign out.";
      accountStatus.className = "status error";
    }
  } finally {
    if (accountSignoutButton) accountSignoutButton.disabled = false;
  }
}

function bindAccountModal() {
  ensureAccountModal();
  accountCloseButton?.addEventListener("click", hideAccountModal);
  accountModal?.addEventListener("click", (event) => {
    if (event.target === accountModal) hideAccountModal();
  });
  accountSignoutButton?.addEventListener("click", handleAccountSignout);
}

function closeMenu() {
  header?.classList.remove("is-menu-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function renderAuth() {
  if (!authLink) return;
  if (currentSession?.user) {
    authLink.textContent = "Account";
    authLink.href = "#virals-account";
    return;
  }
  authLink.textContent = "Login";
  authLink.href = getLoginUrl();
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

authLink?.addEventListener("click", (event) => {
  if (!currentSession?.user) return;
  event.preventDefault();
  showAccountModal();
  closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    hideAccountModal();
  }
});

prepareMobileMenu();
renderMobileDock();
bindAccountModal();
initAuth();
