import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("carrier onboarding collects the current Twilio business, campaign, consent, and attestation fields", async () => {
  const [page, source] = await Promise.all([
    read("client-portal/communications/onboarding/index.html"),
    read("src/client-portal/communications-onboarding.ts"),
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
  assert.match(source, /role", "account_admin"/);
});

test("carrier onboarding persistence is tenant-scoped, account-admin-only, and server validated", async () => {
  const migration = await read("supabase/migrations/20260826153548_communications_twilio_onboarding.sql");

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
