import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  analyzePortalSetup, choosePortalColors, detectColorCandidates, detectColors, detectFonts, projectMatchesWebsite, proposedPortalDomain, verifyVercel,
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

test("portal setup keeps the public counter separate and defaults it off", async () => {
  const defaultResult = await analyzePortalSetup(records(), { includeRemote: false });
  assert.deepEqual(defaultResult.proposed.public_counter, {
    enabled: false,
    metric: "all_time_pageviews",
    label: "Website visits",
    public_key: null,
  });
  const savedResult = await analyzePortalSetup(records({
    publicCounter: { enabled: true, metric: "daily_visitors", label: "Visitors today", public_key: "a2f7a988-fc9f-4e54-ad60-889beeb79cd8" },
  }), { includeRemote: false });
  assert.equal(savedResult.proposed.public_counter.enabled, true);
  assert.equal(savedResult.proposed.public_counter.metric, "daily_visitors");
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
  assert.deepEqual(new Set(detectColors(source).slice(0, 2)), new Set(["#17231b", "#b77946"]));
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

test("a dark portal background automatically prefers a light logo variant", async () => {
  const input = records({
    assets: [
      { id: "logo-dark", asset_key: "brand.logo-dark", label: "Logo Dark", category: "logo", status: "active", current_version_id: "version-dark" },
      { id: "logo-light", asset_key: "brand.logo-light", label: "Logo Light", category: "logo", status: "active", current_version_id: "version-light" },
    ],
    versions: [
      { id: "version-dark", public_url: "https://cdn.example/logo-dark.png", mime_type: "image/png" },
      { id: "version-light", public_url: "https://cdn.example/logo-light.png", mime_type: "image/png" },
    ],
  });
  const result = await analyzePortalSetup(input, { includeRemote: false });
  assert.equal(result.proposed.logo_asset_id, "logo-light");
});

test("a light portal background automatically prefers a dark logo variant", async () => {
  const input = records({
    branding: { primary_color: "#f4f0e7", accent_color: "#536a2c" },
    assets: [
      { id: "logo-dark", asset_key: "brand.logo-dark", label: "Logo Dark", category: "logo", status: "active", current_version_id: "version-dark" },
      { id: "logo-light", asset_key: "brand.logo-light", label: "Logo Light", category: "logo", status: "active", current_version_id: "version-light" },
    ],
    versions: [
      { id: "version-dark", public_url: "https://cdn.example/logo-dark.png", mime_type: "image/png" },
      { id: "version-light", public_url: "https://cdn.example/logo-light.png", mime_type: "image/png" },
    ],
  });
  const result = await analyzePortalSetup(input, { includeRemote: false });
  assert.equal(result.proposed.logo_asset_id, "logo-dark");
});

test("a partially customized saved palette is protected as one intentional pair", () => {
  assert.deepEqual(choosePortalColors(["#ef7b2d", "#102a43"], {
    primary_color: "#17231b",
    accent_color: "#d8b95f",
  }), {
    primary_color: "#17231b",
    accent_color: "#d8b95f",
  });
});

test("semantic CSS variables outrank repeated utility colors", () => {
  const source = `
    <meta name="theme-color" content="#123f5a">
    :root { --brand-primary: #123f5a; --brand-accent: #f2a23a; --surface: #f4f4f4; --line: #888888; }
    .cards { color:#888888; border-color:#888888; box-shadow:0 1px 2px #888888; }
    .hero { background-color:var(--brand-primary); color:var(--brand-accent); }
  `;
  const detected = detectColorCandidates(source);
  assert.equal(detected[0].value, "#123f5a");
  assert.equal(detected[1].value, "#f2a23a");
  assert.deepEqual(choosePortalColors(detected, {
    primary_color: "#17231b",
    accent_color: "#b77946",
  }), {
    primary_color: "#123f5a",
    accent_color: "#f2a23a",
  });
});

test("modern RGB and HSL brand tokens are normalized into exact hex colors", () => {
  const detected = detectColorCandidates(`:root {
    --brand-primary: rgb(18 63 90);
    --brand-accent: hsl(36 88% 59%);
    --surface: rgba(250, 250, 250, 0.9);
  }`);
  assert.deepEqual(choosePortalColors(detected, {
    primary_color: "#17231b",
    accent_color: "#b77946",
  }), {
    primary_color: "#123f5a",
    accent_color: "#f2a93a",
  });
});

test("descriptive green and lime variables produce an outdoor brand palette", () => {
  const detected = detectColorCandidates(`:root { --green: #536a2c; --green-dark: #293719; --lime: #c6da63; --cream: #f4f0e7; }`);
  assert.deepEqual(choosePortalColors(detected, {
    primary_color: "#17231b",
    accent_color: "#b77946",
  }), {
    primary_color: "#293719",
    accent_color: "#c6da63",
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

test("Vercel verification treats an unpaused project as available even when the project live flag is false", async () => {
  const result = await verifyVercel(records(), { provider: "github", full_name: "qjnbly-ui/rootsandrelicsgreenhouse.com" }, {
    vercelToken: "test-token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ projects: [{ id: "prj_123", name: "roots-and-relics", live: false, paused: false, link: { org: "qjnbly-ui", repo: "rootsandrelicsgreenhouse.com" } }] }),
    }),
  });
  assert.equal(result.verified, true);
  assert.equal(result.live, true);
});

test("Vercel verification reports a paused project as unavailable", async () => {
  const result = await verifyVercel(records(), { provider: "github", full_name: "qjnbly-ui/rootsandrelicsgreenhouse.com" }, {
    vercelToken: "test-token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ projects: [{ id: "prj_123", name: "roots-and-relics", live: true, paused: true, link: { org: "qjnbly-ui", repo: "rootsandrelicsgreenhouse.com" } }] }),
    }),
  });
  assert.equal(result.live, false);
});

test("Vercel discovery can match a managed website by its production hostname", () => {
  assert.equal(projectMatchesWebsite({
    name: "rootsandrelicsgreenhouse-com",
    targets: { production: { alias: ["www.rootsandrelicsgreenhouse.com", "rootsandrelicsgreenhouse.com"] } },
  }, { live_url: "https://www.rootsandrelicsgreenhouse.com/" }), true);
  assert.equal(projectMatchesWebsite({ name: "another-project" }, { live_url: "https://www.rootsandrelicsgreenhouse.com/" }), false);
});

test("portal interface keeps setup, overrides, feature permissions, and activation separate", async () => {
  const html = await readFile(new URL("../../n3xra-admin/website-portal/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../../n3xra-admin/website-portal/website-portal-admin.js", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../../n3xra-admin/website-admin-workspace.js", import.meta.url), "utf8");
  const workspaceStyles = await readFile(new URL("../../n3xra-admin/website-admin.css", import.meta.url), "utf8");
  assert.match(html, /id="portal-auto-configure"/);
  assert.match(html, /id="portal-connection-list"/);
  assert.match(html, /id="portal-customize"/);
  assert.match(html, /id="portal-logo-picker"/);
  assert.match(html, /id="portal-logo-asset" type="hidden"/);
  assert.match(html, /id="portal-favicon-picker"/);
  assert.match(html, /id="portal-favicon-asset" type="hidden"/);
  assert.match(html, /id="portal-asset-dialog"/);
  assert.match(html, /id="portal-copy-url"/);
  assert.match(html, /id="portal-open-url"/);
  assert.match(html, /id="portal-feature-grid"/);
  assert.match(html, /id="portal-feature-save-state"/);
  assert.match(html, /id="portal-public-counter-details"[^>]*hidden/);
  assert.doesNotMatch(html, /id="portal-save-features"|id="portal-save-public-counter"/);
  assert.match(html, /id="portal-activate"[^>]*disabled/);
  assert.match(script, /activation_ready/);
  assert.match(script, /portal_enabled/);
  assert.match(script, /navigator\.clipboard\.writeText\(address\)/);
  assert.match(script, /data-portal-asset-choice/);
  assert.match(script, /openPortalAssetDialog/);
  assert.match(script, /portalAssetChoices = result\.assets\.filter\(\(asset\) => asset\.category === "logo"/);
  assert.match(script, /safeAssetUrl\(asset\.public_url\)/);
  assert.match(script, /asset\.category === "logo"/);
  assert.match(script, /website-portal-logo-name/);
  assert.doesNotMatch(script, /likelyLogos/);
  assert.match(script, /https:\/\/\$\{hostname\}\//);
  assert.match(script, /status: sameDomain \? oldDomain\.status : "pending"/);
  assert.match(script, /Authorization: `Bearer \$\{currentSession\.access_token\}`/);
  assert.doesNotMatch(script, /void analyze\(\{ includeRemote: true/);
  assert.match(script, /portal-refresh-analysis[\s\S]*analyze\(\{ includeRemote: true \}\)/);
  assert.match(script, /restoreAdminScrollPosition/);
  assert.match(script, /queueAccessSave/);
  assert.match(script, /Portal visibility settings saved automatically/);
  assert.match(script, /scrollRegion\.scrollTo\(\{ top: Math\.max\(0, targetTop\), behavior: "smooth" \}\)/);
  assert.doesNotMatch(script, /portal-customize"\)\.scrollIntoView/);
  assert.match(workspace, /document\.documentElement\.classList\.add\("website-admin-root"\)/);
  assert.match(workspace, /window\.scrollTo\(0, 0\)/);
  assert.match(workspaceStyles, /html\.website-admin-root \{ height:100%; overflow:hidden;/);
});
