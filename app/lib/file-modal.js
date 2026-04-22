import { getDownloadFilename } from "./document-links.js";
import { getDocumentDisplayTitle } from "./document-presenters.js";

export function openFilePreviewModal(elements, options) {
  const { modal, title, frame, downloadLink, openTabLink } = elements;
  const { doc, previewUrl, fallbackUrl, downloadUrl } = options;

  const resolvedPreviewUrl = previewUrl || fallbackUrl || "";
  const resolvedDownloadUrl = downloadUrl || fallbackUrl || "";

  if (title) title.textContent = getDocumentDisplayTitle(doc) || "File preview";
  if (frame) frame.src = resolvedPreviewUrl;
  if (downloadLink) {
    downloadLink.href = resolvedDownloadUrl;
    downloadLink.setAttribute("download", getDownloadFilename(doc));
  }
  if (openTabLink) {
    openTabLink.href = resolvedPreviewUrl;
  }
  if (modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }
}

export function closeFilePreviewModal(elements) {
  const { modal, frame } = elements;
  if (modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }
  if (frame) frame.src = "";
}
