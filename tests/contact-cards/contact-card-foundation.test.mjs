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
  assert.match(publicColumns, /additional_emails/);
  assert.match(publicColumns, /additional_phones/);
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
  const [vercel, account, activation, admin, adminLogic, adminStyles, sharedStyles, productShell, prospects] = await Promise.all([
    read("vercel.json"),
    read("account/index.html"),
    read("client-portal/contact-card/index.html"),
    read("n3xra-admin/contact-cards/index.html"),
    read("src/contact-cards/admin.ts"),
    read("n3xra-admin/contact-cards/contact-cards-admin.css"),
    read("card/card.css"),
    read("account/admin/product-shell.js"),
    read("account/admin/prospects/index.html"),
  ]);
  assert.match(vercel, /"source": "\/card\/:slug"[\s\S]*"destination": "\/card\?slug=:slug"/);
  assert.match(account, /\/client-portal\/contact-card\//);
  assert.match(account, /Activate Contact Card/);
  assert.match(activation, /card-activation-slug/);
  assert.match(activation, /card-scan-input/);
  assert.doesNotMatch(activation, /Your digital introduction/);
  assert.doesNotMatch(activation, /Choose your permanent address/);
  assert.match(activation, /id="card-editor-toolbar" hidden/);
  assert.match(admin, /Add Contact Card/);
  assert.match(admin, /class="contact-card-admin-form" id="contact-card-admin-form" hidden/);
  assert.doesNotMatch(admin, /class="contact-card-admin-form hidden"/);
  assert.match(admin, /id="contact-card-modal" role="dialog" aria-modal="true"/);
  assert.match(admin, /id="contact-card-modal-close"/);
  assert.match(admin, /id="contact-card-modal-backdrop"/);
  assert.match(admin, /\/card\/admin\.js\?v=7/);
  assert.match(admin, /\/card\/card\.css\?v=8/);
  assert.match(admin, /\/account\/admin\/product-shell\.js\?v=19/);
  assert.match(admin, /contact-cards-admin\.css\?v=4/);
  assert.match(admin, /id="admin-card-links"/);
  assert.match(admin, /data-admin-media-input="profile"/);
  assert.match(adminLogic, /function openModal/);
  assert.match(adminLogic, /function saveErrorMessage/);
  assert.match(adminLogic, /details\.code === "23505"/);
  assert.match(adminLogic, /modalClose\?\.addEventListener\("click", \(\) => void requestClose\(\)\)/);
  assert.match(adminLogic, /event\.key === "Escape"/);
  assert.match(adminLogic, /async function requestClose/);
  assert.match(adminLogic, /await saveCard\(\)/);
  assert.match(admin, /id="admin-card-scan-input"/);
  assert.match(admin, /id="contact-card-header-save"/);
  assert.match(adminLogic, /new URLSearchParams\(window\.location\.search\)\.get\("card"\)/);
  assert.match(adminStyles, /\.contact-card-modal \{ position:fixed/);
  assert.match(adminStyles, /@media\(max-width:800px\).*\.contact-card-modal\{align-items:end/s);
  assert.match(sharedStyles, /grid-template-rows: auto minmax\(0,1fr\) auto/);
  assert.match(sharedStyles, /\.card-scan-review-fields \{[^}]*min-height: 0;[^}]*overflow: auto/s);
  assert.match(productShell, /querySelectorAll\("\.site-footer, \.home-footer"\)/);
  assert.doesNotMatch(productShell, /querySelectorAll\("footer"\)/);
  assert.doesNotMatch(prospects, /prospect-card-owner/);
  assert.match(sharedStyles, /\.contact-card-company-logo \{[^}]*object-fit: cover/s);
  assert.match(sharedStyles, /\.card-editor-media-preview img \{[^}]*object-fit: cover/s);
  assert.doesNotMatch(sharedStyles, /\.card-editor-media-preview\.is-logo img \{[^}]*object-fit: contain/s);
});

test("public Contact Card product page uses the shared N3XRA account flow", async () => {
  const [landingPage, homepage, sitemap] = await Promise.all([
    read("contact-card/index.html"),
    read("index.html"),
    read("sitemap.xml"),
  ]);
  assert.match(landingPage, /N3XRA Contact Card/);
  assert.match(landingPage, /\/account\/\?signup=signup/);
  assert.match(landingPage, /same N3XRA account/);
  assert.match(landingPage, /class="demo-card"/);
  assert.match(landingPage, /Save contact/);
  assert.match(landingPage, /class="demo-section-label">Contact/);
  assert.doesNotMatch(landingPage, /See how it works/);
  assert.doesNotMatch(landingPage, /feature-number/);
  assert.doesNotMatch(landingPage, /id="signup-form"/);
  assert.match(homepage, /href="\/contact-card\/"/);
  assert.match(sitemap, /https:\/\/n3xra\.com\/contact-card\//);
});

test("physical card requests create an important Admin Inbox notification", async () => {
  const migration = await read("supabase/migrations/20260826130412_notify_admin_on_contact_card_request.sql");
  assert.match(migration, /new\.physical_card_status = 'requested'/);
  assert.match(migration, /old\.physical_card_status is distinct from 'requested'/);
  assert.match(migration, /insert into public\.admin_notifications/);
  assert.match(migration, /'contact_cards\.physical_card\.requested'/);
  assert.match(migration, /'\/n3xra-admin\/contact-cards\/\?card=' \|\| new\.id::text/);
});

test("customers can activate their own card and physical requests are protected", async () => {
  const [migration, adminOverride, editor, activation] = await Promise.all([
    read("supabase/migrations/20260826043457_contact_card_profiles.sql"),
    read("supabase/migrations/20260826124620_allow_admin_partial_contact_cards.sql"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
  ]);
  assert.match(migration, /for insert to authenticated[\s\S]*auth\.uid\(\)\) = owner_user_id/i);
  assert.match(migration, /physical_card_status text not null default 'not_requested'/);
  assert.match(migration, /guard_contact_card_customer_updates/);
  assert.match(migration, /Only N3XRA can update card fulfillment status/);
  assert.match(adminOverride, /drop constraint contact_card_profiles_shipping_check/);
  assert.match(adminOverride, /'delivered'/);
  assert.match(adminOverride, /Complete the mailing address before requesting a physical card/);
  assert.match(adminOverride, /physical_card_status = 'not_requested'/);
  assert.match(editor, /state === "delivered"/);
  assert.match(editor, /Complete the mailing address before requesting a physical card/);
  assert.match(activation, /\/card\/editor\.js\?v=6/);
  assert.match(activation, /id="card-scan-review"/);
  assert.match(activation, /Use all scanned details/);
  assert.match(activation, /id="card-editor-additional-emails"/);
  assert.match(editor, /applyScanSelection/);
  assert.match(editor, /additional_emails/);
  assert.match(editor, /form\?\.addEventListener\("input", markChanged\)/);
  assert.match(editor, /All changes saved/);
  assert.match(editor, /Retrying automatically/);
  assert.match(editor, /window\.setTimeout\(\(\) => void saveChanges\(\), 4000\)/);
  assert.doesNotMatch(activation, />Save changes</);
});

test("contact cards store additional public emails and phone numbers", async () => {
  const [migration, publicCard] = await Promise.all([
    read("supabase/migrations/20260826232037_add_contact_card_extra_contacts.sql"),
    read("src/contact-cards/public-card.ts"),
  ]);
  assert.match(migration, /additional_emails text\[\]/);
  assert.match(migration, /additional_phones text\[\]/);
  assert.match(migration, /cardinality\(additional_emails\) <= 5/);
  assert.match(publicCard, /card\.additional_emails/);
  assert.match(publicCard, /card\.additional_phones/);
});

test("customers can keep editing while N3XRA fulfills a physical card", async () => {
  const migration = await read("supabase/migrations/20260827032319_allow_customer_profile_updates_during_fulfillment.sql");
  assert.match(migration, /new\.physical_card_status is distinct from old\.physical_card_status/);
  assert.match(migration, /old\.physical_card_status in \('processing', 'shipped', 'delivered'\)/);
  assert.match(migration, /Only N3XRA can update card fulfillment status/);
  assert.match(migration, /if new\.physical_card_status is distinct from old\.physical_card_status then[\s\S]*if new\.physical_card_status not in \('not_requested', 'requested'\) then/);
});

test("platform administrators can update a contact card owner", async () => {
  const migration = await read("supabase/migrations/20260827034648_grant_contact_card_admin_owner_updates.sql");
  assert.match(migration, /grant update \(owner_user_id\)/i);
  assert.match(migration, /contact_card_profiles to authenticated/i);
});
