import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
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

test("approved presentation introduces costs only in the closing service section", async () => {
  const html = await readFile(new URL("../../bonanza/index.html", import.meta.url), "utf8");
  const investmentStart = html.indexOf('id="investment"');
  assert.ok(investmentStart > 0);
  assert.equal(html.slice(0, investmentStart).includes("$"), false);
  assert.match(html.slice(investmentStart), /\$2,500/);
  assert.match(html.slice(investmentStart), /Baseline service/);
  assert.match(html.slice(investmentStart), /Month-to-month control/);
  assert.equal(html.includes("response-controls-template"), false);
  assert.match(html, /proposal-v6\.js/);
});
