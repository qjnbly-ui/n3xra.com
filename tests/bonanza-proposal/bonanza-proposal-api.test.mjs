import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { _test } = require("../../api/bonanza-proposal.js");

test("proposal access codes are normalized before hashing", () => {
  assert.equal(_test.normalizeCode(" example-code "), "EXAMPLE-CODE");
  assert.equal(_test.codeHash(" example-code "), _test.codeHash("EXAMPLE-CODE"));
});

test("proposal sections expose only their supported choices", () => {
  assert.deepEqual(_test.SECTION_CHOICES.addon_communications, ["basic", "plus", "later", "question"]);
  assert.equal(_test.SECTION_CHOICES.included_website.includes("add_now"), false);
});

test("constant-time comparison rejects a different hash", () => {
  assert.equal(_test.safeEqual("abc", "abc"), true);
  assert.equal(_test.safeEqual("abc", "abd"), false);
  assert.equal(_test.safeEqual("abc", "abcd"), false);
});
