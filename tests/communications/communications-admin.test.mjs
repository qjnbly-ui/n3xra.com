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

test("the verified 144-file base and provisioning migration remain ordered before provider work", async () => {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const migrationFiles = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const [productionReport, replayReport, provisioningReport] = await Promise.all([
    projectFile("supabase/reports/communications-production-database-release-2026-08-14.md"),
    projectFile("supabase/reports/preview-replay-final-2026-08-14.md"),
    projectFile("supabase/reports/communications-admin-provisioning-2026-08-14.md"),
  ]);

  assert.equal(migrationFiles.length, 149);
  assert.equal(migrationFiles[0], "20260515052659_foundational_schema_baseline.sql");
  const communicationsSeedIndex = migrationFiles.indexOf("20260814033028_roots_relics_communications_seed_forward.sql");
  const communicationsProvisioningIndex = migrationFiles.indexOf("20260814173124_communications_admin_provisioning.sql");
  const communicationsProviderIndex = migrationFiles.indexOf("20260814184353_communications_resend_provider_foundation.sql");
  const careersExpansionIndex = migrationFiles.indexOf("20260815212436_expand_universal_careers_application.sql");
  assert.ok(communicationsSeedIndex < communicationsProvisioningIndex);
  assert.ok(communicationsProvisioningIndex < communicationsProviderIndex);
  assert.ok(communicationsProviderIndex < careersExpansionIndex);
  assert.match(productionReport, /Migration count: 144/);
  assert.match(replayReport, /executed all 144 active migrations in order/);
  assert.match(provisioningReport, /repository now contains 145 migrations/);
  assert.match(provisioningReport, /has not been applied to production/);
});

test("Communications is registered after the other product workspaces", async () => {
  const navigation = await projectFile("account/admin/admin-navigation.js");
  const websitePosition = navigation.indexOf('key: "websites"');
  const recordsPosition = navigation.indexOf('key: "records"');
  const partnersPosition = navigation.indexOf('key: "partners"');
  const communicationsPosition = navigation.indexOf('key: "communications"');

  assert.ok(websitePosition < recordsPosition);
  assert.ok(recordsPosition < partnersPosition);
  assert.ok(partnersPosition < communicationsPosition);
  assert.doesNotMatch(navigation, /key: "utilities"/);
  assert.match(navigation, /label: "Communications"/);
  assert.match(navigation, /"Organization Workspace", "\/n3xra-admin\/communications\/"/);
  assert.match(navigation, /"Requests", "\/n3xra-admin\/communications\/requests\/"/);
});

test("all approved Communications Admin routes use the shared product shell", async () => {
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
  assert.match(source, /Email: \$\{email\.label\}/);
  assert.match(source, /Texting: \$\{sms\.label\}/);
  assert.match(source, /upsert_communications_subscriber: "Add or update subscriber"/);
  assert.match(source, /qr_campaign: "QR campaign"/);
  assert.match(source, /No approval or provisioning controls are available/);
  assert.match(source, /Secure admin controls/);
  assert.match(source, /\/api\/communications-admin-mutations/);
  assert.match(source, /communications-workspace-form/);
  assert.match(source, /communications-subscription-form/);
  assert.match(source, /communications-topic-form/);
  assert.match(source, /communications-pricing-form/);
  assert.doesNotMatch(compiled, /Read-only release/);
});

test("the desktop navigation and empty states stay compact", async () => {
  const styles = await projectFile("n3xra-admin/communications/communications-admin.css");

  assert.match(styles, /communications-admin-context-layout[^}]*grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(styles, /communications-admin-page > \.portal-layout \{ grid-template-columns: 210px minmax\(0, 1fr\)/);
  assert.match(styles, /communications-admin-empty[^}]*min-height: 72px/);
  assert.match(styles, /communications-admin-card\.is-empty > header/);
  assert.match(styles, /communications-admin-form[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /communications-admin-form-status\.is-error/);
});

test("the provisioning migration exposes only audited service-role operations", async () => {
  const migration = await projectFile("supabase/migrations/20260814173124_communications_admin_provisioning.sql");

  assert.match(migration, /create table public\.communications_admin_audit_log/);
  assert.match(migration, /alter table public\.communications_admin_audit_log enable row level security/);
  assert.match(migration, /before update or delete on public\.communications_admin_audit_log/);
  assert.match(migration, /before truncate on public\.communications_admin_audit_log/);
  assert.match(migration, /actor_user_id uuid not null/);
  assert.match(migration, /organization_id uuid not null/);
  assert.match(migration, /workspace_id uuid not null/);
  assert.match(migration, /identity_snapshot jsonb not null/);
  assert.match(migration, /'actor'.*'email'.*'role'/s);
  assert.match(migration, /'organization'.*'name'.*'slug'/s);
  assert.match(migration, /'workspace'.*'program_name'.*'sender_name'/s);
  assert.doesNotMatch(migration, /actor_user_id uuid references/);
  assert.doesNotMatch(migration, /organization_id uuid references/);
  assert.doesNotMatch(migration, /workspace_id uuid references/);
  assert.equal((migration.match(/security invoker/g) || []).length, 5);
  assert.equal((migration.match(/Idempotency key is required\./g) || []).length, 4);
  assert.equal((migration.match(/Active platform administrator access is required\./g) || []).length, 4);
  assert.equal((migration.match(/grant execute on function public\.communications_admin_/g) || []).length, 4);
  assert.match(migration, /revoke all on public\.communications_admin_audit_log from public, anon, authenticated/);
  assert.match(migration, /revoke all on public\.communications_admin_audit_log from service_role/);
  assert.match(migration, /grant select, insert on public\.communications_admin_audit_log to service_role/);
  assert.doesNotMatch(migration, /grant all on public\.communications_admin_audit_log/);
  assert.match(migration, /Provider-backed activation is not available in this release/);
  assert.doesNotMatch(migration, /RESEND_API_KEY|TWILIO_AUTH_TOKEN|service_role_key/i);
});

test("the Communications Admin endpoint independently requires an active platform admin", async () => {
  const endpointSource = await projectFile("api/communications-admin.js");
  const sharedSource = await projectFile("api/_communications.js");

  assert.match(endpointSource, /req\.method !== "GET"/);
  assert.match(endpointSource, /await requirePlatformAdmin\(req\)/);
  assert.match(endpointSource, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(endpointSource, /provider_phone_sid|messaging_service_sid|public_token|ip_hash|original_values|consent_snapshot/);
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

test("the mutation endpoint authenticates first and allowlists atomic RPC operations", async () => {
  const endpointSource = await projectFile("api/communications-admin-mutations.js");
  assert.match(endpointSource, /const \{ user \} = await requirePlatformAdmin\(req\)/);
  assert.match(endpointSource, /provision_workspace:[\s\S]*communications_admin_provision_workspace/);
  assert.match(endpointSource, /save_form:[\s\S]*communications_admin_save_form/);
  assert.match(endpointSource, /save_topic:[\s\S]*communications_admin_save_topic/);
  assert.match(endpointSource, /update_pricing:[\s\S]*communications_admin_update_pricing/);
  assert.doesNotMatch(endpointSource, /RESEND_API_KEY|TWILIO_AUTH_TOKEN|provider_phone_sid|messaging_service_sid/);

  const handler = require("../../api/communications-admin-mutations.js");
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
  await handler({ method: "POST", headers: {}, body: { operation: "provision_workspace" } }, response);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: "Authentication required." });
});
