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
  document.querySelectorAll("footer.site-footer.home-footer, footer.cards-footer").forEach(ensureProductFooterCards);

  if (!document.body
    || document.body.hasAttribute("data-disable-site-assistant")
    || location.pathname.startsWith("/n3xra-records")) return;

  ensureAssistantTrigger(document.querySelector(".site-nav-actions"));
  ensureAssistantTrigger(document.querySelector(".site-mobile-menu"), true);
}

function ensureProductFooterCards(footer) {
  if (!footer || footer.dataset.productCardsReady === "true") return;
  footer.dataset.productCardsReady = "true";
  if (!document.querySelector('link[data-footer-products-style]')) {
    const productStyles = document.createElement("link");
    productStyles.rel = "stylesheet";
    productStyles.href = "/assets/product-footer.css?v=1";
    productStyles.dataset.footerProductsStyle = "true";
    document.head.append(productStyles);
  }
  const productSection = document.createElement("section");
  productSection.className = "footer-products page-shell";
  productSection.setAttribute("aria-labelledby", "footer-products-title");
  productSection.innerHTML = `
    <div class="footer-products-heading">
      <p>N3XRA SOFTWARE</p>
      <h2 id="footer-products-title">Products built for real work.</h2>
    </div>
    <nav class="footer-product-grid" aria-label="N3XRA products">
      <a href="/maps/"><span>MAPS</span><strong>N3XRA Maps</strong><small>Assets, infrastructure, layers, and field locations.</small><i>→</i></a>
      <a href="/project-cards/"><span>PROJECT CARDS</span><strong>N3XRA Project Cards</strong><small>Reusable NFC cards connected to live project pages.</small><i>→</i></a>
      <a href="/contact-card/"><span>CONTACT CARD</span><strong>N3XRA Contact Card</strong><small>Your identity, contact details, and links in one place.</small><i>→</i></a>
      <a href="/nexra-communications/"><span>COMMUNICATIONS</span><strong>N3XRA Communications</strong><small>Permission-based text and email communication.</small><i>→</i></a>
      <a href="/records/"><span>RECORDS</span><strong>N3XRA Records</strong><small>Secure documents, files, records, and meeting intelligence.</small><i>→</i></a>
    </nav>`;
  footer.prepend(productSection);
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
