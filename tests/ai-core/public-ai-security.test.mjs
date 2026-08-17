import assert from "node:assert/strict";
import test from "node:test";
import securityModule from "../../api/_ai-core/public-ai-security.js";

const { createPublicAiSecurity } = securityModule;

const env = {
  TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  ASK_AI_GRANT_SECRET: "grant-test-secret",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test-value",
};

function response(value, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => value };
}

function request(cookie = "") {
  return { headers: { cookie, "x-forwarded-for": "203.0.113.10" } };
}

test("a valid Turnstile result creates a secure browser-session grant", async () => {
  const calls = [];
  const security = createPublicAiSecurity({
    env,
    now: () => Date.UTC(2026, 7, 17, 12),
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("siteverify")) return response({ success: true, action: "ask-ai" });
      return response(true);
    },
  });
  const grant = await security.verifyChallenge("captcha-token", request());
  const cookieHeader = security.cookie(grant);
  const browserCookie = cookieHeader.split(";")[0];
  assert.equal(security.hasGrant(request(browserCookie)), true);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.doesNotMatch(cookieHeader, /Max-Age|Expires/i);
  await security.requireAccess(request(browserCookie), "ask");
  assert.equal(calls.filter((call) => call.url.includes("consume_public_ai_rate_limit")).length, 2);
});

test("tampered grants and incorrect Turnstile actions are rejected", async () => {
  const security = createPublicAiSecurity({
    env,
    fetcher: async () => response({ success: true, action: "career-application" }),
  });
  assert.equal(security.hasGrant(request("n3xra_ask_grant=not-a-real-grant")), false);
  await assert.rejects(
    () => security.verifyChallenge("captcha-token", request()),
    (error) => error?.code === "security_required" && error?.status === 403,
  );
});

test("the durable hourly limit blocks further public model calls", async () => {
  const security = createPublicAiSecurity({
    env,
    fetcher: async (url, options) => {
      if (String(url).includes("siteverify")) return response({ success: true, action: "ask-ai" });
      const payload = JSON.parse(String(options?.body || "{}"));
      return response(payload.input_limit !== 8);
    },
  });
  const grant = await security.verifyChallenge("captcha-token", request());
  const browserCookie = security.cookie(grant).split(";")[0];
  await assert.rejects(
    () => security.requireAccess(request(browserCookie), "ask"),
    (error) => error?.code === "rate_limited" && error?.status === 429,
  );
});
