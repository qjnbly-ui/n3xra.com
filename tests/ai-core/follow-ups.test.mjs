import assert from "node:assert/strict";
import test from "node:test";
import followUpModule from "../../api/ai-follow-ups.js";

const { createFollowUpHandler, normalizeFollowUps, prepareAnswerContext } = followUpModule;

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

function runHandler(handler, { body = {}, headers = {} } = {}) {
  const result = { status: 200, headers: {}, body: null };
  const res = {
    setHeader(name, value) { result.headers[name] = value; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return result; },
  };
  return Promise.resolve(handler({ method: "POST", body, headers, socket: { remoteAddress: "127.0.0.1" } }, res));
}

test("follow-up normalization is bounded, redacted, and deduplicated", () => {
  assert.deepEqual(normalizeFollowUps([
    "  1. Which accounts are paid?  ",
    "Which accounts are paid?",
    "Show the newest account",
    "Contact sk-test_abcdefghijklmnopqrstuvwxyz",
  ], "What can you tell me about the average user?"), [
    "Which accounts are paid?",
    "Show the newest account?",
    "Contact [REDACTED_SECRET]?",
  ]);
});

test("private follow-up context removes personal details but preserves useful status data", () => {
  const context = prepareAnswerContext([
    "Total accounts: 12.",
    "1. Jennifer Patzke — active, free",
    "Owner: Quentin Nichols",
    "Email: person@example.test",
    "Phone: +1 (555) 867-5309",
    "Account: 596b4d01-29e4-4a07-9c4e-30e597756c25",
  ].join("\n"), "admin");
  assert.doesNotMatch(context, /Jennifer|Patzke|Quentin|Nichols|person@example|555|596b4d01/i);
  assert.match(context, /Total accounts: 12/i);
  assert.match(context, /active, free/i);
});

test("public follow-ups use one strict structured model request", async () => {
  let payload;
  const handler = createFollowUpHandler({
    env: { GROQ_API_KEY: "test-key" },
    publicSecurity: { requireAccess: async () => {} },
    fetcher: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ followUps: [
        "How many accounts are on paid plans?",
        "Which accounts were added most recently?",
        "Are any accounts inactive?",
      ] }) } }] });
    },
  });
  const result = await runHandler(handler, { body: {
    surface: "public",
    question: "What can you tell me about the average user?",
    answer: "There are 12 accounts, and the recent accounts are active on the free plan.",
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.followUps.length, 3);
  assert.equal(payload.reasoning_effort, "low");
  assert.equal(payload.max_completion_tokens, 520);
  assert.equal(payload.response_format.json_schema.strict, true);
});

test("private follow-up surfaces require the appropriate verified session", async () => {
  const handler = createFollowUpHandler({ env: {}, fetcher: async () => response({}) });
  const account = await runHandler(handler, { body: { surface: "account", question: "Status?", answer: "Active." } });
  const admin = await runHandler(handler, { body: { surface: "admin", question: "Status?", answer: "Active." } });
  assert.equal(account.status, 401);
  assert.equal(admin.status, 401);
});

test("a normal authenticated account cannot request admin or codebase follow-ups", async () => {
  const handler = createFollowUpHandler({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "public-key",
      SUPABASE_SECRET_KEY: "sb_secret_test-value",
      GROQ_API_KEY: "test-key",
    },
    fetcher: async (url) => String(url).includes("/auth/v1/user")
      ? response({ id: "account-user", email: "person@example.test" })
      : response([]),
  });
  const result = await runHandler(handler, {
    headers: { authorization: "Bearer account-token" },
    body: { surface: "codebase", question: "How is access controlled?", answer: "It is role restricted." },
  });
  assert.equal(result.status, 403);
  assert.match(result.body.error, /administrator/i);
});
