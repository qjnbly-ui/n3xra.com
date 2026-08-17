import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
const require = createRequire(import.meta.url);
const handler = require("../../api/submit-career-application.js");

function request(body, ip) {
  return { method: "POST", body, headers: { "x-forwarded-for": ip }, socket: {} };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("career endpoint rejects requests without a CAPTCHA token before any external write", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected network call"); };
  try {
    const res = response();
    await handler(request({}, "192.0.2.1"), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /Security check failed/i);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("career endpoint rejects random-looking bot names after CAPTCHA verification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  try {
    const res = response();
    await handler(request({ captchaToken: "valid", application: { full_name: "XDziVBiRhJXwTucczQhgTu", email: "person@example.com", information_retention_consent: true } }, "192.0.2.2"), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /real name/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("career endpoint writes a validated application only after CAPTCHA succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("siteverify")) return { ok: true, json: async () => ({ success: true }) };
    if (String(url).includes("/rest/v1/careers_applications")) return { ok: true, json: async () => ({}) };
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const res = response();
    await handler(request({ captchaToken: "valid", application: { full_name: "Taylor Applicant", email: "taylor@example.com", information_retention_consent: true } }, "192.0.2.3"), res);
    assert.equal(res.statusCode, 201);
    assert.match(res.payload.applicationId, /^[0-9a-f-]{36}$/i);
    const write = calls.find((call) => call.url.includes("/rest/v1/careers_applications"));
    assert.ok(write);
    const payload = JSON.parse(write.options.body);
    assert.equal(payload.full_name, "Taylor Applicant");
    assert.equal(payload.status, "new");
    assert.equal(payload.information_retention_consent, true);
  } finally { globalThis.fetch = originalFetch; }
});
