import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("careers presents a universal, vision-led application", async () => {
  const html = await source("careers/index.html");

  assert.match(html, /Build the role you see\./);
  assert.match(html, /Only your name, email, and information-retention consent are required/);
  assert.match(html, /name="proposed_title"/);
  assert.match(html, /name="role_vision"/);
  assert.match(html, /name="n3xra_interest"/);
  assert.match(html, /name="contribution_vision"/);
  assert.match(html, /name="contribution_areas"/);
  assert.match(html, /name="participation_preferences"/);
  assert.match(html, /Commission or performance-based work/);
  assert.match(html, /Investment opportunity/);
  assert.match(html, /External advisor/);
});

test("careers submission preserves multi-select answers and safe defaults", async () => {
  const javascript = await source("careers/careers.js");

  assert.match(javascript, /getAll\("contribution_areas"\)/);
  assert.match(javascript, /getAll\("participation_preferences"\)/);
  assert.match(javascript, /values\.role_interest = values\.role_interest \|\| "open_to_best_fit"/);
  assert.match(javascript, /values\.experience_level = values\.experience_level \|\| "not_specified"/);
  assert.match(javascript, /values\.message = values\.message \|\| ""/);
});

test("careers keeps mobile multi-select choices compact", async () => {
  const css = await source("careers/careers.css");

  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.choice-list span \{[\s\S]*?min-height:\s*46px/);
});

test("careers migration validates the expanded application fields", async () => {
  const migration = await source("supabase/migrations/20260815212436_expand_universal_careers_application.sql");

  for (const column of [
    "proposed_title",
    "role_vision",
    "n3xra_interest",
    "contribution_vision",
    "contribution_areas",
    "participation_preferences",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.match(migration, /careers_applications_contribution_areas_check/);
  assert.match(migration, /careers_applications_participation_preferences_check/);
  assert.match(migration, /cardinality\(contribution_areas\) <= 18/);
  assert.match(migration, /cardinality\(participation_preferences\) <= 8/);
});

test("career administration displays applicant direction and vision", async () => {
  const javascript = await source("account/admin/applications/applications.js");

  assert.match(javascript, /Proposed title/);
  assert.match(javascript, /Contribution areas/);
  assert.match(javascript, /Relationship interests/);
  assert.match(javascript, /What stands out about N3XRA/);
  assert.match(javascript, /Where they could create the clearest value/);
});

test("career administration permanently deletes an application through the protected admin service", async () => {
  const [html, javascript, platformAdmin, migration] = await Promise.all([
    source("account/admin/applications/index.html"),
    source("account/admin/applications/applications.js"),
    source("supabase/functions/platform-admin/index.ts"),
    source("supabase/migrations/20260809222828_careers_applications_and_notes.sql"),
  ]);

  assert.match(html, /id="application-summary" role="status" aria-live="polite"/);
  assert.match(javascript, /id="delete-application"/);
  assert.match(javascript, /confirmAdminAction\([\s\S]*This cannot be undone/);
  assert.match(javascript, /invokePlatformAdmin\("delete-career-application", \{ applicationId: application\.id \}\)/);
  assert.match(platformAdmin, /if \(action === "delete-career-application"\)/);
  assert.match(platformAdmin, /from\("careers-files"\)\.remove\(\[resumePath\]\)/);
  assert.match(platformAdmin, /from\("careers_applications"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", applicationId\)/);
  assert.doesNotMatch(migration, /grant [^;]*delete[^;]* on public\.careers_applications to authenticated/i);
});
