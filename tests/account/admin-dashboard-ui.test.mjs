import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountCssPath = new URL("../../account/account.css", import.meta.url);
const accountJsPath = new URL("../../account/account.js", import.meta.url);
const adminNavigationPath = new URL("../../account/admin/admin-navigation.js", import.meta.url);
const adminCssPath = new URL("../../account/admin/admin.css", import.meta.url);
const adminInboxCssPath = new URL("../../account/admin/inbox/inbox.css", import.meta.url);
const adminInboxHtmlPath = new URL("../../account/admin/inbox/index.html", import.meta.url);
const adminBillingHtmlPath = new URL("../../account/admin/billing/index.html", import.meta.url);
const financialOperationsHtmlPath = new URL("../../account/admin/operations/index.html", import.meta.url);
const financialOperationsScriptPath = new URL("../../account/admin/operations/operations.js", import.meta.url);
const financialOperationsCssPath = new URL("../../account/admin/operations/operations.css", import.meta.url);
const utilitiesAdminScriptPath = new URL("../../utilities/admin/utilities-admin.js", import.meta.url);
const utilitiesAdminHtmlPath = new URL("../../n3xra-admin/utilities/index.html", import.meta.url);

test("financial corrections keep destructive confirmation text visible", async () => {
  const [html, css] = await Promise.all([
    readFile(financialOperationsHtmlPath, "utf8"),
    readFile(financialOperationsCssPath, "utf8"),
  ]);
  assert.match(html, /class="portal-button operations-danger"[^>]*>Void transaction<\/button>/);
  assert.match(css, /\.operations-workspace,\s*\.operations-dialog\s*{[\s\S]*--ops-red:\s*#a64040/);
  assert.match(css, /\.operations-danger\s*{[\s\S]*color:\s*#fff !important;[\s\S]*background:\s*var\(--ops-red, #a64040\) !important;/);
});

test("the account Admin tab keeps daily tools focused and isolates retired admin-only products", async () => {
  const [html, css, navigation] = await Promise.all([
    readFile(accountHtmlPath, "utf8"),
    readFile(accountCssPath, "utf8"),
    readFile(adminNavigationPath, "utf8"),
  ]);
  const adminSection = html.match(/<section class="dashboard-section admin-app-section[\s\S]+?<\/section>\s*<\/div>/)?.[0] || "";

  const adminCards = adminSection.match(/class="app-card admin-app-card"/g) || [];
  assert.equal(adminCards.length, 8);
  assert.doesNotMatch(html, /id="(?:music|virals)-app-card"/);
  assert.doesNotMatch(adminSection, /Utilities Admin|\/n3xra-admin\/utilities/);
  assert.match(adminSection, /Admin Inbox[\s\S]*Accounts[\s\S]*Websites[\s\S]*Records[\s\S]*Support Requests[\s\S]*Billing &amp; Plans/);
  assert.match(adminSection, /Open all admin tools/);
  assert.match(adminSection, /Retired products[\s\S]*N3XRA Virals[\s\S]*N3XRA AI Music Generator/);
  assert.doesNotMatch(adminSection, /N3XRA Internal Records|open-admin-records-button/);
  assert.match(adminSection, /available only to verified N3XRA administrators and open without creating a product enrollment/);
  assert.doesNotMatch(adminSection, /Codebase AI|Career Applications|Ownership &amp; Governance/);
  assert.doesNotMatch(adminSection, /admin-app-icon|admin-icon-/);

  for (const section of ["Overview", "People & Access", "Customer Operations", "Products", "Company", "Tools", "Ownership"]) {
    assert.ok(navigation.includes(`label("${section}")`) || navigation.includes(`title: "${section}"`), `${section} category is missing`);
  }
  assert.doesNotMatch(navigation, /Virals|AI Music|Internal Records|Archived Apps|Retired Apps/);
  assert.match(navigation, /\["\/account\/admin\/operations\/", "Financial Operations"\]/);
  assert.doesNotMatch(navigation, /\["\/account\/admin\/operations\/", "Operations"\]/);

  assert.match(css, /\.admin-app-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /\.retired-app-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.admin-app-card\s*{[\s\S]*min-height:\s*168px/);
  assert.match(css, /\.admin-app-card > \.btn\.block\s*{\s*width:\s*max-content/);
});

test("admin workspaces collapse consistently and keep every essential action in the mobile menu", async () => {
  const [navigation, styles] = await Promise.all([
    readFile(adminNavigationPath, "utf8"),
    readFile(adminCssPath, "utf8"),
  ]);

  assert.match(navigation, /admin-mobile-menu-utilities[\s\S]*Ask Admin AI[\s\S]*Dashboard[\s\S]*Sign out/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.account-admin-page > \.portal-layout \{ display:block/);
  assert.match(styles, /\.account-admin-page \.portal-layout > \.portal-nav \{ display:none/);
  assert.match(styles, /\.site-topbar\.admin-topbar \.site-nav-actions > :not\(\.site-menu-toggle\) \{ display:none/);
  assert.match(styles, /\.admin-mobile-menu-utilities \{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.site-topbar\.admin-topbar \.admin-mobile-menu-utilities \.site-menu-link \{[\s\S]*min-height: 44px;/);
  assert.match(styles, /\.site-topbar\.admin-topbar \.site-menu-toggle \{[\s\S]*width:44px;[\s\S]*height:44px;/);
  assert.match(styles, /\.account-directory-app,[\s\S]*\.analytics-operations-app \{[\s\S]*height:auto;[\s\S]*overflow:visible;/);
  assert.match(styles, /\.account-directory-app > #admin-status,[\s\S]*\.analytics-operations-app > #admin-status \{[\s\S]*position:static;/);
  assert.match(styles, /main \.portal-button \{ min-height:44px; \}/);
  assert.match(styles, /\.admin-mobile-product \.admin-nav-child,[\s\S]*min-height: 44px;/);
});

test("Utilities admin works with the shared shell sign-out control", async () => {
  const [script, html] = await Promise.all([
    readFile(utilitiesAdminScriptPath, "utf8"),
    readFile(utilitiesAdminHtmlPath, "utf8"),
  ]);

  assert.doesNotMatch(html, /id="utilities-admin-logout"/);
  assert.match(html, /utilities-admin\.js\?v=2/);
  assert.match(script, /if \(logoutButton\) logoutButton\.hidden = true;/);
  assert.match(script, /if \(logoutButton\) logoutButton\.hidden = false;/);
  assert.match(script, /logoutButton\?\.addEventListener\("click", handleLogout\)/);
  assert.match(script, /adminPanel\.hidden = false;/);
});

test("customer app cards use consistent N3XRA product names and clear access states", async () => {
  const [html, css, script] = await Promise.all([
    readFile(accountHtmlPath, "utf8"),
    readFile(accountCssPath, "utf8"),
    readFile(accountJsPath, "utf8"),
  ]);

  assert.match(html, /<h3>N3XRA Loan Tracker<\/h3>/);
  assert.match(html, /<h3>N3XRA Records<\/h3>/);
  assert.match(html, /<h3>N3XRA Communications<\/h3>/);
  assert.match(html, /<h3>N3XRA Website Portal<\/h3>/);
  assert.match(html, /<h3 id="partner-portal-title">N3XRA Partners<\/h3>/);
  assert.match(html, /<h3>N3XRA Ownership Updates<\/h3>/);
  assert.doesNotMatch(script, /partnerPortalTitle\.textContent = "Partner Portal"/);
  assert.match(css, /\.dashboard-apps \.app-grid\s*{[\s\S]*repeat\(auto-fit, minmax\(280px, 1fr\)\)/);
  assert.match(css, /\.app-card\.is-connected > \.btn[\s\S]*background:\s*#123a33/);
  assert.match(css, /\.app-card\.is-available > \.btn\.block\s*{[\s\S]*width:\s*max-content/);
  assert.match(css, /\.app-card\.is-pending\s*{/);
  assert.match(css, /\.app-card\.is-action-required\s*{/);
  assert.match(script, /function websiteAppState\(status\)/);
  assert.match(html, /My products[\s\S]*Your products[\s\S]*Explore N3XRA products[\s\S]*More from N3XRA/);
  assert.match(html, /id="communications-product-link" href="\/nexra-communications\/request\/"/);
  assert.match(html, /id="website-portal-link" href="\/website-request\/"/);
  assert.match(html, /id="partner-portal-link" href="\/partners\/#apply"/);
  assert.match(html, /id="investment-interest-link" href="\/invest\/#ownership-updates"/);
  assert.match(script, /communicationsProductLink\.href = hasCommunicationsAccess[\s\S]*"\/client-portal\/communications\/"[\s\S]*"\/nexra-communications\/request\/"/);
  assert.match(script, /websitePortalLink\.href = "\/client-portal\/"[\s\S]*websitePortalLink\.href = "\/website-request\/"/);
  assert.match(script, /placeMoreFromN3xraCard\(partnerPortalCard, isApprovedPartner\)/);
  assert.match(script, /ownershipUpdateStatus = !interest[\s\S]*"Withdrawn"[\s\S]*"Submitted"/);
  assert.match(script, /placeMoreFromN3xraCard\(investmentInterestCard, ownershipUpdateStatus === "Submitted", ownershipUpdateStatus\)/);
  assert.match(script, /investmentInterestLink\.href = "\/invest\/#ownership-updates"/);
  assert.doesNotMatch(script, /investmentInterestLink\.href = "\/account\/investment\/"/);
  assert.match(script, /accountOverviewActions\?\.classList\.toggle\("has-admin-tools", canViewAdminApps\)/);
});

test("mobile inbox summaries remain compact while full notifications open separately", async () => {
  const [css, html, billingHtml] = await Promise.all([
    readFile(adminInboxCssPath, "utf8"),
    readFile(adminInboxHtmlPath, "utf8"),
    readFile(adminBillingHtmlPath, "utf8"),
  ]);

  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.notification-item-main p\s*{[\s\S]*display:\s*-webkit-box;[\s\S]*-webkit-line-clamp:\s*2;/);
  assert.match(css, /\.notification-item-main:focus-visible\s*{/);
  assert.match(html, /<dialog class="notification-dialog"/);
  assert.match(html, /inbox\.css\?v=3/);
  assert.doesNotMatch(html, /<option value="(?:music|virals)">/);
  for (const product of ["records", "websites", "ai_music", "virals"]) {
    assert.match(billingHtml, new RegExp(`<option value="${product}">`));
  }
});

test("the financial workspace is clearly labeled without changing its stable route", async () => {
  const [html, script, css] = await Promise.all([
    readFile(financialOperationsHtmlPath, "utf8"),
    readFile(financialOperationsScriptPath, "utf8"),
    readFile(financialOperationsCssPath, "utf8"),
  ]);

  assert.match(html, /<title>N3XRA \| Financial Operations<\/title>/);
  assert.match(html, /aria-label="Financial operations sections"/);
  assert.match(html, /N3XRA Financial Operations/);
  assert.match(script, /Financial Operations Report/);
  assert.match(script, /data-record-payment/);
  assert.match(script, /payment_method: "cash"/);
  assert.match(script, /data-send-invoice/);
  assert.match(script, /send-manual-invoice/);
  assert.match(html, /data-operations-view="invoices">Payments</);
  assert.match(html, /id="ops-payments-received-month"/);
  assert.match(html, /id="ops-payments-outstanding"/);
  assert.match(html, /id="ops-payments-overdue"/);
  assert.match(html, /id="ops-payment-activity"/);
  assert.match(html, /data-create-payment/);
  assert.match(script, /function invoiceDisplayStatus/);
  assert.match(script, /function renderPaymentActivity/);
  assert.match(html, /operations\.css\?v=17/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.operations-workspace > \.admin-status \{[\s\S]*position: static;/);
  assert.doesNotMatch(html, /<title>N3XRA \| Operations<\/title>/);
});
