import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the Updates section publishes no content", async () => {
  const [updates, sitemap, projectPulse] = await Promise.all([
    repositoryFile("updates/index.html"),
    repositoryFile("sitemap.xml"),
    repositoryFile("project-pulse/index.html"),
  ]);

  assert.match(updates, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(updates, /updates-callout|updates-post-card|feed\.xml/);
  assert.doesNotMatch(sitemap, /n3xra\.com\/updates/);
  assert.doesNotMatch(projectPulse, /href="\/updates\//);

  await assert.rejects(access(new URL("../../updates/feed.xml", import.meta.url)));
});
