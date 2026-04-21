export function getDownloadFilename(docOrFilename) {
  if (typeof docOrFilename === "string") {
    return String(docOrFilename || "").trim() || "download";
  }

  return String(docOrFilename?.original_filename || "").trim() || "download";
}

export function buildPreviewUrl(docOrFilename, signedUrl) {
  const originalFilename = typeof docOrFilename === "string"
    ? docOrFilename
    : docOrFilename?.original_filename;
  const lowerName = String(originalFilename || "").toLowerCase();

  if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
  }

  return signedUrl;
}
