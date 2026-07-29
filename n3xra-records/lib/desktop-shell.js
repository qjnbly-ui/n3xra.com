const DESKTOP_SHELL_BREAKPOINT = 981;

const RECORDS_PRIMARY_LINKS = [
  { key: "account", label: "Account", href: "/n3xra-records/account" },
  { key: "library", label: "Library", href: "/n3xra-records/library" },
  { key: "files", label: "Files", href: "/n3xra-records/files.html" },
  { key: "messages", label: "Messages", href: "/n3xra-records/messages.html" },
  { key: "meeting-notes", label: "Meeting Notes", href: "/n3xra-records/meeting-notes" },
];

function normalizePathname(value = window.location.pathname) {
  return String(value || "")
    .replace(/\/index\.html$/i, "")
    .replace(/\.html$/i, "")
    .replace(/\/+$/, "");
}

function getActiveRecordsPage() {
  const pathname = normalizePathname();
  if (pathname.endsWith("/n3xra-records/account")) return "account";
  if (pathname.endsWith("/n3xra-records/library")) return "library";
  if (pathname.endsWith("/n3xra-records/files") || pathname.endsWith("/n3xra-records/documents")) return "files";
  if (pathname.endsWith("/n3xra-records/messages")) return "messages";
  if (
    pathname.endsWith("/n3xra-records/meeting-notes") ||
    pathname.endsWith("/n3xra-records/all-meeting-notes") ||
    pathname.endsWith("/n3xra-records/recordings") ||
    pathname.endsWith("/n3xra-records/all-recordings")
  ) return "meeting-notes";
  return "";
}

function renderPrimaryLink(item, activePage) {
  const isActive = item.key === activePage;
  return `<a href="${item.href}"${isActive ? ' class="is-active" aria-current="page"' : ""}>${item.label}</a>`;
}

function buildDesktopNavigation(activePage) {
  const navigation = document.createElement("aside");
  navigation.className = "records-desktop-nav records-shared-desktop-nav";
  navigation.setAttribute("aria-label", "Records navigation");
  navigation.innerHTML = `
    <p class="records-desktop-nav-label">N3XRA Records</p>
    <nav class="records-desktop-nav-links records-desktop-nav-primary">
      ${RECORDS_PRIMARY_LINKS.map((item) => renderPrimaryLink(item, activePage)).join("")}
    </nav>
  `;
  return navigation;
}

function installDesktopHeader() {
  const topbarInner = document.querySelector(".topbar > .topbar-inner");
  if (!topbarInner || topbarInner.querySelector(".records-desktop-appbar")) return;

  const appbar = document.createElement("div");
  appbar.className = "records-desktop-appbar";
  appbar.innerHTML = `
    <a class="records-desktop-app-brand" href="/n3xra-records/library" aria-label="N3XRA Records home">
      <img src="/assets/n3xra_logo_transparent_small.png" alt="">
      <span>N3XRA</span>
      <i aria-hidden="true"></i>
      <strong>Records</strong>
    </a>
    <div class="records-desktop-app-actions">
      <a href="/account/">Dashboard</a>
      <button type="button" data-records-desktop-signout>Sign out</button>
    </div>
  `;

  appbar.querySelector("[data-records-desktop-signout]")?.addEventListener("click", () => {
    document.getElementById("mobile-logout-button")?.click();
  });

  topbarInner.prepend(appbar);
}

function installDesktopShell() {
  const body = document.body;
  const shell = body?.querySelector(":scope > .shell");
  const main = shell?.querySelector(":scope > main.main");
  if (!body || !shell || !main) return;

  installDesktopHeader();

  if (body.classList.contains("records-account-page") || shell.querySelector(":scope > .records-desktop-frame")) return;

  const frame = document.createElement("div");
  frame.className = "records-desktop-frame";
  frame.append(buildDesktopNavigation(getActiveRecordsPage()), main);
  shell.append(frame);
  body.classList.add("records-shared-desktop-shell-page");

  if (window.innerWidth >= DESKTOP_SHELL_BREAKPOINT) {
    main.scrollTop = 0;
  }
}

installDesktopShell();
