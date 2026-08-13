import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the tenant login is client-branded and authenticates without the N3XRA account screen", async () => {
  const [html, script] = await Promise.all([
    projectFile("client-portal/login/index.html"),
    projectFile("client-portal/login.js"),
  ]);

  assert.match(html, /data-portal-business-logo/);
  assert.match(html, /data-portal-business-name/);
  assert.match(html, /id="portal-login-form"/);
  assert.match(html, /id="portal-return-link"/);
  assert.doesNotMatch(html, /N3XRA/);
  assert.match(script, /resolvePortalTenant/);
  assert.match(script, /signInWithPassword/);
  assert.match(script, /\.from\("client_websites"\)/);
  assert.match(script, /Return to \$\{identity\.websiteName\} website/);
  assert.doesNotMatch(script, /window\.location\.replace\("\/account/);
});

test("the branded dashboard removes master-platform navigation and the admin assistant", async () => {
  const [shell, context, navigation] = await Promise.all([
    projectFile("client-portal/brand-shell.js"),
    projectFile("client-portal/tenant-context.js"),
    projectFile("assets/site-nav.js"),
  ]);

  assert.match(shell, /showGenericPortalIdentity/);
  assert.match(context, /a\[href\^="\/account"\]/);
  assert.match(context, /data-site-assistant-open/);
  assert.match(context, /identity\.websiteName/);
  assert.match(context, /identity\.logoUrl/);
  assert.match(context, /portal-provider-label/);
  assert.match(navigation, /\.portal\.n3xra\.com/);
  assert.match(navigation, /portal-white-label-host/);
});

test("client portal sign-out clears only the current session and always returns to its branded login", async () => {
  const [html, shell, portal] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("client-portal/portal-shell.js"),
    projectFile("client-portal/portal.js"),
  ]);

  assert.match(html, /portal-shell\.js\?v=3/);
  assert.match(shell, /signOut\(\{ scope: "local" \}\)/);
  assert.match(shell, /finally/);
  assert.match(shell, /window\.location\.replace\(portalLoginUrl\(\)\)/);
  assert.doesNotMatch(portal, /logoutButton/);
});

test("every tenant workspace disables the N3XRA site assistant", async () => {
  const pages = [
    "client-portal/index.html",
    "client-portal/services/index.html",
    "client-portal/billing/index.html",
    "client-portal/assets/index.html",
    "project-workspace/index.html",
    "proposals/index.html",
    "website-onboarding/index.html",
  ];
  const htmlPages = await Promise.all(pages.map(projectFile));
  htmlPages.forEach((html, index) => {
    assert.match(html, /data-disable-site-assistant/, `${pages[index]} must disable the platform assistant`);
    assert.doesNotMatch(html, /N3XRA/, `${pages[index]} must not contain platform branding`);
    assert.doesNotMatch(html, /n3xra_logo_transparent_small/, `${pages[index]} must not contain the platform logo`);
    assert.doesNotMatch(html, /href="\/account/, `${pages[index]} must not link to the master dashboard`);
  });

  const siteNavigation = await projectFile("assets/site-nav.js");
  assert.match(siteNavigation, /hasAttribute\("data-disable-site-assistant"\)/);
});

test("public tenant resolution exposes only published assets copied to the public CDN bucket", async () => {
  const migration = await projectFile("supabase/migrations/20260813122919_expose_portal_public_brand_identity_from_cdn.sql");

  assert.match(migration, /'logo_url'/);
  assert.match(migration, /logo_version\.status = 'published'/);
  assert.match(migration, /logo_version\.public_url ~ '\^https:\/\/\[\^\/\]\+\/storage\/v1\/object\/public\/website-assets-public\/'/);
  assert.match(migration, /'website_url', cw\.live_url/);
});
