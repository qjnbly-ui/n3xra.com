import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const careersMigrationPath = new URL(
  "../../supabase/migrations/20260809222828_careers_applications_and_notes.sql",
  import.meta.url,
);
const recordsPolicyMigrationPath = new URL(
  "../../supabase/migrations/20260812220716_scope_records_storage_policies.sql",
  import.meta.url,
);
const legacyRecordsPolicyMigrationPath = new URL(
  "../../supabase/migrations/20260812221159_scope_legacy_records_storage_policies.sql",
  import.meta.url,
);

test("anonymous career uploads do not evaluate Records-only storage policies", async () => {
  const [careersMigration, recordsPolicyMigration] = await Promise.all([
    readFile(careersMigrationPath, "utf8"),
    readFile(recordsPolicyMigrationPath, "utf8"),
  ]);

  assert.match(
    careersMigration,
    /create policy "careers_files_submit"[\s\S]*for insert to anon, authenticated[\s\S]*bucket_id = 'careers-files'/,
  );

  const recordsPolicies = [
    "storage_select_documents_policy",
    "storage_insert_documents_policy",
    "storage_update_documents_policy",
    "storage_delete_documents_policy",
    "storage_select_meeting_recordings_policy",
    "storage_insert_meeting_recordings_policy",
    "storage_update_meeting_recordings_policy",
    "storage_delete_meeting_recordings_policy",
  ];

  for (const policy of recordsPolicies) {
    assert.match(
      recordsPolicyMigration,
      new RegExp(`alter policy "${policy}"\\s+on storage\\.objects to authenticated`),
      `${policy} must not apply to anon`,
    );
  }

  assert.match(
    recordsPolicyMigration,
    /create policy "storage_select_public_documents_policy"[\s\S]*for select[\s\S]*to anon[\s\S]*document\.is_public = true/,
  );
  assert.match(recordsPolicyMigration, /document\.storage_path = storage\.objects\.name/);
  assert.doesNotMatch(
    recordsPolicyMigration.match(/create policy "storage_select_public_documents_policy"[\s\S]*$/)?.[0] || "",
    /can_(?:view|change)_records_/,
  );
});

test("legacy Records storage policies are also excluded from anonymous requests", async () => {
  const migration = await readFile(legacyRecordsPolicyMigrationPath, "utf8");
  const policies = [
    "storage_select_organization_assets_policy",
    "storage_insert_organization_assets_policy",
    "storage_update_organization_assets_policy",
    "storage_delete_organization_assets_policy",
    "storage_select_own_documents",
    "storage_insert_own_documents",
    "storage_update_own_documents",
    "storage_delete_own_documents",
  ];

  for (const policy of policies) {
    assert.match(
      migration,
      new RegExp(`alter policy "${policy}"\\s+on storage\\.objects to authenticated`),
      `${policy} must not apply to anon`,
    );
  }
});
