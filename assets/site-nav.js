function isAdminRoute() {
  return Boolean(document.body?.dataset.adminView)
    || location.pathname.startsWith("/account/admin/")
    || location.pathname.startsWith("/n3xra-admin/");
}

function cachedAssistantAudience() {
  try {
    const cached = JSON.parse(sessionStorage.getItem("n3xra-platform-admin-access") || "null");
    const role = String(cached?.admin?.role || "").toLowerCase();
    const fresh = Number.isFinite(cached?.checkedAt)
      && Date.now() - cached.checkedAt < 15 * 60 * 1000;
    if (cached?.version === 2 && cached?.allowed && fresh && ["owner", "admin"].includes(role)) {
      return "admin";
    }
  } catch {
    // A stale display cache must never prevent the navigation from rendering.
  }
  return "public";
}

function assistantAudience() {
  return isAdminRoute() || cachedAssistantAudience() === "admin" ? "admin" : "public";
}

function assistantProductName() {
  return String(document.body?.dataset.assistantProduct || "").trim();
}

function ensureAssistantTrigger(container, mobile = false) {
  if (!container) return null;

  let trigger = container.querySelector("[data-site-assistant-open]");
  if (!trigger) {
    trigger = document.createElement("button");
    trigger.className = mobile
      ? "site-menu-link site-assistant-mobile-trigger"
      : "site-menu-link site-assistant-nav-trigger";
    trigger.type = "button";
    trigger.dataset.siteAssistantOpen = "";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "site-assistant-layer");
    if (mobile) container.append(trigger);
    else container.prepend(trigger);
  }

  const productName = assistantProductName();
  const admin = !productName && assistantAudience() === "admin";
  const label = productName ? `Ask ${productName} AI` : admin ? "Ask Admin AI" : "Ask N3XRA";
  if (trigger.textContent !== label) trigger.textContent = label;
  trigger.classList.toggle("is-admin", admin);
  trigger.removeAttribute("data-assistant-state");

  if (trigger.dataset.siteAssistantBootstrapBound !== "true") {
    trigger.dataset.siteAssistantBootstrapBound = "true";
    trigger.addEventListener("click", () => {
      if (document.documentElement.dataset.siteAssistantReady === "true") return;
      window.__n3xraAssistantOpenRequested = true;
      loadAssistantController();
    });
  }
  return trigger;
}

function bindMenuToggle(toggle) {
  if (toggle.dataset.siteMenuBound === "true") return;
  const menuId = toggle.getAttribute("aria-controls");
  const menu = menuId ? document.getElementById(menuId) : null;
  if (!menu) return;

  toggle.dataset.siteMenuBound = "true";
  toggle.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("is-open");
    menu.hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("site-menu-is-open", isOpen);
  });
}

function initializeVisibleNavigation() {
  document.querySelectorAll("[data-site-menu-toggle]").forEach(bindMenuToggle);

  if (!document.body
    || document.body.hasAttribute("data-disable-site-assistant")
    || location.pathname.startsWith("/n3xra-records")) return;

  ensureAssistantTrigger(document.querySelector(".site-nav-actions"));
  ensureAssistantTrigger(document.querySelector(".site-mobile-menu"), true);
}

function loadAssistantController() {
  if (!document.body
    || document.body.hasAttribute("data-disable-site-assistant")
    || location.pathname.startsWith("/n3xra-records")) return;

  initializeVisibleNavigation();

  if (!document.querySelector('link[data-site-assistant-style]')) {
    const assistantStyle = document.createElement("link");
    assistantStyle.rel = "stylesheet";
    assistantStyle.href = "/assets/site-assistant.css?v=6";
    assistantStyle.dataset.siteAssistantStyle = "true";
    document.head.append(assistantStyle);
  }
  if (!document.querySelector('script[data-site-assistant-script]')) {
    const assistantScript = document.createElement("script");
    assistantScript.type = "module";
    assistantScript.src = "/assets/site-assistant/main.mjs?v=6";
    assistantScript.dataset.siteAssistantScript = "true";
    document.head.append(assistantScript);
  }
}

if (String(window.location.hostname || "").toLowerCase().endsWith(".portal.n3xra.com")) {
  document.documentElement.classList.add("portal-white-label-host");
}

// This file intentionally loads during HTML parsing. Watching the parser lets the
// shared navigation add its final controls before the browser's first paint.
const navigationObserver = new MutationObserver(initializeVisibleNavigation);
navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
initializeVisibleNavigation();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    navigationObserver.disconnect();
    loadAssistantController();
  }, { once: true });
} else {
  navigationObserver.disconnect();
  loadAssistantController();
}
