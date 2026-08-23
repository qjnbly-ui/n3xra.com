import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);

test("client analytics is a separate tenant feature from platform-admin analytics", async () => {
  const [clientEndpoint, adminEndpoint, clientPage, adminPage] = await Promise.all([
    projectFile("api/client-vercel-analytics.js"),
    projectFile("api/vercel-analytics.js"),
    projectFile("client-portal/analytics.js"),
    projectFile("account/admin/analytics/index.html"),
  ]);

  assert.match(clientEndpoint, /website_analytics_connections/);
  assert.match(clientEndpoint, /website_portal_features/);
  assert.match(clientEndpoint, /feature_key=eq\.analytics/);
  assert.match(clientEndpoint, /website_members/);
  assert.match(clientEndpoint, /platform_admins/);
  assert.doesNotMatch(clientEndpoint, /VERCEL_ANALYTICS_PROJECT_ID/);
  assert.match(adminEndpoint, /VERCEL_ANALYTICS_PROJECT_ID/);
  assert.match(clientPage, /client-vercel-analytics/);
  assert.match(adminPage, /data-admin-view="analytics"/);
});

test("analytics activation stores only a server-side website-to-project mapping", async () => {
  const [migration, connectionEndpoint, portalAdmin] = await Promise.all([
    projectFile("supabase/migrations/20260823001005_client_website_analytics.sql"),
    projectFile("api/client-analytics-connection.js"),
    projectFile("n3xra-admin/website-portal/website-portal-admin.js"),
  ]);

  assert.match(migration, /create table public\.website_analytics_connections/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.website_analytics_connections from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.website_analytics_connections to service_role/);
  assert.match(migration, /'analytics', false/);
  assert.match(connectionEndpoint, /verifyAdminRequest/);
  assert.match(connectionEndpoint, /verifyVercel/);
  assert.match(connectionEndpoint, /resolution=merge-duplicates/);
  assert.match(portalAdmin, /\/api\/client-analytics-connection/);
  assert.match(portalAdmin, /analyticsEnabled/);
});

test("analytics archive stores idempotent daily rollups behind a service-only boundary", async () => {
  const [migration, archive, syncEndpoint, vercelConfig] = await Promise.all([
    projectFile("supabase/migrations/20260823001005_client_website_analytics.sql"),
    projectFile("api/_client-analytics-archive.js"),
    projectFile("api/sync-client-analytics.js"),
    projectFile("vercel.json"),
  ]);

  assert.match(migration, /create table public\.website_analytics_daily/);
  assert.match(migration, /primary key \(website_id, metric_date\)/);
  assert.match(migration, /create table public\.website_analytics_sync_runs/);
  assert.match(migration, /alter table public\.website_analytics_daily enable row level security/);
  assert.match(migration, /revoke all on public\.website_analytics_daily from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.website_analytics_daily to service_role/);
  assert.match(archive, /on_conflict=website_id,metric_date/);
  assert.match(archive, /resolution=merge-duplicates/);
  assert.match(archive, /const requestedDays = latest \? 3 : DEFAULT_BACKFILL_DAYS/);
  assert.match(syncEndpoint, /Bearer \$\{cronSecret\}/);
  assert.match(syncEndpoint, /feature_key=eq\.analytics&enabled=eq\.true/);
  assert.match(vercelConfig, /"path": "\/api\/sync-client-analytics"/);
  assert.match(vercelConfig, /"schedule": "37 4 \* \* \*"/);
});

test("analytics archive queries completed UTC dates for the mapped Vercel project", () => {
  const { analyticsUrl, completedDateRange } = require("../../api/_client-analytics-archive.js");
  const range = completedDateRange(3);
  const since = new Date(`${range.since}T00:00:00.000Z`);
  const until = new Date(`${range.until}T00:00:00.000Z`);
  assert.equal((until.getTime() - since.getTime()) / 86_400_000, 2);
  assert.ok(until.getTime() < Date.now());

  const url = analyticsUrl({ project_id: "prj_example", team_id: "team_example" }, "visits", "day", range, 3);
  assert.equal(url.pathname, "/v1/query/web-analytics/visits/aggregate");
  assert.equal(url.searchParams.get("projectId"), "prj_example");
  assert.equal(url.searchParams.get("teamId"), "team_example");
  assert.equal(url.searchParams.get("by"), "day");
  assert.equal(url.searchParams.get("limit"), "3");
});

test("all-time analytics uses archived totals and labels summed visitors honestly", async () => {
  const [endpoint, archive, source, page] = await Promise.all([
    projectFile("api/client-vercel-analytics.js"),
    projectFile("api/_client-analytics-archive.js"),
    projectFile("src/client-portal/analytics.ts"),
    projectFile("client-portal/analytics/index.html"),
  ]);

  assert.match(archive, /website_analytics_daily\?select=metric_date,pageviews,visitors,events,synced_at/);
  assert.match(endpoint, /requestedRange === "all"/);
  assert.match(endpoint, /All recorded history/);
  assert.match(endpoint, /Vercel Web Analytics \+ N3XRA archive/);
  assert.match(source, /allTime \? "Daily visitors" : "Visitors"/);
  assert.match(source, /Unique visitors summed by day/);
  assert.match(page, /<option value="all">All recorded history<\/option>/);
  assert.match(page, /id="analytics-breakdown-period"/);
});

test("public traffic counters are isolated per website and store only safe public settings", async () => {
  const [migration, endpoint, syncEndpoint] = await Promise.all([
    projectFile("supabase/migrations/20260823001005_client_website_analytics.sql"),
    projectFile("api/public-traffic-counter.js"),
    projectFile("api/sync-client-analytics.js"),
  ]);

  assert.match(migration, /create table public\.website_public_traffic_counters/);
  assert.match(migration, /public_key uuid not null default gen_random_uuid\(\) unique/);
  assert.match(migration, /metric in \('all_time_pageviews', 'daily_visitors'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /Platform admins can read public traffic counter settings/);
  assert.match(migration, /revoke all on public\.website_public_traffic_counters from public, anon, authenticated/);
  assert.match(endpoint, /public_key=eq\.\$\{encodeURIComponent\(key\)\}/);
  assert.doesNotMatch(endpoint, /req\.query\?\.website_id/);
  assert.match(endpoint, /Access-Control-Allow-Origin/);
  assert.match(endpoint, /enabled: false/);
  assert.match(syncEndpoint, /website_public_traffic_counters\?select=website_id&enabled=eq\.true/);
});

test("portal analytics and public counter controls save automatically from one compact panel", async () => {
  const [adminPage, adminScript] = await Promise.all([
    projectFile("n3xra-admin/website-portal/index.html"),
    projectFile("n3xra-admin/website-portal/website-portal-admin.js"),
  ]);
  assert.match(adminPage, /Analytics[\s\S]*id="portal-public-counter-enabled"/);
  assert.match(adminPage, /id="portal-public-counter-details"[^>]*hidden/);
  assert.doesNotMatch(adminPage, /Save counter settings|Save portal sections/);
  assert.match(adminScript, /featureGrid\.addEventListener\("change"[\s\S]*queueAccessSave/);
  assert.match(adminScript, /website_public_traffic_counters"\)[\s\S]*\.select\("public_key,enabled,metric,label"\)/);
});

test("public counter loader uses website-owned markup and removes all space when disabled", async () => {
  const [source, built, adminPage, adminScript, styles] = await Promise.all([
    projectFile("src/client-portal/public-traffic-counter.ts"),
    projectFile("client-portal/public-traffic-counter.js"),
    projectFile("n3xra-admin/website-portal/index.html"),
    projectFile("n3xra-admin/website-portal/website-portal-admin.js"),
    projectFile("n3xra-admin/website-portal/website-portal-admin.css"),
  ]);

  assert.match(source, /root\.hidden = true/);
  assert.match(source, /root\.hidden = false/);
  assert.match(source, /data-n3xra-traffic-counter/);
  assert.match(source, /url\.hostname === "n3xra\.com"/);
  assert.match(source, /url\.hostname = "www\.n3xra\.com"/);
  assert.match(built, /public-traffic-counter\?key=/);
  assert.doesNotMatch(source, /iframe/i);
  assert.match(adminPage, /id="portal-public-counter-enabled"/);
  assert.match(adminPage, /value="all_time_pageviews"/);
  assert.match(adminPage, /value="daily_visitors"/);
  assert.match(adminScript, /data-n3xra-traffic-counter=.*hidden/);
  assert.match(adminScript, /https:\/\/www\.n3xra\.com\/client-portal\/public-traffic-counter\.js\?v=2/);
  assert.match(adminScript, /website_public_traffic_counters/);
  assert.match(styles, /@media \(max-width:700px\)/);
  assert.match(styles, /website-portal-counter-layout/);
});

test("client navigation exposes Analytics only when its website feature is enabled", async () => {
  const [shell, context, migration] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
    projectFile("supabase/migrations/20260823001005_client_website_analytics.sql"),
  ]);

  assert.match(shell, /key: "analytics"/);
  assert.match(shell, /feature: "analytics"/);
  assert.match(context, /website_portal_features/);
  assert.match(context, /data-client-feature/);
  assert.match(context, /selectedFeatures\.analytics !== true/);
  assert.match(migration, /website_portal_features_key_check[\s\S]*'analytics'/);
});

test("analytics report is readable and responsive on desktop and mobile", async () => {
  const [html, styles, script] = await Promise.all([
    projectFile("client-portal/analytics/index.html"),
    projectFile("client-portal/analytics/analytics.css"),
    projectFile("client-portal/analytics.js"),
  ]);

  assert.match(html, /aria-label="Traffic summary"/);
  assert.match(html, /id="analytics-chart" role="img"/);
  assert.match(html, /id="analytics-pages"/);
  assert.match(html, /id="analytics-referrers"/);
  assert.match(html, /id="analytics-countries"/);
  assert.match(html, /id="analytics-devices"/);
  assert.match(html, /id="analytics-visitors-label"/);
  assert.match(styles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width:700px\)/);
  assert.match(styles, /\.client-analytics-grid \{ grid-template-columns:1fr/);
  assert.match(script, /scopeWebsitesToPortalTenant/);
  assert.match(script, /Authorization: `Bearer \$\{session\.access_token\}`/);
});
