export function safeWebsiteAssetFilename(value = "asset") {
  const parts = String(value).trim().split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = parts.join(".").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
  return `${stem}${extension}`;
}

export function websiteAssetThumbnailUrl(value = "") {
  return String(value || "");
}

export function humanizeWebsiteAssetFilename(filename = "") {
  return String(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d+)/g, "$1 $2")
    .replace(/(\d+)([a-zA-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\s+/g, " ")
    .trim() || "Website Asset";
}

export function websiteAssetKeyFromLabel(value = "") {
  const words = String(value).trim().replace(/[^a-zA-Z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "asset";
  const candidate = words[0].toLowerCase() + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[a-z]/.test(candidate) ? candidate : `asset${candidate[0]?.toUpperCase() || ""}${candidate.slice(1)}`;
}

export function uniqueWebsiteAssetKey(preferredKey, reservedKeys = new Set()) {
  const baseKey = websiteAssetKeyFromLabel(preferredKey || "asset");
  if (!reservedKeys.has(baseKey)) return baseKey;
  let suffix = 2;
  while (reservedKeys.has(`${baseKey}${suffix}`)) suffix += 1;
  return `${baseKey}${suffix}`;
}

export function onboardingCategoryToWebsiteAsset(category = "other") {
  const mappings = {
    logo: { category: "logo", replacementType: "html_src" },
    brand: { category: "brand", replacementType: "html_src" },
    photo: { category: "image", replacementType: "html_src" },
    content: { category: "document", replacementType: "download_only" },
    document: { category: "document", replacementType: "download_only" },
    legal: { category: "document", replacementType: "download_only" },
    other: { category: "other", replacementType: "download_only" },
  };
  return mappings[category] || mappings.other;
}

export function validateWebsiteAssetRename(value, currentFilename = "") {
  const filename = String(value || "").trim();
  if (!filename || filename.length > 255 || /[\\/]/.test(filename) || filename === "." || filename === "..") {
    throw new Error("Enter a filename up to 255 characters without slashes.");
  }
  const currentExtension = String(currentFilename).includes(".") ? String(currentFilename).split(".").pop().toLowerCase() : "";
  const nextExtension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  if (currentExtension !== nextExtension) {
    throw new Error(`Keep the existing ${currentExtension ? `.${currentExtension}` : "extension-free"} file type.`);
  }
  return filename;
}
