import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sender = require("../../api/communications-send.js");
const smsStatus = require("../../api/communications-sms-status.js");
const email = require("../../api/communications-email.js");
const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("client sending rejects unauthenticated requests before any provider operation", async () => {
  let statusCode = 0;
  let payload = null;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return body; },
  };
  await sender({
    method: "POST",
    headers: {},
    body: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      channels: ["sms"],
      message: "Hello",
    },
  }, response);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: "Authentication required." });
});

test("channel normalization and SMS segment estimates cover ordinary and Unicode messages", () => {
  assert.deepEqual(sender.normalizeChannels(["EMAIL", "sms", "sms", "unknown"]), ["email", "sms"]);
  assert.equal(sender.smsSegments("A".repeat(160)), 1);
  assert.equal(sender.smsSegments("A".repeat(161)), 2);
  assert.equal(sender.smsSegments("🙂".repeat(71)), 2);
});

test("the browser sends only a signed-in request while providers and consent checks stay server-side", async () => {
  const [browser, endpoint, page] = await Promise.all([
    projectFile("src/client-portal/communications-app.ts"),
    projectFile("src/communications-provider/communications-send.ts"),
    projectFile("client-portal/communications/index.html"),
  ]);
  assert.match(page, /N3XRA Communications/);
  assert.match(page, /communications-compose-form/);
  assert.match(page, /communications-preview-dialog/);
  assert.match(page, /communications-test-email/);
  assert.match(page, /communications-preview-send/);
  assert.match(page, /Send a test only/);
  assert.match(page, /Subscribers are not contacted/);
  assert.match(page, /Send the live update/);
  assert.doesNotMatch(page, /communications-preview-button/);
  assert.match(browser, /operation: "preview"/);
  assert.match(browser, /operation: "test"/);
  assert.match(browser, /previewFrame\.srcdoc = result\.html/);
  assert.match(browser, /if \(channels\.includes\("email"\) && !liveSendApproved\)[\s\S]*await openEmailPreview\(\)/);
  assert.match(browser, /previewSend\.addEventListener\("click"[\s\S]*liveSendApproved = true;[\s\S]*form\.requestSubmit\(\)/);
  assert.match(browser, /Test sent only to[\s\S]*No subscribers were contacted/);
  assert.match(browser, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(browser, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(browser, /TWILIO_AUTH_TOKEN|COMMUNICATIONS_RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(endpoint, /organization_product_member_access/);
  assert.match(endpoint, /organization_product_entitlements/);
  assert.match(endpoint, /email_status === "subscribed"/);
  assert.match(endpoint, /sms_status === "subscribed"/);
  assert.match(endpoint, /sendResendEmail/);
  assert.match(endpoint, /twilio\(accountSid, authToken\)\.messages\.create/);
  assert.match(endpoint, /Reply STOP to opt out/);
});

test("branded email rendering is email-safe and includes a plain-text fallback", () => {
  const rendered = email.renderCommunicationsEmail({
    brand: {
      name: "Roots & Relics",
      websiteUrl: "https://example.test/",
      logoUrl: "https://cdn.example.test/logo.png",
      primaryColor: "#17231b",
      accentColor: "#b77946",
      headingFont: "Fraunces",
      bodyFont: "Manrope",
      poweredByLabel: "Sent with N3XRA Communications",
    },
    message: "New plants <script>alert(1)</script>\nAvailable Friday.",
    supportEmail: "hello@example.test",
    programName: "Greenhouse updates",
  });
  assert.match(rendered.html, /Roots &amp; Relics/);
  assert.match(rendered.html, /https:\/\/cdn\.example\.test\/logo\.png/);
  assert.match(rendered.html, /background:#17231b/);
  assert.match(rendered.html, /background:#b77946/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered.text, /Visit https:\/\/example\.test\//);
  assert.match(rendered.text, /To change your email preference/);
});

test("email branding follows the active website linked to the Communications workspace", async () => {
  const calls = [];
  const database = async (path) => {
    calls.push(path);
    if (path.startsWith("communications_workspace_websites?")) return [{ website_id: "site-1" }];
    if (path.startsWith("client_websites?")) return [{ id: "site-1", name: "Acme", live_url: "https://acme.example/" }];
    if (path.startsWith("website_portal_branding?")) return [{ logo_asset_id: "logo-1", primary_color: "#123456", accent_color: "#abcdef", heading_font: "Georgia", body_font: "Arial", powered_by_label: "Powered by N3XRA" }];
    if (path.startsWith("website_assets?")) return [{ current_version_id: "version-1", status: "active" }];
    if (path.startsWith("website_asset_versions?")) return [{ public_url: "https://cdn.example/logo.png", status: "published" }];
    return [];
  };
  const brand = await email.loadCommunicationsEmailBrand(database, { id: "workspace-1", organization_id: "org-1", sender_name: "Fallback", program_name: "Updates", website_url: "https://fallback.example/" });
  assert.equal(brand.name, "Acme");
  assert.equal(brand.primaryColor, "#123456");
  assert.equal(brand.logoUrl, "https://cdn.example/logo.png");
  assert.equal(calls.length, 5);
});

test("broadcast persistence is service-only, tenant-scoped, and idempotent", async () => {
  const migration = await projectFile("supabase/migrations/20260901000045_communications_client_broadcast_delivery.sql");
  for (const table of ["communications_broadcasts", "communications_broadcast_recipients"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/);
  assert.match(migration, /payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /unique \(broadcast_id, subscriber_id, channel\)/);
  assert.doesNotMatch(migration, /TWILIO_AUTH_TOKEN|COMMUNICATIONS_RESEND_API_KEY|service_role_key/i);
});

test("Twilio status callbacks collapse provider states into stored Communications states", () => {
  assert.equal(smsStatus.eventStatus("delivered"), "delivered");
  assert.equal(smsStatus.eventStatus("undelivered"), "failed");
  assert.equal(smsStatus.eventStatus("accepted"), "queued");
});
