import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authSurfaces = [
  "account/account.js",
  "n3xra-records/login.js",
  "client-portal/login.js",
  "utilities/login/utilities-login.js",
  "n3xra-virals/login/index.html",
  "ai-music-generator/login/index.html",
  "ai-music-generator/app/index.html",
  "ai-music-generator/index.html",
  "invest/interest.js",
  "website-request/request.js",
  "admin-app/App.tsx",
];

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("public Supabase auth surfaces pass Turnstile tokens to Supabase", async () => {
  for (const path of authSurfaces) {
    const contents = await source(path);
    assert.match(contents, /captchaToken/, `${path} must supply a CAPTCHA token`);
    assert.doesNotMatch(
      contents,
      /verifyCaptchaServerSide/,
      `${path} must not spend a single-use token before Supabase validates it`,
    );
  }
});

test("password, signup, reset, and OTP calls include CAPTCHA options", async () => {
  const expectations = [
    ["account/account.js", 3],
    ["n3xra-records/login.js", 3],
    ["client-portal/login.js", 2],
    ["utilities/login/utilities-login.js", 2],
    ["n3xra-virals/login/index.html", 1],
    ["ai-music-generator/login/index.html", 2],
    ["ai-music-generator/app/index.html", 2],
    ["ai-music-generator/index.html", 2],
    ["invest/interest.js", 1],
    ["website-request/request.js", 1],
    ["admin-app/App.tsx", 2],
  ];

  for (const [path, minimum] of expectations) {
    const contents = await source(path);
    const tokenOptions = contents.match(/captchaToken(?:\s*:\s*[\w.]+)?/g) || [];
    assert.ok(tokenOptions.length >= minimum, `${path} is missing CAPTCHA options on an auth request`);
  }
});

test("unverified identities are visibly separated as pending accounts", async () => {
  const contents = await source("account/admin/controllers/accounts.js");
  assert.match(contents, /Pending verification/);
  assert.match(contents, /account\.emailConfirmedAt/);
  assert.match(contents, /Awaiting email verification/);
});
