import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("carrier onboarding collects the current Twilio business, campaign, consent, and attestation fields", async () => {
  const [page, source, organizationResolver] = await Promise.all([
    read("client-portal/communications/onboarding/index.html"),
    read("src/client-portal/communications-onboarding.ts"),
    read("src/client-portal/communications-organization.ts"),
  ]);

  for (const field of [
    "legal_business_name",
    "business_registration_number",
    "authorized_first_name",
    "authorized_position",
    "campaign_description",
    "message_flow",
    "message_sample_1",
    "message_sample_2",
    "privacy_policy_url",
    "terms_url",
    "opt_in_evidence_url",
    "authority_attested",
    "carrier_fees_authorized",
    "signature_name",
  ]) assert.match(page, new RegExp(`name="${field}"`), field);

  assert.match(page, /separate, optional, unchecked by default/);
  assert.match(page, /not shared with third parties or affiliates for marketing/);
  assert.match(page, /N3XRA reviews the completed application before sending anything to Twilio or purchasing a number/);
  assert.match(source, /save_communications_carrier_onboarding/);
  assert.match(source, /input_submit: submit/);
  assert.match(source, /requireAccountAdmin: true/);
  assert.match(organizationResolver, /role", "account_admin"/);
});

test("Communications follows the selected organization and never borrows another tenant's workspace", async () => {
  const [resolver, app, onboarding, context, account] = await Promise.all([
    read("src/client-portal/communications-organization.ts"),
    read("src/client-portal/communications-app.ts"),
    read("src/client-portal/communications-onboarding.ts"),
    read("client-portal/client-workspace-context.js"),
    read("account/account.js"),
  ]);

  assert.match(resolver, /n3xra-client-workspace-context/);
  assert.match(resolver, /document\.body\.dataset\.portalWebsiteId/);
  assert.match(resolver, /get\("organization"\)/);
  assert.match(resolver, /organizationForWebsite/);
  assert.match(resolver, /if \(selectedWebsiteOrganizationId\)[\s\S]*return eligibleOrganization/);
  assert.match(resolver, /\.limit\(2\)/);
  assert.match(resolver, /organizationIds\.length === 1/);
  assert.doesNotMatch(resolver, /records-active-organization-id|getStoredActiveOrganizationId/);
  assert.match(app, /resolveSelectedCommunicationsOrganization/);
  assert.match(app, /Communications is not active for the selected organization/);
  assert.match(onboarding, /resolveSelectedCommunicationsOrganization\(supabase, session\.user\.id, \{ requireAccountAdmin: true \}\)/);
  assert.match(context, /explicitOrganizationId/);
  assert.match(context, /url\.searchParams\.set\("organization", website\.organization_id\)/);
  assert.match(account, /client-portal\/billing\/\?product=communications/);
  assert.match(account, /client-portal\/communications\/\?organization=/);
});

test("carrier onboarding persistence is tenant-scoped, account-admin-only, and server validated", async () => {
  const migration = await read("supabase/migrations/20260826170812_communications_twilio_onboarding.sql");

  assert.match(migration, /communications_carrier_onboarding_workspace_organization_fk/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /membership\.role = 'account_admin'/);
  assert.match(migration, /security definer/);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.save_communications_carrier_onboarding.*from public, anon/);
  assert.match(migration, /Campaign description must be between 40 and 4,096 characters/);
  assert.match(migration, /Provide between two and five sample messages/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.communications_carrier_onboarding to authenticated/);
});

test("Communications surfaces onboarding to the client and the protected admin review", async () => {
  const [clientPage, clientSource, adminApi, adminSource] = await Promise.all([
    read("client-portal/communications/index.html"),
    read("src/client-portal/communications-app.ts"),
    read("api/communications-admin.js"),
    read("src/communications-admin/communications-admin.ts"),
  ]);

  assert.match(clientPage, /communications-onboarding-card/);
  assert.match(clientSource, /communications_carrier_onboarding/);
  assert.match(clientSource, /Carrier application under review/);
  assert.match(adminApi, /communications_carrier_onboarding\?select=/);
  assert.match(adminSource, /Private business identity, consent, and campaign details/);
  assert.match(adminSource, /EIN \/ registration/);
});
