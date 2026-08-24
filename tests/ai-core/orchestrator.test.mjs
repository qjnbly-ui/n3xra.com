import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AssistantOrchestrator } = require("../../api/_ai-core/orchestrator.js");
const { getSiteContext, localGroundedAnswer } = require("../../api/_ai-core/local-knowledge.js");

const adminIdentity = { audience: "admin", user: { id: "admin", email: "admin@n3xra.com", displayName: "Admin" }, adminRole: "owner" };
const accountIdentity = { audience: "account", user: { id: "user", email: "user@example.com", displayName: "User" }, adminRole: null };
const publicIdentity = { audience: "public", user: null, adminRole: null };
const body = (question, path = "/") => ({ question, conversationId: "conversation-123", history: [], page: { path, title: "N3XRA" } });
const identity = (value) => ({ async resolve() { return value; } });

test("current structured admin data answers before any model", async () => {
  let providerCalls = 0;
  const orchestrator = new AssistantOrchestrator({
    identity: identity(adminIdentity),
    providers: [{ name: "unused", async complete() { providerCalls += 1; throw new Error("should not run"); }, async completeStructured() { throw new Error("unused"); } }],
    liveData: { async load(capability) { return { capability, status: "current", data: { careers: [], partners: [], creators: [] }, fetchedAt: "2026-08-11T12:00:00Z", recordedAt: null, freshnessSeconds: 0, warnings: [] }; } },
  });
  const result = await orchestrator.answer(body("Did anyone submit an application?", "/account/admin/applications"), "token");
  assert.equal(result.source, "live");
  assert.match(result.answer, /None received/);
  assert.equal(providerCalls, 0);
});

test("cached data is clearly labeled as recorded", async () => {
  const orchestrator = new AssistantOrchestrator({
    identity: identity(adminIdentity), providers: [],
    liveData: { async load(capability) { return { capability, status: "cached", data: { open: [] }, fetchedAt: null, recordedAt: "2026-08-11T10:00:00Z", freshnessSeconds: 7_200, warnings: ["live timeout"] }; } },
  });
  const result = await orchestrator.answer(body("Show support tickets", "/account/admin/support"), "token");
  assert.equal(result.source, "cache");
  assert.match(result.answer, /Recorded/);
});

test("primary provider failure uses fallback provider", async () => {
  const providers = [
    { name: "primary", async complete() { throw new Error("down"); }, async completeStructured() { throw new Error("router down"); } },
    { name: "fallback", async complete() { return { text: "Fallback grounded answer", provider: "fallback", model: "m" }; }, async completeStructured() { throw new Error("unused"); } },
  ];
  const orchestrator = new AssistantOrchestrator({ identity: identity(publicIdentity), providers, liveData: null });
  const result = await orchestrator.answer(body("What does N3XRA build?"));
  assert.equal(result.source, "fallback_ai");
  assert.equal(result.answer, "Fallback grounded answer");
  assert.match(result.warnings[0], /primary/);
});

test("all provider failures return a useful local answer", async () => {
  const down = { name: "down", async complete() { throw new Error("offline"); }, async completeStructured() { throw new Error("offline"); } };
  const orchestrator = new AssistantOrchestrator({ identity: identity(publicIdentity), providers: [down], liveData: null });
  const result = await orchestrator.answer(body("I need help with a website"));
  assert.equal(result.source, "local");
  assert.match(result.answer, /\/services/);
});

test("non-admin accounts cannot obtain admin live data", async () => {
  let liveCalls = 0;
  const orchestrator = new AssistantOrchestrator({
    identity: identity(accountIdentity), providers: [],
    liveData: { async load() { liveCalls += 1; throw new Error("must not run"); } },
  });
  const result = await orchestrator.answer(body("Show all customer accounts"), "token");
  assert.equal(result.capability, "account");
  assert.match(result.answer, /not an active platform administrator/i);
  assert.equal(liveCalls, 0);
});

test("Records keeps its dedicated AI and admin actions remain confirmation-gated", async () => {
  const orchestrator = new AssistantOrchestrator({ identity: identity(adminIdentity), providers: [], liveData: null });
  const records = await orchestrator.answer(body("Help me search", "/n3xra-records/library"), "token");
  assert.match(records.answer, /Records AI remains/);
  const action = await orchestrator.answer(body("Can you delete that account?", "/account/admin/accounts"), "token");
  assert.equal(action.capability, "admin_action");
  assert.match(action.answer, /write actions are not enabled/i);
});

test("admin outreach rewriting reaches the model without loading unrelated account data", async () => {
  let liveCalls = 0;
  let providerRequest;
  const orchestrator = new AssistantOrchestrator({
    identity: identity(adminIdentity),
    providers: [{
      name: "drafting",
      async complete(request) { providerRequest = request; return { text: "Rewritten N3XRA outreach", provider: "drafting", model: "test" }; },
      async completeStructured() { throw new Error("drafting must not need intent fallback"); },
    }],
    liveData: { async load() { liveCalls += 1; throw new Error("must not load account data"); } },
  });
  const result = await orchestrator.answer({
    ...body("Template 1: Online Utility Billing, records, and public access."),
    history: [
      { role: "user", content: "Rewrite each template using what N3XRA actually stands for and avoid promises we cannot make." },
      { role: "assistant", content: "Send the first template." },
    ],
  }, "token");
  assert.equal(result.capability, "admin_advisory");
  assert.equal(result.answer, "Rewritten N3XRA outreach");
  assert.equal(liveCalls, 0);
  assert.match(providerRequest.messages.map((message) => message.content).join("\n"), /avoid promises we cannot make/i);
});

test("session probe recognizes assistant mode", async () => {
  const orchestrator = new AssistantOrchestrator({ identity: identity(adminIdentity), providers: [], liveData: null });
  assert.deepEqual(await orchestrator.sessionMode("token"), { audience: "admin", label: "Admin AI", signedIn: true });
});

test("local knowledge remains available to existing integrations", async () => {
  const context = await getSiteContext("What does Records do?", [], publicIdentity, { path: "/records", title: "Records" });
  assert.match(context, /AUTHORITATIVE N3XRA KNOWLEDGE|PUBLIC SITE SUMMARY/);
  assert.match(localGroundedAnswer("help", "records_handoff", { path: "/n3xra-records/library", title: "Records" }), /dedicated assistant/);
});

test("current-page questions always receive the exact current public page extract", async () => {
  const context = await getSiteContext("What am I looking at?", [], publicIdentity, { path: "/", title: "N3XRA home" }, "current_page");
  assert.match(context, /CURRENT PAGE EXTRACT[\s\S]*Route \/:/);
  assert.match(context, /Bring your ideas to life\. Build whatever comes next\./);
  assert.match(context, /mention only sections, labels, destinations, and actions explicitly present/i);
  assert.doesNotMatch(context, /PUBLIC PROJECT PULSE/);
  assert.match(context, /Answer from this extract only/);
});

test("public and admin contexts use separate mode profiles", async () => {
  const publicContext = await getSiteContext("What does N3XRA offer?", [], publicIdentity, { path: "/", title: "N3XRA" });
  const adminContext = await getSiteContext("What does N3XRA offer?", [], adminIdentity, { path: "/", title: "N3XRA" });
  assert.match(publicContext, /sales professional and trusted friend/i);
  assert.doesNotMatch(adminContext, /sales professional and trusted friend/i);
  assert.match(adminContext, /direct, operational, and concise/i);
  assert.match(publicContext, /pronounced Nexra/i);
  assert.match(adminContext, /pronounced Nexra/i);
});

test("historically unreliable questions resolve through capabilities", async () => {
  const overview = { accounts: 10, openSupport: 2, careerApplications: 0, partnerApplications: 1, creatorApplications: 3, websiteRequests: 4, activeWebsiteProjects: 2, unreadNotifications: 5 };
  const orchestrator = new AssistantOrchestrator({
    identity: identity(adminIdentity), providers: [],
    liveData: { async load(capability) { return { capability, status: "partial", data: overview, fetchedAt: "2026-08-11T12:00:00Z", recordedAt: null, freshnessSeconds: 0, warnings: ["analytics unavailable"] }; } },
  });
  for (const question of ["What needs my attention?", "Give me the platform status", "Summarize everything pending"]) {
    const result = await orchestrator.answer(body(question, "/account"), "token");
    assert.match(result.answer, /Accounts 10/);
    assert.equal(result.dataStatus, "partial");
  }
});
