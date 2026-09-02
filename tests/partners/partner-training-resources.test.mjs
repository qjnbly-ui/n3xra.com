import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
const { default: handler } = await import("../../api/partner-portal.js?partner-training-resources-test");

const partnerId = "00000000-0000-4000-8000-000000000001";
const fileId = "00000000-0000-4000-8000-000000000002";

function response(status, body) {
  return {
    statusCode: status,
    headers: {},
    body,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

test("an approved partner receives a temporary URL for a guide in the training folder", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes("/auth/v1/user")) return json({ id: partnerId, email: "partner@example.com" });
    if (String(url).includes("founding_partner_applications?")) return json([{ id: partnerId, status: "approved" }]);
    if (String(url).includes("n3xra_files?select=id,name,storage_path")) return json([{
      id: fileId,
      name: "N3XRA LLC/Sales/Representative Training & Guides/N3XRA_Sales_Representative_Guide_Version_1_Draft.pdf",
      storage_path: "uploads/guide.pdf",
      mime_type: "application/pdf",
    }]);
    if (String(url).includes("/storage/v1/object/sign/n3xra-files/")) return json({ signedURL: "/object/sign/n3xra-files/uploads/guide.pdf?token=temporary" });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const res = response(0, null);
    await handler({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { action: "open_training_resource", file_id: fileId } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, "https://vdbjlgmbpykjblprqnak.supabase.co/storage/v1/object/sign/n3xra-files/uploads/guide.pdf?token=temporary");
    assert.equal(calls.filter((url) => url.includes("/storage/v1/object/sign/")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a partner cannot use the guide endpoint to open another internal file", async () => {
  const originalFetch = globalThis.fetch;
  let signCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) return json({ id: partnerId, email: "partner@example.com" });
    if (String(url).includes("founding_partner_applications?")) return json([{ id: partnerId, status: "approved" }]);
    if (String(url).includes("n3xra_files?select=id,name,storage_path")) return json([{
      id: fileId,
      name: "N3XRA LLC/Business Records/private.pdf",
      storage_path: "uploads/private.pdf",
      mime_type: "application/pdf",
    }]);
    if (String(url).includes("/storage/v1/object/sign/")) signCalls += 1;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const res = response(0, null);
    await handler({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { action: "open_training_resource", file_id: fileId } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "Training resource not found.");
    assert.equal(signCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
