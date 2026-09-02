import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("Partner / Sales Representatives are stored outside the platform administrator role", async () => {
  const [migration, edgeFunction] = await Promise.all([
    read("supabase/migrations/20260902154607_partner_sales_representative_role.sql"),
    read("supabase/functions/platform-admin/index.ts"),
  ]);

  assert.match(migration, /create table if not exists public\.platform_sales_representatives/);
  assert.match(migration, /private\.can_manage_sales_leads\(\)/);
  assert.match(migration, /prospect_contacts_sales_staff_select/);
  assert.match(migration, /prospect_contacts_sales_staff_insert/);
  assert.match(migration, /prospect_contacts_sales_staff_update/);
  assert.match(migration, /prospect_contacts_admin_delete[\s\S]*public\.is_platform_admin/);
  assert.match(edgeFunction, /role: "sales_rep", access_scope: "sales_leads"/);
  assert.match(edgeFunction, /Partner \/ Sales Representative access is limited to Sales Leads and the Partner Portal/);
});

test("Sales representatives can open only Sales Leads in the administrative shell", async () => {
  const [session, navigation, account, adminCss] = await Promise.all([
    read("account/admin/admin-session.js"),
    read("account/admin/admin-navigation.js"),
    read("account/account.js"),
    read("account/admin/admin.css"),
  ]);

  assert.match(session, /normalizedRole === "sales_rep"[\s\S]*"\/account\/admin\/prospects\/"/);
  assert.match(navigation, /"\/account\/admin\/prospects\/", "Sales Leads"/);
  assert.match(navigation, /if \(isSalesRepresentative\(\)\) return \[\]/);
  assert.match(account, /"operations_admin", "sales_rep"/);
  assert.match(account, /salesRepresentative \? "Sales" : "Admin"/);
  assert.match(adminCss, /body\[data-admin-role="sales_rep"\] \[data-site-assistant-open\]/);
});

test("Sales lead scanning accepts the scoped role without opening other admin APIs", async () => {
  const [sharedApi, scanApi, page, source] = await Promise.all([
    read("api/_communications.js"),
    read("api/admin-prospect-card-scan.js"),
    read("account/admin/prospects/index.html"),
    read("src/admin-prospects/prospects.ts"),
  ]);

  assert.match(sharedApi, /async function requireSalesLeadAccess/);
  assert.match(sharedApi, /platform_sales_representatives\?select=user_id,status/);
  assert.match(scanApi, /requireSalesLeadAccess/);
  assert.match(page, /<h1>Sales Leads<\/h1>/);
  assert.match(source, /document\.body\.dataset\.adminRole === "sales_rep"/);
});

test("Partner applications link to Auth accounts and portal errors remain distinguishable", async () => {
  const [migration, portalApi, account] = await Promise.all([
    read("supabase/migrations/20260902160149_link_partner_applications_to_accounts.sql"),
    read("api/partner-portal.js"),
    read("account/account.js"),
  ]);

  assert.match(migration, /add column if not exists account_user_id uuid references auth\.users\(id\)/);
  assert.match(migration, /founding_partner_applications_account_user_unique/);
  assert.match(migration, /founding_partner_applications_link_account/);
  assert.match(migration, /auth_users_link_partner_application/);
  assert.match(portalApi, /account_user_id=eq\.\$\{encodeURIComponent\(userId\)\}/);
  assert.doesNotMatch(portalApi, /approvedApplication\(email\)/);
  assert.match(account, /if \(response\.status === 403\) return \{ approved: false \}/);
  assert.match(account, /Connection unavailable/);
});
