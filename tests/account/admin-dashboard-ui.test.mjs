import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountHtmlPath = new URL("../../account/index.html", import.meta.url);
const accountCssPath = new URL("../../account/account.css", import.meta.url);

test("the account Admin tab uses compact cards without changing customer app cards", async () => {
  const html = await readFile(accountHtmlPath, "utf8");
  const css = await readFile(accountCssPath, "utf8");
  const adminSection = html.match(/<section class="dashboard-section admin-app-section[\s\S]+?<\/section>\s*<\/div>/)?.[0] || "";

  const adminCards = adminSection.match(/class="app-card admin-app-card"/g) || [];
  assert.equal(adminCards.length, 17);
  assert.doesNotMatch(adminSection, /admin-app-icon|admin-icon-/);

  assert.match(css, /\.admin-app-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /\.admin-app-card\s*{[\s\S]*min-height:\s*168px/);
  assert.match(css, /\.admin-app-card > \.btn\.block\s*{\s*width:\s*max-content/);

});
