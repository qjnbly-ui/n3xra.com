import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the client portal provides one shared Team & Permissions workspace", async () => {
  const [html, script, shell, context] = await Promise.all([
    projectFile("client-portal/team/index.html"),
    projectFile("client-portal/team.js"),
    projectFile("client-portal/client-shell.js"),
    projectFile("client-portal/client-workspace-context.js"),
  ]);

  assert.match(html, /Team &amp; Permissions/);
  assert.match(html, /id="team-invite-form"/);
  assert.match(html, /Administrator/);
  assert.match(html, /Editor/);
  assert.match(html, /View only/);
  assert.match(script, /client_portal_team_snapshot/);
  assert.match(script, /client_portal_create_team_invite/);
  assert.match(script, /send-client-team-invite/);
  assert.match(script, /client_portal_update_team_member/);
  assert.match(script, /client_portal_remove_team_member/);
  assert.match(shell, /label: "Team & Permissions"/);
  assert.match(context, /label: "Team & Permissions"/);
});

test("N3XRA website administration uses the same client invitation workflow", async () => {
  const [html, admin, edge] = await Promise.all([
    projectFile("n3xra-admin/websites/index.html"),
    projectFile("n3xra-admin/websites/websites-admin.js"),
    projectFile("supabase/functions/send-client-team-invite/index.ts"),
  ]);

  assert.match(html, /Existing users sign in; new users create their account/);
  assert.match(html, /Send invitation/);
  assert.match(html, /value="account_admin">Administrator/);
  assert.doesNotMatch(html, /Assign an existing N3XRA account/);
  assert.match(admin, /client_portal_team_snapshot/);
  assert.match(admin, /client_portal_create_team_invite/);
  assert.match(admin, /send-client-team-invite/);
  assert.match(admin, /client_portal_update_team_member/);
  assert.match(admin, /client_portal_remove_team_member/);
  assert.match(admin, /client_portal_resend_team_invite/);
  assert.match(admin, /client_portal_revoke_team_invite/);
  assert.match(edge, /platform_admins/);
  assert.match(edge, /\["owner", "admin"\]/);
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
