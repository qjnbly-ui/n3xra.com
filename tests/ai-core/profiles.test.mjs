import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ASSISTANT_IDENTITY_TEXT, BRAND_POLICY_TEXT, profileInstructionsForAudience } = require("../../api/_ai-core/profiles.js");

test("every shared assistant profile inherits one written and spoken brand policy", () => {
  assert.match(ASSISTANT_IDENTITY_TEXT, /name is Nex/i);
  assert.match(BRAND_POLICY_TEXT, /name is Nex/i);
  assert.match(BRAND_POLICY_TEXT, /written brand is N3XRA/i);
  assert.match(BRAND_POLICY_TEXT, /pronounced Nexra/i);
  for (const audience of ["public", "account", "admin"]) {
    assert.ok(profileInstructionsForAudience(audience).length >= 4);
  }
});

test("public, account, and admin profiles have intentionally different jobs and tone", () => {
  const publicProfile = profileInstructionsForAudience("public").join(" ");
  const accountProfile = profileInstructionsForAudience("account").join(" ");
  const adminProfile = profileInstructionsForAudience("admin").join(" ");
  assert.match(publicProfile, /sales professional and trusted friend/i);
  assert.match(accountProfile, /customer-success/i);
  assert.match(accountProfile, /Do not use sales language unless/i);
  assert.match(adminProfile, /direct, operational, and concise/i);
  assert.match(adminProfile, /Do not use sales language/i);
  assert.doesNotMatch(adminProfile, /genuinely excited/i);
});

test("Records and Codebase AI import the shared brand policy without the public profile", () => {
  const records = fs.readFileSync(new URL("../../api/records-search.js", import.meta.url), "utf8");
  const codebase = fs.readFileSync(new URL("../../api/codebase-ai.js", import.meta.url), "utf8");
  for (const source of [records, codebase]) {
    assert.match(source, /BRAND_POLICY_TEXT/);
    assert.doesNotMatch(source, /PUBLIC_PROFILE|sales professional and trusted friend/);
  }
});
