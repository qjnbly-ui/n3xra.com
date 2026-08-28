import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the branded portal root is the business dashboard instead of the project workspace", async () => {
  const [html, shell, portal] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/portal.js"),
  ]);

  assert.match(html, /id="portal-view-dashboard"/);
  assert.match(html, /id="portal-app-grid"/);
  assert.match(html, /portal-apps\.js\?v=10/);
  assert.doesNotMatch(html, /portal-dashboard-hero|portal-apps-heading|portal-app-summary/);
  assert.match(shell, /key: "dashboard"[\s\S]*href: "\/client-portal\/"/);
  assert.doesNotMatch(shell, /window\.location\.replace\(`\/project-workspace/);
  assert.match(portal, /activePortalView = "dashboard"/);
  assert.match(portal, /else showPortalView\("dashboard"\)/);
});

test("portal apps are loaded from the tenant website's linked organization", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /resolvePortalTenant/);
  assert.match(apps, /\.from\("client_websites"\)/);
  assert.match(apps, /\.eq\("id", tenant\.website_id\)/);
  assert.match(apps, /\.from\("organization_product_entitlements"\)/);
  assert.match(apps, /HIDDEN_CUSTOMER_PRODUCT_KEYS/);
  assert.match(apps, /"ai_music", "music", "virals"/);
  assert.match(apps, /\.eq\("organization_id", organizationId\)/);
  assert.match(apps, /setStoredActiveOrganizationId/);
  assert.match(apps, /safePortalPath/);
  assert.doesNotMatch(apps, /target\s*=|window\.open\s*\(/);
});

test("unbranded portals skip the app dashboard unless multiple N3XRA apps are subscribed", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /function routeOrRenderApps\(apps, \{ preferWebsite = false \} = \{\}\)/);
  assert.match(apps, /subscribedApps = apps\.filter\(\(app\) => app\.key !== "website"\)/);
  assert.match(apps, /if \(subscribedApps\.length === 1 && onlySubscribedApp\)/);
  assert.match(apps, /if \(subscribedApps\.length > 1\)/);
  assert.match(apps, /window\.location\.replace\(app\.href\)/);
  assert.match(apps, /routeOrRenderApps\(apps, \{ preferWebsite: isBrandedPortalHostname\(\) \}\)/);
  assert.match(apps, /catch\(\(error\) => \{[\s\S]*openOnlyAvailableApp\(websiteApp\(\)\)/);
});

test("branded portals open Website Management directly only when it is the sole available workspace", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /import \{ isBrandedPortalHostname, resolvePortalTenant \}/);
  assert.match(apps, /if \(preferWebsite && website && apps\.length === 1\) \{[\s\S]*openOnlyAvailableApp\(website\);[\s\S]*return;/);
  assert.match(apps, /if \(preferWebsite && apps\.length > 1\) \{[\s\S]*renderApps\(apps\);[\s\S]*return;/);
  assert.match(apps, /routeOrRenderApps\(apps, \{ preferWebsite: isBrandedPortalHostname\(\) \}\)/);
  assert.ok(
    apps.indexOf("if (preferWebsite && website && apps.length === 1)") < apps.indexOf("if (subscribedApps.length === 1 && onlySubscribedApp)"),
    "the branded website preference must run before the single-subscription redirect",
  );
});

test("the website app lands on the first enabled section when Progress is off", async () => {
  const [apps, workspaceContext] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(apps, /function defaultWebsiteHref\(features = \{\}\)/);
  assert.match(apps, /features\.progress !== false[\s\S]*return "\/project-workspace\/"/);
  assert.match(apps, /features\.files_assets !== false[\s\S]*return "\/client-portal\/#files-assets"/);
  assert.doesNotMatch(apps, /features\.overview/);
  assert.match(apps, /\.from\("website_portal_features"\)[\s\S]*\.eq\("website_id", tenant\.website_id\)/);
  assert.match(workspaceContext, /const currentFeature = PAGE_FEATURES\[pageKey\]/);
  assert.match(workspaceContext, /currentFeature && !featureEnabled\(currentFeature, selectedFeatures\)/);
  assert.match(workspaceContext, /window\.location\.replace\(routeForWebsite\(defaultWebsiteRoute\(selectedFeatures\), website\.id/);
});

test("the app dashboard shows only additional subscriptions, not Website Management", async () => {
  const [apps, styles] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/portal-apps.css"),
  ]);

  assert.match(apps, /renderApps\(subscribedApps\)/);
  assert.doesNotMatch(apps, /badge: "Included"/);
  assert.doesNotMatch(styles, /\.portal-dashboard-hero|\.portal-apps-heading/);
  assert.match(styles, /\.portal-apps-section\s*\{[\s\S]*width: 100%[\s\S]*min-height: 100%/);
});

test("website workspace hash routes are never replaced by the app dashboard redirect", async () => {
  const apps = await projectFile("client-portal/portal-apps.js");

  assert.match(apps, /window\.location\.hash && window\.location\.hash !== "#overview"/);
  assert.match(apps, /window\.location\.hash[\s\S]*createBrowserSupabase\(\)/);
});

test("the N3XRA website portal opens Website Management without the branded app chooser", async () => {
  const [apps, shell, workspaceContext, brandShell] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/brand-shell.js"),
  ]);

  assert.match(apps, /tenant\.mode === "unbound"[\s\S]*window\.location\.replace\(requestedWebsiteHref\(websiteApp\(\)\.href\)\)/);
  assert.match(apps, /function requestedWebsiteHref\(href\)[\s\S]*URLSearchParams\(window\.location\.search\)\.get\("website"\)[\s\S]*url\.searchParams\.set\("website", websiteId\)/);
  assert.match(shell, /isBrandedPortalHostname\(\)[\s\S]*Dashboard/);
  assert.match(workspaceContext, /isBrandedPortalHostname\(\)[\s\S]*Dashboard/);
  assert.match(brandShell, /showN3xraPortalIdentity/);
  assert.match(brandShell, /N3XRA \| Website Management/);
});

test("explicit website selection survives every unbranded workspace transition", async () => {
  const [apps, workspaceContext, shell, html] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/index.html"),
  ]);

  assert.match(apps, /UUID_PATTERN/);
  assert.match(apps, /requestedWebsiteHref\(websiteApp\(\)\.href\)/);
  assert.match(workspaceContext, /function routeForWebsite\(href, websiteId, organizationId = ""\)/);
  assert.match(workspaceContext, /\.website-organization-navigation a/);
  assert.match(workspaceContext, /routeForWebsite\(defaultWebsiteRoute\(selectedFeatures\), website\.id/);
  assert.match(shell, /client-workspace-context\.js\?v=22/);
  assert.match(html, /client-shell\.js\?v=27/);
});

test("platform administrators can open entitled customer apps without customer membership grants", async () => {
  const [apps, workspaceContext] = await Promise.all([
    projectFile("client-portal/portal-apps.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(apps, /supabase\.rpc\("is_platform_admin"\)/);
  assert.match(apps, /platformAdmin !== true && !allowedProductKeys\.has/);
  assert.match(workspaceContext, /supabase\.rpc\("is_platform_admin"\)/);
  assert.match(workspaceContext, /platformAdmin \|\| allowedProductKeys\.has\(productKey\)/);
});

test("client navigation separates apps from the website workspace", async () => {
  const [shell, workspaceContext, styles] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/client-shell.css"),
  ]);

  assert.match(shell, /const appSections = \[[\s\S]*Apps Dashboard[\s\S]*Support/);
  assert.match(shell, /const websiteSections = \[[\s\S]*label: "Progress"/);
  assert.match(shell, /label: "Progress"[\s\S]*feature: "progress"/);
  assert.match(shell, /label: "Support"[\s\S]*feature: "support"/);
  assert.match(shell, /label: "Files & Assets"[\s\S]*feature: "files_assets"/);
  assert.match(shell, /label: "Services & Ownership"[\s\S]*feature: "services"/);
  assert.match(shell, /label: "Billing"[\s\S]*feature: "billing"/);
  assert.match(shell, /data-client-project-progress/);
  assert.match(shell, /Website Workspace/);
  assert.match(shell, /Start a New Project/);
  assert.doesNotMatch(shell, /portal-nav-label">New work/);
  assert.match(workspaceContext, /const APP_ROUTES = \[[\s\S]*Apps Dashboard[\s\S]*Support/);
  assert.match(workspaceContext, /const WEBSITE_ROUTES = \[[\s\S]*Progress[\s\S]*Files & Assets[\s\S]*Start a New Project/);
  assert.match(workspaceContext, /const PAGE_FEATURES = \{[\s\S]*assets: "files_assets"[\s\S]*support: "support"/);
  assert.match(workspaceContext, /featureMap\(featureResult\.data \|\| \[\], website\.id\)/);
  assert.doesNotMatch(workspaceContext, /projectComplete/);
  assert.doesNotMatch(workspaceContext, /website-organization-intake-link/);
  assert.match(workspaceContext, /updateWebsiteReturnLink/);
  assert.match(workspaceContext, /actions\.prepend\(returnLink\)/);
  assert.match(workspaceContext, /Return to Website/);
  assert.match(workspaceContext, /Return to Dashboard/);
  assert.match(workspaceContext, /brandedPortal \? websiteUrl : "\/account\/"/);
  assert.doesNotMatch(workspaceContext, /client-organization-links/);
  assert.match(styles, /website-organization-navigation p\.is-separated/);
  assert.match(styles, /\.client-website-return-link/);
});

test("client workspaces always provide a compact mobile menu with safe sign-out controls", async () => {
  const [shell, portalShell, workspaceContext, styles, billingStyles] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/portal-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("client-portal/client-shell.css"),
    projectFile("client-portal/billing/billing.css"),
  ]);

  assert.match(shell, /function ensureClientMobileNavigation\(topbar\)/);
  assert.match(shell, /className = "site-menu-toggle"/);
  assert.match(shell, /className = "site-mobile-menu client-mobile-menu"/);
  assert.match(shell, /data-portal-logout/);
  assert.match(shell, /function mobileSectionMarkup\(section\)[\s\S]*data-client-feature/);
  assert.match(portalShell, /querySelectorAll\("#portal-logout, \[data-portal-logout\]"\)/);
  assert.match(workspaceContext, /\.site-mobile-menu \[data-client-website-return\]/);
  assert.match(styles, /@media \(max-width:800px\)[\s\S]*\.site-menu-toggle[\s\S]*display:inline-flex/);
  assert.match(styles, /\.site-mobile-menu\.is-open[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width:480px\)[\s\S]*grid-template-columns:1fr/);
  assert.match(billingStyles, /@media \(max-width: 700px\)[\s\S]*\.billing-card \{ padding: 16px/);
});

test("Apps Dashboard navigation appears only when the tenant has multiple subscribed N3XRA apps", async () => {
  const [shell, workspaceContext] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(shell, /data-client-app-dashboard hidden/);
  assert.match(workspaceContext, /visiblePortalAppKeys/);
  assert.match(workspaceContext, /\.from\("organization_product_entitlements"\)/);
  assert.match(workspaceContext, /HIDDEN_CUSTOMER_PRODUCT_KEYS/);
  assert.match(workspaceContext, /!HIDDEN_CUSTOMER_PRODUCT_KEYS\.has\(productKey\)/);
  assert.match(workspaceContext, /portal_path/);
  assert.match(workspaceContext, /setAppsDashboardAvailability\(portalAppKeys\.length > 1 \|\| organizationAdminAvailable\)/);
  assert.match(workspaceContext, /data-client-app-dashboard hidden/);
});

test("a Records subscription appears directly in the branded website workspace app navigation", async () => {
  const [shell, workspaceContext] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(shell, /label: "Records"[\s\S]*requiresRecordsApp: true/);
  assert.match(shell, /data-client-records-app hidden/);
  assert.match(workspaceContext, /label: "Records"[\s\S]*requiresRecordsApp: true/);
  assert.match(workspaceContext, /setRecordsAvailability\(portalAppKeys\.includes\("records"\), selectedWebsite\?\.organization_id\)/);
  assert.match(workspaceContext, /\/n3xra-records\/library\?support_org=\$\{encodeURIComponent\(organizationId\)\}/);
});

test("Communications stays in every portal navigation when the organization is subscribed", async () => {
  const [shell, workspaceContext] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(shell, /brandedPortal \|\| normalizePath\(window\.location\.pathname\) === "\/client-portal\/communications\/"/);
  assert.match(shell, /data-client-communications-app hidden/);
  assert.match(workspaceContext, /requiresCommunicationsApp: brandedPortal/);
  assert.match(workspaceContext, /setCommunicationsAvailability\(portalAppKeys\.includes\("communications"\)\)/);
});

test("organization app entitlements are RLS protected and synchronized from subscriptions", async () => {
  const migration = await projectFile("supabase/migrations/20260813165301_branded_portal_app_entitlements.sql");

  assert.match(migration, /create table public\.organization_product_entitlements/);
  assert.match(migration, /alter table public\.organization_product_entitlements enable row level security/);
  assert.match(migration, /to authenticated[\s\S]*membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /organization_product_entitlements_admin_update[\s\S]*using \(\(select public\.is_platform_admin\(\)\)\)[\s\S]*with check/);
  assert.match(migration, /organizations_sync_records_product_entitlement/);
  assert.match(migration, /client_websites[\s\S]*organization_id = candidate\.organization_id/);
  assert.doesNotMatch(migration, /grant (select|all).*organization_product_entitlements to anon/i);
});

test("Records adopts the client portal brand and returns only to its app dashboard", async () => {
  const [recordsShell, desktopShell, recordsStyles] = await Promise.all([
    projectFile("client-portal/records-app-shell.js"),
    projectFile("n3xra-records/lib/desktop-shell.js"),
    projectFile("n3xra-records/styles.css"),
  ]);

  assert.match(desktopShell, /initializeRecordsPortalShell/);
  assert.match(recordsShell, /identity\.websiteName/);
  assert.match(recordsShell, /identity\.logoUrl/);
  assert.match(recordsShell, /Return to dashboard/);
  assert.match(recordsShell, /actions\?\.prepend\(dashboardLink\)/);
  assert.match(recordsShell, /records-portal-dashboard-link/);
  assert.doesNotMatch(recordsShell, /Back to \$\{identity\.websiteName\} Website/);
  assert.doesNotMatch(recordsShell, /Portal home/);
  assert.match(recordsStyles, /\.records-desktop-app-actions \.records-portal-dashboard-link/);
  assert.doesNotMatch(recordsShell, /target\s*=|window\.open\s*\(/);
});
