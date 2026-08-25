import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const projectFile = (path) => readFile(new URL(path, root), "utf8");

test("the client Support view is a request and work tracker", async () => {
  const [html, source, styles] = await Promise.all([
    projectFile("client-portal/index.html"),
    projectFile("src/client-portal/support-workspace.ts"),
    projectFile("client-portal/support-workspace.css"),
  ]);

  assert.match(html, /What should we work on\?/);
  assert.match(html, /id="client-support-form"/);
  assert.match(html, /Site analytics/);
  assert.match(html, /Communications/);
  assert.match(html, /General account/);
  assert.match(html, /Records/);
  assert.match(html, /data-client-support-filter="active"/);
  assert.match(html, /data-client-support-filter="past"/);
  assert.match(source, /platform_support_requests/);
  assert.match(source, /platform_support_request_updates/);
  assert.match(source, /Started by N3XRA/);
  assert.match(source, /scopeInput\?\.value === "website"/);
  assert.match(source, /day\$\{days === 1 \? "" : "s"\} remaining/);
  assert.match(source, /Requests loaded, but timeline updates are temporarily unavailable\./);
  assert.match(source, /changeRun[.]progress_updated_at \|\| changeRun[.]updated_at \|\| changeRun[.]created_at/);
  assert.match(source, /await loadRequests[(][)][.]catch/);
  assert.doesNotMatch(source, /if \(updateResult\.error\) throw updateResult\.error/);
  assert.doesNotMatch(source, /internal_notes/);
  assert.match(styles, /client-support-update/);
  assert.match(styles, /\.client-support-form\{[^}]*background:#fff/);
  assert.doesNotMatch(styles, /\.client-support-form\{[^}]*background:var\(--portal-deep\)/);
});

test("client-visible support records are tenant-scoped and keep internal notes private", async () => {
  const migration = await projectFile("supabase/migrations/20260816044014_client_visible_support_work.sql");

  assert.match(migration, /platform_support_requests_client_select/);
  assert.match(migration, /public\.can_view_client_website\(website_id\)/);
  assert.match(migration, /requester_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /client_visible = true/);
  assert.match(migration, /source = 'client_portal'/);
  assert.doesNotMatch(migration, /grant select on public\.platform_support_requests to authenticated/);
  assert.match(migration, /grant select \([\s\S]*estimated_completion_at[\s\S]*\) on public\.platform_support_requests to authenticated/);
  assert.match(migration, /grant insert \([\s\S]*requester_user_id[\s\S]*origin[\s\S]*\) on public\.platform_support_requests to authenticated/);
  assert.doesNotMatch(migration.match(/grant insert \([\s\S]*?\) on public\.platform_support_requests to authenticated/)?.[0] || "", /internal_notes/);
  assert.match(migration, /visible_to_client = true/);
});

test("general support work can be scoped to an account, organization, or website", async () => {
  const [migration, adminHtml, controller, edgeFunction, websiteHtml, websiteAdmin] = await Promise.all([
    projectFile("supabase/migrations/20260816051240_general_support_work_targets.sql"),
    projectFile("account/admin/support/index.html"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
    projectFile("n3xra-admin/websites/index.html"),
    projectFile("n3xra-admin/websites/websites-admin.js"),
  ]);

  assert.match(migration, /public\.can_view_organization\(organization_id\)/);
  assert.match(migration, /website_id is null/);
  assert.match(adminHtml, /id="support-work-account"/);
  assert.match(adminHtml, /id="support-work-context"/);
  assert.match(controller, /General N3XRA account/);
  assert.match(controller, /requesterUserId/);
  assert.match(edgeFunction, /organizations: organizationResult\.data/);
  assert.match(edgeFunction, /accounts: accountResult\.data/);
  assert.match(websiteHtml, /id="website-support-work-form"/);
  assert.match(websiteAdmin, /createWebsiteSupportWork/);
});

test("client support updates authorize through a narrow request-access helper", async () => {
  const migration = await projectFile("supabase/migrations/20260817200734_harden_client_support_update_policy.sql");

  assert.match(migration, /function private\.can_view_client_support_request\(target_request_id uuid\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /request\.requester_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /public\.can_view_client_website\(request\.website_id\)/);
  assert.match(migration, /public\.can_view_organization\(request\.organization_id\)/);
  assert.match(migration, /visible_to_client = true[\s\S]*private\.can_view_client_support_request\(request_id\)/);
  assert.match(migration, /revoke all on function private\.can_view_client_support_request\(uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /drop function if exists public\.can_view_client_support_request\(uuid\)/);
});

test("administrators can start work and publish estimates and timeline notes", async () => {
  const [html, controller, edgeFunction] = await Promise.all([
    projectFile("account/admin/support/index.html"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);

  assert.match(html, /Start client work/);
  assert.match(html, /First client-visible update/);
  assert.match(controller, /create-support-work/);
  assert.match(controller, /estimatedCompletionAt/);
  assert.match(controller, /New client-visible update/);
  assert.match(edgeFunction, /action === "create-support-work"/);
  assert.match(edgeFunction, /origin: "n3xra"/);
  assert.match(edgeFunction, /platform_support_request_updates/);
});

test("admin-created support work is limited to the selected client's real access", async () => {
  const [html, controller, edgeFunction] = await Promise.all([
    projectFile("account/admin/support/index.html"),
    projectFile("account/admin/controllers/support.js"),
    projectFile("supabase/functions/platform-admin/index.ts"),
  ]);

  assert.match(html, /id="support-work-context" disabled/);
  assert.match(controller, /supportOrganizationMemberships/);
  assert.match(controller, /supportWebsiteMemberships/);
  assert.match(controller, /supportProductEntitlements/);
  assert.match(controller, /organization\.owner_user_id === userId/);
  assert.match(controller, /membership\.user_id === userId && membership\.status === "active"/);
  assert.match(controller, /\["active", "trialing"\]\.includes\(entitlement\.status\)/);
  assert.match(controller, /contextSelect\.required = websiteRequired \|\| Boolean\(productKey\)/);
  assert.match(controller, /support-work-account"\)\?\.addEventListener\("change", renderSupportWorkTargets\)/);
  assert.match(controller, /support-work-topic"\)\?\.addEventListener\("change", renderSupportWorkTargets\)/);

  assert.match(edgeFunction, /organizationMemberships: organizationMembershipResult\.data/);
  assert.match(edgeFunction, /websiteMemberships: websiteMembershipResult\.data/);
  assert.match(edgeFunction, /productEntitlements: entitlementResult\.data/);
  assert.match(edgeFunction, /selected organization is not connected to this client account/);
  assert.match(edgeFunction, /selected website is not available to this client account/);
  assert.match(edgeFunction, /websiteTopics\.has\(topic\) && !websiteId/);
  assert.match(edgeFunction, /productTopics\.has\(topic\)/);
  assert.match(edgeFunction, /\.in\("status", \["active", "trialing"\]\)/);
});
