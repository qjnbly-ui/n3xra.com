import assert from "node:assert/strict";
import test from "node:test";

const { createWebsiteChangeIntakeHandler } = await import("../../api/website-change-intake.js");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test("website change intake rejects an unauthenticated request before tenant access", async () => {
  let tenantReads = 0;
  const handler = createWebsiteChangeIntakeHandler({
    identityResolver: { resolve: async () => ({ audience: "public", user: null, adminRole: null }) },
    accessibleWebsite: async () => { tenantReads += 1; return null; },
  });
  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { action: "analyze" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(tenantReads, 0);
});

test("website change intake rejects websites outside the signed-in client's membership", async () => {
  const handler = createWebsiteChangeIntakeHandler({
    identityResolver: { resolve: async () => ({ audience: "account", user: { id: "user-1", email: "client@example.com", displayName: "Client" }, adminRole: null }) },
    accessibleWebsite: async () => null,
  });
  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { action: "analyze", websiteId: "11111111-1111-4111-8111-111111111111", request: "Update our hours." } }, res);
  assert.equal(res.statusCode, 403);
});

test("submitting creates only an awaiting-review record even when client analysis is tampered with", async () => {
  let inserted;
  const handler = createWebsiteChangeIntakeHandler({
    identityResolver: { resolve: async () => ({ audience: "account", user: { id: "user-2", email: "client@example.com", displayName: "Client Name" }, adminRole: null }) },
    accessibleWebsite: async () => ({ id: "22222222-2222-4222-8222-222222222222", name: "Example", organization_id: "33333333-3333-4333-8333-333333333333" }),
    insertRequest: async (record) => { inserted = record; return [{ id: "request-1", ...record }]; },
  });
  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: {
    action: "submit",
    websiteId: "22222222-2222-4222-8222-222222222222",
    request: "Update our Friday hours to 9 AM–3 PM.",
    analysis: { title: "Friday hours", summary: "Change Friday hours.", changeKind: "business_hours", changeScope: "content", automationStatus: "completed", canAutoApply: true },
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(inserted.automation_status, "awaiting_review");
  assert.equal(inserted.intake_mode, "ai_assisted");
  assert.equal(inserted.message, "Update our Friday hours to 9 AM–3 PM.");
  assert.equal("canAutoApply" in inserted, false);
  assert.deepEqual(res.payload.preview, { eligible: false, started: false });
});

test("submitting to a Fast Preview website starts the isolated preview with the client's session", async () => {
  let started;
  const handler = createWebsiteChangeIntakeHandler({
    identityResolver: { resolve: async () => ({ audience: "account", user: { id: "user-3", email: "client@example.com", displayName: "Client Name" }, adminRole: null }) },
    accessibleWebsite: async () => ({ id: "22222222-2222-4222-8222-222222222222", name: "Example", organization_id: "33333333-3333-4333-8333-333333333333", live_preview_enabled: true }),
    insertRequest: async (record) => [{ id: "44444444-4444-4444-8444-444444444444", ...record }],
    startFastPreview: async (requestId, token) => {
      started = { requestId, token };
      return { run: { id: "55555555-5555-4555-8555-555555555555", state: "queued" } };
    },
  });
  const res = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer client-token" }, body: {
    action: "submit",
    websiteId: "22222222-2222-4222-8222-222222222222",
    request: "Make the page backgrounds consistent.",
    analysis: { title: "Background update", summary: "Use one background treatment across every page.", changeKind: "design", changeScope: "code" },
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(started, { requestId: "44444444-4444-4444-8444-444444444444", token: "client-token" });
  assert.equal(res.payload.preview.started, true);
  assert.equal(res.payload.preview.run.state, "queued");
});
