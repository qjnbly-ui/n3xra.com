import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { IdentityResolver, getAuthorizationToken } = require("../../api/_ai-core/auth.js");
const { GroqProvider, OpenAiResponsesProvider, completeWithFallback, createProviderChain } = require("../../api/_ai-core/providers.js");

test("authorization parser accepts only bearer tokens", () => {
  assert.equal(getAuthorizationToken({ authorization: "Bearer abc123" }), "abc123");
  assert.equal(getAuthorizationToken({ authorization: "Basic abc123" }), "");
  assert.equal(getAuthorizationToken({ Authorization: ["Bearer first", "Bearer second"] }), "first");
});

test("identity resolver distinguishes public, account, and verified admin", async () => {
  const publicIdentity = await new IdentityResolver({}).resolve("");
  assert.equal(publicIdentity.audience, "public");

  const userPayload = { id: "u1", email: "user@example.com", user_metadata: { full_name: "User" } };
  const accountFetcher = async () => new Response(JSON.stringify(userPayload), { status: 200 });
  const accountIdentity = await new IdentityResolver({ SUPABASE_ANON_KEY: "anon" }, { fetcher: accountFetcher }).resolve("token");
  assert.equal(accountIdentity.audience, "account");

  let call = 0;
  const adminFetcher = async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify(userPayload), { status: 200 })
      : new Response(JSON.stringify([{ role: "owner", status: "active" }]), { status: 200 });
  };
  const adminIdentity = await new IdentityResolver({ SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "secret" }, { fetcher: adminFetcher }).resolve("token");
  assert.equal(adminIdentity.audience, "admin");
  assert.equal(adminIdentity.adminRole, "owner");
});

test("identity resolver rejects invalid sessions", async () => {
  const resolver = new IdentityResolver({ SUPABASE_ANON_KEY: "anon" }, { fetcher: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(() => resolver.resolve("expired"), /no longer valid/i);
});

test("Groq provider validates normal and structured responses", async () => {
  const requests = [];
  const fetcher = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"capability":"public_site"}' } }] }), { status: 200 });
  };
  const provider = new GroqProvider("key", "model", fetcher);
  const normal = await provider.complete({ messages: [{ role: "user", content: "hi" }], maxTokens: 20, temperature: 0 });
  await provider.completeStructured({ messages: [{ role: "user", content: "route" }], maxTokens: 20, temperature: 0, schemaName: "intent", schema: {} });
  assert.equal(normal.provider, "groq");
  assert.equal(requests[1].response_format.type, "json_object");
});

test("OpenAI fallback uses Responses structured output protocol", async () => {
  let body;
  const provider = new OpenAiResponsesProvider("key", "model", async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: '{"capability":"public_site","confidence":1,"reason":"general"}' }), { status: 200 });
  });
  const result = await provider.completeStructured({ messages: [{ role: "user", content: "route" }], maxTokens: 50, temperature: 0, schemaName: "intent", schema: { type: "object" } });
  assert.equal(result.provider, "openai");
  assert.equal(body.text.format.type, "json_schema");
});

test("provider chain falls back after primary failure", async () => {
  const providers = [
    { name: "primary", async complete() { throw new Error("primary down"); } },
    { name: "fallback", async complete() { return { text: "worked", provider: "fallback", model: "m" }; } },
  ];
  const result = await completeWithFallback(providers, { messages: [], maxTokens: 10, temperature: 0 });
  assert.equal(result.result.text, "worked");
  assert.equal(result.providerIndex, 1);
  assert.match(result.warnings[0], /primary down/);
});

test("provider factory creates only configured providers", () => {
  assert.equal(createProviderChain({}).length, 0);
  assert.equal(createProviderChain({ GROQ_API_KEY: "key", GROQ_ASK_MODEL: "primary", GROQ_FALLBACK_MODEL: "fallback", OPENAI_API_KEY: "key2", OPENAI_ASSISTANT_MODEL: "openai-model" }).length, 3);
});
