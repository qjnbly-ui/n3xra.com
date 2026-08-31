import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") return htmlFiles(target);
    return entry.isFile() && entry.name === "index.html" ? [target] : [];
  }));
  return files.flat();
}

async function allHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") return allHtmlFiles(target);
    return entry.isFile() && entry.name.endsWith(".html") ? [target] : [];
  }));
  return files.flat();
}

function extractHomeFooter(html) {
  const start = html.indexOf('<footer class="site-footer home-footer">');
  if (start < 0) return null;
  const end = html.indexOf("</footer>", start);
  return end < 0 ? null : html.slice(start, end + "</footer>".length);
}

test("pages opting into the homepage footer keep its exact shared content", async () => {
  const [canonicalHtml, pages] = await Promise.all([
    projectFile("index.html"),
    allHtmlFiles(projectRoot),
  ]);
  const canonicalFooter = extractHomeFooter(canonicalHtml);
  const matchingPages = [];

  assert.ok(canonicalFooter, "the homepage must provide the canonical home footer");
  for (const file of pages) {
    const html = await readFile(file, "utf8");
    if (!html.includes("site-footer home-footer")) continue;
    const relativeFile = path.relative(projectRoot, file);
    matchingPages.push(relativeFile);
    assert.equal(extractHomeFooter(html), canonicalFooter, `${relativeFile} must match the homepage footer`);
  }

  assert.ok(matchingPages.length > 1, "the shared home footer must be used beyond the homepage");
});

test("public account links render one stable label without an authentication repaint", async () => {
  const pages = [
    "index.html",
    "careers/index.html",
    "invest/index.html",
    "partners/index.html",
    "privacy/index.html",
    "project-pulse/index.html",
    "projects/index.html",
    "records/index.html",
    "services/index.html",
    "support/index.html",
    "terms/index.html",
    "updates/index.html",
  ];
  const htmlPages = await Promise.all(pages.map(projectFile));

  htmlPages.forEach((html, index) => {
    assert.doesNotMatch(html, /master-auth-link\.js|site-auth-link\.js/, `${pages[index]} must not load a label-repainting controller`);
    assert.doesNotMatch(html, /data-master-auth-link|data-site-auth-link/, `${pages[index]} must not retain obsolete dynamic-label hooks`);
    assert.doesNotMatch(html, /class="[^"]*site-auth-link[^"]*"[^>]*>Login</, `${pages[index]} must not paint Login before the final action`);
  });
});

test("the shared assistant trigger is visible with its route label before its asynchronous controller loads", async () => {
  const [navigation, styles, assistant, adminShell] = await Promise.all([
    projectFile("assets/site-nav.js"),
    projectFile("assets/site-nav.css"),
    projectFile("src/site-assistant/main.mts"),
    projectFile("account/admin/admin-shell.js"),
  ]);

  assert.match(navigation, /ensureAssistantTrigger\(document\.querySelector\("\.site-nav-actions"\)\)/);
  assert.ok(navigation.indexOf("ensureAssistantTrigger(document.querySelector(\".site-nav-actions\"))") < navigation.indexOf("site-assistant/main.mjs"));
  assert.match(navigation, /new MutationObserver\(initializeVisibleNavigation\)/);
  assert.match(navigation, /navigationObserver\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);
  assert.match(navigation, /n3xra-platform-admin-access/);
  assert.match(navigation, /const label = admin \? "Ask Admin AI" : "Ask N3XRA"/);
  assert.match(navigation, /if \(trigger\.textContent !== label\) trigger\.textContent = label/);
  assert.match(navigation, /__n3xraAssistantOpenRequested = true/);
  assert.match(navigation, /siteAssistantReady === "true"/);
  assert.match(navigation, /trigger\.removeAttribute\("data-assistant-state"\)/);
  assert.doesNotMatch(navigation, /trigger\.dataset\.assistantState = "pending"/);
  assert.doesNotMatch(styles, /\[data-site-assistant-open\][\s\S]*?visibility:\s*hidden/);
  assert.match(assistant, /trigger\.removeAttribute\("data-assistant-state"\)/);
  assert.match(assistant, /desktopTrigger\?\.classList\.contains\("is-admin"\) \? "admin" : audience/);
  assert.match(adminShell, />Ask Admin AI<\/button>/);
});

test("the homepage mobile menu keeps four equal navigation tabs without a duplicate assistant action", async () => {
  const [html, styles] = await Promise.all([
    projectFile("index.html"),
    projectFile("assets/home.css"),
  ]);
  const mobileMenu = html.match(/<nav class="site-mobile-menu" id="home-mobile-menu"[\s\S]*?<\/nav>/)?.[0] || "";

  assert.match(html, /home\.css\?v=51/);
  assert.deepEqual(
    [...mobileMenu.matchAll(/class="site-menu-link"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]),
    ["Projects", "Services", "Support", "Software"],
  );
  assert.doesNotMatch(mobileMenu, /Ask (?:Admin )?AI|Ask N3XRA/);
  assert.match(styles, /\.home-topbar \.site-mobile-menu \.site-assistant-mobile-trigger \{\s*display: none !important;/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.home-topbar \.site-mobile-menu\.is-open \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.home-topbar \.site-mobile-menu\.is-open \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("an early assistant click is retained until the controller is ready", async () => {
  const assistant = await projectFile("src/site-assistant/main.mts");

  assert.match(assistant, /desktopTrigger\?\.classList\.contains\("is-admin"\) \? "admin" : "public"/);
  assert.match(assistant, /dataset\.siteAssistantReady = "true"/);
  assert.match(assistant, /if \(assistantWindow\.__n3xraAssistantOpenRequested\)/);
  assert.match(assistant, /delete assistantWindow\.__n3xraAssistantOpenRequested/);
  assert.match(assistant, /The API still[\s\S]*verifies authorization for every protected request/);
});

test("shared navigation runs during parsing so its controls exist before first paint", async () => {
  const pages = await htmlFiles(projectRoot);
  const failures = [];

  for (const file of pages) {
    const html = await readFile(file, "utf8");
    const scripts = html.match(/<script[^>]*site-nav\.js[^>]*>/g) || [];
    for (const script of scripts) {
      if (!/site-nav\.js\?v=5/.test(script) || /\bdefer\b|\basync\b/.test(script)) {
        failures.push(path.relative(projectRoot, file));
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("tenant portal headers stay reserved but hidden until final branding is applied", async () => {
  const pages = [
    "client-portal/index.html",
    "client-portal/assets/index.html",
    "client-portal/billing/index.html",
    "client-portal/communications/index.html",
    "client-portal/services/index.html",
    "project-workspace/index.html",
    "proposals/index.html",
    "website-onboarding/index.html",
  ];
  const [styles, shell, context, ...htmlPages] = await Promise.all([
    projectFile("client-portal/portal.css"),
    projectFile("src/client-portal/brand-shell.ts"),
    projectFile("src/client-portal/tenant-context.ts"),
    ...pages.map(projectFile),
  ]);

  assert.match(styles, /html\.portal-brand-pending \.site-topbar-row\s*\{\s*visibility:\s*hidden;/);
  assert.match(shell, /classList\.remove\("portal-brand-pending"\)/);
  assert.match(context, /classList\.remove\("portal-brand-pending"\)/);
  htmlPages.forEach((html, index) => {
    assert.match(html, /<html lang="en" class="portal-brand-pending">/, `${pages[index]} must wait for resolved branding`);
  });
});

test("the shared client shell appears before page-specific data finishes loading", async () => {
  const [portalStyles, communicationsStyles, brandShell] = await Promise.all([
    projectFile("client-portal/portal.css"),
    projectFile("client-portal/communications.css"),
    projectFile("src/client-portal/brand-shell.ts"),
  ]);

  assert.match(portalStyles, /body\.portal-loading\.client-portal-shell main\s*\{\s*visibility:\s*visible;/);
  assert.match(communicationsStyles, /body\.communications-loading\.client-portal-shell main\s*\{\s*visibility:\s*visible;/);
  assert.match(brandShell, /sessionStorage\.getItem\(BRAND_CACHE_KEY\)/);
  assert.match(brandShell, /await resolvePortalTenant\(supabase\)/);
});

test("the account header reserves its auth action until the session-facing label is final", async () => {
  const [html, styles, controller] = await Promise.all([
    projectFile("account/index.html"),
    projectFile("assets/site-nav.css"),
    projectFile("account/account.js"),
  ]);

  assert.match(html, /id="account-nav-link" data-auth-state="pending"/);
  assert.match(styles, /\.site-auth-link\[data-auth-state="pending"\]\s*\{\s*visibility:\s*hidden;/);
  assert.match(controller, /updateAccountNav\(view === "dashboard"/);
});

test("hidden legacy products do not paint a signed-out label before session resolution", async () => {
  const viralsPages = [
    "virals/index.html",
    "virals/about/index.html",
    "virals/most-searched-videos/index.html",
    "virals/saved-scripts/index.html",
    "virals/todays-top-creators/index.html",
    "virals/todays-viral-videos/index.html",
    "virals/top-shop-products/index.html",
  ];
  const [viralsStyles, viralsNav, viralsApp, musicLanding, musicApp, ...htmlPages] = await Promise.all([
    projectFile("virals/virals.css"),
    projectFile("virals/nav.js"),
    projectFile("virals/virals.js"),
    projectFile("ai-music-generator/index.html"),
    projectFile("ai-music-generator/app/index.html"),
    ...viralsPages.map(projectFile),
  ]);

  assert.match(viralsStyles, /\.auth-pill\[data-auth-state="pending"\]\s*\{\s*visibility:\s*hidden;/);
  assert.match(viralsNav, /authLink\.dataset\.authState = "signed-in"/);
  assert.match(viralsNav, /authLink\.dataset\.authState = "signed-out"/);
  assert.match(viralsApp, /headerAuthLink\.dataset\.authState = "signed-in"/);
  assert.match(viralsApp, /headerAuthLink\.dataset\.authState = "signed-out"/);
  htmlPages.forEach((html, index) => {
    assert.match(html, /id="virals-header-auth-link" data-auth-state="pending"/, `${viralsPages[index]} must wait for resolved auth`);
  });
  [musicLanding, musicApp].forEach((html) => {
    assert.match(html, /id="musicHeaderAuthLink" data-auth-state="pending"/);
    assert.match(html, /musicHeaderAuthLink\.dataset\.authState = "signed-in"/);
    assert.match(html, /musicHeaderAuthLink\.dataset\.authState = "signed-out"/);
  });
});
