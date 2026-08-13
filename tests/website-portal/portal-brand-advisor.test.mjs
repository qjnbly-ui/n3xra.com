import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { advisePortalBrand } = require("../../api/_ai-core/portalBrandAdvisor.js");
const { applyGuardedAdvice } = require("../../api/website-portal-setup.js");

function input(overrides = {}) {
  return {
    websiteName: "Example Business",
    currentPrimaryColor: "#17231b",
    currentAccentColor: "#b77946",
    colorCandidates: [
      { value: "#19324a", score: 80, primaryScore: 220, accentScore: 0, evidence: ["--brand-primary: #19324a"] },
      { value: "#e0a33a", score: 60, primaryScore: 0, accentScore: 180, evidence: ["--accent: #e0a33a"] },
    ],
    logoCandidates: [
      { id: "logo-light", label: "Light logo", assetKey: "logo-light", publicUrl: "https://cdn.example/light.png", mimeType: "image/png", score: 260 },
      { id: "logo-dark", label: "Dark logo", assetKey: "logo-dark", publicUrl: "https://cdn.example/dark.png", mimeType: "image/png", score: 120 },
    ],
    ...overrides,
  };
}

test("Groq vision chooses only supplied colors and logo assets", async () => {
  let body;
  const { advice, warnings } = await advisePortalBrand(input(), {
    env: { GROQ_API_KEY: "groq-key" },
    fetcher: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          primary_color: "#19324a",
          accent_color: "#e0a33a",
          logo_asset_id: "logo-light",
          confidence: 0.91,
          reason: "The light full logo has the strongest contrast on the dark brand background.",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(body.model, "qwen/qwen3.6-27b");
  assert.equal(body.messages[0].content.filter((part) => part.type === "image_url").length, 2);
  assert.equal(advice.provider, "groq");
  assert.equal(advice.logoAssetId, "logo-light");
  assert.equal(advice.primaryColor, "#19324a");
  assert.deepEqual(warnings, []);
});

test("invented AI values are discarded", async () => {
  const { advice } = await advisePortalBrand(input(), {
    env: { GROQ_API_KEY: "groq-key" },
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        primary_color: "#123456",
        accent_color: "#abcdef",
        logo_asset_id: "not-a-real-asset",
        confidence: 0.99,
        reason: "Invented result.",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(advice, null);
});

test("OpenAI vision is used when Groq is unavailable", async () => {
  const requested = [];
  const { advice, warnings } = await advisePortalBrand(input(), {
    env: {
      GROQ_API_KEY: "groq-key",
      OPENAI_API_KEY: "openai-key",
      OPENAI_PORTAL_VISION_MODEL: "openai-vision-model",
    },
    fetcher: async (url) => {
      requested.push(String(url));
      if (String(url).includes("groq.com")) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        primary_color: "#19324a",
        accent_color: "#e0a33a",
        logo_asset_id: "logo-light",
        confidence: 0.85,
        reason: "The full light logo is readable and the colors match named brand tokens.",
      }) }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(requested.length, 2);
  assert.match(requested[1], /api\.openai\.com/);
  assert.equal(advice.provider, "openai");
  assert.equal(warnings.length, 1);
});

test("at most five approved logo images are sent to vision analysis", async () => {
  const logos = Array.from({ length: 7 }, (_, index) => ({
    id: `logo-${index}`,
    label: `Logo ${index}`,
    assetKey: `logo-${index}`,
    publicUrl: `https://cdn.example/logo-${index}.png`,
    mimeType: "image/png",
    score: 100 - index,
  }));
  let imageCount = 0;
  await advisePortalBrand(input({ logoCandidates: logos }), {
    env: { GROQ_API_KEY: "groq-key" },
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      imageCount = body.messages[0].content.filter((part) => part.type === "image_url").length;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        primary_color: "#19324a",
        accent_color: "#e0a33a",
        logo_asset_id: "logo-0",
        confidence: 0.9,
        reason: "Best full logo.",
      }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(imageCount, 5);
});

test("saved Roots and Relics branding remains authoritative during AI refresh", () => {
  const result = {
    proposed: { primary_color: "#17231b", accent_color: "#d8b95f", logo_asset_id: "roots-light" },
    discovery: {
      color_candidates: [
        { value: "#19324a" },
        { value: "#e0a33a" },
      ],
      logo_candidates: [
        { id: "roots-light" },
        { id: "different-logo" },
      ],
    },
  };
  const records = {
    branding: {
      primary_color: "#17231b",
      accent_color: "#d8b95f",
      logo_asset_id: "roots-light",
    },
  };
  const meta = applyGuardedAdvice(result, records, {
    primaryColor: "#19324a",
    accentColor: "#e0a33a",
    logoAssetId: "different-logo",
    confidence: 0.99,
    reason: "Alternative recommendation.",
    provider: "groq",
    model: "qwen/qwen3.6-27b",
  });

  assert.equal(meta.protected_saved_colors, true);
  assert.equal(meta.protected_saved_logo, true);
  assert.deepEqual(result.proposed, {
    primary_color: "#17231b",
    accent_color: "#d8b95f",
    logo_asset_id: "roots-light",
  });
});
