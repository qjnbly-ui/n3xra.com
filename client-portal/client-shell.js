function prepareClientPortalShell() {
  const topbar = document.querySelector(".site-topbar");
  const shell = document.querySelector("main.portal-shell");
  const layout = shell?.querySelector(":scope > .portal-layout");
  const workspace = layout?.querySelector(":scope > .portal-workspace");
  const heading = shell?.querySelector(":scope > .portal-heading");
  const picker = shell?.querySelector(":scope > .portal-project-picker");

  if (!shell || !layout || !workspace) return;

  document.body.classList.add("client-portal-shell");
  topbar?.classList.add("client-portal-topbar");
  shell.classList.add("client-portal-page");

  if (!workspace.querySelector(":scope > .client-workspace-banner")) {
    const banner = document.createElement("div");
    banner.className = "client-workspace-banner";
    banner.innerHTML = `
      <p class="portal-kicker">${heading?.querySelector(".portal-kicker")?.textContent?.trim() || "Client services"}</p>
      <strong>${heading?.querySelector("h1")?.textContent?.trim() || "Website Client Portal"}</strong>
      <span>Client workspace</span>
    `;
    workspace.prepend(banner);
  }

  if (picker && picker.parentElement !== workspace) {
    workspace.querySelector(":scope > .client-workspace-banner")?.insertAdjacentElement("afterend", picker);
  }

  heading?.remove();
}

prepareClientPortalShell();
