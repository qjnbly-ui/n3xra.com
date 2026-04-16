import { createBrowserSupabase, hasConfig } from "./lib/supabase-client.js";

const setupPanel = document.getElementById("embed-setup-panel");
const embedPanel = document.getElementById("embed-panel");
const searchQueryInput = document.getElementById("embed-search-query");
const searchYearSelect = document.getElementById("embed-search-year");
const searchResetButton = document.getElementById("embed-search-reset");
const recordsList = document.getElementById("embed-records-list");
const emptyState = document.getElementById("embed-empty");
const statusEl = document.getElementById("embed-status");
const fileModal = document.getElementById("embed-file-modal");
const fileModalTitle = document.getElementById("embed-file-modal-title");
const fileModalFrame = document.getElementById("embed-file-modal-frame");
const fileModalDownload = document.getElementById("embed-file-modal-download");
const fileModalShare = document.getElementById("embed-file-modal-share");
const fileModalClose = document.getElementById("embed-file-modal-close");

let supabase = null;
let documentsCache = [];
let activeModalDocumentId = null;

function getOrganizationId() {
  return new URLSearchParams(window.location.search).get("org") || "";
}

function setStatus(message, tone = "") {
  statusEl.textContent = message || "";
  statusEl.className = "status";
  if (tone) statusEl.classList.add(tone);
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "Unknown upload date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function snippetFromText(text, query) {
  if (!text) return "No extracted text yet.";
  if (!query) return `${text.slice(0, 220).trim()}${text.length > 220 ? "..." : ""}`;

  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return `${text.slice(0, 220).trim()}${text.length > 220 ? "..." : ""}`;

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + q.length + 120);
  const snippet = text.slice(start, end).trim();
  const relativeIndex = index - start;
  const before = escapeHtml(snippet.slice(0, relativeIndex));
  const match = escapeHtml(snippet.slice(relativeIndex, relativeIndex + q.length));
  const after = escapeHtml(snippet.slice(relativeIndex + q.length));
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

function buildPreviewUrl(doc, signedUrl) {
  const lowerName = String(doc?.original_filename || "").toLowerCase();
  if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
  }
  return signedUrl;
}

function updateYearFilterOptions() {
  const years = Array.from(new Set(documentsCache.map((doc) => String(doc.year || "").trim()).filter(Boolean))).sort((a, b) => Number(b) - Number(a));
  searchYearSelect.innerHTML = '<option value="all">All years</option>';
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    searchYearSelect.append(option);
  });
}

function renderDocuments() {
  const query = searchQueryInput.value.trim().toLowerCase();
  const selectedYear = searchYearSelect.value;

  const filtered = documentsCache.filter((doc) => {
    const yearMatch = selectedYear === "all" || String(doc.year || "") === selectedYear;
    if (!yearMatch) return false;
    if (!query) return true;
    const haystack = `${doc.title || ""} ${doc.original_filename || ""} ${doc.extracted_text || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  recordsList.innerHTML = "";
  show(emptyState, filtered.length === 0);
  emptyState.textContent = query ? "No records match your search." : "No records available.";

  filtered.forEach((doc) => {
    const item = document.createElement("article");
    item.className = "embed-record-card";
    item.innerHTML = `
      <div class="embed-record-main">
        <div class="embed-record-heading">
          <div>
            <p class="doc-title">${escapeHtml(doc.title || doc.original_filename || "Untitled document")}</p>
            <p class="doc-subtitle">${escapeHtml(doc.original_filename || "Unknown file")} · ${doc.year ? `Year ${escapeHtml(doc.year)}` : "No year"}${doc.month ? ` · ${escapeHtml(doc.month)}` : ""} · ${escapeHtml(formatDate(doc.created_at))}</p>
          </div>
          <span class="doc-status">Public</span>
        </div>
        <p class="doc-snippet">${snippetFromText(doc.extracted_text || "", query)}</p>
      </div>
      <div class="embed-record-actions">
        <button class="btn secondary" type="button" data-action="view" data-id="${doc.id}">View</button>
        <button class="btn secondary" type="button" data-action="download" data-id="${doc.id}">Download</button>
        <button class="btn secondary" type="button" data-action="share" data-id="${doc.id}">Share</button>
      </div>
    `;
    recordsList.append(item);
  });
}

async function createSignedUrlForDocument(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60);
  if (error || !data?.signedUrl) {
    setStatus(error?.message || "Unable to create signed URL.", "error");
    return null;
  }

  return { doc, signedUrl: data.signedUrl };
}

async function openFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  activeModalDocumentId = documentId;
  fileModalTitle.textContent = doc.title || doc.original_filename || "File preview";
  fileModalFrame.src = buildPreviewUrl(doc, signedUrl);
  fileModalDownload.href = signedUrl;
  fileModalDownload.setAttribute("download", doc.original_filename || "download");
  fileModal.classList.add("is-open");
  fileModal.setAttribute("aria-hidden", "false");
}

function closeFileModal() {
  fileModal.classList.remove("is-open");
  fileModal.setAttribute("aria-hidden", "true");
  fileModalFrame.src = "";
  activeModalDocumentId = null;
}

async function downloadFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  const link = document.createElement("a");
  link.href = signedUrl;
  link.download = doc.original_filename || "download";
  link.target = "_blank";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function shareFile(documentId) {
  const signed = await createSignedUrlForDocument(documentId);
  if (!signed) return;
  const { doc, signedUrl } = signed;

  if (navigator.share) {
    try {
      await navigator.share({
        title: doc.title || doc.original_filename || "Shared file",
        text: `Shared from Records Database: ${doc.title || doc.original_filename || "File"}`,
        url: signedUrl,
      });
      setStatus("Share sheet opened.", "success");
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(signedUrl);
    setStatus("Share link copied to clipboard.", "success");
    return;
  }

  setStatus("Sharing is not available on this device.", "error");
}

async function handleRecordAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.getAttribute("data-action");
  const id = button.getAttribute("data-id");
  if (!id || !action) return;

  if (action === "view") await openFile(id);
  if (action === "download") await downloadFile(id);
  if (action === "share") await shareFile(id);
}

async function loadDocuments() {
  const organizationId = getOrganizationId();
  if (!organizationId) {
    setStatus("Missing library id for the embedded view.", "error");
    return;
  }

  setStatus("Loading records...");
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, original_filename, storage_path, extracted_text, year, month, created_at")
    .eq("organization_id", organizationId)
    .eq("is_public", true)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(error.message, "error");
    return;
  }

  documentsCache = Array.isArray(data) ? data : [];
  updateYearFilterOptions();
  renderDocuments();
  setStatus(`${documentsCache.length} public record${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(embedPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();

  show(setupPanel, false);
  show(embedPanel, true);
  await loadDocuments();

  searchQueryInput.addEventListener("input", renderDocuments);
  searchYearSelect.addEventListener("change", renderDocuments);
  searchResetButton.addEventListener("click", () => {
    searchQueryInput.value = "";
    searchYearSelect.value = "all";
    renderDocuments();
  });
  recordsList.addEventListener("click", handleRecordAction);
  fileModalClose.addEventListener("click", closeFileModal);
  fileModalShare.addEventListener("click", async () => {
    if (!activeModalDocumentId) return;
    await shareFile(activeModalDocumentId);
  });
  fileModal.addEventListener("click", (event) => {
    if (event.target === fileModal) closeFileModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fileModal.classList.contains("is-open")) {
      closeFileModal();
    }
  });
}

init();
