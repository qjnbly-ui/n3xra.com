import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const termsHtml = await readFile(new URL("../../partners/terms/index.html", import.meta.url), "utf8");
const applicationHtml = await readFile(new URL("../../partners/index.html", import.meta.url), "utf8");

test("website referral terms use the current flat commission rule", () => {
  assert.match(termsHtml, /flat \$100 commission/);
  assert.match(termsHtml, /No minimum website service term is required for commission eligibility\./);
  assert.match(termsHtml, /purchases and pays for an eligible N3XRA website build/);
  assert.doesNotMatch(termsHtml, /full year of qualifying website service/i);
});

test("partner application acknowledgement matches the current website rule", () => {
  assert.match(applicationHtml, /flat \$100 website commission/);
  assert.match(applicationHtml, /No minimum website service term is required\./);
  assert.doesNotMatch(applicationHtml, /full year of eligible website service/i);
});

test("nonparticipating services are stated explicitly", () => {
  assert.match(termsHtml, /N3XRA Communications is not currently a participating commission product/);
  assert.match(termsHtml, /Custom development does not carry an automatic commission rate/);
});
