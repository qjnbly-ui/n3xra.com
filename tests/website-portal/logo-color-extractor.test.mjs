import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../shared/lib/logo-color-extractor.js", import.meta.url), "utf8");
const { chooseLogoPortalColors, logoPaletteFromPixels } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function pixels(colors) {
  return new Uint8ClampedArray(colors.flatMap(([red, green, blue, alpha = 255, count = 1]) => (
    Array.from({ length: count }, () => [red, green, blue, alpha]).flat()
  )));
}

test("extracts a dark primary and colorful accent from a transparent logo", () => {
  const palette = logoPaletteFromPixels(pixels([
    [10, 12, 14, 255, 40],
    [190, 25, 35, 255, 24],
    [255, 255, 255, 0, 80],
  ]));
  assert.deepEqual(chooseLogoPortalColors(palette), {
    primaryColor: "#000000",
    accentColor: "#c02020",
  });
});

test("ignores opaque near-white backgrounds when reading logo colors", () => {
  const palette = logoPaletteFromPixels(pixels([
    [252, 252, 252, 255, 100],
    [20, 35, 50, 255, 30],
    [230, 145, 20, 255, 12],
  ]));
  assert.equal(palette.some((candidate) => candidate.color === "#ffffff"), false);
  assert.deepEqual(chooseLogoPortalColors(palette), {
    primaryColor: "#202040",
    accentColor: "#e0a020",
  });
});

test("requires two readable and distinct logo colors", () => {
  const palette = logoPaletteFromPixels(pixels([[15, 15, 15, 255, 30]]));
  assert.throws(() => chooseLogoPortalColors(palette), /two sufficiently distinct colors/);
});

test("the portal exposes a saved match-colors action", async () => {
  const [html, admin] = await Promise.all([
    readFile(new URL("../../n3xra-admin/website-portal/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../n3xra-admin/website-portal/website-portal-admin.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="portal-match-logo-colors"[^>]*>Match colors to logo/);
  assert.match(admin, /extractLogoPortalColors\(logoUrl\)/);
  assert.match(admin, /await saveSettings\(\{ success: `Portal colors matched/);
});
