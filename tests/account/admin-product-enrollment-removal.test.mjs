import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("account administration exposes a typed destructive enrollment action", async () => {
  const [controller, admin] = await Promise.all([
    read("account/admin/controllers/accounts.js"),
    read("account/admin/admin.js"),
  ]);

  assert.match(admin, /promptAdminText/);
  assert.match(admin, /async function loadAdminView\(adminContext\)/);
  assert.match(admin, /platformAdminRole: adminContext\.admin\?\.role/);
  assert.match(admin, /await loadAdminView\(context\)/);
  assert.doesNotMatch(admin, /platformAdminRole: context\.admin\?\.role/);
  assert.match(controller, /canRemoveEnrollments = String\(context\.platformAdminRole/);
  assert.match(controller, /Delete product & data/);
  assert.match(controller, /Remove access/);
  assert.match(controller, /const expected = `DELETE \$\{copy\.workspaceName\}`/);
  assert.match(controller, /invoke\("remove-product-enrollment"/);
  assert.match(controller, /userId: account\.id/);
  assert.match(controller, /workspaceId: item\.organizationId/);
  assert.match(controller, /Their N3XRA login and other products are not affected/);
});

test("product removal is owner-authorized, race-safe, and does not delete the identity", async () => {
  const edgeFunction = await read("supabase/functions/platform-admin/index.ts");
  const action = edgeFunction.match(/if \(action === "remove-product-enrollment"\)[\s\S]*?(?=\n    if \(action === "update-platform-account"\))/)?.[0] || "";

  assert.match(action, /platformAdmin\.role[\s\S]*owner/);
  assert.match(action, /expectedConfirmation = `DELETE \$\{workspaceName\}`/);
  assert.match(action, /input_delete_workspace: deleteWorkspace/);
  assert.match(action, /\["workspace", "product_data"\]\.includes\(resultMode\)[\s\S]*removeStorageObjects/);
  assert.doesNotMatch(action, /auth\.admin\.deleteUser|from\("profiles"\)\.delete/);
});

test("the removal transaction preserves shared data and protects paid workspaces", async () => {
  const migration = await read("supabase/migrations/20260816005509_admin_remove_product_enrollment.sql");

  assert.match(migration, /request_claims[\s\S]*service_role/);
  assert.match(migration, /delete from public\.organization_memberships[\s\S]*'mode', 'access_only'/);
  assert.match(migration, /This Records workspace has % other member/);
  assert.match(migration, /Cancel the active Records subscription/);
  assert.match(migration, /delete from public\.website_members[\s\S]*'mode', 'access_only'/);
  assert.match(migration, /This website has % other active member/);
  assert.match(migration, /Cancel the active website subscription/);
  assert.match(migration, /delete from public\.loan_payments[\s\S]*delete from public\.loan_accounts/);
  assert.match(migration, /revoke all on function public\.admin_remove_product_enrollment\(text, uuid, uuid, boolean\) from authenticated/);
  assert.match(migration, /grant execute on function public\.admin_remove_product_enrollment\(text, uuid, uuid, boolean\) to service_role/);
});

test("Records removal is product-scoped and preserves website and Communications data", async () => {
  const [migration, edgeFunction, controller] = await Promise.all([
    read("supabase/migrations/20260816014500_scope_records_enrollment_removal.sql"),
    read("supabase/functions/platform-admin/index.ts"),
    read("account/admin/controllers/accounts.js"),
  ]);

  assert.match(migration, /create or replace function public\.admin_remove_records_enrollment/);
  assert.match(migration, /update public\.organization_product_entitlements[\s\S]*'records'/);
  assert.doesNotMatch(migration, /delete from public\.organizations/);
  assert.doesNotMatch(migration, /delete from public\.client_websites|delete from public\.communications_/);
  assert.match(edgeFunction, /product === "records"[\s\S]*admin_remove_records_enrollment/);
  assert.doesNotMatch(edgeFunction.match(/async function recordsEnrollmentStorage[\s\S]*?\n}/)?.[0] || "", /organization-assets|logo_storage_path/);
  assert.match(controller, /The client website, website files, Communications data, shared contacts/);
});

test("admin function errors expose the protected server response", async () => {
  const admin = await read("account/admin/admin.js");

  assert.match(admin, /error\.context[\s\S]*error\.context\.json/);
  assert.match(admin, /response\?\.error \|\| response\?\.message/);
});

test("workspace deletion collects product-owned uploads without deleting shared branding", async () => {
  const edgeFunction = await read("supabase/functions/platform-admin/index.ts");

  for (const bucket of ["documents", "meeting-recordings", "website-assets-private", "website-assets-public", "website-onboarding-private"]) {
    assert.match(edgeFunction, new RegExp(bucket));
  }
  assert.doesNotMatch(edgeFunction.match(/async function recordsEnrollmentStorage[\s\S]*?\n}/)?.[0] || "", /organization-assets|logo_storage_path/);
  assert.match(edgeFunction, /publicStorageObjectPath\(row\.public_url, "website-assets-public"\)/);
  assert.match(edgeFunction, /storageCleanupPending: storageFailures\.length > 0/);
});

test("retired-product enrollments have isolated destructive controls", async () => {
  const [controller, edgeFunction, migration] = await Promise.all([
    read("account/admin/controllers/accounts.js"),
    read("supabase/functions/platform-admin/index.ts"),
    read("supabase/migrations/20260816014726_admin_remove_retired_products.sql"),
  ]);

  assert.match(controller, /\["records", "websites", "ai_music", "virals"\]\.includes\(item\.product\)/);
  assert.match(controller, /retiredProduct \? item\.productLabel/);
  assert.match(edgeFunction, /organizationId: profile\.user_id/);
  assert.match(edgeFunction, /admin_remove_retired_product_enrollment/);
  assert.match(edgeFunction, /workspaceId !== userId/);
  assert.match(migration, /request_claims[\s\S]*service_role/);
  assert.match(migration, /delete from public\.music_generations[\s\S]*delete from public\.music_profiles/);
  assert.match(migration, /delete from public\.virals_commission_ledger[\s\S]*delete from public\.virals_profiles/);
  assert.match(migration, /revoke all on function public\.admin_remove_retired_product_enrollment\(text, uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_remove_retired_product_enrollment\(text, uuid\) to service_role/);
});

test("platform owner can delete a non-admin account only after typed confirmation", async () => {
  const [controller, admin, edgeFunction] = await Promise.all([
    read("account/admin/controllers/accounts.js"),
    read("account/admin/admin.js"),
    read("supabase/functions/platform-admin/index.ts"),
  ]);
  const action = edgeFunction.match(/if \(action === "delete-platform-account"\)[\s\S]*?(?=\n    if \(action === "remove-product-enrollment"\))/)?.[0] || "";

  assert.match(controller, /id="account-delete"[\s\S]*Delete account/);
  assert.match(controller, /const expected = `DELETE \$\{account\.email\}`/);
  assert.match(controller, /invoke\("delete-platform-account"/);
  assert.match(admin, /currentUserId: adminContext\.user\?\.id/);
  assert.match(action, /platformAdmin\.role[\s\S]*owner/);
  assert.match(action, /userId === user\.id/);
  assert.match(action, /expectedConfirmation = `DELETE \$\{targetEmail\}`/);
  assert.match(action, /platform_admins/);
  assert.match(action, /Cancel every active paid product subscription/);
  assert.match(action, /Transfer or remove the other Records members/);
  assert.match(action, /auth\.admin\.deleteUser\(userId\)/);
  assert.match(action, /removeStorageObjects\(adminClient, storageObjects\)/);
});
