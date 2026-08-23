import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the tenant login is client-branded and authenticates without the N3XRA account screen", async () => {
  const [html, script, styles] = await Promise.all([
    projectFile("client-portal/login/index.html"),
    projectFile("client-portal/login.js"),
    projectFile("client-portal/login/login.css"),
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
  assert.match(script, /size: "flexible"/);
  assert.match(styles, /\.portal-login-captcha\s*\{[\s\S]*justify-items: center/);
  assert.match(styles, /#portal-login-turnstile\s*\{[\s\S]*text-align: center/);
  const returnRule = styles.match(/\.portal-login-return\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(returnRule, /text-underline-offset/);
  assert.doesNotMatch(returnRule, /background|border|border-radius/);
  assert.doesNotMatch(script, /window\.location\.replace\("\/account/);
});

test("the branded dashboard removes master-platform navigation and the admin assistant", async () => {
  const [shell, context, navigation, workspaceContext, portalHtml, loginHtml] = await Promise.all([
    projectFile("client-portal/brand-shell.js"),
    projectFile("client-portal/tenant-context.js"),
    projectFile("assets/site-nav.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/index.html"),
    projectFile("client-portal/login/index.html"),
  ]);

  assert.match(shell, /showGenericPortalIdentity/);
  assert.match(context, /a\[href\^="\/account"\]/);
  assert.match(context, /data-site-assistant-open/);
  assert.match(context, /identity\.websiteName/);
  assert.match(context, /identity\.logoUrl/);
  assert.match(context, /portal-provider-label/);
  assert.match(context, /site-nav-actions[\s\S]{0,260}provider\.remove\(\)/);
  assert.match(navigation, /\.portal\.n3xra\.com/);
  assert.match(navigation, /portal-white-label-host/);
  assert.match(workspaceContext, /Return to Website/);
  assert.match(workspaceContext, /Return to Dashboard/);
  assert.match(workspaceContext, /brandedPortal \? websiteUrl : "\/account\/"/);
  assert.match(workspaceContext, /Return to \$\{websiteName\} website/);
  assert.match(workspaceContext, /data-client-website-return/);
  assert.doesNotMatch(workspaceContext, /client-organization-links/);
  assert.doesNotMatch(workspaceContext, /Back to[\s\S]{0,160}target="_blank"/);
  assert.doesNotMatch(portalHtml.match(/<a id="files-live-link"[^>]*>/)?.[0] || "", /target=/);
  assert.doesNotMatch(loginHtml.match(/<a class="portal-login-return"[^>]*>/)?.[0] || "", /target=/);
});

test("client portal sign-out clears only the current session and always returns to its branded login", async () => {
  const [html, loginHtml, login, shell, portal, context] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("client-portal/login/index.html"),
    projectFile("client-portal/login.js"),
    projectFile("client-portal/portal-shell.js"),
    projectFile("client-portal/portal.js"),
    projectFile("client-portal/tenant-context.js"),
  ]);

  assert.match(html, /portal-shell\.js\?v=6/);
  assert.match(loginHtml, /login\.js\?v=5/);
  assert.match(shell, /signOut\(\{ scope: "local" \}\)/);
  assert.match(shell, /finally/);
  assert.match(shell, /window\.location\.replace\(portalSignedOutUrl\(\)\)/);
  assert.match(context, /client-portal\/login\?signed_out=1/);
  assert.match(login, /searchParams\.get\("signed_out"\) === "1"/);
  assert.match(login, /You have been signed out\./);
  assert.match(login, /replaceState\(\{\}, document\.title, "\/client-portal\/login"\)/);
  assert.doesNotMatch(portal, /logoutButton/);
});

test("tenant login enters the portal root so subscription routing can choose the correct destination", async () => {
  const login = await projectFile("client-portal/login.js");

  assert.match(login, /window\.location\.replace\("\/client-portal\/"\)/);
  assert.doesNotMatch(login, /window\.location\.replace\("\/client-portal\/#files-assets"\)/);
});

test("every tenant workspace disables the N3XRA site assistant", async () => {
  const pages = [
    "client-portal/index.html",
    "client-portal/services/index.html",
    "client-portal/billing/index.html",
    "client-portal/analytics/index.html",
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

test("every portal resolves a return URL from the live site or its active website domain", async () => {
  const migration = await projectFile("supabase/migrations/20260813161533_add_default_portal_return_url.sql");

  assert.match(migration, /nullif\(trim\(cw\.live_url\), ''\)/);
  assert.match(migration, /select 'https:\/\/' \|\| wd\.domain_name/);
  assert.match(migration, /wd\.domain_purpose = 'website'/);
  assert.match(migration, /order by wd\.is_primary desc, wd\.created_at asc/);
});
