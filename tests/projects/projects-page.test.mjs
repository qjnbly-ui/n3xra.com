import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Projects shares the Services hero system and keeps the local navigation logo", async () => {
  const [projects, services] = await Promise.all([
    projectFile("projects/index.html"),
    projectFile("services/index.html"),
  ]);

  const sharedHeroGradient = /linear-gradient\(145deg, #0a3657 0%, #0b223b 55%, #07111d 100%\)/;
  assert.match(projects, sharedHeroGradient);
  assert.match(services, sharedHeroGradient);
  assert.doesNotMatch(projects, /background-size:\s*76px 76px/);
  assert.doesNotMatch(services, /background-size:\s*76px 76px/);
  assert.match(projects, /<p class="projects-hero-eyebrow">Projects<\/p>/);
  assert.match(projects, /<h1 id="projects-title">Selected Work<\/h1>/);
  assert.doesNotMatch(projects, /projects-hero-logo|projectlogo\.png/);

  const navBrand = projects.match(/<a class="site-brand home-brand"[\s\S]*?<\/a>/)?.[0] || "";
  assert.match(navBrand, /n3xra_logo_transparent_small\.png/);
  assert.doesNotMatch(navBrand, /supabase\.co/);

  const websiteEntry = projects.match(/<a class="projects-client-entry"[^>]*>Manage your website<\/a>/)?.[0] || "";
  assert.match(websiteEntry, /href="\/account\/"/);
  assert.doesNotMatch(websiteEntry, /client-portal\/login/);
});

test("public marketing pages do not use the retired square-grid texture", async () => {
  const pages = await Promise.all([
    projectFile("projects/index.html"),
    projectFile("services/index.html"),
    projectFile("support/index.html"),
    projectFile("assets/home.css"),
  ]);
  const squareGridLine = /linear-gradient\(rgba\(255,\s*255,\s*255,\s*0\.08\)\s*1px,\s*transparent\s*1px\)/;

  for (const page of pages) {
    assert.doesNotMatch(page, squareGridLine);
  }
});
