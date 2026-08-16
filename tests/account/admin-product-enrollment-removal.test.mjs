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
  assert.match(admin, /platformAdminRole: context\.admin\?\.role/);
  assert.match(controller, /canRemoveEnrollments = String\(context\.platformAdminRole/);
  assert.match(controller, /Delete app & data/);
  assert.match(controller, /Remove access/);
  assert.match(controller, /const expected = `DELETE \$\{copy\.workspaceName\}`/);
  assert.match(controller, /invoke\("remove-product-enrollment"/);
  assert.match(controller, /userId: account\.id/);
  assert.match(controller, /workspaceId: item\.organizationId/);
  assert.match(controller, /Their N3XRA login and other apps are not affected/);
});

test("product removal is owner-authorized, race-safe, and does not delete the identity", async () => {
  const edgeFunction = await read("supabase/functions/platform-admin/index.ts");
  const action = edgeFunction.match(/if \(action === "remove-product-enrollment"\)[\s\S]*?(?=\n    if \(action === "update-platform-account"\))/)?.[0] || "";

  assert.match(action, /platformAdmin\.role[\s\S]*owner/);
  assert.match(action, /expectedConfirmation = `DELETE \$\{workspaceName\}`/);
  assert.match(action, /input_delete_workspace: deleteWorkspace/);
  assert.match(action, /resultMode === "workspace"[\s\S]*removeStorageObjects/);
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

test("workspace deletion collects private uploads, recordings, and public website files", async () => {
  const edgeFunction = await read("supabase/functions/platform-admin/index.ts");

  for (const bucket of ["documents", "meeting-recordings", "organization-assets", "website-assets-private", "website-assets-public", "website-onboarding-private"]) {
    assert.match(edgeFunction, new RegExp(bucket));
  }
  assert.match(edgeFunction, /publicStorageObjectPath\(row\.public_url, "website-assets-public"\)/);
  assert.match(edgeFunction, /storageCleanupPending: storageFailures\.length > 0/);
});
