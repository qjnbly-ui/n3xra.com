import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountCssPath = new URL("../../account/account.css", import.meta.url);
const accountJsPath = new URL("../../account/account.js", import.meta.url);

test("the account Admin tab uses compact cards without changing customer app cards", async () => {
  const html = await readFile(accountHtmlPath, "utf8");
  const css = await readFile(accountCssPath, "utf8");
  const adminSection = html.match(/<section class="dashboard-section admin-app-section[\s\S]+?<\/section>\s*<\/div>/)?.[0] || "";

  const adminCards = adminSection.match(/class="app-card admin-app-card"/g) || [];
  assert.equal(adminCards.length, 18);
  assert.doesNotMatch(html, /id="(?:music|virals)-app-card"/);
  assert.doesNotMatch(adminSection, /Utilities Admin|\/n3xra-admin\/utilities/);
  assert.match(adminSection, /Retained internal apps/);
  assert.match(adminSection, /href="\/virals\/"[\s\S]*href="\/ai-music-generator\/app\/"/);
  assert.doesNotMatch(adminSection, /admin-app-icon|admin-icon-/);

  assert.match(css, /\.admin-app-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /\.admin-app-card\s*{[\s\S]*min-height:\s*168px/);
  assert.match(css, /\.admin-app-card > \.btn\.block\s*{\s*width:\s*max-content/);

});

test("customer app cards use consistent N3XRA product names", async () => {
  const [html, script] = await Promise.all([
    readFile(accountHtmlPath, "utf8"),
    readFile(accountJsPath, "utf8"),
  ]);

  assert.match(html, /<h3>N3XRA Loan Tracker<\/h3>/);
  assert.match(html, /<h3>N3XRA Records<\/h3>/);
  assert.match(html, /<h3>N3XRA Website Portal<\/h3>/);
  assert.match(html, /<h3 id="partner-portal-title">N3XRA Partners<\/h3>/);
  assert.match(html, /<h3>N3XRA Ownership Updates<\/h3>/);
  assert.doesNotMatch(script, /partnerPortalTitle\.textContent = "Partner Portal"/);
});
