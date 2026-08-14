import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const routes = new Map([
  ["n3xra-admin/communications/index.html", "overview"],
  ["n3xra-admin/communications/websites-forms/index.html", "websites-forms"],
  ["n3xra-admin/communications/subscribers/index.html", "subscribers"],
  ["n3xra-admin/communications/topics-signup/index.html", "topics-signup"],
  ["n3xra-admin/communications/activity-usage/index.html", "activity-usage"],
  ["n3xra-admin/communications/email-readiness/index.html", "email-readiness"],
  ["n3xra-admin/communications/texting-readiness/index.html", "texting-readiness"],
  ["n3xra-admin/communications/pricing-activation/index.html", "pricing-activation"],
  ["n3xra-admin/communications/requests/index.html", "requests"],
]);

test("the reconciled active migration history remains the verified 144-file sequence", async () => {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const migrationFiles = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const [productionReport, replayReport] = await Promise.all([
    projectFile("supabase/reports/communications-production-database-release-2026-08-14.md"),
    projectFile("supabase/reports/preview-replay-final-2026-08-14.md"),
  ]);

  assert.equal(migrationFiles.length, 144);
  assert.equal(migrationFiles[0], "20260515052659_foundational_schema_baseline.sql");
  assert.equal(migrationFiles.at(-1), "20260814033028_roots_relics_communications_seed_forward.sql");
  assert.match(productionReport, /Migration count: 144/);
  assert.match(replayReport, /executed all 144 active migrations in order/);
});

test("Communications Admin is registered as the fifth Product Admin App", async () => {
  const navigation = await projectFile("account/admin/admin-navigation.js");
  const websitePosition = navigation.indexOf('key: "websites"');
  const recordsPosition = navigation.indexOf('key: "records"');
  const utilitiesPosition = navigation.indexOf('key: "utilities"');
  const partnersPosition = navigation.indexOf('key: "partners"');
  const communicationsPosition = navigation.indexOf('key: "communications"');

  assert.ok(websitePosition < recordsPosition);
  assert.ok(recordsPosition < utilitiesPosition);
  assert.ok(utilitiesPosition < partnersPosition);
  assert.ok(partnersPosition < communicationsPosition);
  assert.match(navigation, /label: "Communications Admin"/);
  assert.match(navigation, /"Organization Workspace", "\/n3xra-admin\/communications\/"/);
  assert.match(navigation, /"Requests", "\/n3xra-admin\/communications\/requests\/"/);
});

test("all approved read-only Communications Admin routes use the shared product shell", async () => {
  for (const [path, section] of routes) {
    const html = await projectFile(path);
    assert.match(html, new RegExp(`data-section="${section}"`), path);
    assert.match(html, /\/account\/admin\/product-shell\.js/, path);
    assert.match(html, /\/account\/admin\/admin\.css/, path);
    assert.match(html, /\/n3xra-admin\/communications\/communications-admin\.css/, path);
    assert.match(html, /\/n3xra-admin\/communications\/communications-admin\.js/, path);
  }
});

test("the browser uses admin-session only as a gate and reads through the protected API", async () => {
  const [source, compiled] = await Promise.all([
    projectFile("src/communications-admin/communications-admin.ts"),
    projectFile("n3xra-admin/communications/communications-admin.js"),
  ]);

  for (const browserCode of [source, compiled]) {
    assert.match(browserCode, /getAdminSession/);
    assert.match(browserCode, /\/api\/communications-admin/);
    assert.doesNotMatch(browserCode, /\.from\s*\(/);
    assert.doesNotMatch(browserCode, /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|RESEND_API_KEY|TWILIO_AUTH_TOKEN/);
  }
  assert.match(source, /Not configured/);
  assert.match(source, /Pending verification/);
  assert.match(source, /Pending carrier registration/);
  assert.match(source, /No approval or provisioning controls are available/);
});

test("the Communications Admin endpoint independently requires an active platform admin", async () => {
  const endpointSource = await projectFile("api/communications-admin.js");
  const sharedSource = await projectFile("api/_communications.js");

  assert.match(endpointSource, /req\.method !== "GET"/);
  assert.match(endpointSource, /await requirePlatformAdmin\(req\)/);
  assert.match(endpointSource, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(endpointSource, /configuration|provider_phone_sid|messaging_service_sid|public_token|ip_hash|original_values|consent_snapshot/);
  assert.match(sharedSource, /platform_admins\?select=user_id,role,status/);
  assert.match(sharedSource, /status=eq\.active&role=in\.\(owner,admin\)/);

  const handler = require("../../api/communications-admin.js");
  let statusCode = 0;
  let payload = null;
  const response = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return body;
    },
  };
  await handler({ method: "GET", headers: {}, query: {} }, response);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: "Authentication required." });
});
