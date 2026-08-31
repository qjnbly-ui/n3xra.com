import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the homepage presents Project Cards as a public N3XRA product", async () => {
  const home = await projectFile("index.html");
  assert.match(home, /href="\/project-cards\/"/);
  assert.match(home, /N3XRA Project Cards/);
  assert.match(home, /Reusable NFC cards that open live project pages/);
});

test("the Project Cards presentation explains the product and offers signup", async () => {
  const [page, styles] = await Promise.all([
    projectFile("project-cards/index.html"),
    projectFile("assets/project-cards.css"),
  ]);
  assert.match(page, /One card[.]<br><em>Any assignment[.]<\/em>/);
  assert.match(page, /The card stays the same[.]/);
  assert.match(page, /The destination changes[.]/);
  assert.match(page, /href="\/account\/?[?]signup=signup&amp;product=project_cards"/);
  assert.match(page, /Project Cards is entering early access/);
  assert.match(page, /class="site-topbar home-topbar"/);
  assert.match(page, /class="site-brand home-brand"/);
  assert.match(page, /href="\/assets\/home-shell[.]css[?]v=1"/);
  assert.match(page, /href="\/projects\/"/);
  assert.match(page, /href="\/services\/"/);
  assert.match(page, /href="\/support\/"/);
  assert.match(page, /href="\/#software"/);
  assert.doesNotMatch(page, /is_platform_admin|client-portal\/project-cards\.js/);
  assert.doesNotMatch(styles, /\.cards-hero:before|background-size:64px 64px/);
});

test("the presentation's interactive example has all three destinations", async () => {
  const [page, script] = await Promise.all([
    projectFile("project-cards/index.html"),
    projectFile("assets/project-cards.js"),
  ]);
  assert.match(page, /data-demo-project="fire"/);
  assert.match(page, /data-demo-project="training"/);
  assert.match(page, /data-demo-project="equipment"/);
  assert.match(script, /Medford Fire Assignment/);
  assert.match(script, /Crew Training Resources/);
  assert.match(script, /Equipment Inspection/);
});
