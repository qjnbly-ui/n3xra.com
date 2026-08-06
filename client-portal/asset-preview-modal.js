let activePreviewUrl = "";

function ensurePreviewModal() {
  let modal = document.getElementById("website-asset-preview-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "website-asset-preview-modal";
  modal.className = "website-asset-preview-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="website-asset-preview-scrim" data-asset-preview-close></div>
    <section class="website-asset-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="website-asset-preview-title">
      <div class="website-asset-preview-head">
        <div><p class="portal-kicker" id="website-asset-preview-kicker">Files &amp; Assets</p><h2 id="website-asset-preview-title">Preview</h2></div>
        <button class="website-asset-preview-close" type="button" data-asset-preview-close aria-label="Close preview">×</button>
      </div>
      <div class="website-asset-preview-body" id="website-asset-preview-body"></div>
      <div class="website-asset-preview-actions"><button class="portal-button portal-button-secondary" type="button" data-asset-preview-close>Close</button><a class="portal-button" id="website-asset-preview-download" href="#" target="_blank" rel="noreferrer" download>Download</a></div>
    </section>`;
  document.body.append(modal);
  modal.querySelectorAll("[data-asset-preview-close]").forEach((element) => element.addEventListener("click", closeAssetPreview));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeAssetPreview();
  });
  return modal;
}

export function closeAssetPreview() {
  const modal = document.getElementById("website-asset-preview-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("website-asset-preview-open");
  const body = modal.querySelector("#website-asset-preview-body");
  if (body) body.innerHTML = "";
  activePreviewUrl = "";
}

export async function openAssetPreview({ name, mimeType, url, downloadUrl = url, kicker = "Files & Assets" }) {
  const modal = ensurePreviewModal();
  const body = modal.querySelector("#website-asset-preview-body");
  modal.querySelector("#website-asset-preview-title").textContent = name || "Preview";
  modal.querySelector("#website-asset-preview-kicker").textContent = kicker;
  const download = modal.querySelector("#website-asset-preview-download");
  download.href = downloadUrl;
  download.download = name || "download";
  body.innerHTML = '<p class="website-asset-preview-loading">Preparing preview…</p>';
  modal.hidden = false;
  document.body.classList.add("website-asset-preview-open");
  modal.querySelector(".website-asset-preview-close")?.focus();
  activePreviewUrl = url;

  const mime = String(mimeType || "").toLowerCase();
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  const element = (() => {
    if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg)$/.test(extension)) {
      const image = document.createElement("img"); image.src = url; image.alt = name || "File preview"; return image;
    }
    if (mime === "application/pdf" || extension === "pdf") {
      const frame = document.createElement("iframe"); frame.src = url; frame.title = name || "PDF preview"; return frame;
    }
    if (mime.startsWith("video/")) {
      const video = document.createElement("video"); video.src = url; video.controls = true; return video;
    }
    if (mime.startsWith("audio/")) {
      const audio = document.createElement("audio"); audio.src = url; audio.controls = true; return audio;
    }
    return null;
  })();
  if (element) {
    if (activePreviewUrl === url) body.replaceChildren(element);
    return;
  }
  if (mime.startsWith("text/") || /^(txt|md|csv|json|html?|css|js)$/.test(extension)) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Preview unavailable");
      const pre = document.createElement("pre");
      pre.textContent = await response.text();
      if (activePreviewUrl === url) body.replaceChildren(pre);
      return;
    } catch {
      // Fall through to the download message.
    }
  }
  if (activePreviewUrl === url) body.innerHTML = "<p>This file type cannot be previewed here. Use Download to open it.</p>";
}
