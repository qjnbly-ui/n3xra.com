import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "public-anon-key";
process.env.SUPABASE_SECRET_KEY = "sb_secret_FAKEVALUE12345678901234567890";

const require = createRequire(import.meta.url);
const handler = require("../../api/codebase-ai.js");

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test("Codebase AI rejects unauthenticated requests without accessing Supabase", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; throw new Error("must not run"); });
  const response = responseRecorder();
  await handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(calls, 0);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
});

test("Codebase AI requires an owner or admin role after server-side session verification", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls += 1;
    assert.ok(init.signal instanceof AbortSignal);
    if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    return new Response(JSON.stringify([{ user_id: "user-1", role: "viewer", status: "active" }]), { status: 200 });
  });
  const response = responseRecorder();
  await handler({ method: "GET", headers: { authorization: "Bearer valid-user-token" } }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 2);
  assert.match(response.payload.error, /administrator access/i);
});

test("Codebase AI allows a verified owner to read only private-index metadata on GET", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("/auth/v1/user")
    ? new Response(JSON.stringify({ id: "owner-1" }), { status: 200 })
    : new Response(JSON.stringify([{ user_id: "owner-1", role: "owner", status: "active" }]), { status: 200 }));
  const response = responseRecorder();
  await handler({ method: "GET", headers: { authorization: "Bearer valid-owner-token" } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.payload), ["index"]);
  assert.deepEqual(Object.keys(response.payload.index).sort(), ["chunkCount", "fileCount", "generatedAt"]);
});
