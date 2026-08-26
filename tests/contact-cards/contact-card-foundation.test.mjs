import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("public contact-card endpoint returns only the approved public fields", async () => {
  const source = await read("api/contact-card.js");
  const publicColumns = source.match(/const PUBLIC_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || "";
  assert.match(publicColumns, /display_name/);
  assert.match(publicColumns, /links/);
  assert.match(publicColumns, /show_n3xra_branding/);
  assert.doesNotMatch(publicColumns, /owner_user_id/);
  assert.doesNotMatch(publicColumns, /prospect_contact_id/);
  assert.match(source, /status: "eq\.published"/);
  assert.match(source, /const \{ profile_image_path, company_logo_path, background_image_path, \.\.\.publicCard \} = card/);
  assert.match(source, /profile: Boolean\(profile_image_path\)/);
});

test("contact cards enforce owner-scoped reads and updates", async () => {
  const migration = await read("supabase/migrations/20260826043457_contact_card_profiles.sql");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\)\) = owner_user_id/);
  assert.match(migration, /for update to authenticated[\s\S]*using[\s\S]*with check/i);
  assert.match(migration, /unique index contact_card_profiles_owner_unique_idx/);
  assert.match(migration, /show_n3xra_branding boolean not null default true/);
  assert.match(migration, /section_order text\[\] not null default/);
  assert.match(migration, /'contact-card-media'/);
  assert.match(migration, /contact_card_media_owner_insert/);
  assert.match(migration, /revoke all on table public\.contact_card_profiles from public, anon, authenticated/i);
});

test("private card media is only served for published profiles", async () => {
  const source = await read("api/contact-card-media.js");
  assert.match(source, /status: "eq\.published"/);
  assert.match(source, /contact-card-media/);
  assert.match(source, /SERVICE_KEY/);
  assert.doesNotMatch(source, /createSignedUrl/);
});

test("friendly card URLs and separate customer and admin entry points are connected", async () => {
  const [vercel, account, activation, admin, adminLogic, adminStyles, prospects] = await Promise.all([
    read("vercel.json"),
    read("account/index.html"),
    read("client-portal/contact-card/index.html"),
    read("n3xra-admin/contact-cards/index.html"),
    read("src/contact-cards/admin.ts"),
    read("n3xra-admin/contact-cards/contact-cards-admin.css"),
    read("account/admin/prospects/index.html"),
  ]);
  assert.match(vercel, /"source": "\/card\/:slug"/);
  assert.match(account, /\/client-portal\/contact-card\//);
  assert.match(account, /Activate Contact Card/);
  assert.match(activation, /card-activation-slug/);
  assert.match(activation, /card-scan-input/);
  assert.match(admin, /Add Contact Card/);
  assert.match(admin, /class="contact-card-admin-form" id="contact-card-admin-form" hidden/);
  assert.doesNotMatch(admin, /class="contact-card-admin-form hidden"/);
  assert.match(admin, /id="contact-card-modal" role="dialog" aria-modal="true"/);
  assert.match(admin, /id="contact-card-modal-close"/);
  assert.match(admin, /id="contact-card-modal-backdrop"/);
  assert.match(admin, /\/card\/admin\.js\?v=3/);
  assert.match(admin, /contact-cards-admin\.css\?v=2/);
  assert.match(adminLogic, /function openModal/);
  assert.match(adminLogic, /modalClose\?\.addEventListener\("click", closeModal\)/);
  assert.match(adminLogic, /event\.key === "Escape"/);
  assert.match(adminStyles, /\.contact-card-modal \{ position:fixed/);
  assert.match(adminStyles, /@media\(max-width:800px\).*\.contact-card-modal\{align-items:end/s);
  assert.doesNotMatch(prospects, /prospect-card-owner/);
});

test("customers can activate their own card and physical requests are protected", async () => {
  const migration = await read("supabase/migrations/20260826043457_contact_card_profiles.sql");
  assert.match(migration, /for insert to authenticated[\s\S]*auth\.uid\(\)\) = owner_user_id/i);
  assert.match(migration, /physical_card_status text not null default 'not_requested'/);
  assert.match(migration, /guard_contact_card_customer_updates/);
  assert.match(migration, /Only N3XRA can update card fulfillment status/);
});
