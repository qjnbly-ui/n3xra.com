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

if (!location.pathname.startsWith("/n3xra-records")) {
  if (!document.querySelector('link[data-site-assistant-style]')) {
    const assistantStyle = document.createElement("link");
    assistantStyle.rel = "stylesheet";
    assistantStyle.href = "/assets/site-assistant.css?v=2";
    assistantStyle.dataset.siteAssistantStyle = "true";
    document.head.append(assistantStyle);
  }
  if (!document.querySelector('script[data-site-assistant-script]')) {
    const assistantScript = document.createElement("script");
    assistantScript.type = "module";
    assistantScript.src = "/assets/site-assistant/main.mjs?v=1";
    assistantScript.dataset.siteAssistantScript = "true";
    document.head.append(assistantScript);
  }
}
