import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../client-portal/tenant-context.js", import.meta.url), "utf8");
const tenantContext = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const tenantRow = {
  website_id: "website-a",
  website_name: "Client A",
  website_slug: "client-a",
  portal_theme_id: "classic",
  branding: {
    primary_color: "#17231b",
    accent_color: "#d8b95f",
    logo_url: "https://cdn.example/client-a-logo.png",
    favicon_url: "https://cdn.example/client-a-icon.png",
    website_url: "https://client-a.example/",
    heading_font: "Fraunces",
    body_font: "Manrope",
    powered_by_label: "Powered by N3XRA",
  },
  features: { billing: true },
};

test("the main site and Vercel previews remain unbound workspaces", async () => {
  let calls = 0;
  const supabase = { rpc: async () => { calls += 1; return { data: [], error: null }; } };
  assert.equal((await tenantContext.resolvePortalTenant(supabase, "n3xra.com")).mode, "unbound");
  assert.equal((await tenantContext.resolvePortalTenant(supabase, "preview-123.vercel.app")).mode, "unbound");
  assert.equal(calls, 0);
});

test("a branded hostname resolves and locks website rows to its tenant", async () => {
  const supabase = {
    rpc: async (name, args) => {
      assert.equal(name, "resolve_website_portal");
      assert.deepEqual(args, { portal_hostname: "client-a.portal.n3xra.com" });
      return { data: [tenantRow], error: null };
    },
  };
  const resolution = await tenantContext.resolvePortalTenant(supabase, "Client-A.Portal.N3XRA.com.");
  assert.equal(resolution.mode, "tenant");
  assert.equal(resolution.hostType, "standard");
  assert.deepEqual(
    tenantContext.scopeWebsitesToPortalTenant([{ id: "website-a" }, { id: "website-b" }], resolution),
    [{ id: "website-a" }],
  );
  assert.deepEqual(
    tenantContext.scopeRowsToPortalTenant(
      [{ website_id: "website-a" }, { website_id: "website-b" }],
      resolution,
      (row) => row.website_id,
    ),
    [{ website_id: "website-a" }],
  );
});

test("concurrent portal modules share one hostname verification", async () => {
  let calls = 0;
  const supabase = {
    rpc: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { data: [tenantRow], error: null };
    },
  };
  const results = await Promise.all([
    tenantContext.resolvePortalTenant(supabase, "shared.portal.n3xra.com"),
    tenantContext.resolvePortalTenant(supabase, "shared.portal.n3xra.com"),
    tenantContext.resolvePortalTenant(supabase, "shared.portal.n3xra.com"),
  ]);
  assert.equal(calls, 1);
  assert.ok(results.every((resolution) => resolution.mode === "tenant"));
});

test("a resolved tenant exposes only its client-facing brand identity", () => {
  const identity = tenantContext.portalBrandIdentity({
    mode: "tenant",
    hostname: "client-a.portal.n3xra.com",
    hostType: "standard",
    ...tenantRow,
  });

  assert.deepEqual(identity, {
    websiteName: "Client A",
    logoUrl: "https://cdn.example/client-a-logo.png",
    faviconUrl: "https://cdn.example/client-a-icon.png",
    websiteUrl: "https://client-a.example/",
    primaryColor: "#17231b",
    accentColor: "#d8b95f",
    headingFont: "Fraunces",
    bodyFont: "Manrope",
    poweredByLabel: "Powered by N3XRA",
  });
});

test("an unknown custom hostname fails closed instead of showing another workspace", async () => {
  const supabase = { rpc: async () => ({ data: [], error: null }) };
  const resolution = await tenantContext.resolvePortalTenant(supabase, "unknown.example.com");
  assert.equal(resolution.mode, "not_found");
  assert.deepEqual(tenantContext.scopeWebsitesToPortalTenant([{ id: "website-a" }], resolution), []);
  assert.match(tenantContext.portalTenantEmptyMessage(resolution), /not active/i);
});

test("resolver errors do not fall back to an unbound workspace", async () => {
  const supabase = { rpc: async () => ({ data: null, error: { message: "resolver unavailable" } }) };
  await assert.rejects(
    tenantContext.resolvePortalTenant(supabase, "client-a.portal.n3xra.com"),
    /resolver unavailable/,
  );
});
