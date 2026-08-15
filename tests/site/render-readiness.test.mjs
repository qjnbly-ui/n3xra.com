import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

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
  assert.match(navigation, /trigger\.textContent = admin \? "Ask Admin AI" : "Ask N3XRA"/);
  assert.match(navigation, /trigger\.removeAttribute\("data-assistant-state"\)/);
  assert.doesNotMatch(navigation, /trigger\.dataset\.assistantState = "pending"/);
  assert.doesNotMatch(styles, /\[data-site-assistant-open\][\s\S]*?visibility:\s*hidden/);
  assert.match(assistant, /trigger\.removeAttribute\("data-assistant-state"\)/);
  assert.match(assistant, /desktopTrigger\?\.classList\.contains\("is-admin"\) \? "admin" : audience/);
  assert.match(adminShell, />Ask Admin AI<\/button>/);
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
