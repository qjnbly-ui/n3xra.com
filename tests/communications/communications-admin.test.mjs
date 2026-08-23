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

  assert.ok(migrationFiles.length >= 150);
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

test("workspace creation is an explicit blank mode and never reuses the selected workspace id", async () => {
  const source = await projectFile("src/communications-admin/communications-admin.ts");

  assert.match(source, /get\("new"\) === "1"\) return ""/);
  assert.match(source, /option\("__new__", "Create new workspace…", !selectedWorkspaceId\)/);
  assert.match(source, /window\.location\.href = "\/n3xra-admin\/communications\/\?new=1"/);
  assert.match(source, /workspaceId" type="hidden" value="\$\{escapeHtml\(workspace\.id \|\| ""\)\}"/);
  assert.match(source, /Choose an organization/);
  assert.match(source, /organizationSelect\.required = true/);
});

test("the guided email UI keeps provider secrets server-side and requires explicit confirmations", async () => {
  const [browserSource, endpointSource] = await Promise.all([
    projectFile("src/communications-admin/communications-admin.ts"),
    projectFile("src/communications-provider/communications-admin-email.ts"),
  ]);

  assert.match(browserSource, /Add sending domain/);
  assert.match(browserSource, /Restart verification/);
  assert.match(browserSource, /Activate email/);
  assert.match(browserSource, /I understand this creates the domain in Resend/);
  assert.match(browserSource, /I understand this sends one real email/);
  assert.match(browserSource, /signed Resend webhook must be configured/);
  assert.match(browserSource, /Choose a subscriber with recorded email consent|consenting subscriber/);
  assert.doesNotMatch(browserSource, /COMMUNICATIONS_RESEND_API_KEY|provider_domain_id/);

  assert.match(endpointSource, /await requirePlatformAdmin\(req\)/);
  assert.match(endpointSource, /process\.env\.COMMUNICATIONS_RESEND_API_KEY/);
  assert.match(endpointSource, /process\.env\.COMMUNICATIONS_RESEND_WEBHOOK_SECRET/);
  assert.match(endpointSource, /communications_admin_record_resend_domain/);
  assert.match(endpointSource, /communications_admin_activate_resend_email/);
  assert.match(endpointSource, /sendResendEmail/);
  assert.match(endpointSource, /subscriber\.email_status !== "subscribed"/);
});

test("the email administration endpoint authenticates before any provider operation", async () => {
  const handler = require("../../api/communications-admin-email.js");
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
  await handler({ method: "POST", headers: {}, body: { operation: "create_domain" } }, response);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: "Authentication required." });
});

test("Resend domain responses are normalized and expose DNS instructions without provider identifiers", () => {
  const emailAdmin = require("../../api/communications-admin-email.js");
  assert.equal(emailAdmin.requiredDomain("HTTPS://Updates.Example.com/"), "updates.example.com");
  assert.equal(emailAdmin.providerStatus("partially_verified"), "partially_verified");
  assert.throws(() => emailAdmin.providerStatus("invented"), /unsupported domain status/);

  const safe = emailAdmin.publicDomain({
    id: "provider-secret-reference",
    name: "updates.example.com",
    status: "pending",
    region: "us-east-1",
    records: [{ record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=public-key", status: "pending" }],
  }, { status: "pending_verification", provider_domain_id: "provider-secret-reference" });
  assert.equal(safe.domain, "updates.example.com");
  assert.equal(safe.records[0].value, "p=public-key");
  assert.equal("id" in safe, false);
  assert.equal("provider_domain_id" in safe, false);
});

test("Resend onboarding database operations are tenant-scoped, verified, audited, and service-only", async () => {
  const migration = await projectFile("supabase/migrations/20260823180021_communications_resend_self_service_onboarding.sql");

  assert.equal((migration.match(/security invoker/g) || []).length, 2);
  assert.match(migration, /where id = input_workspace_id/);
  assert.match(migration, /status = 'active' and role in \('owner', 'admin'\)/);
  assert.match(migration, /target_domain\.status <> 'verified'/);
  assert.match(migration, /communications_sending_domains_provider_id_uidx/);
  assert.match(migration, /communications_provider_audit_log/);
  assert.match(migration, /revoke all on function public\.communications_admin_record_resend_domain[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.communications_admin_activate_resend_email[\s\S]*from public, anon, authenticated/);
  assert.equal((migration.match(/grant execute on function public\.communications_admin_/g) || []).length, 2);
  assert.doesNotMatch(migration, /RESEND_API_KEY|WEBHOOK_SECRET|service_role_key/i);
});

test("the customer portal ignores a stored organization without Communications access", async () => {
  const source = await projectFile("src/client-portal/communications-app.ts");
  const storedBlock = source.slice(
    source.indexOf("if (stored)"),
    source.indexOf("const { data, error }", source.indexOf("if (stored)")),
  );

  assert.match(storedBlock, /organization_memberships/);
  assert.match(storedBlock, /organization_product_entitlements/);
  assert.match(storedBlock, /\.eq\("product_key", "communications"\)/);
  assert.match(storedBlock, /\.eq\("portal_enabled", true\)/);
  assert.match(storedBlock, /entitlementResult\.data\?\.organization_id/);
  assert.ok(storedBlock.indexOf("entitlementResult.data") < storedBlock.indexOf("return stored"));
});

test("public email signup can collect consent before outbound delivery is active", async () => {
  const publicEndpoint = require("../../api/communications-public.js");
  const payload = publicEndpoint.publicWorkspacePayload({
    workspace: {
      slug: "roots-and-relics",
      program_name: "Roots & Relics Updates",
      sender_name: "Roots & Relics",
      website_url: "https://www.rootsandrelicsgreenhouse.com/",
      privacy_policy_url: "https://www.rootsandrelicsgreenhouse.com/privacy/",
      program_terms_url: "https://www.n3xra.com/nexra-communications/terms/?workspace=roots-and-relics",
      support_email: "rootsandrelics.greenhouse@gmail.com",
      expected_message_frequency: "General updates only.",
    },
    form: {
      name: "Roots & Relics email signup",
      fields: [],
      success_message: "Your preferences are saved.",
      allowed_origins: ["https://www.rootsandrelicsgreenhouse.com"],
      active_consent_configuration: {
        email: { version: "email-v1", disclosure: "Email disclosure", checkbox_label: "Email me updates" },
      },
    },
    fields: [],
    topics: [],
    channels: [
      { channel: "email", status: "pending_verification" },
      { channel: "sms", status: "pending_setup" },
    ],
  }, "public-website-source-token");

  assert.equal(payload.channels.email.available, true);
  assert.equal(payload.channels.email.deliveryReady, false);
  assert.equal(payload.channels.sms.available, false);
  assert.equal(payload.sourceToken, "public-website-source-token");
  assert.equal(publicEndpoint.originIsAllowed({ form: { allowed_origins: ["https://www.rootsandrelicsgreenhouse.com"] } }, "https://www.rootsandrelicsgreenhouse.com"), true);
});

test("pre-delivery consent keeps source, origin, channel, and delivery boundaries explicit", async () => {
  const [publicEndpoint, helper, migration, qrOriginMigration, nativeQrMigration, emailEndpoint] = await Promise.all([
    projectFile("api/communications-public.js"),
    projectFile("api/_communications.js"),
    projectFile("supabase/migrations/20260823200142_allow_pre_delivery_email_consent.sql"),
    projectFile("supabase/migrations/20260823202726_allow_n3xra_qr_signup_origin.sql"),
    projectFile("supabase/migrations/20260823203918_route_qr_to_client_native_signup.sql"),
    projectFile("src/communications-provider/communications-admin-email.ts"),
  ]);

  assert.match(helper, /status=in\.\(setup,active\)/);
  assert.match(publicEndpoint, /sourceType !== "website_embed"/);
  assert.match(publicEndpoint, /originIsAllowed/);
  assert.match(publicEndpoint, /Access-Control-Allow-Origin/);
  assert.match(migration, /target_source\.source_type = 'hosted_signup'/);
  assert.match(migration, /normalized_origin not in \('https:\/\/n3xra\.com', 'https:\/\/www\.n3xra\.com'\)/);
  assert.match(migration, /status in \('setup', 'active'\)/);
  assert.match(migration, /selected_channel = 'email'.*pending_setup.*pending_verification.*active/s);
  assert.match(migration, /selected_channel = 'sms' and channel_setting\.status = 'active'/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.ingest_website_form_submission[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.ingest_website_form_submission[\s\S]*to service_role/);
  assert.match(qrOriginMigration, /target_source\.source_type in \(''hosted_signup'', ''qr_campaign''\)/);
  assert.match(qrOriginMigration, /pg_get_functiondef/);
  assert.match(nativeQrMigration, /target_source\.source_type = 'qr_campaign'/);
  assert.match(nativeQrMigration, /target_form\.allowed_origins/);
  assert.match(nativeQrMigration, /https:\/\/www\.rootsandrelicsgreenhouse\.com\/join\//);
  assert.match(emailEndpoint, /stored\.status !== "verified"/);
});

test("Communications selects N3XRA or tenant presentation without duplicating the application", async () => {
  const [source, styles, html] = await Promise.all([
    projectFile("src/client-portal/communications-app.ts"),
    projectFile("client-portal/communications.css"),
    projectFile("client-portal/communications/index.html"),
  ]);

  assert.match(source, /isBrandedPortalHostname/);
  assert.match(source, /communications-tenant-surface/);
  assert.match(source, /communications-n3xra-surface/);
  assert.match(source, /await initializePortalBrandShell\(\)/);
  assert.match(source, /metadata\?\.landing_url/);
  assert.match(styles, /body\.communications-tenant-surface/);
  assert.match(styles, /var\(--portal-deep\)/);
  assert.match(styles, /var\(--portal-accent\)/);
  assert.match(html, /data-portal-business-logo/);
});

test("QR codes prefer a trusted client-native landing page and retain their source token", () => {
  const qr = require("../../api/communications-qr.js");
  const data = {
    workspace: { slug: "alpha", website_url: "https://alpha.example.test" },
    form: { allowed_origins: ["https://www.alpha.example.test"] },
  };
  const source = { public_token: "abc123", metadata: { landing_url: "https://www.alpha.example.test/join/" } };
  assert.equal(qr._test.signupUrlForSource(data, source), "https://www.alpha.example.test/join/?workspace=alpha&source=abc123");
  assert.equal(qr._test.nativeLandingUrl(data, { ...source, metadata: { landing_url: "https://attacker.example.test/join/" } }), "");
  assert.equal(qr._test.nativeLandingUrl(data, { ...source, metadata: { landing_url: "http://alpha.example.test/join/" } }), "");
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
