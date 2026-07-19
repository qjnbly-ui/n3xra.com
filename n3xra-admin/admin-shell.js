const items = [
  ["/n3xra-admin/websites/", "Overview"],
  ["/n3xra-admin/requests/", "Requests"],
  ["/n3xra-admin/proposals/", "Proposals"],
  ["/n3xra-admin/projects/", "Progress"],
  ["/n3xra-admin/onboarding/", "Onboarding"],
  ["/n3xra-admin/assets/", "Files & Assets"],
  ["/support/", "Support"],
];

const actions = document.querySelector(".site-nav-actions");
if (actions) {
  let toggle = actions.querySelector("[data-site-menu-toggle]");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.className = "site-menu-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.dataset.siteMenuToggle = "";
    toggle.innerHTML = "<span></span><span></span><span></span>";
    actions.appendChild(toggle);
  }

  const headerInner = actions.closest(".site-topbar-inner");
  let menu = headerInner?.querySelector(".site-mobile-menu");
  if (!menu && headerInner) {
    menu = document.createElement("nav");
    menu.className = "site-mobile-menu";
    menu.hidden = true;
    headerInner.appendChild(menu);
  }

  if (menu) {
    const menuId = menu.id || "website-admin-menu";
    menu.id = menuId;
    menu.setAttribute("aria-label", "Website administration");
    toggle.setAttribute("aria-controls", menuId);
    const path = window.location.pathname.replace(/index\.html$/, "");
    menu.innerHTML = `
      <div class="site-mobile-menu-head"><p class="site-mobile-menu-title">Website admin</p></div>
      ${items.map(([href, label]) => `<a class="site-menu-link${path === href ? " is-current" : ""}" href="${href}">${label}</a>`).join("")}
      <a class="site-menu-link" href="/client-portal/">Client portal</a>
    `;
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("is-open");
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("site-menu-is-open", open);
    });
  }
}
