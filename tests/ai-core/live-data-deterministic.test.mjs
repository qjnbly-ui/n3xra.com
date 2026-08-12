import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ReliableLoader, AdminDataSource, partialObject } = require("../../api/_ai-core/live-data.js");
const { deterministicAnswer, describeFreshness, structuredSummary } = require("../../api/_ai-core/deterministic-answers.js");

test("reliable loader retries and returns latest known good data", async () => {
  let now = new Date("2026-08-11T12:00:00Z");
  const loader = new ReliableLoader({ now: () => now });
  const current = await loader.load("key", "admin_overview", async () => ({ data: { accounts: 3 } }));
  assert.equal(current.status, "current");
  now = new Date("2026-08-11T12:05:00Z");
  let attempts = 0;
  const cached = await loader.load("key", "admin_overview", async () => { attempts += 1; throw new Error("network down"); }, { retries: 2 });
  assert.equal(attempts, 3);
  assert.equal(cached.status, "cached");
  assert.equal(cached.freshnessSeconds, 300);
  assert.deepEqual(cached.data, { accounts: 3 });
});

test("reliable loader reports unavailable without a cache", async () => {
  const result = await new ReliableLoader().load("missing", "account", async () => { throw new Error("offline"); }, { retries: 0 });
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings[0], /offline/);
});

test("reliable loader refuses an expired latest-known-good cache entry", async () => {
  let now = new Date("2026-08-10T00:00:00Z");
  const loader = new ReliableLoader({ now: () => now });
  await loader.load("expired", "admin_overview", async () => ({ data: { accounts: 3 } }));
  now = new Date("2026-08-11T00:00:01Z");
  const result = await loader.load("expired", "admin_overview", async () => { throw new Error("offline"); }, { retries: 0, maxCacheAgeMs: 24 * 60 * 60 * 1000 });
  assert.equal(result.status, "unavailable");
  assert.equal(result.data, null);
});

test("partial data collection preserves successful sources", async () => {
  const result = await partialObject({
    working: async () => [1, 2],
    failing: async () => { throw new Error("timeout"); },
  });
  assert.deepEqual(result.data.working, [1, 2]);
  assert.match(result.warnings[0], /failing: timeout/);
});

test("admin data source loads overview counts through whitelisted REST reads", async () => {
  const fetcher = async () => new Response("[]", { status: 200, headers: { "content-range": "0-0/7" } });
  const source = new AdminDataSource({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" }, { fetcher });
  const result = await source.load("admin_overview", { audience: "admin", user: { id: "a", email: "a@example.com", displayName: "A" }, adminRole: "owner" });
  assert.equal(result.status, "current");
  assert.equal(result.data.accounts, 7);
  assert.equal(result.data.unreadNotifications, 7);
});

test("admin data source refuses admin reads for normal accounts", async () => {
  const source = new AdminDataSource({ SUPABASE_SERVICE_ROLE_KEY: "secret" }, { fetcher: async () => new Response("[]") });
  const result = await source.load("admin_support", { audience: "account", user: { id: "u", email: "u@example.com", displayName: "U" }, adminRole: null });
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings[0], /administrator/i);
});

test("deterministic answers use normalized structured facts and freshness", () => {
  const result = {
    capability: "admin_applications", status: "current", fetchedAt: "2026-08-11T12:00:00Z", recordedAt: null, freshnessSeconds: 0, warnings: [],
    data: { careers: [{ full_name: "Alex", role_interest: "software_developer", status: "new", created_at: "2026-08-11T10:00:00Z" }], partners: [], creators: [] },
  };
  const answer = deterministicAnswer({ capability: "admin_applications", confidence: 1, entities: {}, requiresLiveData: true, requiresAdmin: true, requiresConfirmation: false, reason: "test" }, result, { audience: "admin", user: { id: "a", email: "a@example.com", displayName: "A" }, adminRole: "owner" });
  assert.match(answer, /Alex/);
  assert.match(answer, /Current as of/);
  assert.match(structuredSummary("admin_applications", result), /Career applications/);
  assert.match(describeFreshness({ ...result, status: "cached", fetchedAt: null, recordedAt: "2026-08-11T11:00:00Z" }), /Recorded/);
});

test("deterministic summaries cover every structured capability", () => {
  const base = (capability, data) => ({ capability, status: "current", data, fetchedAt: "2026-08-11T12:00:00Z", recordedAt: null, freshnessSeconds: 0, warnings: [] });
  assert.match(structuredSummary("account", base("account", { profile: { full_name: "User", account_status: "active", subscription_tier: "pro", organization_name: "Org" } })), /Verified account: User/);
  assert.match(structuredSummary("admin_overview", base("admin_overview", { accounts: 4, openSupport: 1 })), /Accounts 4/);
  assert.match(structuredSummary("admin_accounts", base("admin_accounts", { total: 2, recent: [{ full_name: "A", account_status: "active", subscription_tier: "starter" }] })), /Total accounts: 2/);
  assert.match(structuredSummary("admin_support", base("admin_support", { open: [{ subject: "Help", priority: "urgent", status: "new", requester_name: "A", created_at: "2026-08-11T12:00:00Z" }] })), /Help/);
  assert.match(structuredSummary("admin_notifications", base("admin_notifications", { unread: [{ title: "Alert", product: "records", priority: "high", created_at: "2026-08-11T12:00:00Z" }] })), /Alert/);
  assert.match(structuredSummary("admin_websites", base("admin_websites", { requests: [{ business_name: "Shop", status: "new", service_plan: "starter", created_at: "2026-08-11T12:00:00Z" }], projects: [{ name: "Build", status: "active", current_stage: "design", progress_percent: 25 }], proposals: [{}], websites: [{}] })), /Shop/);
  assert.match(structuredSummary("admin_billing", base("admin_billing", { subscriptions: [{ service_plan: "starter", status: "active", amount_cents: 2500, billing_interval: "month" }], websiteInvoices: [{ status: "open", total_cents: 5000, due_at: "2026-08-20T12:00:00Z" }], operationsInvoices: [{}] })), /\$25\.00/);
  assert.match(structuredSummary("admin_operations", base("admin_operations", { parties: [{}], projects: [{}], invoices: [{}], transactions: [{ description: "Deposit", amount_cents: 10000, status: "posted", transaction_date: "2026-08-11T12:00:00Z" }] })), /Deposit/);
  assert.equal(structuredSummary("public_site", base("public_site", {})), "");
});
