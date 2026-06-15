function normalizeProductText(value, fallback = "") {
  return String(value || fallback).trim();
}

function inferProductFromVideo(video, input = {}) {
  const caption = normalizeProductText(video?.caption);
  const transcript = normalizeProductText(video?.transcript);
  const stickers = Array.isArray(video?.stickers) ? video.stickers.join(" ") : "";
  const sourceText = [input.product, caption, stickers, transcript].filter(Boolean).join(" ").slice(0, 4000);

  return {
    name: normalizeProductText(input.product, "Detected product"),
    category: normalizeProductText(input.niche, "TikTok Shop"),
    offer: normalizeProductText(input.goal, "TikTok Shop affiliate sale"),
    confidence: input.product ? "Medium" : sourceText ? "Low" : "Low",
    source: input.product ? "user input" : "transcript inference",
    shopProductId: "",
    productUrl: "",
    claims: [],
    objections: [],
    proofPoints: [],
    ctaPath: "",
    apiReadiness: "No TikTok Shop product ID is attached yet. Official TikTok Shop API enrichment can update this product record when access is available.",
  };
}

async function resolveTikTokShopProduct(_video, _input = {}) {
  // Placeholder for official TikTok Shop API enrichment.
  // Expected future output should match inferProductFromVideo().
  return null;
}

async function resolveProductIntelligence(video, input = {}) {
  const officialProduct = await resolveTikTokShopProduct(video, input);
  if (officialProduct) return officialProduct;
  return inferProductFromVideo(video, input);
}

module.exports = {
  inferProductFromVideo,
  resolveProductIntelligence,
  resolveTikTokShopProduct,
};
