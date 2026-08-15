import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("retired AI Music access is administrator-only and never creates an enrollment", async () => {
  const [route, service, account, app, login, publicPage] = await Promise.all([
    read("api/music-account.js"),
    read("api/_music-supabase.js"),
    read("account/account.js"),
    read("ai-music-generator/app/index.html"),
    read("ai-music-generator/login/index.html"),
    read("ai-music-generator/index.html"),
  ]);

  assert.match(route, /\["GET", "PATCH"\]/);
  assert.doesNotMatch(route, /req\.method === "POST"|getMusicAccount\(/);
  assert.match(service, /\/rest\/v1\/platform_admins/);
  assert.match(service, /role=in\.\(owner,admin\)/);
  assert.match(service, /async function getExistingMusicAccount[\s\S]*retired_admin_access: true/);
  assert.doesNotMatch(service, /async function (?:create|ensure)MusicProfile|reserve_music_generation/);
  assert.match(account, /function openAdminMusic\(\)[\s\S]*window\.location\.assign\("\/ai-music-generator\/app\/"\)/);
  assert.doesNotMatch(account.match(/function openAdminMusic\(\)[\s\S]+?\n}/)?.[0] || "", /fetch\(|confirm\(|enroll/i);
  assert.match(app, /Retired App · Administrator Access/);
  assert.doesNotMatch(app, /musicEnrollmentRequired/);
  assert.match(login, /async function openApp[\s\S]*fetch\("\/api\/music-account"/);
  assert.match(publicPage, /window\.location\.replace\("\/ai-music-generator\/app\/"\)/);
});

test("retired Virals access is administrator-only and never creates an enrollment", async () => {
  const [route, service, account, nav, login, analyze, compare] = await Promise.all([
    read("api/virals-account.js"),
    read("api/_virals-supabase.js"),
    read("account/account.js"),
    read("virals/nav.js"),
    read("n3xra-virals/login/index.html"),
    read("api/virals-analyze.js"),
    read("api/virals-compare.js"),
  ]);

  assert.match(route, /req\.method !== "GET"/);
  assert.doesNotMatch(route, /req\.method === "POST"|getViralsAccount\(|not_enrolled/);
  assert.match(service, /async function isViralsAdmin[\s\S]*platform_admins/);
  assert.match(service, /async function getExistingViralsAccount[\s\S]*retired_admin_access: true/);
  assert.doesNotMatch(service, /getAnonymousViralsUser|ensureViralsProfile|getViralsAccount/);
  assert.match(account, /function openAdminVirals\(\)[\s\S]*window\.location\.assign\("\/virals\/"\)/);
  assert.doesNotMatch(account.match(/function openAdminVirals\(\)[\s\S]+?\n}/)?.[0] || "", /fetch\(|confirm\(|enroll/i);
  assert.match(nav, /window\.location\.replace\(getLoginUrl\(\)\)/);
  assert.match(login, /async function verifyAdministratorAccess[\s\S]*fetch\("\/api\/virals-account"/);
  assert.doesNotMatch(login, /signUp\(|enrollViralsAccount|Create Virals account/);
  assert.match(analyze, /if \(!token\) return sendJson\(res, 401/);
  assert.match(compare, /if \(!token\) return sendJson\(res, 401/);
});
