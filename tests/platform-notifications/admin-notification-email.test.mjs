import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAdminNotificationEmail,
  buildAdminNotificationSms,
  notificationActionUrl,
} from "../../supabase/functions/admin-notification-email/email-format.ts";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("every new admin notification is queued for asynchronous email and text delivery", async () => {
  const [emailMigration, smsMigration] = await Promise.all([
    projectFile("supabase/migrations/20260824062732_admin_notification_email_delivery.sql"),
    projectFile("supabase/migrations/20260824211010_add_admin_notification_sms_delivery.sql"),
  ]);
  assert.match(emailMigration, /vault\.decrypted_secrets/);
  assert.match(smsMigration, /after insert on public\.admin_notifications/);
  assert.match(smsMigration, /net\.http_post/);
  assert.match(smsMigration, /sms_delivery_status in \('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured'\)/);
  assert.match(smsMigration, /revoke all on function public\.claim_admin_notification_delivery\(uuid\) from public, anon, authenticated/);
  assert.match(smsMigration, /grant execute on function public\.claim_admin_notification_delivery\(uuid\) to service_role/);
});

test("notification text is concise and keeps the secure Admin Inbox link", () => {
  const sms = buildAdminNotificationSms({
    id: "11111111-1111-4111-8111-111111111111",
    product: "websites",
    priority: "important",
    title: "Preview ready for approval",
    summary: "The private Vercel preview is ready for your review and approval.",
    action_url: "/account/admin/support/",
    created_at: "2026-08-24T06:00:00.000Z",
  });
  assert.match(sms, /^N3XRA Admin: Preview ready for approval/);
  assert.match(sms, /The private Vercel preview is ready/);
  assert.match(sms, /https:\/\/www\.n3xra\.com\/account\/admin\/support\//);
  assert.ok(sms.length <= 300);

  const safeFallback = buildAdminNotificationSms({
    id: "11111111-1111-4111-8111-111111111111",
    product: "system",
    priority: "activity",
    title: "New notification",
    summary: "Open it for details.",
    action_url: "https://evil.example/phish",
    created_at: "2026-08-24T06:00:00.000Z",
  });
  assert.doesNotMatch(safeFallback, /evil\.example/);
  assert.match(safeFallback, /https:\/\/www\.n3xra\.com\/account\/admin\/inbox\//);
});

test("notification email contains the same title and readable notification content", () => {
  const email = buildAdminNotificationEmail({
    id: "11111111-1111-4111-8111-111111111111",
    product: "websites",
    priority: "important",
    title: "Preview ready for approval",
    summary: "The private Vercel preview is ready.",
    message_text: "## Review\n\n- Open the preview\n- Approve when ready\n\n<script>unsafe()</script>",
    actor_name: "Client Name",
    actor_email: "client@example.com",
    action_url: "/account/admin/support/",
    created_at: "2026-08-24T06:00:00.000Z",
  });
  assert.equal(email.subject, "[N3XRA] Preview ready for approval");
  assert.match(email.text, /The private Vercel preview is ready/);
  assert.match(email.text, /• Open the preview/);
  assert.match(email.html, /Preview ready for approval/);
  assert.match(email.html, /Open the preview/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /https:\/\/www\.n3xra\.com\/account\/admin\/support\//);
});

test("notification action links cannot turn admin email into an external phishing link", () => {
  assert.equal(notificationActionUrl("https://evil.example/review"), "");
  assert.equal(notificationActionUrl("javascript:alert(1)"), "");
  assert.equal(notificationActionUrl("/account/admin/inbox/"), "https://www.n3xra.com/account/admin/inbox/");
  assert.equal(notificationActionUrl("https://client.portal.n3xra.com/path"), "https://client.portal.n3xra.com/path");
});

test("delivery endpoint authenticates the webhook and sends both email and text", async () => {
  const source = await projectFile("supabase/functions/admin-notification-email/index.ts");
  assert.match(source, /ADMIN_NOTIFICATION_WEBHOOK_TOKEN/);
  assert.match(source, /safeEqual/);
  assert.match(source, /claim_admin_notification_delivery/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /admin-notification\/\$\{notification\.id\}/);
  assert.match(source, /email_delivery_status: "sent"/);
  assert.match(source, /email_delivery_status: "failed"/);
  assert.match(source, /ADMIN_NOTIFICATION_SMS_TO/);
  assert.match(source, /TWILIO_ACCOUNT_SID/);
  assert.match(source, /api\.twilio\.com/);
  assert.match(source, /Messages\.json/);
  assert.match(source, /sms_delivery_status: "sent"/);
  assert.match(source, /sms_delivery_status: "failed"/);
  assert.doesNotMatch(source, /admin_notifications"\)\.insert/);
});

test("admin-producing endpoints rely on the central bridge instead of sending duplicate admin emails", async () => {
  const [website, partners, utilities, virals, account] = await Promise.all([
    projectFile("api/submit-website-request.js"),
    projectFile("api/partners-onboarding.js"),
    projectFile("api/utilities-onboarding.js"),
    projectFile("api/virals-creator-apply.js"),
    projectFile("api/new-account.js"),
  ]);
  assert.doesNotMatch(website, /await sendAdminEmail\(/);
  assert.doesNotMatch(partners, /await sendNotification\(/);
  assert.doesNotMatch(utilities, /await sendNotification\(/);
  assert.doesNotMatch(virals, /sendCreatorApplicationNotificationEmail/);
  assert.doesNotMatch(account, /fetch\("https:\/\/api\.resend\.com\/emails"/);
  for (const source of [website, partners, utilities, virals, account]) assert.match(source, /queued/);
});
