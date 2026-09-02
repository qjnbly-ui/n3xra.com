import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("full partner administrators can manage access and inspect financial activity", async () => {
  const [controller, endpoint, html, styles] = await Promise.all([
    read("n3xra-admin/partners/partners-admin.js"),
    read("api/partner-admin-usage.js"),
    read("n3xra-admin/partners/index.html"),
    read("n3xra-admin/partners/partners-admin.css"),
  ]);

  assert.match(controller, /data-partner-code/);
  assert.match(controller, /data-partner-program/);
  assert.match(controller, /data-load-partner-activity/);
  assert.match(controller, /interested_products: interestedProducts/);
  assert.match(endpoint, /access_scope=eq\.full/);
  assert.match(endpoint, /partner_referrals\?select=/);
  assert.match(endpoint, /partner_commission_entries\?select=/);
  assert.match(endpoint, /includeDetails \? \{ activity \} : \{\}/);
  assert.doesNotMatch(html, /id="partner-admin-title">Review applications/);
  assert.doesNotMatch(html, /class="portal-heading"/);
  assert.match(html, /class="partner-admin-workbench"/);
  assert.match(html, /class="partner-admin-pane-head"/);
  assert.match(html, /id="partner-count"/);
  assert.match(html, /id="partner-application-detail"/);
  assert.match(html, /partners-admin\.css\?v=10/);
  assert.match(html, /partners-admin\.js\?v=10/);
  assert.match(controller, /data-select-partner/);
  assert.match(controller, /async function selectApplication/);
  assert.match(controller, /mainReviewDirty/);
  assert.match(styles, /grid-template-columns: 340px minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(styles, /\.partner-admin-detail-pane \{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.partner-admin-workspace \{[^}]*height: 100%[^}]*padding: 0 !important/s);
  assert.doesNotMatch(controller, /<details class="partner-admin-card">/);
});

test("partner commission activity remains read-only in the administrator browser", async () => {
  const controller = await read("n3xra-admin/partners/partners-admin.js");
  assert.doesNotMatch(controller, /\.from\("partner_commission_entries"\)\.update/);
  assert.doesNotMatch(controller, /data-save-commission/);
});

test("full administrators can revise audited commission terms and a custom partner contract", async () => {
  const [controller, endpoint, migration] = await Promise.all([
    read("n3xra-admin/partners/partners-admin.js"),
    read("api/partner-admin-terms.js"),
    read("supabase/migrations/20260831151643_partner_commission_terms_contracts.sql"),
  ]);

  assert.match(controller, /Edit commission &amp; contract/);
  assert.match(controller, /commission_rate_bps/);
  assert.match(controller, /contract_body/);
  assert.match(endpoint, /access_scope=eq\.full/);
  assert.match(endpoint, /revision: Number\(existing\?\.revision \|\| 0\) \+ 1|Number\(existing\?\.revision \|\| 0\) \+ 1/);
  assert.match(migration, /create table public\.partner_terms \(/);
  assert.match(migration, /create table public\.partner_terms_audit_log \(/);
  assert.match(migration, /Partner terms audit records are immutable/);
  assert.match(migration, /revoke all on public\.partner_terms, public\.partner_terms_audit_log from public, anon, authenticated/);
});

test("partner account preview reuses the real portal and remains read-only", async () => {
  const [admin, portal, endpoint] = await Promise.all([
    read("n3xra-admin/partners/partners-admin.js"),
    read("client-portal/partners/partner-portal.js"),
    read("api/partner-portal.js"),
  ]);

  assert.match(admin, /\/client-portal\/partners\/\?admin_preview=/);
  assert.match(portal, /Administrator preview is read-only/);
  assert.match(endpoint, /Administrator previews are read-only/);
  assert.match(endpoint, /isFullAdmin\(user\.id\)/);
  assert.match(endpoint, /partner_terms\?select=/);
});

test("approved partners can open representative resources without gaining access to other internal files", async () => {
  const [portal, endpoint, html] = await Promise.all([
    read("client-portal/partners/partner-portal.js"),
    read("api/partner-portal.js"),
    read("client-portal/partners/index.html"),
  ]);

  assert.match(html, /id="training-resources"/);
  assert.match(html, /Sales representative materials/);
  assert.match(portal, /open_training_resource/);
  assert.match(endpoint, /N3XRA LLC\/Sales\/Representative Training & Guides\//);
  assert.match(endpoint, /startsWith\(TRAINING_RESOURCE_PATH\)/);
  assert.match(endpoint, /object\/sign\/n3xra-files/);
  assert.match(endpoint, /approvedApplication\(user\.id\)/);
});

test("the desktop partner portal scrolls through its complete workspace", async () => {
  const styles = await read("client-portal/partners/partner-portal.css");
  assert.match(styles, /@media \(min-width: 801px\)[\s\S]*\.client-portal-page \.portal-layout > \.partner-portal-workspace \{[\s\S]*overflow-y: auto;/);
});

test("commission and contract validation preserves exact percentage basis points", async () => {
  const { normalizeTerms } = await import("../../api/partner-admin-terms.js");
  const saved = normalizeTerms({
    status: "active",
    commission_type: "percentage",
    commission_rate_bps: 1250,
    currency: "USD",
    commission_description: "Qualified referrals",
    contract_title: "Custom Partner Agreement",
    contract_body: "These are the complete custom partner agreement terms.",
    effective_at: "2026-09-01",
  }, "00000000-0000-0000-0000-000000000001", 2);

  assert.equal(saved.commission_rate_bps, 1250);
  assert.equal(saved.commission_amount_cents, null);
  assert.equal(saved.revision, 2);
  assert.throws(() => normalizeTerms({
    status: "active",
    commission_type: "fixed",
    commission_amount_cents: -1,
    contract_body: "These are complete contract terms.",
  }, "00000000-0000-0000-0000-000000000001", 1), /non-negative/);
});

test("partner admin provides customizable staged email with immutable sent history", async () => {
  const [controller, endpoint, migration] = await Promise.all([
    read("n3xra-admin/partners/partners-admin.js"),
    read("api/partner-admin-email.js"),
    read("supabase/migrations/20260831153407_partner_email_workflow.sql"),
  ]);

  assert.match(controller, /Manage email process/);
  assert.match(controller, /Preview email/);
  assert.match(controller, /Send to partner/);
  assert.match(endpoint, /approval:/);
  assert.match(endpoint, /contract_ready:/);
  assert.match(endpoint, /portal_ready:/);
  assert.match(endpoint, /follow_up:/);
  assert.match(endpoint, /access_scope=eq\.full/);
  assert.match(endpoint, /Idempotency-Key/);
  assert.match(endpoint, /application\.status !== "approved"/);
  assert.match(endpoint, /terms\?\.status !== "active"/);
  assert.match(migration, /create table public\.partner_email_deliveries/);
  assert.match(migration, /Sent partner email delivery records are immutable/);
  assert.doesNotMatch(migration, /partner_application_id uuid not null references/);
  assert.match(migration, /revoke all on public\.partner_email_deliveries from public, anon, authenticated/);
});

test("default approval email confirms approval but asks the partner to await details", async () => {
  const { buildHtml, defaultTemplates } = await import("../../api/partner-admin-email.js");
  const templates = defaultTemplates({
    full_name: "Alex Partner",
    email: "alex@example.com",
    status: "approved",
    referral_code: "ALEX",
    interested_products: ["Website Referral Program"],
  }, null);

  assert.match(templates.approval.body, /has been approved/);
  assert.match(templates.approval.body, /Please await further details/);
  assert.match(templates.contract_ready.body, /agreement and commission terms are ready/);
  assert.match(templates.portal_ready.body, /Partner Portal is ready/);
  assert.match(buildHtml("Hello <script>", "Safe <b>message</b>"), /Hello &lt;script&gt;/);
  assert.doesNotMatch(buildHtml("Hello", "Safe <b>message</b>"), /<b>message<\/b>/);
});
