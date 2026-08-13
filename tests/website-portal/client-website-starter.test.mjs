import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../../templates/client-website/src/components/PortalSignInLink.astro", import.meta.url),
  "utf8",
);

test("the client website starter always opens portal sign-in in the current tab", () => {
  assert.match(component, /href=\{portalUrl\.toString\(\)\}/);
  assert.doesNotMatch(component, /target\s*=|window\.open\s*\(/);
  assert.doesNotMatch(component, /target\??:/);
});

test("the client website starter requires a secure production portal URL", () => {
  assert.match(component, /portalUrl\.protocol !== "https:"/);
  assert.match(component, /isLocalDevelopment/);
});
