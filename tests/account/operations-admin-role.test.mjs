import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("Operations Administrator invitations preserve the established admin role with a restricted scope", async () => {
  const [migration, edgeFunction, controller, html] = await Promise.all([
    read("supabase/migrations/20260824233608_operations_administrator_role.sql"),
    read("supabase/functions/platform-admin/index.ts"),
    read("account/admin/controllers/platform-admins.js"),
    read("account/admin/platform-admins/index.html"),
  ]);

  assert.match(migration, /add column if not exists access_scope text not null default 'full'/);
  assert.match(migration, /check \(access_scope in \('full', 'operations'\)\)/);
  assert.match(migration, /is_full_platform_admin/);
  assert.match(migration, /founding_partner_applications_select_policy[\s\S]*is_full_platform_admin/);
  assert.match(edgeFunction, /requestedRole === "operations_admin" \? "admin" : requestedRole/);
  assert.match(edgeFunction, /accessScope = requestedRole === "operations_admin" \? "operations" : "full"/);
  assert.match(edgeFunction, /access_scope: inviteAccessScope/);
  assert.match(edgeFunction, /data\.access_scope === "operations" \? \{ \.\.\.data, role: "operations_admin" \}/);
  assert.match(controller, /Operations administrator/);
  assert.match(html, /value="operations_admin">Operations administrator/);
});

test("Operations Administrator navigation contains only the approved workspaces", async () => {
  const [navigation, session, adminCss] = await Promise.all([
    read("account/admin/admin-navigation.js"),
    read("account/admin/admin-session.js"),
    read("account/admin/admin.css"),
  ]);

  for (const allowed of [
    "/account/admin/inbox/", "/account/admin/accounts/", "/account/admin/prospects/", "/account/admin/support/",
    "/account/admin/billing/", "/account/admin/operations/", "/account/admin/analytics/",
    "/account/admin/applications/", "/account/admin/business-info/", "/account/admin/files/",
    "/account/admin/communications/", "/account/notifications/",
  ]) {
    assert.match(navigation, new RegExp(allowed.replaceAll("/", "\\/")));
    assert.match(session, new RegExp(allowed.replaceAll("/", "\\/")));
  }

  assert.match(navigation, /operationsAdminProductKeys = new Set\(\["websites", "records", "communications"\]\)/);
  assert.match(navigation, /isOperationsAdministrator\(\) \? "" : mobileSection/);
  assert.match(session, /return normalizedRole === "operations_admin" && OPERATIONS_ADMIN_PATHS\.has/);
  assert.match(adminCss, /body\[data-admin-role="operations_admin"\] \[data-site-assistant-open\]/);
});

test("excluded partner, codebase, Admin AI, and retired-product services require full administrator scope", async () => {
  const [partnerApi, codebaseApi, assistantAuth, musicApi, viralsApi] = await Promise.all([
    read("api/partner-admin-usage.js"),
    read("api/codebase-ai.js"),
    read("src/ai-core/auth.ts"),
    read("api/_music-supabase.js"),
    read("api/_virals-supabase.js"),
  ]);

  assert.match(partnerApi, /access_scope=eq\.full/);
  assert.match(codebaseApi, /accessScope !== "full"/);
  assert.match(assistantAuth, /accessScope === "full"/);
  assert.match(musicApi, /access_scope=eq\.full/);
  assert.match(viralsApi, /access_scope=eq\.full/);
});
