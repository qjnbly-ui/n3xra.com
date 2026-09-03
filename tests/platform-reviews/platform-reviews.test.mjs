import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectFile = (name) => readFileSync(path.join(root, name), "utf8");

const migrationPath = "supabase/migrations/20260903041316_platform_reviews_foundation.sql";

test("platform reviews use a separate schema and leave Records reviews isolated", () => {
  const migration = projectFile(migrationPath);
  assert.match(migration, /create table public\.platform_review_subjects/);
  assert.match(migration, /create table public\.platform_reviews/);
  assert.match(migration, /intentionally separate from public\.reviews/i);
  assert.doesNotMatch(migration, /(?:alter|drop|insert into|update|delete from)\s+(?:table\s+)?public\.reviews\b/i);
  assert.doesNotMatch(migration, /\('records',\s*'N3XRA Records'/);
  assert.match(migration, /Records is intentionally excluded/i);
});

test("personal and official organization reviews have distinct ownership constraints", () => {
  const migration = projectFile(migrationPath);
  assert.match(migration, /scope in \('personal', 'organization'\)/);
  assert.match(migration, /platform_reviews_personal_subject_uidx[\s\S]*author_user_id, subject_key/);
  assert.match(migration, /platform_reviews_organization_subject_uidx[\s\S]*organization_id, subject_key/);
  assert.match(migration, /scope = 'personal'[\s\S]*author_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /scope = 'organization'[\s\S]*public\.can_manage_org_settings\(organization_id\)/);
});

test("review moderation is database enforced and explicitly granted", () => {
  const migration = projectFile(migrationPath);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(migration, /status in \('pending', 'changes_requested', 'published', 'hidden', 'rejected'\)/);
  assert.match(migration, /new\.status := 'pending'/);
  assert.match(migration, /new\.moderation_note := null/);
  assert.match(migration, /alter table public\.platform_reviews enable row level security/);
  assert.match(migration, /revoke all on public\.platform_reviews from anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on public\.platform_reviews to authenticated/);
  assert.match(migration, /create policy "platform_reviews_insert"/);
  assert.match(migration, /create policy "platform_reviews_update"/);
});

test("public review retrieval exposes display fields only", () => {
  const migration = projectFile(migrationPath);
  const functionSql = migration.slice(migration.indexOf("create or replace function public.list_published_platform_reviews"));
  assert.match(functionSql, /where review\.status = 'published'/);
  assert.match(functionSql, /review\.is_featured/);
  assert.match(functionSql, /order by review\.is_featured desc/);
  assert.match(functionSql, /grant execute on function public\.list_published_platform_reviews\(text, integer\) to anon, authenticated/);
  assert.doesNotMatch(functionSql.split("revoke all on function")[0], /author_user_id|moderated_by_user_id|moderation_note/);
});

test("personal and organization review pages are separate from each other and Records", () => {
  const page = projectFile("account/reviews/index.html");
  const source = projectFile("src/platform-reviews/personal.ts");
  const organizationPage = projectFile("client-portal/reviews/index.html");
  const organizationSource = projectFile("src/platform-reviews/organization.ts");
  assert.match(page, /id="personal-reviews-panel"/);
  assert.doesNotMatch(page, /id="organization-reviews-panel"/);
  assert.match(organizationPage, /id="organization-review-form"/);
  assert.match(page, /N3XRA Records keeps its existing library-specific review inside Records/);
  assert.match(source, /\.from\("platform_reviews"\)/);
  assert.doesNotMatch(source, /\.from\("reviews"\)/);
  assert.match(organizationSource, /\.eq\("role", "account_admin"\)/);
  assert.match(source, /Submitted\. N3XRA will review it before it is published/);
});

test("reviews are reachable from accounts, organization admin, and platform admin", () => {
  const account = projectFile("account/index.html");
  const team = projectFile("client-portal/team/index.html");
  const organizationPage = projectFile("client-portal/reviews/index.html");
  const adminPage = projectFile("account/admin/reviews/index.html");
  const adminNavigation = projectFile("account/admin/admin-navigation.js");
  const adminSession = projectFile("account/admin/admin-session.js");
  assert.match(account, /class="settings-link-card" href="\/account\/reviews\/"/);
  assert.doesNotMatch(team, /id="organization-reviews-link"/);
  assert.match(organizationPage, /id="organization-review-form"/);
  assert.match(projectFile("client-portal/client-shell.js"), /key: "reviews", label: "Review", href: "\/client-portal\/reviews\/"/);
  assert.match(projectFile("client-portal/client-workspace-context.js"), /keys: \["reviews"\], label: "Review"/);
  assert.doesNotMatch(account, /id="reviews-app-card"/);
  assert.match(account, /class="settings-link-card" href="\/account\/reviews\/"/);
  assert.match(adminPage, /data-admin-view="reviews"/);
  assert.match(adminNavigation, /\/account\/admin\/reviews\//);
  assert.match(adminSession, /\/account\/admin\/reviews\//);
});

test("review pages use the current full-width product shells instead of the legacy standalone portal", () => {
  const personalPage = projectFile("account/reviews/index.html");
  const organizationPage = projectFile("client-portal/reviews/index.html");
  const publicPage = projectFile("reviews/index.html");
  assert.match(personalPage, /site-topbar home-topbar account-topbar/);
  assert.doesNotMatch(personalPage, /client-portal\/portal\.css/);
  assert.match(organizationPage, /client-portal\/client-shell\.js\?v=29/);
  assert.match(publicPage, /site-topbar home-topbar is-scrolled/);
  assert.doesNotMatch(publicPage, /client-portal\/portal\.css/);
});

test("platform admin can publish, request changes, hide, or reject", () => {
  const page = projectFile("account/admin/reviews/index.html");
  const source = projectFile("src/platform-reviews/admin.ts");
  assert.match(page, /Customer Reviews/);
  assert.match(source, /data-review-status=\"published\"/);
  assert.match(source, /data-review-status=\"changes_requested\"/);
  assert.match(source, /data-review-status=\"hidden\"/);
  assert.match(source, /data-review-status=\"rejected\"/);
  assert.match(source, /Review note for the customer/);
  assert.match(source, /data-review-featured/);
});

test("published reviews have a dedicated public, verified display", () => {
  const page = projectFile("reviews/index.html");
  const source = projectFile("src/platform-reviews/public.ts");
  const homepage = projectFile("index.html");
  assert.match(page, /Verified customer experiences/);
  assert.match(page, /id="public-reviews-grid"/);
  assert.match(source, /\/rest\/v1\/rpc\/list_published_platform_reviews/);
  assert.match(source, /review\.is_featured/);
  assert.match(homepage, /href="\/reviews\/">Reviews/);
});
