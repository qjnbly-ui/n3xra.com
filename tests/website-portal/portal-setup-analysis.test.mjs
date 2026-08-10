import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  analyzePortalSetup, detectColors, detectFonts, proposedPortalDomain, verifyVercel,
} = require("../../api/_website-portal-setup.js");

function records(overrides = {}) {
  return {
    website: {
      id: "a2f7a988-fc9f-4e54-ad60-889beeb79cd8",
      name: "Roots and Relics",
      slug: "roots-and-relics",
      status: "active",
      live_url: "https://rootsandrelicsgreenhouse.com/",
      repository_full_name: "qjnbly-ui/rootsandrelicsgreenhouse.com",
      portal_enabled: false,
      portal_theme_id: "classic",
    },
    domains: [{ domain_name: "rootsandrelicsgreenhouse.com", status: "active", is_primary: true, domain_purpose: "website" }],
    repositories: [],
    services: [],
    assets: [{ id: "asset-logo", asset_key: "brand.logo", label: "Main logo", category: "logo", status: "active", current_version_id: "version-logo" }],
    versions: [{ id: "version-logo", public_url: "https://cdn.example/logo.png", mime_type: "image/png" }],
    branding: null,
    features: [],
    ...overrides,
  };
}

test("portal setup proposes a management subdomain from the primary website domain", () => {
  assert.equal(proposedPortalDomain(records()), "manage.rootsandrelicsgreenhouse.com");
});

test("saved portal domains take precedence over generated domains", () => {
  const input = records({
    domains: [
      { domain_name: "rootsandrelicsgreenhouse.com", status: "active", is_primary: true, domain_purpose: "website" },
      { domain_name: "studio.rootsandrelicsgreenhouse.com", status: "active", is_primary: false, domain_purpose: "portal" },
    ],
  });
  assert.equal(proposedPortalDomain(input), "studio.rootsandrelicsgreenhouse.com");
});

test("branding detection ignores near-white colors and finds named font families", () => {
  const source = `body{color:#ffffff;background:#17231b;font-family:'Manrope',sans-serif}.hero{color:#b77946;font-family:"Fraunces",serif}.more{border-color:#b77946}`;
  assert.deepEqual(detectColors(source).slice(0, 2), ["#b77946", "#17231b"]);
  assert.deepEqual(detectFonts(source), ["Manrope", "Fraunces"]);
});

test("quick analysis reuses approved assets and keeps optional integrations non-blocking", async () => {
  const result = await analyzePortalSetup(records(), { includeRemote: false });
  assert.equal(result.proposed.logo_asset_id, "asset-logo");
  assert.equal(result.proposed.management_domain, "manage.rootsandrelicsgreenhouse.com");
  assert.equal(result.readiness.activation_ready, false);
  assert.equal(result.connections.find((item) => item.key === "github").state, "recorded");
  assert.equal(result.connections.find((item) => item.key === "vercel").required, false);
});

test("an active management domain completes the required activation checks", async () => {
  const input = records({
    domains: [
      { domain_name: "rootsandrelicsgreenhouse.com", status: "active", is_primary: true, domain_purpose: "website" },
      { domain_name: "manage.rootsandrelicsgreenhouse.com", status: "active", is_primary: false, domain_purpose: "portal" },
    ],
  });
  const result = await analyzePortalSetup(input, { includeRemote: false });
  assert.equal(result.readiness.activation_ready, true);
});

test("an inactive website blocks portal activation", async () => {
  const input = records({ website: { ...records().website, status: "paused" } });
  const result = await analyzePortalSetup(input, { includeRemote: false });
  assert.equal(result.readiness.activation_ready, false);
});

test("Vercel verification matches the connected GitHub repository to a deployed project", async () => {
  let requestedUrl = "";
  let authorization = "";
  const result = await verifyVercel(
    records(),
    { provider: "github", full_name: "qjnbly-ui/rootsandrelicsgreenhouse.com" },
    {
      vercelToken: "test-token",
      teamId: "team_123",
      fetchImpl: async (url, options) => {
        requestedUrl = String(url);
        authorization = options.headers.Authorization;
        return {
          ok: true,
          json: async () => ({
            projects: [{
              id: "prj_123",
              name: "roots-and-relics",
              framework: "other",
              live: true,
              link: { org: "qjnbly-ui", repo: "rootsandrelicsgreenhouse.com" },
            }],
          }),
        };
      },
    },
  );

  assert.equal(result.verified, true);
  assert.equal(result.name, "roots-and-relics");
  assert.equal(result.framework, "other");
  assert.match(requestedUrl, /\/v9\/projects\?teamId=team_123&limit=100$/);
  assert.equal(authorization, "Bearer test-token");
});

test("portal interface keeps setup, overrides, feature permissions, and activation separate", async () => {
  const html = await readFile(new URL("../../n3xra-admin/website-portal/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../../n3xra-admin/website-portal/website-portal-admin.js", import.meta.url), "utf8");
  assert.match(html, /id="portal-auto-configure"/);
  assert.match(html, /id="portal-connection-list"/);
  assert.match(html, /id="portal-customize"/);
  assert.match(html, /id="portal-feature-grid"/);
  assert.match(html, /id="portal-activate"[^>]*disabled/);
  assert.match(script, /activation_ready/);
  assert.match(script, /portal_enabled/);
  assert.match(script, /status: sameDomain \? oldDomain\.status : "pending"/);
  assert.match(script, /Authorization: `Bearer \$\{currentSession\.access_token\}`/);
});
