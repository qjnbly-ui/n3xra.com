import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountCssPath = new URL("../../account/account.css", import.meta.url);
const accountJsPath = new URL("../../account/account.js", import.meta.url);
const adminNavigationPath = new URL("../../account/admin/admin-navigation.js", import.meta.url);
const adminInboxCssPath = new URL("../../account/admin/inbox/inbox.css", import.meta.url);
const adminInboxHtmlPath = new URL("../../account/admin/inbox/index.html", import.meta.url);

test("the account Admin tab is a focused six-action launcher", async () => {
  const [html, css, navigation] = await Promise.all([
    readFile(accountHtmlPath, "utf8"),
    readFile(accountCssPath, "utf8"),
    readFile(adminNavigationPath, "utf8"),
  ]);
  const adminSection = html.match(/<section class="dashboard-section admin-app-section[\s\S]+?<\/section>\s*<\/div>/)?.[0] || "";

  const adminCards = adminSection.match(/class="app-card admin-app-card"/g) || [];
  assert.equal(adminCards.length, 6);
  assert.doesNotMatch(html, /id="(?:music|virals)-app-card"/);
  assert.doesNotMatch(adminSection, /Utilities Admin|\/n3xra-admin\/utilities/);
  assert.match(adminSection, /Admin Inbox[\s\S]*Accounts[\s\S]*Websites[\s\S]*Records[\s\S]*Support Requests[\s\S]*Billing &amp; Plans/);
  assert.match(adminSection, /Open all admin tools/);
  assert.doesNotMatch(adminSection, /Virals|AI Music|Codebase AI|Career Applications|Ownership &amp; Governance/);
  assert.doesNotMatch(adminSection, /admin-app-icon|admin-icon-/);

  for (const section of ["Overview", "People & Access", "Customer Operations", "Products", "Company", "Tools", "Ownership", "Archived Apps"]) {
    assert.ok(navigation.includes(`label("${section}")`) || navigation.includes(`title: "${section}"`), `${section} category is missing`);
  }
  assert.match(navigation, /\["\/virals\/", "Virals"\]/);
  assert.match(navigation, /\["\/ai-music-generator\/app\/", "AI Music"\]/);
  assert.match(navigation, /data-open-internal-records/);

  assert.match(css, /\.admin-app-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /\.admin-app-card\s*{[\s\S]*min-height:\s*168px/);
  assert.match(css, /\.admin-app-card > \.btn\.block\s*{\s*width:\s*max-content/);
});

test("customer app cards use consistent N3XRA product names and clear access states", async () => {
  const [html, css, script] = await Promise.all([
    readFile(accountHtmlPath, "utf8"),
    readFile(accountCssPath, "utf8"),
    readFile(accountJsPath, "utf8"),
  ]);

  assert.match(html, /<h3>N3XRA Loan Tracker<\/h3>/);
  assert.match(html, /<h3>N3XRA Records<\/h3>/);
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
  assert.match(script, /interest && interest\.status !== "withdrawn"/);
  assert.match(script, /accountOverviewActions\?\.classList\.toggle\("has-admin-tools", canViewAdminApps\)/);
});

test("mobile inbox summaries remain compact while full notifications open separately", async () => {
  const [css, html] = await Promise.all([
    readFile(adminInboxCssPath, "utf8"),
    readFile(adminInboxHtmlPath, "utf8"),
  ]);

  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.notification-item-main p\s*{[\s\S]*display:\s*-webkit-box;[\s\S]*-webkit-line-clamp:\s*2;/);
  assert.match(css, /\.notification-item-main:focus-visible\s*{/);
  assert.match(html, /<dialog class="notification-dialog"/);
  assert.match(html, /inbox\.css\?v=3/);
});
