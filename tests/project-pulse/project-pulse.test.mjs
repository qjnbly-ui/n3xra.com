import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../../", import.meta.url);
const repositoryFile = (path) => readFile(new URL(path, repositoryUrl), "utf8");

test("Project Pulse publishes every current product as a live destination", async () => {
  const [manifestText, page, client] = await Promise.all([
    repositoryFile("project-pulse/manifest.json"),
    repositoryFile("project-pulse/index.html"),
    repositoryFile("project-pulse/project-pulse.js"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.summary.products, manifest.products.length);
  assert.equal(new Set(manifest.products.map(({ id }) => id)).size, manifest.products.length);
  assert.equal(new Set(manifest.products.map(({ route }) => route)).size, manifest.products.length);
  assert.match(page, /id="pulse-products"/);
  assert.match(client, /renderProducts\(manifest\.products\)/);

  await Promise.all(manifest.products.map(({ route }) => (
    access(new URL(`${route.replace(/^\//, "")}index.html`, repositoryUrl))
  )));
});

test("Project Pulse includes the latest released platform work", async () => {
  const manifest = JSON.parse(await repositoryFile("project-pulse/manifest.json"));
  const titles = manifest.recentCapabilities.map(({ title }) => title);

  assert.ok(titles.includes("N3XRA Contact Cards"));
  assert.ok(titles.includes("Persistent N3XRA Build Studio"));
  assert.ok(titles.includes("Connected Communications provisioning and billing"));
  assert.ok(titles.includes("Isolated website staging previews"));
});
