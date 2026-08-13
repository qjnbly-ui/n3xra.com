import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  analyzePortalSetup, choosePortalColors, detectColors, detectFonts, proposedPortalDomain, verifyVercel,
} = require("../../api/_website-portal-setup.js");

function records(overrides = {}) {
  return {
    website: {
      id: "a2f7a988-fc9f-4e54-ad60-889beeb79cd8",
      name: "Roots and Relics",
      slug: "roots-and-relics",
      portal_slug: "roots-and-relics",
      organization_id: "23aed60f-b87c-49e1-8152-f51e5e17db3a",
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
    members: [{ user_id: "client-user", role: "owner", status: "active" }],
    ...overrides,
  };
}

test("portal setup proposes the standard tenant address from the stable portal slug", () => {
  assert.equal(proposedPortalDomain(records()), "roots-and-relics.portal.n3xra.com");
});

test("a saved custom domain remains an optional alias instead of replacing the standard address", async () => {
  const input = records({
    domains: [
      { domain_name: "rootsandrelicsgreenhouse.com", status: "active", is_primary: true, domain_purpose: "website" },
      { domain_name: "studio.rootsandrelicsgreenhouse.com", status: "active", is_primary: false, domain_purpose: "portal" },
    ],
  });
  const result = await analyzePortalSetup(input, { includeRemote: false, portalRootVerified: true });
  assert.equal(result.proposed.portal_domain, "roots-and-relics.portal.n3xra.com");
  assert.equal(result.proposed.management_domain, "studio.rootsandrelicsgreenhouse.com");
  assert.equal(result.connections.find((item) => item.key === "domain").required, false);
});

test("branding detection ignores near-white colors and finds named font families", () => {
  const source = `body{color:#ffffff;background:#17231b;font-family:'Manrope',sans-serif}.hero{color:#b77946;font-family:"Fraunces",serif}.more{border-color:#b77946}`;
  assert.deepEqual(detectColors(source).slice(0, 2), ["#b77946", "#17231b"]);
  assert.deepEqual(detectFonts(source), ["Manrope", "Fraunces"]);
});

test("bright detected accents never become the full portal background", () => {
  assert.deepEqual(choosePortalColors(["#d8b95f", "#a84f32"], {
    primary_color: "#17231b",
    accent_color: "#b77946",
  }), {
    primary_color: "#17231b",
    accent_color: "#d8b95f",
  });
});

test("a readable dark brand color becomes the portal background", () => {
  assert.deepEqual(choosePortalColors(["#d8b95f", "#a84f32", "#1f2d1a"], {
    primary_color: "#17231b",
    accent_color: "#b77946",
  }), {
    primary_color: "#1f2d1a",
    accent_color: "#d8b95f",
  });
});

test("saved custom portal colors stay authoritative over later scans", () => {
  assert.deepEqual(choosePortalColors(["#d8b95f", "#1f2d1a"], {
    primary_color: "#123456",
    accent_color: "#abcdef",
  }), {
    primary_color: "#123456",
    accent_color: "#abcdef",
  });
});

test("quick analysis reuses approved assets and keeps optional integrations non-blocking", async () => {
  const result = await analyzePortalSetup(records(), { includeRemote: false });
  assert.equal(result.proposed.logo_asset_id, "asset-logo");
  assert.equal(result.proposed.portal_domain, "roots-and-relics.portal.n3xra.com");
  assert.equal(result.readiness.activation_ready, false);
  assert.equal(result.connections.find((item) => item.key === "portal_host").state, "attention");
  assert.equal(result.connections.find((item) => item.key === "github").state, "recorded");
  assert.equal(result.connections.find((item) => item.key === "vercel").required, false);
});

test("verified wildcard infrastructure and an active member complete required activation checks", async () => {
  const result = await analyzePortalSetup(records(), { includeRemote: false, portalRootVerified: true });
  assert.equal(result.readiness.activation_ready, true);
});

test("a draft website can be activated for portal testing", async () => {
  const input = records({ website: { ...records().website, status: "draft" } });
  const result = await analyzePortalSetup(input, { includeRemote: false, portalRootVerified: true });
  const websiteConnection = result.connections.find((item) => item.key === "website");
  assert.equal(result.readiness.activation_ready, true);
  assert.equal(websiteConnection.state, "default");
  assert.match(websiteConnection.detail, /portal testing is allowed/);
});

test("a website without an active member cannot be activated", async () => {
  const input = records({ members: [{ user_id: "client-user", role: "owner", status: "revoked" }] });
  const result = await analyzePortalSetup(input, { includeRemote: false, portalRootVerified: true });
  assert.equal(result.readiness.activation_ready, false);
  assert.equal(result.connections.find((item) => item.key === "membership").state, "attention");
});

test("a paused website still blocks portal activation", async () => {
  const input = records({ website: { ...records().website, status: "paused" } });
  const result = await analyzePortalSetup(input, { includeRemote: false, portalRootVerified: true });
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
  assert.match(html, /id="portal-copy-url"/);
  assert.match(html, /id="portal-open-url"/);
  assert.match(html, /id="portal-feature-grid"/);
  assert.match(html, /id="portal-activate"[^>]*disabled/);
  assert.match(script, /activation_ready/);
  assert.match(script, /portal_enabled/);
  assert.match(script, /navigator\.clipboard\.writeText\(address\)/);
  assert.match(script, /https:\/\/\$\{hostname\}\//);
  assert.match(script, /status: sameDomain \? oldDomain\.status : "pending"/);
  assert.match(script, /Authorization: `Bearer \$\{currentSession\.access_token\}`/);
});
