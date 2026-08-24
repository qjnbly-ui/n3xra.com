function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(red, green, blue) {
  return srgbChannel(red) * 0.2126 + srgbChannel(green) * 0.7152 + srgbChannel(blue) * 0.0722;
}

function contrast(left, right) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function hex(red, green, blue) {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function quantize(channel) {
  return Math.min(255, Math.round(channel / 32) * 32);
}

export function logoPaletteFromPixels(pixels) {
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 128) continue;
    const rawRed = pixels[index];
    const rawGreen = pixels[index + 1];
    const rawBlue = pixels[index + 2];
    if (rawRed > 244 && rawGreen > 244 && rawBlue > 244) continue;
    const red = quantize(rawRed);
    const green = quantize(rawGreen);
    const blue = quantize(rawBlue);
    const key = `${red},${green},${blue}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return [...buckets.entries()].map(([key, count]) => {
    const [red, green, blue] = key.split(",").map(Number);
    const light = luminance(red, green, blue);
    return {
      color: hex(red, green, blue),
      count,
      chroma: Math.max(red, green, blue) - Math.min(red, green, blue),
      luminance: light,
      whiteContrast: contrast(light, 1),
    };
  }).sort((left, right) => right.count - left.count);
}

export function chooseLogoPortalColors(palette) {
  const usable = palette.filter((candidate) => candidate.whiteContrast >= 4.5);
  if (!usable.length) throw new Error("This logo does not contain a dark color that can support readable portal text.");

  const topCount = usable[0].count;
  const darkNeutral = usable.find((candidate) => candidate.luminance <= 0.12 && candidate.chroma <= 40 && candidate.count >= topCount * 0.08);
  const primary = darkNeutral || usable[0];
  const colorful = palette
    .filter((candidate) => candidate.color !== primary.color && candidate.chroma >= 48 && contrast(candidate.luminance, primary.luminance) >= 3)
    .sort((left, right) => (right.count * (1 + right.chroma / 64)) - (left.count * (1 + left.chroma / 64)))[0];
  const distinct = palette.find((candidate) => candidate.color !== primary.color && contrast(candidate.luminance, primary.luminance) >= 3);
  const accent = colorful || distinct;
  if (!accent) throw new Error("This logo does not contain two sufficiently distinct colors.");
  return { primaryColor: primary.color, accentColor: accent.color };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected published logo could not be analyzed."));
    image.src = url;
  });
}

export async function extractLogoPortalColors(url) {
  const image = await loadImage(url);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestEdge) throw new Error("The selected logo has no readable image dimensions.");
  const scale = Math.min(1, 160 / longestEdge);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not analyze the selected logo.");
  context.drawImage(image, 0, 0, width, height);
  return chooseLogoPortalColors(logoPaletteFromPixels(context.getImageData(0, 0, width, height).data));
}
