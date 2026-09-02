import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("prospects remain separate from accounts and store private business-card images", async () => {
  const [migration, page, controller] = await Promise.all([
    read("supabase/migrations/20260824235341_prospect_business_card_contacts.sql"),
    read("account/admin/prospects/index.html"),
    read("src/admin-prospects/prospects.ts"),
  ]);

  assert.match(migration, /create table if not exists public\.prospect_contacts/);
  assert.match(migration, /alter table public\.prospect_contacts enable row level security/);
  assert.match(migration, /grant select, insert, update, delete on table public\.prospect_contacts to authenticated/);
  assert.match(migration, /'prospect-business-cards',[\s\S]*false,[\s\S]*8388608/);
  assert.match(migration, /prospect_business_cards_admin_select[\s\S]*is_platform_admin/);
  assert.match(migration, /email_marketing_status <> 'subscribed'[\s\S]*email_consent_at is not null/);
  assert.match(migration, /sms_marketing_status <> 'subscribed'[\s\S]*sms_consent_at is not null/);
  assert.match(migration, /Prospect records never create or enroll auth accounts/);
  assert.match(page, /capture="environment"/);
  assert.match(page, /Scanning a card does not provide marketing consent/);
  assert.match(controller, /\.from\("prospect_contacts"\)/);
  assert.doesNotMatch(controller, /auth\.admin|profiles|createUser|inviteUser/);
});

test("authorized staff can open Sales Leads and announcements expose a consent-aware audience", async () => {
  const [navigation, session, announcementPage, announcementController, edgeFunction, smsConsent] = await Promise.all([
    read("account/admin/admin-navigation.js"),
    read("account/admin/admin-session.js"),
    read("account/notifications/index.html"),
    read("account/notifications/notifications.js"),
    read("supabase/functions/platform-admin/index.ts"),
    read("api/_sms-consent.js"),
  ]);

  assert.match(navigation, /\["\/account\/admin\/prospects\/", "Sales Leads"\]/);
  assert.match(session, /"\/account\/admin\/prospects\/"/);
  assert.match(announcementPage, /<option value="prospects">Potential Clients<\/option>/);
  assert.match(announcementController, /recipientKeys:/);
  assert.match(announcementController, /function notificationRecipientIsEligible/);
  assert.match(edgeFunction, /prospects: "Potential Clients"/);
  assert.match(edgeFunction, /key: `prospect:\$\{contact\.id\}`/);
  assert.match(edgeFunction, /emailOptedIn: Boolean\(email && contact\.email_marketing_status === "subscribed"\)/);
  assert.match(edgeFunction, /smsOptedIn: Boolean\(phone && contact\.sms_marketing_status === "subscribed" && latestConsentByPhone\.get\(phone\)\?\.event_type !== "opt_out"\)/);
  assert.match(edgeFunction, /Email skipped because this prospect has no active email consent/);
  assert.match(edgeFunction, /Text skipped because this recipient has no active SMS consent/);
  assert.match(smsConsent, /eventType === "opt_out"[\s\S]*prospect_contacts\?phone_e164=eq\.[\s\S]*sms_marketing_status: "unsubscribed"/);
});

test("Groq business-card analysis uses vision input and normalizes extracted contact details", async () => {
  const { analyzeProspectBusinessCard } = await import("../../api/_ai-core/prospect-card.js");
  let requestBody;
  const fetcher = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        full_name: " Lindsay Example ",
        first_name: "Lindsay",
        last_name: "Example",
        job_title: "Owner",
        company_name: "Example Studio",
        email: "LINDSAY@EXAMPLE.COM",
        emails: ["LINDSAY@EXAMPLE.COM", "studio@example.com"],
        phone: "541-555-0123",
        phones: ["541-555-0123", "541-555-0199"],
        website_url: "example.com",
        address: "123 Main St",
        interest_tags: ["Website", "Website", "Communications"],
        notes: "Local design studio",
        confidence: 1.2,
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await analyzeProspectBusinessCard("data:image/jpeg;base64,aGVsbG8=", {
    env: { GROQ_API_KEY: "test-key" },
    fetcher,
  });

  assert.equal(requestBody.model, "qwen/qwen3.6-27b");
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.messages[1].content[1].type, "image_url");
  assert.equal(result.details.email, "lindsay@example.com");
  assert.deepEqual(result.details.emails, ["lindsay@example.com", "studio@example.com"]);
  assert.equal(result.details.phoneE164, "+15415550123");
  assert.deepEqual(result.details.phonesE164, ["+15415550123", "+15415550199"]);
  assert.equal(result.details.websiteUrl, "https://example.com/");
  assert.deepEqual(result.details.interestTags, ["Website", "Communications"]);
  assert.equal(result.details.confidence, 1);
});
