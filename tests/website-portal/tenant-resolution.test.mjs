import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  hasActiveWebsiteAccess,
  portalSlugFromHostname,
  resolvePortalTenant,
  standardPortalHostname,
} = require("../../api/_website-portal-tenant.js");

function records(overrides = {}) {
  return {
    website: {
      id: "a2f7a988-fc9f-4e54-ad60-889beeb79cd8",
      organization_id: "23aed60f-b87c-49e1-8152-f51e5e17db3a",
      slug: "roots-and-relics",
      portal_slug: "roots-and-relics",
      status: "active",
      portal_enabled: true,
    },
    domains: [],
    ...overrides,
  };
}

test("the standard wildcard hostname resolves one active portal tenant", () => {
  const input = records();
  assert.equal(standardPortalHostname(input.website), "roots-and-relics.portal.n3xra.com");
  assert.equal(portalSlugFromHostname("roots-and-relics.portal.n3xra.com"), "roots-and-relics");
  assert.deepEqual(resolvePortalTenant(input, "roots-and-relics.portal.n3xra.com"), {
    website_id: input.website.id,
    organization_id: input.website.organization_id,
    portal_slug: "roots-and-relics",
    hostname: "roots-and-relics.portal.n3xra.com",
    host_type: "standard",
  });
});

test("an explicitly enabled draft portal resolves for pre-launch testing", () => {
  const input = records({ website: { ...records().website, status: "draft" } });
  assert.equal(resolvePortalTenant(input, "roots-and-relics.portal.n3xra.com")?.website_id, input.website.id);
});

test("unrelated hosts, disabled portals, and paused websites do not resolve", () => {
  assert.equal(resolvePortalTenant(records(), "another-client.portal.n3xra.com"), null);
  assert.equal(resolvePortalTenant(records({ website: { ...records().website, portal_enabled: false } }), "roots-and-relics.portal.n3xra.com"), null);
  assert.equal(resolvePortalTenant(records({ website: { ...records().website, status: "paused" } }), "roots-and-relics.portal.n3xra.com"), null);
});

test("an active custom domain resolves as an alias", () => {
  const input = records({ domains: [{ domain_name: "portal.rootsandrelics.com", domain_purpose: "portal", status: "active" }] });
  assert.equal(resolvePortalTenant(input, "portal.rootsandrelics.com")?.host_type, "custom");
});

test("client access requires an active membership for the resolved website", () => {
  const members = [
    { user_id: "client-a", status: "active" },
    { user_id: "client-b", status: "revoked" },
  ];
  assert.equal(hasActiveWebsiteAccess(members, "client-a"), true);
  assert.equal(hasActiveWebsiteAccess(members, "client-b"), false);
  assert.equal(hasActiveWebsiteAccess(members, "different-client"), false);
  assert.equal(hasActiveWebsiteAccess(members, "platform-admin", true), true);
});
