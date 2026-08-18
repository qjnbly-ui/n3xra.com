import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("career applications expose account and product provisioning", async () => {
  const [html, controller, css] = await Promise.all([
    read("account/admin/applications/index.html"),
    read("account/admin/applications/applications.js"),
    read("account/admin/applications/applications.css"),
  ]);

  assert.match(html, /Create account &amp; access/);
  assert.match(html, /Products available on first sign in/);
  assert.match(html, /Platform administrator access is managed separately/);
  assert.match(html, /Activation email preview/);
  assert.match(html, /id="application-email-preview-frame"[\s\S]*sandbox=""/);
  assert.match(html, /Preview email/);
  assert.match(controller, /list-career-applicant-products/);
  assert.match(controller, /preview-career-applicant-email/);
  assert.match(controller, /provision-career-applicant/);
  assert.match(controller, /applicationId: application\.id/);
  assert.match(controller, /Open account/);
  assert.match(css, /\.provision-product-option:has\(input:checked\)/);
  assert.match(css, /#application-email-preview-frame/);
});

test("email preview uses the delivery template without creating an account or sending", async () => {
  const edgeFunction = await read("supabase/functions/platform-admin/index.ts");
  const previewAction = edgeFunction.match(/if \(action === "preview-career-applicant-email"\)[\s\S]*?(?=\n    if \(action === "provision-career-applicant"\))/)?.[0] || "";

  assert.match(previewAction, /renderApplicantActivationEmail/);
  assert.doesNotMatch(previewAction, /auth\.admin\.generateLink/);
  assert.doesNotMatch(previewAction, /admin_provision_career_applicant/);
  assert.doesNotMatch(previewAction, /sendApplicantActivationEmail/);
  assert.match(edgeFunction, /const email = renderApplicantActivationEmail\(options\)/);
});

test("trusted provisioning creates access before sending a password setup link", async () => {
  const [edgeFunction, migration, accountController, accountHtml] = await Promise.all([
    read("supabase/functions/platform-admin/index.ts"),
    read("supabase/migrations/20260818004009_admin_provision_career_applicant.sql"),
    read("account/account.js"),
    read("account/index.html"),
  ]);

  const action = edgeFunction.match(/if \(action === "provision-career-applicant"\)[\s\S]*?(?=\n    if \(action === "list-website-request-workspace"\))/)?.[0] || "";
  assert.match(action, /auth\.admin\.generateLink/);
  assert.match(action, /admin_provision_career_applicant/);
  assert.match(action, /sendApplicantActivationEmail/);
  assert.ok(action.indexOf("admin_provision_career_applicant") < action.indexOf("sendApplicantActivationEmail"));
  assert.match(action, /auth\.admin\.deleteUser/);
  assert.match(edgeFunction, /APPLICANT_INSTANT_PRODUCT_KEYS = \["records"\]/);

  assert.match(migration, /security invoker/);
  assert.match(migration, /request_claims[\s\S]*service_role/);
  assert.match(migration, /update public\.careers_applications[\s\S]*account_user_id/);
  assert.match(migration, /insert into public\.organization_memberships/);
  assert.match(migration, /insert into public\.organization_product_entitlements/);
  assert.match(migration, /source[\s\S]*'manual'/);
  assert.match(migration, /revoke all on function public\.admin_provision_career_applicant[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function public\.admin_provision_career_applicant[\s\S]*service_role/);
  assert.match(migration, /require their own setup workflow/);

  assert.match(accountController, /callbackType === "invite"/);
  assert.match(accountController, /Finish account setup/);
  assert.match(accountController, /Set password and continue/);
  assert.match(accountHtml, /id="recovery-title"/);
});

test("invite-mode PKCE callbacks are exchanged without confusing product invite codes", async () => {
  const callbackHelper = await read("shared/lib/supabase-client.js");

  assert.match(callbackHelper, /code\.length < 16/);
  assert.match(callbackHelper, /return !params\.has\("invite"\) && !params\.has\("invite_code"\)/);
});
