import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAdminNotificationEmail,
  notificationActionUrl,
} from "../../supabase/functions/admin-notification-email/email-format.ts";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("every new admin notification is queued for asynchronous email delivery", async () => {
  const migration = await projectFile("supabase/migrations/20260824062732_admin_notification_email_delivery.sql");
  assert.match(migration, /after insert on public\.admin_notifications/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /net\.http_post/);
  assert.match(migration, /email_delivery_status in \('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured'\)/);
  assert.match(migration, /revoke all on function public\.claim_admin_notification_email\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_admin_notification_email\(uuid\) to service_role/);
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

test("delivery endpoint authenticates the webhook and makes Resend retries idempotent", async () => {
  const source = await projectFile("supabase/functions/admin-notification-email/index.ts");
  assert.match(source, /ADMIN_NOTIFICATION_WEBHOOK_TOKEN/);
  assert.match(source, /safeEqual/);
  assert.match(source, /claim_admin_notification_email/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /admin-notification\/\$\{notification\.id\}/);
  assert.match(source, /email_delivery_status: "sent"/);
  assert.match(source, /email_delivery_status: "failed"/);
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
