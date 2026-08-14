import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const resend = require("../../api/_communications-resend.js");
const webhook = require("../../api/communications-resend-webhook.js");
const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const subscriberId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const secretBytes = Buffer.from("resend-webhook-test-secret");
const webhookSecret = `whsec_${secretBytes.toString("base64")}`;

function signature(payload, svixId, timestamp) {
  return `v1,${createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(`${svixId}.${timestamp}.`), Buffer.from(payload)]))
    .digest("base64")}`;
}

function deliveryInput(overrides = {}) {
  return {
    workspaceId,
    subscriberId,
    idempotencyKey: "welcome-2026-08-14-0001",
    from: "Updates@Example.com",
    to: "Member@Example.com",
    subject: "Welcome",
    html: "<p>Welcome.</p>",
    text: "Welcome.",
    ...overrides,
  };
}

test("the adapter prepares and claims atomically before sending with provider idempotency", async () => {
  const calls = [];
  const database = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    if (path.endsWith("communications_prepare_resend_delivery")) {
      return { request_id: requestId, status: "prepared", existing: false };
    }
    if (path.endsWith("communications_claim_resend_delivery")) {
      return { request_id: requestId, status: "sending", should_send: true };
    }
    return { request_id: requestId, status: "sent", existing: false };
  };
  let providerRequest;
  const fetchImplementation = async (url, options) => {
    providerRequest = { url, options };
    return new Response(JSON.stringify({ id: "resend-message-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await resend.sendResendEmail(deliveryInput(), {
    database,
    fetch: fetchImplementation,
    apiKey: "re_test_server_only",
  });

  assert.equal(result.sent, true);
  assert.equal(result.providerMessageId, "resend-message-1");
  assert.deepEqual(calls.map((call) => call.path), [
    "rpc/communications_prepare_resend_delivery",
    "rpc/communications_claim_resend_delivery",
    "rpc/communications_record_resend_delivery_result",
  ]);
  assert.match(calls[0].body.input_payload_hash, /^[0-9a-f]{64}$/);
  assert.equal(calls[2].body.input_success, true);
  assert.equal(providerRequest.url, resend.RESEND_ENDPOINT);
  assert.equal(providerRequest.options.headers["Idempotency-Key"], "welcome-2026-08-14-0001");
  assert.equal(providerRequest.options.headers.Authorization, "Bearer re_test_server_only");
  assert.deepEqual(JSON.parse(providerRequest.options.body).to, ["member@example.com"]);
});

test("an already claimed delivery never calls Resend again", async () => {
  let providerCalls = 0;
  const database = async (path) => {
    if (path.endsWith("communications_prepare_resend_delivery")) {
      return { request_id: requestId, status: "delivered", provider_message_id: "resend-existing" };
    }
    return { request_id: requestId, status: "delivered", should_send: false };
  };
  const result = await resend.sendResendEmail(deliveryInput(), {
    database,
    fetch: async () => {
      providerCalls += 1;
      throw new Error("must not send");
    },
    apiKey: "re_test_server_only",
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.sent, false);
  assert.equal(result.existing, true);
  assert.equal(result.providerMessageId, "resend-existing");
});

test("retryable provider failures are recorded before being rethrown", async () => {
  const calls = [];
  const database = async (path, options) => {
    const body = JSON.parse(options.body);
    calls.push({ path, body });
    if (path.endsWith("communications_prepare_resend_delivery")) return { request_id: requestId, status: "prepared" };
    if (path.endsWith("communications_claim_resend_delivery")) return { request_id: requestId, status: "sending", should_send: true };
    return { request_id: requestId, status: "failed", retryable: true };
  };

  await assert.rejects(
    resend.sendResendEmail(deliveryInput(), {
      database,
      fetch: async () => new Response(JSON.stringify({ message: "Rate limited" }), { status: 429 }),
      apiKey: "re_test_server_only",
    }),
    /Rate limited/,
  );
  const failure = calls.at(-1);
  assert.match(failure.path, /communications_record_resend_delivery_result$/);
  assert.equal(failure.body.input_success, false);
  assert.equal(failure.body.input_retryable, true);
});

test("webhook verification requires the exact raw payload and a fresh Svix signature", () => {
  const payload = JSON.stringify({ type: "email.delivered", created_at: "2026-08-14T18:00:00.000Z", data: {} });
  const svixId = "msg_webhook_1";
  const timestamp = "1786730400";
  const signed = signature(payload, svixId, timestamp);
  const verification = {
    payload,
    svixId,
    svixTimestamp: timestamp,
    svixSignature: signed,
    secret: webhookSecret,
    nowSeconds: Number(timestamp),
  };

  assert.equal(resend.verifyResendWebhook(verification), true);
  assert.equal(resend.verifyResendWebhook({ ...verification, payload: `${payload} ` }), false);
  assert.equal(resend.verifyResendWebhook({ ...verification, svixSignature: "v1,invalid" }), false);
  assert.equal(resend.verifyResendWebhook({ ...verification, nowSeconds: Number(timestamp) + 301 }), false);
});

test("a verified webhook is hashed and delegated to the single atomic database operation", async () => {
  const payload = JSON.stringify({
    type: "email.bounced",
    created_at: "2026-08-14T18:00:00.000Z",
    data: {
      email_id: "resend-message-1",
      to: ["member@example.com"],
      bounce: { type: "Permanent" },
    },
  });
  const svixId = "msg_webhook_2";
  const timestamp = "1786730400";
  let databaseCall;
  const result = await webhook.processResendWebhook(Buffer.from(payload), {
    svixId,
    svixTimestamp: timestamp,
    svixSignature: signature(payload, svixId, timestamp),
  }, {
    secret: webhookSecret,
    nowSeconds: Number(timestamp),
    database: async (path, options) => {
      databaseCall = { path, body: JSON.parse(options.body) };
      return { ok: true, processed: true, suppressed: true };
    },
  });

  assert.equal(result.suppressed, true);
  assert.equal(databaseCall.path, "rpc/communications_process_resend_webhook");
  assert.equal(databaseCall.body.input_svix_id, svixId);
  assert.equal(databaseCall.body.input_provider_message_id, "resend-message-1");
  assert.match(databaseCall.body.input_payload_hash, /^[0-9a-f]{64}$/);
});

test("account-level suppression events are accepted without a delivery message ID", async () => {
  const payload = JSON.stringify({
    type: "suppression.removed",
    created_at: "2026-08-14T18:00:00.000Z",
    data: {
      id: "suppression-1",
      email: "member@example.com",
      origin: "manual",
      source_id: null,
    },
  });
  const svixId = "msg_webhook_3";
  const timestamp = "1786730400";
  let body;
  const result = await webhook.processResendWebhook(Buffer.from(payload), {
    svixId,
    svixTimestamp: timestamp,
    svixSignature: signature(payload, svixId, timestamp),
  }, {
    secret: webhookSecret,
    nowSeconds: Number(timestamp),
    database: async (_path, options) => {
      body = JSON.parse(options.body);
      return { ok: true, processed: true, suppression_status: "removed" };
    },
  });

  assert.equal(body.input_event_type, "suppression.removed");
  assert.equal(body.input_provider_message_id, null);
  assert.equal(result.suppression_status, "removed");
});

test("the migration keeps provider history private, immutable, ordered, and service-only", async () => {
  const migration = await projectFile("supabase/migrations/20260814184353_communications_resend_provider_foundation.sql");

  for (const table of [
    "communications_email_delivery_requests",
    "communications_email_suppressions",
    "communications_resend_webhook_events",
    "communications_provider_audit_log",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.match(migration, /before update or delete on public\.communications_resend_webhook_events/);
  assert.match(migration, /before update or delete on public\.communications_provider_audit_log/);
  assert.match(migration, /before truncate on public\.communications_resend_webhook_events/);
  assert.match(migration, /before truncate on public\.communications_provider_audit_log/);
  assert.equal((migration.match(/grant execute on function public\.communications_/g) || []).length, 4);
  assert.match(migration, /grant select, insert on public\.communications_provider_audit_log to service_role/);
  assert.doesNotMatch(migration, /grant (?:all|update|delete).*communications_provider_audit_log/i);
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/);
  assert.match(migration, /target_workspace\.status <> 'active'/);
  assert.match(migration, /svix_id text not null unique/);
  assert.match(migration, /provider_status_at timestamptz/);
  assert.match(migration, /input_occurred_at >= target_request\.provider_status_at/);
  assert.match(migration, /communications_email_suppressions[\s\S]*status = 'active'/);
  assert.match(migration, /'suppression\.added', 'suppression\.removed'/);
  assert.match(migration, /on conflict \(email\) where workspace_id is null do update/);
  assert.match(migration, /normalized_event_type = 'suppression\.removed' and suppression_state_applied/);
  assert.doesNotMatch(migration, /RESEND_API_KEY|COMMUNICATIONS_RESEND_API_KEY|WEBHOOK_SECRET|service_role_key/i);
});

test("provider credentials and verification stay exclusively in server code", async () => {
  const [adapterSource, webhookSource, compiledAdapter, browserSource] = await Promise.all([
    projectFile("src/communications-provider/_communications-resend.ts"),
    projectFile("src/communications-provider/communications-resend-webhook.ts"),
    projectFile("api/_communications-resend.js"),
    projectFile("src/communications-admin/communications-admin.ts"),
  ]);
  assert.match(adapterSource, /process\.env\.COMMUNICATIONS_RESEND_API_KEY/);
  assert.match(adapterSource, /process\.env\.COMMUNICATIONS_RESEND_WEBHOOK_SECRET/);
  assert.match(webhookSource, /bodyParser: false/);
  assert.match(webhookSource, /readRawBody/);
  assert.match(compiledAdapter, /Idempotency-Key/);
  assert.doesNotMatch(browserSource, /COMMUNICATIONS_RESEND_API_KEY|COMMUNICATIONS_RESEND_WEBHOOK_SECRET/);
});
