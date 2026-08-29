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
  assert.match(source, /Cache-Control", "no-store"/);
  assert.doesNotMatch(publicColumns, /prospect_contact_id/);
  assert.match(source, /status: "eq\.published"/);
  assert.match(source, /const INTERNAL_COLUMNS = `\$\{PUBLIC_COLUMNS\},owner_user_id`/);
  assert.match(source, /const \{ owner_user_id, profile_image_path, company_logo_path, background_image_path, \.\.\.publicCard \} = card/);
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
  assert.doesNotMatch(source, /stale-while-revalidate/);
  assert.doesNotMatch(source, /createSignedUrl/);
});

test("friendly card URLs and separate customer and admin entry points are connected", async () => {
  const [vercel, account, activation, admin, adminLogic, adminStyles, sharedStyles, productShell, prospects, editor] = await Promise.all([
    read("vercel.json"),
    read("account/index.html"),
    read("client-portal/contact-card/index.html"),
    read("n3xra-admin/contact-cards/index.html"),
    read("src/contact-cards/admin.ts"),
    read("n3xra-admin/contact-cards/contact-cards-admin.css"),
    read("card/card.css"),
    read("account/admin/product-shell.js"),
    read("account/admin/prospects/index.html"),
    read("src/contact-cards/editor.ts"),
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
  assert.match(admin, /\/card\/admin\.js\?v=8/);
  assert.match(admin, /\/card\/card\.css\?v=14/);
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
  assert.doesNotMatch(sharedStyles, /\.card-editor-toolbar \{[^}]*position:sticky/s);
  assert.match(sharedStyles, /\.card-workspace-nav \{[^}]*bottom:0[^}]*border-radius:0/s);
  assert.match(sharedStyles, /\.card-workspace-nav \{[^}]*left:50%[^}]*width:min\(560px,calc\(100% - 28px\)\)[^}]*transform:translateX\(-50%\)/s);
  assert.match(activation, /data-card-tab="preview"[^>]*>.*<svg/s);
  assert.match(activation, /id="card-profile-history" hidden/);
  assert.match(editor, /\.in\("status", \["paid", "refunded"\]\)/);
  assert.match(editor, /await saveChanges\(\)/);
  assert.match(sharedStyles, /\.card-workspace-nav button\.is-active \{[^}]*border-top-color/s);
});

test("public Contact Card product page uses the shared N3XRA account flow", async () => {
  const [landingPage, publicCardPage, homepage, sitemap] = await Promise.all([
    read("contact-card/index.html"),
    read("card/index.html"),
    read("index.html"),
    read("sitemap.xml"),
  ]);
  assert.match(landingPage, /N3XRA Contact Card/);
  assert.match(landingPage, /\/account\/\?signup=signup/);
  assert.match(landingPage, /Ready to share one link/);
  assert.equal((landingPage.match(/\/account\/\?signup=signup/g) || []).length, 1);
  assert.doesNotMatch(landingPage, /class="hero-actions"/);
  assert.match(landingPage, /class="demo-card"/);
  assert.match(landingPage, /Save contact/);
  assert.match(landingPage, /class="demo-section-label">Contact/);
  assert.match(landingPage, /data-reveal/);
  assert.match(landingPage, /IntersectionObserver/);
  assert.match(landingPage, /prefers-reduced-motion/);
  assert.match(landingPage, /Scan what you have/);
  assert.match(landingPage, /<a class="home-brand" href="\/" aria-label="N3XRA home">/);
  assert.match(landingPage, /href="\/invest\/">Invest/);
  assert.doesNotMatch(landingPage, /\.footer-grid \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(landingPage, /See how it works/);
  assert.doesNotMatch(landingPage, /data-demo-tab/);
  assert.doesNotMatch(landingPage, /feature-number/);
  assert.doesNotMatch(landingPage, /id="signup-form"/);
  assert.match(publicCardPage, /href="\/contact-card\/" aria-label="Learn about N3XRA Contact Card"/);
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
  const [migration, adminOverride, editor, activation, cardStyles] = await Promise.all([
    read("supabase/migrations/20260826043457_contact_card_profiles.sql"),
    read("supabase/migrations/20260826124620_allow_admin_partial_contact_cards.sql"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
    read("card/card.css"),
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
  assert.match(activation, /\/card\/editor\.js\?v=20/);
  assert.match(activation, /id="card-preview-frame"[\s\S]*scrolling="no"/);
  assert.match(editor, /function fitPreviewFrame\(\)/);
  assert.match(editor, /previewResizeObserver\.observe\(previewShell\)/);
  assert.match(cardStyles, /\.is-card-preview-embed[\s\S]*min-height:0/);
  assert.doesNotMatch(cardStyles, /\.card-phone-preview \{[^}]*height:min\(760px,calc\(100dvh - 190px\)\)/);
  assert.match(activation, /id="card-scan-review"/);
  assert.match(activation, /Use all scanned details/);
  assert.match(activation, /id="card-editor-additional-emails"/);
  assert.match(editor, /applyScanSelection/);
  assert.match(editor, /additional_emails/);
  assert.match(editor, /form\?\.addEventListener\("input", markChanged\)/);
  assert.match(editor, /All changes saved/);
  assert.match(editor, /Retrying automatically/);
  assert.match(editor, /window\.setTimeout\(\(\) => void saveChanges\(\), 4000\)/);
  assert.match(activation, /id="card-physical-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="card-physical-purchase"/);
  assert.match(activation, /id="card-physical-purchase" hidden/);
  assert.ok(activation.indexOf('id="card-view-profile"') < activation.indexOf('id="card-physical-purchase"'));
  assert.match(activation, /form="card-editor-form" name="shipping_name"/);
  assert.match(editor, /function setPhysicalCardPurchaseOpen/);
  assert.match(editor, /physicalCardPurchase\?\.addEventListener\("input", markChanged\)/);
  assert.doesNotMatch(activation, />Save changes</);
});

test("Connect Back stores public submissions privately for the card owner", async () => {
  const [migration, endpoint, publicCard, publicPage, editor, editorPage] = await Promise.all([
    read("supabase/migrations/20260828125842_contact_card_connections.sql"),
    read("api/contact-card-connect.js"),
    read("src/contact-cards/public-card.ts"),
    read("card/index.html"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
  ]);
  assert.match(migration, /create table public\.contact_card_connections/);
  assert.match(migration, /alter table public\.contact_card_connections enable row level security/i);
  assert.match(migration, /auth\.uid\(\)\) = owner_user_id/);
  assert.match(migration, /revoke all on table public\.contact_card_connections from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant insert on table public\.contact_card_connections to anon/i);
  assert.match(migration, /consume_contact_card_connection_rate_limit/);
  assert.match(endpoint, /exchange_enabled: "eq\.true"/);
  assert.match(endpoint, /createHmac\("sha256"/);
  assert.match(endpoint, /privacy_notice_version/);
  assert.match(publicCard, /\/api\/contact-card-connect/);
  assert.match(publicPage, /id="card-connect-dialog"/);
  assert.match(editor, /contact_card_connections/);
  assert.match(editor, /switchWorkspaceView\("preview"\)/);
  assert.match(editorPage, /data-card-tab="contacts"/);
  assert.match(editorPage, /data-card-tab="profile"/);
  assert.match(editorPage, /name="exchange_enabled"/);
  assert.match(editorPage, /\/card\/card\.css\?v=19/);
});

test("Contact Card Contacts combines Connect Back and scanned business cards", async () => {
  const [migration, editor, editorPage] = await Promise.all([
    read("supabase/migrations/20260828152031_contact_card_scanned_contacts.sql"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
  ]);
  assert.match(migration, /business_card_scan/);
  assert.match(migration, /for insert to authenticated[\s\S]*with check/i);
  assert.match(migration, /\(select auth\.uid\(\)\) = owner_user_id/);
  assert.match(migration, /source = 'business_card_scan'/);
  assert.match(migration, /additional_emails text\[\]/);
  assert.match(editorPage, /data-contact-source="public_card"/);
  assert.match(editorPage, /data-contact-source="business_card_scan"/);
  assert.match(editorPage, /id="card-contact-scan-input"/);
  assert.match(editorPage, /id="card-contact-export"/);
  assert.match(editorPage, /id="card-contact-scan-dialog"/);
  assert.match(editor, /scanContactCard/);
  assert.match(editor, /source: "business_card_scan"/);
  assert.match(editor, /exportContactsCsv/);
  assert.match(editor, /n3xra-contacts-/);
  assert.match(editor, /downloadContactVcard/);
  assert.match(editor, /text\/vcard/);
  assert.match(editor, /\.vcf/);
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

test("contact methods retain descriptions and public links use service logos", async () => {
  const [migration, endpoint, editor, admin, publicCard, editorPage] = await Promise.all([
    read("supabase/migrations/20260828135838_add_contact_card_contact_labels.sql"),
    read("api/contact-card.js"),
    read("src/contact-cards/editor.ts"),
    read("src/contact-cards/admin.ts"),
    read("src/contact-cards/public-card.ts"),
    read("client-portal/contact-card/index.html"),
  ]);
  assert.match(migration, /additional_email_labels text\[\]/);
  assert.match(migration, /additional_phone_labels text\[\]/);
  assert.match(migration, /grant update \([\s\S]*email_label[\s\S]*additional_phone_labels/i);
  assert.match(endpoint, /additional_email_labels/);
  assert.match(editorPage, /name="email_label"/);
  assert.match(editorPage, /name="phone_label"/);
  assert.match(editor, /dataset\.contactLabel/);
  assert.match(admin, /additional_phone_labels/);
  assert.match(publicCard, /function serviceIcon/);
  assert.match(publicCard, /instagram:/);
  assert.match(publicCard, /youtube:/);
  assert.match(publicCard, /card\.additional_email_labels/);
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

test("Contact Card commerce keeps one-time card checkout while reserving branding removal for Premium", async () => {
  const [migration, billing, webhook, editor, editorPage, landing] = await Promise.all([
    read("supabase/migrations/20260827051948_contact_card_commerce.sql"),
    read("supabase/functions/contact-card-billing/index.ts"),
    read("supabase/functions/stripe-webhook/index.ts"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
    read("contact-card/index.html"),
  ]);
  assert.match(migration, /create table public\.contact_card_entitlements/);
  assert.match(migration, /Purchase the branding removal upgrade/);
  assert.match(billing, /mode: "payment"/);
  assert.doesNotMatch(billing, /STRIPE_PRICE_CONTACT_CARD_BRANDING_REMOVAL/);
  assert.match(billing, /product === "branding_removal"[\s\S]*New one-time purchases are no longer available/);
  assert.match(webhook, /n3xra_contact_card/);
  assert.match(editor, /checkoutProduct === "branding_removal"/);
  assert.match(editorPage, /Remove “Powered by N3XRA” <i class="card-premium-tag">Premium<\/i>/);
  assert.match(editor, /show_n3xra_branding: hasBrandingRemoval \? values\.get\("show_n3xra_branding"\) !== "on" : true/);
  assert.match(editor, /brandingToggle\.checked = false/);
  assert.doesNotMatch(editor, /startCheckout\("branding_removal"/);
  assert.match(editor, /Branding removal is included with paid N3XRA Contact Card Premium/);
  assert.doesNotMatch(landing, /Permanent “Powered by N3XRA” removal/);
  assert.doesNotMatch(landing, /\$9\.99/);
  assert.match(landing, /3-card tap pack/);
});

test("Contact Card Premium is a recurring, owner-scoped upgrade with a dismissible prompt", async () => {
  const [migration, billing, webhook, editor, editorPage, editorStyles, publicEndpoint, connectEndpoint] = await Promise.all([
    read("supabase/migrations/20260828160512_contact_card_premium_subscription.sql"),
    read("supabase/functions/contact-card-billing/index.ts"),
    read("supabase/functions/stripe-webhook/index.ts"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
    read("card/card.css"),
    read("api/contact-card.js"),
    read("api/contact-card-connect.js"),
  ]);
  assert.match(migration, /premium_active boolean not null default false/);
  assert.match(migration, /premium_prompt_dismissed_at/);
  assert.match(migration, /grant update \(premium_prompt_dismissed_at\)/);
  assert.match(migration, /for update to authenticated[\s\S]*auth\.uid\(\)[\s\S]*with check/i);
  assert.match(migration, /guard_contact_card_connection_premium/);
  assert.match(migration, /branding_removal or premium_active/);
  assert.match(billing, /monthly: \{ amount: 399/);
  assert.match(billing, /yearly: \{ amount: 2999/);
  assert.match(billing, /mode: "subscription"/);
  assert.match(billing, /billingPortal\.sessions\.create/);
  assert.match(billing, /n3xra_contact_card_premium/);
  assert.match(webhook, /syncContactCardPremium/);
  assert.match(webhook, /customer\.subscription\.deleted/);
  assert.match(editorPage, /id="card-premium-dialog"/);
  assert.match(editorPage, /Don’t show this automatically again/);
  assert.match(editorPage, /data-premium-plan="yearly"/);
  assert.match(editorPage, /\$29\.99\/year/);
  assert.match(editorStyles, /\.card-premium-dialog \{[^}]*width:min\(560px,calc\(100vw - 28px\)\)/);
  assert.match(editorStyles, /width:calc\(100vw - 14px\); max-width:calc\(100vw - 14px\)/);
  assert.match(editor, /premium_prompt_dismissed_at/);
  assert.match(editor, /view === "contacts" && !hasPremium/);
  assert.match(editor, /action: "portal"/);
  assert.match(publicEndpoint, /exchange_enabled: hasPremiumTools/);
  assert.match(connectEndpoint, /contact_card_entitlements/);
  assert.match(connectEndpoint, /premium_trial_ends_at/);
});

test("Contact Card Premium offers one server-enforced seven-day trial without branding removal", async () => {
  const [migration, enforcementMigration, billing, webhook, editor, editorPage, publicEndpoint, connectEndpoint] = await Promise.all([
    read("supabase/migrations/20260828170517_contact_card_premium_free_trial.sql"),
    read("supabase/migrations/20260828224346_enforce_paid_contact_card_branding.sql"),
    read("supabase/functions/contact-card-billing/index.ts"),
    read("supabase/functions/stripe-webhook/index.ts"),
    read("src/contact-cards/editor.ts"),
    read("client-portal/contact-card/index.html"),
    read("api/contact-card.js"),
    read("api/contact-card-connect.js"),
  ]);
  assert.match(migration, /premium_trial_started_at timestamptz/);
  assert.match(migration, /premium_trial_ends_at = premium_trial_started_at \+ interval '7 days'/);
  assert.match(migration, /premium_active is true[\s\S]*premium_trial_ends_at > now\(\)/);
  assert.match(billing, /action === "start_trial"/);
  assert.match(billing, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(billing, /\.is\("premium_trial_started_at", null\)/);
  assert.match(editorPage, /Start your 7-day trial/);
  assert.match(editorPage, /No card or payment setup required/);
  assert.match(editorPage, /Branding stays visible during the trial/);
  assert.match(enforcementMigration, /select base_access, premium_active/);
  assert.doesNotMatch(enforcementMigration, /branding_removal or premium_active/);
  assert.match(enforcementMigration, /default_contact_card_premium_features/);
  assert.match(enforcementMigration, /new\.premium_trial_started_at is not null[\s\S]*new\.premium_active is true/);
  assert.match(enforcementMigration, /show_n3xra_branding = true,[\s\S]*exchange_enabled = true/);
  assert.match(billing, /update\(\{ show_n3xra_branding: true, exchange_enabled: true \}\)/);
  assert.match(webhook, /firstPaidActivation[\s\S]*update\(\{ show_n3xra_branding: true, exchange_enabled: true \}\)/);
  assert.match(editor, /hasBrandingRemoval = hasPaidPremium;/);
  assert.match(editor, /card\.exchange_enabled = true;[\s\S]*card\.show_n3xra_branding = true;/);
  assert.match(editor, /action: "start_trial"/);
  assert.match(publicEndpoint, /hasPremiumTools = hasPaidPremium \|\| hasTrialAccess/);
  assert.match(publicEndpoint, /canHideBranding = hasPaidPremium;/);
  assert.match(connectEndpoint, /premium_trial_ends_at/);
});
