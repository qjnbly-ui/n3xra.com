export function getDocumentDisplayTitle(doc) {
  return String(doc?.title || doc?.original_filename || "Untitled document").trim() || "Untitled document";
}

export function formatDocumentDate(value, withTime = false) {
  if (!value) return "Unknown upload date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function stripFileExtension(filename) {
  return String(filename || "").replace(/\.[^.]+$/, "").trim();
}

export function buildDocumentMetadata(doc, options = {}) {
  const {
    includeFilename = true,
    includeFilenameIfDifferent = false,
    includeYear = true,
    includeYearLabel = false,
    includeMonth = true,
    includeVisibility = false,
    includeCreatedAt = true,
    createdAtWithTime = false,
  } = options;

  const title = String(doc?.title || "").trim();
  const filename = String(doc?.original_filename || "").trim();
  const filenameBase = stripFileExtension(filename);
  const filenameDiffers = Boolean(filename && filenameBase && filenameBase.toLowerCase() !== title.toLowerCase());

  const parts = [];

  if (includeFilename) {
    if (!includeFilenameIfDifferent || filenameDiffers) {
      if (filename) parts.push(filename);
    }
  }

  if (includeYear && doc?.year) {
    parts.push(includeYearLabel ? `Year ${String(doc.year).trim()}` : String(doc.year).trim());
  }

  if (includeMonth && doc?.month) {
    parts.push(String(doc.month).trim());
  }

  if (includeVisibility) {
    parts.push(doc?.is_public ? "Public" : "Private");
  }

  if (includeCreatedAt) {
    parts.push(formatDocumentDate(doc?.created_at, createdAtWithTime));
  }

  return parts.filter(Boolean).join(" · ");
}
