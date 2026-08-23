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
