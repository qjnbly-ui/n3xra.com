document.querySelectorAll("[data-site-menu-toggle]").forEach((toggle) => {
  const menuId = toggle.getAttribute("aria-controls");
  const menu = menuId ? document.getElementById(menuId) : null;
  if (!menu) return;

  toggle.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("is-open");
    menu.hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("site-menu-is-open", isOpen);
  });
});

function isAdminRoute() {
  return Boolean(document.body?.dataset.adminView)
    || location.pathname.startsWith("/account/admin/")
    || location.pathname.startsWith("/n3xra-admin/");
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

  const admin = isAdminRoute();
  trigger.textContent = admin ? "Ask Admin AI" : "Ask N3XRA";
  trigger.classList.toggle("is-admin", admin);
  if (admin) trigger.removeAttribute("data-assistant-state");
  else trigger.dataset.assistantState = "pending";
  return trigger;
}

if (String(window.location.hostname || "").toLowerCase().endsWith(".portal.n3xra.com")) {
  document.documentElement.classList.add("portal-white-label-host");
}

if (!document.body?.hasAttribute("data-disable-site-assistant") && !location.pathname.startsWith("/n3xra-records")) {
  ensureAssistantTrigger(document.querySelector(".site-nav-actions"));
  ensureAssistantTrigger(document.querySelector(".site-mobile-menu"), true);

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
