import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { classifyDeterministically, classifyRequest } = require("../../api/_ai-core/router.js");

const admin = { audience: "admin", user: { id: "admin", email: "admin@n3xra.com", displayName: "Admin" }, adminRole: "owner" };
const account = { audience: "account", user: { id: "user", email: "user@example.com", displayName: "User" }, adminRole: null };
const publicIdentity = { audience: "public", user: null, adminRole: null };
const request = (question, path = "/account/admin") => ({ question, conversationId: "conversation-123", history: [], page: { path, title: "N3XRA" } });

const cases = [
  ["Did anyone apply for a job today?", "admin_applications"],
  ["Show me the newest candidates", "admin_applications"],
  ["How many resumes came in?", "admin_applications"],
  ["Any partner applications waiting?", "admin_applications"],
  ["What support tickets are open?", "admin_support"],
  ["Do we have an urgent customer issue?", "admin_support"],
  ["List the support request queue", "admin_support"],
  ["How many user accounts exist?", "admin_accounts"],
  ["Show recent customer profiles", "admin_accounts"],
  ["Which subscribers signed up?", "admin_accounts"],
  ["What is unread in the admin inbox?", "admin_notifications"],
  ["Show platform alerts", "admin_notifications"],
  ["Any new notifications?", "admin_notifications"],
  ["What website projects are launching?", "admin_websites"],
  ["Show the newest proposals", "admin_websites"],
  ["Are there pending website requests?", "admin_websites"],
  ["Which invoices are unpaid?", "admin_billing"],
  ["Show active subscriptions", "admin_billing"],
  ["What billing needs attention?", "admin_billing"],
  ["Summarize operations transactions", "admin_operations"],
  ["What is in the operations ledger?", "admin_operations"],
  ["Show business projects and deposits", "admin_operations"],
  ["How much site traffic did we get?", "admin_analytics"],
  ["Show visitor analytics", "admin_analytics"],
  ["Where are pageviews coming from?", "admin_analytics"],
  ["Give me an admin overview", "admin_overview"],
  ["What needs attention across the platform?", "admin_overview"],
  ["Summarize everything pending", "admin_overview"],
  ["What is my account status?", "account"],
  ["Explain this page", "current_page"],
];

test("structured routing maps natural paraphrases to capabilities", () => {
  for (const [question, expected] of cases) {
    assert.equal(classifyDeterministically(request(question), admin).capability, expected, question);
  }
});

test("records routes always hand off to existing Records AI", () => {
  assert.equal(classifyDeterministically(request("Help me", "/n3xra-records/library"), admin).capability, "records_handoff");
});

test("action requests route to a confirmation-gated capability", () => {
  const intent = classifyDeterministically(request("Can you delete that application?"), admin);
  assert.equal(intent.capability, "admin_action");
  assert.equal(intent.requiresConfirmation, true);
});

test("signed-in account and public requests remain scoped", () => {
  assert.equal(classifyDeterministically(request("What is my plan?"), account).capability, "account");
  assert.equal(classifyDeterministically(request("What does N3XRA build?", "/services"), publicIdentity).capability, "public_site");
  assert.equal(classifyDeterministically(request("Where can I request a website?", "/services"), publicIdentity).capability, "public_site");
  assert.equal(classifyDeterministically(request("Show all customer accounts"), account).capability, "admin_accounts");
});

test("uncertain requests can use a validated structured provider", async () => {
  const provider = {
    name: "test",
    async completeStructured() { return { text: '{"capability":"current_page","confidence":0.91,"reason":"page question"}', provider: "test", model: "test" }; },
  };
  const intent = await classifyRequest(request("Guide me around", "/projects"), publicIdentity, provider);
  assert.equal(intent.capability, "current_page");
});

test("invalid router provider output falls back safely", async () => {
  const provider = { name: "test", async completeStructured() { throw new Error("down"); } };
  const intent = await classifyRequest(request("Tell me something", "/projects"), publicIdentity, provider);
  assert.equal(intent.capability, "public_site");
});
