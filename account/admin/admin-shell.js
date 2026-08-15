(() => {
  if (document.querySelector("[data-admin-shell-header]")) return;

  const header = document.createElement("header");
  header.className = "site-topbar admin-topbar";
  header.dataset.adminShellHeader = "true";
  header.innerHTML = `
    <div class="site-topbar-inner">
      <div class="site-topbar-row">
        <a class="site-brand" href="/" aria-label="N3XRA home">
          <img src="/assets/n3xra_logo_transparent_small.png" alt="">
          <span>N3XRA</span>
        </a>
        <div class="site-nav-actions">
          <button class="site-menu-link site-assistant-nav-trigger" type="button" data-site-assistant-open aria-expanded="false" aria-controls="site-assistant-layer">Ask N3XRA</button>
          <a class="site-menu-link" href="/account/">Dashboard</a>
          <button class="site-menu-link portal-logout" id="admin-sign-out" type="button" data-admin-sign-out>Sign out</button>
          <button class="site-menu-toggle" data-site-menu-toggle type="button" aria-controls="admin-menu" aria-expanded="false" aria-label="Open admin navigation">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
      <nav class="site-mobile-menu" id="admin-menu" aria-label="N3XRA administration menu" hidden></nav>
    </div>
  `;

  document.body.prepend(header);
})();
