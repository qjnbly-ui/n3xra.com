import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Build Studio is available from every website administration workspace", async () => {
  const [session, navigation, context, workspace] = await Promise.all([
    read("account/admin/admin-session.js"),
    read("account/admin/admin-navigation.js"),
    read("n3xra-admin/website-admin-context.js"),
    read("n3xra-admin/website-admin-workspace.js"),
  ]);
  for (const source of [session, navigation, context, workspace]) assert.match(source, /\/n3xra-admin\/build-studio\//);
  assert.match(context, /"Build Studio"/);
  assert.match(workspace, /key: "build"/);
});

test("Build Studio UI keeps repository mutations behind explicit controls", async () => {
  const [source, markup] = await Promise.all([read("src/build-studio/build-studio.ts"), read("n3xra-admin/build-studio/index.html")]);
  assert.match(source, /\/checkpoint/);
  assert.match(source, /\/push/);
  assert.match(markup, /Changes stay on this branch/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
});

test("Build worker uses App Server over stdio and server-managed sessions", async () => {
  const [worker, appServer, migration] = await Promise.all([
    read("services/build-worker/src/server.ts"),
    read("services/build-worker/src/codex-app-server.ts"),
    read("supabase/migrations/20260826202714_build_studio_foundation.sql"),
  ]);
  assert.match(appServer, /spawn\("codex", \["app-server"\]/);
  assert.match(appServer, /chatgptDeviceCode/);
  assert.match(worker, /Do not commit, push, deploy/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.website_build_sessions from public, anon, authenticated/);
});

test("Build worker ships as a persistent Render service", async () => {
  const [blueprint, dockerfile, worker] = await Promise.all([read("render.yaml"), read("services/build-worker/Dockerfile"), read("services/build-worker/src/server.ts")]);
  assert.match(blueprint, /mountPath: \/var\/data/);
  assert.match(blueprint, /CODEX_HOME/);
  assert.match(blueprint, /SUPABASE_SERVICE_ROLE_KEY[\s\S]*sync: false/);
  assert.match(blueprint, /GITHUB_APP_PRIVATE_KEY[\s\S]*sync: false/);
  assert.doesNotMatch(blueprint, /GITHUB_TOKEN/);
  assert.match(worker, /repositories: \[repository\]/);
  assert.match(worker, /permissions: \{ contents: "write" \}/);
  assert.match(worker, /return await proxyPreview/);
  assert.match(worker, /\["install", "--no-audit", "--no-fund"\]/);
  assert.match(worker, /"x-frame-options"/);
  assert.match(worker, /"content-security-policy"/);
  assert.match(dockerfile, /@openai\/codex@0\.143\.0/);
  assert.match(dockerfile, /N3XRA_BUILD_HOST=0\.0\.0\.0/);
});
