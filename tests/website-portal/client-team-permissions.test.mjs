import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the client portal provides one shared Organization Admin workspace", async () => {
  const [html, script, shell, context] = await Promise.all([
    projectFile("client-portal/team/index.html"),
    projectFile("client-portal/team.js"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(html, /Organization Admin/);
  assert.match(html, /People &amp; Permissions/);
  assert.match(html, /Products &amp; workspaces/);
  assert.match(html, /id="organization-access-body"/);
  assert.match(html, /id="team-invite-form"/);
  assert.match(html, /id="team-invite-product-access"/);
  assert.match(html, /id="team-limit-form"/);
  assert.match(html, /Unlimited by default/);
  assert.match(html, /Administrator/);
  assert.match(html, /Editor/);
  assert.match(html, /View only/);
  assert.match(script, /client_portal_team_snapshot/);
  assert.match(script, /client_portal_add_or_invite_team_member/);
  assert.match(script, /client_portal_update_team_limit/);
  assert.match(script, /send-client-team-invite/);
  assert.match(script, /client_portal_update_team_member/);
  assert.match(script, /client_portal_update_product_member_access/);
  assert.match(script, /input_product_access/);
  assert.match(script, /client_portal_remove_team_member/);
  assert.match(script, /client_portal_organization_access_snapshot/);
  assert.match(script, /renderProductAccess/);
  assert.match(shell, /label: "Organization Admin"/);
  assert.match(context, /label: "Organization Admin"/);
  assert.match(shell, /data-client-organization-admin hidden/);
  assert.match(context, /client_portal_team_snapshot/);
  assert.match(context, /setOrganizationAdminAvailability/);
});

test("organization admins can assign independent product permissions", async () => {
  const [migration, script, apps, records] = await Promise.all([
    projectFile("supabase/migrations/20260827212747_organization_product_member_permissions.sql"),
    projectFile("src/client-portal/team.ts"),
    projectFile("src/client-portal/portal-apps.ts"),
    projectFile("n3xra-records/dashboard.js"),
  ]);

  assert.match(migration, /create table public\.organization_product_member_access/);
  assert.match(migration, /alter table public\.organization_product_member_access enable row level security/);
  assert.match(migration, /organization_product_member_access_user_active_idx/);
  assert.match(migration, /client_portal_update_product_member_access/);
  assert.match(migration, /input_product_access jsonb default null/);
  assert.match(migration, /jsonb_each_text\(invite_record\.product_access\)/);
  assert.match(migration, /organization_product_role\(target_organization_id, 'records'\)/);
  assert.match(migration, /revoke all on function public\.client_portal_update_product_member_access\(uuid, text, text\) from public, anon/);
  assert.doesNotMatch(migration, /grant (select|all).*organization_product_member_access to anon/i);
  assert.match(script, /data-invite-product-access/);
  assert.match(script, /data-product-member/);
  assert.match(apps, /organization_product_member_access/);
  assert.match(records, /permittedRecordsOrganizationIds/);
});

test("the organization overview composes existing product permission systems without replacing them", async () => {
  const migration = await projectFile("supabase/migrations/20260827152715_organization_admin_product_overview.sql");
  assert.match(migration, /organization_product_entitlements/);
  assert.match(migration, /website_members/);
  assert.match(migration, /public\.can_view_organization\(input_organization_id\)/);
  assert.match(migration, /revoke all on function public\.client_portal_organization_access_snapshot\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.client_portal_organization_access_snapshot\(uuid\) to authenticated/);
});

test("organization owners receive the same admin entry point in branded and master dashboards", async () => {
  const [apps, accountPage, accountScript] = await Promise.all([
    projectFile("src/client-portal/portal-apps.ts"),
    projectFile("account/index.html"),
    projectFile("account/account.js"),
  ]);

  assert.match(apps, /name: "Organization Admin"/);
  assert.match(apps, /client_portal_team_snapshot/);
  assert.match(apps, /data as \{ can_manage\?: boolean \}/);
  assert.match(accountPage, /id="organization-admin-card"/);
  assert.match(accountScript, /loadOrganizationAdminAccess/);
  assert.match(accountScript, /organizationAdminLink\.href = `\/client-portal\/team\/\?organization=/);
});

test("N3XRA website administration uses the same direct-add and invitation workflow", async () => {
  const [html, admin, edge] = await Promise.all([
    projectFile("n3xra-admin/websites/index.html"),
    projectFile("n3xra-admin/websites/websites-admin.js"),
    projectFile("supabase/functions/send-client-team-invite/index.ts"),
  ]);

  assert.match(html, /Add a confirmed N3XRA account immediately/);
  assert.match(html, /Add person/);
  assert.match(html, /id="member-limit-form"/);
  assert.match(html, /value="account_admin">Administrator/);
  assert.match(admin, /client_portal_team_snapshot/);
  assert.match(admin, /client_portal_add_or_invite_team_member/);
  assert.match(admin, /client_portal_update_team_limit/);
  assert.match(admin, /send-client-team-invite/);
  assert.match(admin, /client_portal_update_team_member/);
  assert.match(admin, /client_portal_remove_team_member/);
  assert.match(admin, /client_portal_resend_team_invite/);
  assert.match(admin, /client_portal_revoke_team_invite/);
  assert.match(edge, /platform_admins/);
  assert.match(edge, /\["owner", "admin"\]/);
});

test("confirmed accounts are attached immediately and organization teams default to unlimited", async () => {
  const migration = await projectFile("supabase/migrations/20260830015340_direct_existing_member_access_and_unlimited_teams.sql");

  assert.match(migration, /alter column user_limit set default 0/);
  assert.match(migration, /Zero means unlimited/);
  assert.match(migration, /auth_user\.email_confirmed_at is not null/);
  assert.match(migration, /client_portal_add_or_invite_team_member/);
  assert.match(migration, /client_portal_apply_member_access/);
  assert.match(migration, /target_user_limit > 0 and current_member_count >= target_user_limit/);
  assert.match(migration, /client_portal_update_team_limit/);
  assert.match(migration, /Only an account administrator can add team members/);
  assert.match(migration, /revoke all on function public\.client_portal_apply_member_access[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.client_portal_add_or_invite_team_member[\s\S]*to authenticated/);
  assert.match(migration, /join auth\.users auth_user[\s\S]*invite\.redeemed_uses < invite\.max_uses/);
});

test("legacy websites expose a platform-admin-only organization connection without activating other products", async () => {
  const [html, admin, migration, existingOrganizationMigration] = await Promise.all([
    projectFile("n3xra-admin/websites/index.html"),
    projectFile("n3xra-admin/websites/websites-admin.js"),
    projectFile("supabase/migrations/20260823234716_connect_website_client_organization.sql"),
    projectFile("supabase/migrations/20260824131458_connect_website_to_existing_organization.sql"),
  ]);

  assert.match(html, /id="website-organization-setup" hidden/);
  assert.match(html, /Create and connect organization/);
  assert.match(html, /id="website-organization-select"/);
  assert.match(html, /Existing organization/);
  assert.match(admin, /Boolean\(selectedWebsite && !selectedWebsite\.organization_id\)/);
  assert.match(admin, /platform_connect_website_client_organization/);
  assert.match(admin, /input_organization_id: websiteOrganizationSelect\?\.value \|\| null/);
  assert.match(admin, /Connect existing organization/);
  assert.match(admin, /selectedWebsite\.organization_id = data\.organization_id/);
  assert.match(migration, /not public\.is_platform_admin\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /member\.role = 'owner'/);
  assert.match(migration, /owner_organization_count > 0/);
  assert.match(migration, /instead of creating a duplicate/);
  assert.match(migration, /product_key = 'records'/);
  assert.match(migration, /portal_enabled = false/);
  assert.match(migration, /grant execute on function public\.platform_connect_website_client_organization\(uuid\)[\s\S]*to authenticated/);
  assert.match(existingOrganizationMigration, /input_organization_id uuid default null/);
  assert.match(existingOrganizationMigration, /organization\.owner_user_id = target_owner_user_id/);
  assert.match(existingOrganizationMigration, /insert into public\.website_members/);
  assert.match(existingOrganizationMigration, /grant execute on function public\.platform_connect_website_client_organization\(uuid, uuid\)[\s\S]*to authenticated/);
});

test("team mutations protect owners, bind invites to email, and preserve tenant isolation", async () => {
  const migration = await projectFile("supabase/migrations/20260823230958_client_portal_team_management.sql");

  assert.match(migration, /public\.can_view_organization\(input_organization_id\)/);
  assert.match(migration, /public\.can_manage_members\(input_organization_id\)/);
  assert.match(migration, /This invitation was sent to a different email address/);
  assert.match(migration, /membership_record\.user_id = owner_user_id/);
  assert.match(migration, /membership_record\.user_id = auth\.uid\(\)/);
  assert.match(migration, /website\.organization_id = invite_record\.organization_id/);
  assert.match(migration, /revoke all on function public\.client_portal_team_snapshot\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.client_portal_team_snapshot\(uuid\) to authenticated/);
});

test("team invitation email is authorized server-side and does not expose service credentials", async () => {
  const [edge, account] = await Promise.all([
    projectFile("supabase/functions/send-client-team-invite/index.ts"),
    projectFile("account/account.js"),
  ]);

  assert.match(edge, /userClient\.auth\.getUser\(\)/);
  assert.match(edge, /membership\?\.role === "account_admin"/);
  assert.match(edge, /organization\?\.owner_user_id === user\.id/);
  assert.match(edge, /RESEND_API_KEY/);
  assert.match(edge, /This secure invitation expires in seven days/);
  assert.match(edge, /approvedPortalHost/);
  assert.match(edge, /client_portal/);
  assert.match(account, /isClientPortalInvite/);
  assert.match(account, /redeem_invite_code/);
  assert.match(account, /window\.location\.assign\("\/client-portal\/"\)/);
  assert.doesNotMatch(edge, /serviceRoleKey\s*[:=]\s*["'][^"']+["']/);
});
