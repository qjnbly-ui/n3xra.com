const titleEl = document.getElementById("shared-document-title");
const metaEl = document.getElementById("shared-document-meta");
const errorEl = document.getElementById("shared-document-error");
const frameWrap = document.getElementById("shared-document-frame-wrap");
const frameEl = document.getElementById("shared-document-frame");
const downloadLink = document.getElementById("shared-document-download");
const printButton = document.getElementById("shared-document-print");
const accountLink = document.getElementById("shared-document-account-link");

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setError(message) {
  if (titleEl) titleEl.textContent = "Document unavailable";
  if (metaEl) metaEl.textContent = "";
  if (errorEl) {
    errorEl.innerHTML = `<strong>Unable to open this shared document.</strong> ${message || "The link may be invalid."}`;
  }
  show(errorEl, true);
  show(frameWrap, false);
  show(downloadLink, false);
  show(printButton, false);
}

function getToken() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

async function loadSharedDocument() {
  const token = getToken().trim();
  if (!token) {
    setError("The share token is missing.");
    return;
  }

  try {
    const response = await fetch(`/api/shared-document?token=${encodeURIComponent(token)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "The shared document could not be loaded.");
    }

    const title = payload?.title || "Shared document";
    const organizationName = payload?.organizationName || "N3XRA Records";
    const pdfUrl = payload?.pdfUrl || `/api/shared-document-pdf?token=${encodeURIComponent(token)}&mode=view`;
    const downloadUrl = payload?.downloadUrl || `/api/shared-document-pdf?token=${encodeURIComponent(token)}&mode=download`;

    document.title = `${title} | N3XRA Records`;
    if (titleEl) titleEl.textContent = title;
    if (metaEl) metaEl.textContent = `${organizationName} shared this PDF document.`;
    if (frameEl) frameEl.src = pdfUrl;
    if (downloadLink) downloadLink.href = downloadUrl;
    show(errorEl, false);
    show(frameWrap, true);
    show(downloadLink, true);
    show(printButton, true);
  } catch (error) {
    setError(error?.message || "The shared document could not be loaded.");
  }
}

printButton?.addEventListener("click", () => {
  try {
    frameEl?.contentWindow?.focus();
    frameEl?.contentWindow?.print();
  } catch {
    window.open(frameEl?.src || "", "_blank", "noopener");
  }
});

accountLink?.addEventListener("click", (event) => {
  const token = getToken().trim();
  if (!token) return;
  event.preventDefault();
  const url = new URL("/account", window.location.origin);
  url.searchParams.set("next", `/n3xra-records/shared-document?token=${encodeURIComponent(token)}`);
  window.location.href = url.href;
});

loadSharedDocument();
