import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("project cards client workspace is tenant-scoped and starts without sample data", async () => {
  const [page, source, shell, account] = await Promise.all([read("client-portal/project-cards/index.html"), read("src/client-portal/project-cards.ts"), read("client-portal/client-shell.js"), read("account/index.html")]);
  assert.match(page, /client-portal\/client-shell\.css/);
  assert.match(page, /id="pc-project-list"/);
  assert.match(page, />Assigned name</);
  assert.match(page, /Create your first project/);
  assert.doesNotMatch(page, /Internal preview|Medford Fire Assignment/);
  assert.match(source, /organization_product_member_access/);
  assert.match(source, /project_card_projects/);
  assert.doesNotMatch(source, /rpc\("is_platform_admin"\)|medford-fire|PREVIEW/);
  assert.match(source, /n3xra\.com\/t\//);
  assert.match(shell, /Projects & Cards/);
  assert.match(account, /Open Project Cards/);
});

test("project cards retain their internal palette", async () => {
  const styles = await read("client-portal/project-cards/project-cards.css");
  assert.match(styles, /--pc-deep:#183a2f/);
  assert.match(styles, /--pc-lime:#d9f07a/);
  assert.match(styles, /\.pc-project-grid/);
  assert.match(styles, /\.pc-table/);
});

test("project editor loads and saves real tenant resources without sample assignments", async () => {
  const [page, source, styles] = await Promise.all([read("client-portal/project-cards/editor/index.html"), read("src/client-portal/project-cards-editor.ts"), read("client-portal/project-cards/editor/editor.css")]);
  assert.match(page, /id="pe-resource-list"/);
  assert.doesNotMatch(page, /Medford|Fire Weather Briefing/);
  assert.match(source, /type ResourceType = "pdf" \| "radio" \| "image" \| "file" \| "link"/);
  assert.match(source, /can_manage_project_cards/);
  assert.match(source, /project_card_resources/);
  assert.doesNotMatch(source, /Medford|assignedCards = \[/);
  assert.match(styles, /--pe-lime:#d9f07a/);
});

test("public project-card route is scan-ready and does not require authentication", async () => {
  const [page, source, vercel] = await Promise.all([read("project-card/index.html"), read("src/client-portal/project-card-public.ts"), read("vercel.json")]);
  assert.match(page, /Medford Fire Assignment/);
  assert.match(page, /data-resource="weather"/);
  assert.doesNotMatch(source, /createBrowserSupabase|is_platform_admin/);
  assert.match(vercel, /"source": "\/p\/:slug"/);
  assert.match(vercel, /"destination": "\/project-card\?slug=:slug"/);
});

test("card activation waits for a secure server-created identity before NFC writing", async () => {
  const [page, source, cardsSource] = await Promise.all([read("client-portal/project-cards/activate/index.html"), read("src/client-portal/project-cards-activate.ts"), read("src/client-portal/project-cards.ts")]);
  assert.match(page, /Bring your own NFC card/i);
  assert.match(page, /id="pa-write" disabled/);
  assert.match(page, /never recycled after retirement/i);
  assert.match(source, /"NDEFReader" in window/);
  assert.match(source, /rpc\("can_manage_project_cards"/);
  assert.match(source, /rpc\("create_project_card"/);
  assert.doesNotMatch(page, /Medford Fire Assignment|Crew Training Resources/);
  assert.match(cardsSource, /data-card-action/);
  assert.match(cardsSource, /will never be issued again/);
});

test("Project Cards has a separate N3XRA admin workspace", async () => {
  const [page, source, navigation] = await Promise.all([read("n3xra-admin/project-cards/index.html"), read("src/client-portal/project-cards-admin.ts"), read("account/admin/admin-navigation.js")]);
  assert.match(page, /N3XRA MASTER ADMINISTRATION/);
  assert.match(page, /No Project Cards customers yet/);
  assert.match(source, /rpc\("is_platform_admin"\)/);
  assert.match(source, /organization_product_entitlements/);
  assert.match(navigation, /key: "project-cards"[\s\S]*\/n3xra-admin\/project-cards\//);
  assert.doesNotMatch(page, /Medford Fire Assignment|Internal preview/);
});

test("project cards migration keeps tenant data private and permanent tokens non-recyclable", async () => {
  const [migration, verification] = await Promise.all([
    read("supabase/migrations/20260831130251_project_cards_foundation.sql"),
    read("supabase/verification/project_cards_rls.sql"),
  ]);
  assert.match(migration, /create table public\.project_card_projects/);
  assert.match(migration, /create table public\.project_card_resources/);
  assert.match(migration, /create table public\.project_card_devices/);
  assert.match(migration, /create table public\.project_card_device_events/);
  assert.match(migration, /alter table public\.project_card_devices enable row level security/);
  assert.match(migration, /organization_product_role\(target_organization_id, 'project_cards'\)/);
  assert.match(migration, /A retired card identity cannot be reused/);
  assert.match(migration, /extensions\.gen_random_bytes\(16\)/);
  assert.match(migration, /revoke all on table public\.project_card_devices from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant delete[^;]*project_card_devices to authenticated/i);
  assert.match(migration, /grant execute on function public\.resolve_project_card\(text\) to anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_project_card_page\(text\) to anon, authenticated/);
  assert.match(verification, /Viewer incorrectly created a project/);
  assert.match(verification, /Card lifecycle audit events were not recorded/);
});
