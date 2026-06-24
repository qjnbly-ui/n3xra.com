import { createBrowserSupabase, getConfig, hasConfig } from "/shared/lib/supabase-client.js";
import { createPublicAppDocumentPdfObjectUrl, getAppDocumentPdfFilename } from "./lib/app-document-pdf.js";
import { buildPreviewUrl } from "./lib/document-links.js";
import { buildDocumentMetadata, getDocumentDisplayTitle } from "./lib/document-presenters.js";
import { closeFilePreviewModal, openFilePreviewModal } from "./lib/file-modal.js";

const setupPanel = document.getElementById("embed-setup-panel");
const embedPanel = document.getElementById("embed-panel");
const libraryNameEl = document.getElementById("embed-library-name");
const embedHeadCopyEl = document.getElementById("embed-head-copy");
const searchQueryInput = document.getElementById("embed-search-query");
const searchYearSelect = document.getElementById("embed-search-year");
const searchResetButton = document.getElementById("embed-search-reset");
const recordsList = document.getElementById("embed-records-list");
const emptyState = document.getElementById("embed-empty");
const statusEl = document.getElementById("embed-status");
const fileModal = document.getElementById("embed-file-modal");
const fileModalTitle = document.getElementById("embed-file-modal-title");
const fileModalFrame = document.getElementById("embed-file-modal-frame");
const fileModalOpenTab = document.getElementById("embed-file-modal-open-tab");
const fileModalDownload = document.getElementById("embed-file-modal-download");
const fileModalClose = document.getElementById("embed-file-modal-close");

let supabase = null;
let documentsCache = [];
let activeModalDocumentId = null;
let activeModalObjectUrl = "";
let resolvedOrganizationId = "";
const DEFAULT_PRIMARY_COLOR = "#176f66";
const DEFAULT_ACCENT_COLOR = "#ea9b3f";

function getRequestedOrganizationId() {
  return new URLSearchParams(window.location.search).get("org") || "";
}

function getRequestedSlug() {
  const fromQuery = new URLSearchParams(window.location.search).get("slug") || "";
  if (fromQuery) return fromQuery;

  const match = window.location.pathname.match(/^\/library\/([^/]+)$/i);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1] || "");
  } catch {
    return match[1] || "";
  }
}

function getResolvedOrganizationId() {
  return resolvedOrganizationId || getRequestedOrganizationId();
}

function getPublicPageUrl() {
  const slug = getRequestedSlug().trim();
  if (slug) {
    return new URL(`/library/${encodeURIComponent(slug)}`, window.location.origin).href;
  }

  const organizationId = getResolvedOrganizationId();
  if (organizationId) {
    const url = new URL("/n3xra-records/embed", window.location.origin);
    url.searchParams.set("org", organizationId);
    return url.href;
  }

  return window.location.href;
}

function getBrandingParam(key) {
  return new URLSearchParams(window.location.search).get(key) || "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function getCustomAccentColor(branding = {}) {
  const raw = String(branding.branded_accent_color || getBrandingParam("accent") || "").trim();
  if (!raw) return "";
  return normalizeHexColor(raw, "");
}

function applyEmbedBranding(branding = {}) {
  const libraryName = String(branding.name || getBrandingParam("name") || "").trim() || "Library records";
  const primaryColor = normalizeHexColor(branding.branded_primary_color || getBrandingParam("primary"), DEFAULT_PRIMARY_COLOR);
  const accentColor = getCustomAccentColor(branding);
  const hasCustomAccent = Boolean(accentColor);

  if (libraryNameEl) libraryNameEl.textContent = libraryName;
  if (embedHeadCopyEl) embedHeadCopyEl.textContent = "Search and files";
  document.title = `${libraryName} | N3XRA Embedded View`;
  document.documentElement.style.setProperty("--teal", primaryColor);
  document.documentElement.style.setProperty("--gold", hasCustomAccent ? accentColor : DEFAULT_ACCENT_COLOR);
  document.documentElement.dataset.embedAccent = hasCustomAccent ? "on" : "off";
}

async function loadEmbedBranding() {
  const organizationId = getRequestedOrganizationId();
  const slug = getRequestedSlug().trim();

  let data = null;
  let error = null;

  if (organizationId && isUuid(organizationId)) {
    const result = await supabase.rpc("get_public_embed_config", {
      input_organization_id: organizationId,
    });
    data = result.data;
    error = result.error;
    resolvedOrganizationId = organizationId;
  } else if (slug) {
    const result = await supabase.rpc("get_public_embed_config_by_slug", {
      input_slug: slug,
    });
    data = result.data;
    error = result.error;
  } else {
    return;
  }

  if (error) return;
  const branding = Array.isArray(data) ? data[0] : null;
  if (!branding) return;
  if (branding.id && isUuid(branding.id)) {
    resolvedOrganizationId = branding.id;
  }
  applyEmbedBranding(branding);
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

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message || fallback : fallback;
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

function getMonthNumber(value) {
  const raw = String(value || "").trim().toLowerCase();
  const monthMap = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ]);

  return monthMap.get(raw) || null;
}

function getDocumentDateScore(doc) {
  const yearRaw = String(doc?.year || "").trim();
  if (!/^(19|20)\d{2}$/.test(yearRaw)) return null;
  return Number.parseInt(yearRaw, 10) * 100 + (getMonthNumber(doc?.month) || 0);
}

function sortDocumentsNewestToOldest(docs) {
  return [...docs].sort((a, b) => {
    const aScore = getDocumentDateScore(a);
    const bScore = getDocumentDateScore(b);

    if (aScore !== bScore) {
      if (aScore === null) return 1;
      if (bScore === null) return -1;
      return bScore - aScore;
    }

    const aCreatedAt = new Date(a.created_at || 0).getTime();
    const bCreatedAt = new Date(b.created_at || 0).getTime();
    return bCreatedAt - aCreatedAt;
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
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("data-id", doc.id);
    item.setAttribute("aria-label", `Open ${doc.title || doc.original_filename || "document"}`);
    item.innerHTML = `
      <div class="embed-record-main">
        <div class="embed-record-heading">
          <div>
            <p class="doc-title">${escapeHtml(getDocumentDisplayTitle(doc))}</p>
            <p class="doc-subtitle">${escapeHtml(buildDocumentMetadata(doc, { includeFilenameIfDifferent: true }))}</p>
          </div>
        </div>
        <p class="doc-snippet">${snippetFromText(doc.extracted_text || "", query)}</p>
      </div>
    `;
    recordsList.append(item);
  });
}

function normalizePublicDocument(doc) {
  const effectiveTitle = String(doc?.effective_title || "").trim();
  const effectiveFilename = String(doc?.effective_original_filename || "").trim();
  const effectiveText = String(doc?.effective_text || "").trim();

  return {
    ...doc,
    source_title: doc?.source_title || doc?.title || "",
    source_original_filename: doc?.source_original_filename || doc?.original_filename || "",
    source_extracted_text: doc?.source_extracted_text || doc?.extracted_text || "",
    title: effectiveTitle || doc?.title || "",
    original_filename: effectiveFilename || doc?.original_filename || "",
    extracted_text: effectiveText || doc?.extracted_text || "",
    has_editable_document: Boolean(doc?.editable_document_id || doc?.has_editable_document),
  };
}

function revokeActiveModalObjectUrl() {
  if (!activeModalObjectUrl) return;
  URL.revokeObjectURL(activeModalObjectUrl);
  activeModalObjectUrl = "";
}

async function openEditablePublicFile(doc) {
  const objectUrl = await createPublicAppDocumentPdfObjectUrl({
    config: getConfig(),
    organizationId: getResolvedOrganizationId(),
    sourceDocumentId: doc.id,
    documentId: doc.editable_document_id,
  });
  revokeActiveModalObjectUrl();
  activeModalObjectUrl = objectUrl;

  const modalDoc = {
    ...doc,
    original_filename: getAppDocumentPdfFilename(doc),
  };

  activeModalDocumentId = doc.id;
  openFilePreviewModal(
    {
      modal: fileModal,
      title: fileModalTitle,
      frame: fileModalFrame,
      downloadLink: fileModalDownload,
      openTabLink: fileModalOpenTab,
    },
    {
      doc: modalDoc,
      previewUrl: objectUrl,
      fallbackUrl: objectUrl,
      downloadUrl: objectUrl,
    }
  );
}

async function fetchPublicFileUrls(documentId, mode = "view") {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (!doc) return null;

  const organizationId = getResolvedOrganizationId();
  const response = await fetch(`/api/public-file?org=${encodeURIComponent(organizationId)}&doc=${encodeURIComponent(documentId)}&mode=${encodeURIComponent(mode)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedUrl) {
    setStatus(String(data?.error || "Unable to access public file."), "error");
    return null;
  }

  return {
    doc,
    signedUrl: data.signedUrl,
    previewUrl: data.previewUrl || buildPreviewUrl(doc, data.signedUrl),
    shareUrl: data.shareUrl || "",
  };
}

async function openFile(documentId) {
  const doc = documentsCache.find((item) => item.id === documentId);
  if (doc?.editable_document_id) {
    setStatus("Opening current document...");
    try {
      await openEditablePublicFile(doc);
      setStatus("");
      return;
    } catch (error) {
      setStatus(getErrorMessage(error, "Unable to open the current document. Opening original file instead."), "error");
    }
  }

  const signed = await fetchPublicFileUrls(documentId, "view");
  if (!signed) return;
  const downloadSigned = await fetchPublicFileUrls(documentId, "download");
  const { doc: signedDoc, previewUrl, signedUrl } = signed;

  activeModalDocumentId = documentId;
  openFilePreviewModal(
    {
      modal: fileModal,
      title: fileModalTitle,
      frame: fileModalFrame,
      downloadLink: fileModalDownload,
      openTabLink: fileModalOpenTab,
    },
    {
      doc: signedDoc,
      previewUrl,
      fallbackUrl: signedUrl,
      downloadUrl: downloadSigned?.signedUrl || signedUrl,
    }
  );
}

function closeFileModal() {
  closeFilePreviewModal({ modal: fileModal, frame: fileModalFrame });
  revokeActiveModalObjectUrl();
  activeModalDocumentId = null;
}

async function handleRecordAction(event) {
  const card = event.target.closest(".embed-record-card[data-id]");
  if (!card) return;
  const id = card.getAttribute("data-id");
  if (!id) return;
  await openFile(id);
}

async function handleRecordKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".embed-record-card[data-id]");
  if (!card) return;
  event.preventDefault();
  const id = card.getAttribute("data-id");
  if (!id) return;
  await openFile(id);
}

async function loadDocuments() {
  const organizationId = getResolvedOrganizationId();
  if (!organizationId) {
    setStatus("Missing library reference for the embedded view.", "error");
    return;
  }
  if (!isUuid(organizationId)) {
    setStatus("Invalid library id format for the embedded view.", "error");
    return;
  }

  setStatus("Loading records...");
  const rpcResult = await supabase.rpc("get_public_embed_documents", {
    input_organization_id: organizationId,
  });

  let data = rpcResult.data;
  let error = rpcResult.error;

  if (error) {
    // Fallback to direct select for older database deployments.
    const fallback = await supabase
      .from("documents")
      .select("id, title, original_filename, storage_path, extracted_text, year, month, created_at")
      .eq("organization_id", organizationId)
      .eq("is_public", true)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    setStatus(error.message, "error");
    return;
  }

  documentsCache = sortDocumentsNewestToOldest((Array.isArray(data) ? data : []).map(normalizePublicDocument));
  updateYearFilterOptions();
  renderDocuments();
  setStatus(`${documentsCache.length} public record${documentsCache.length === 1 ? "" : "s"} loaded.`, "success");
}

async function init() {
  applyEmbedBranding();
  show(setupPanel, !hasConfig());
  show(embedPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();

  show(setupPanel, false);
  show(embedPanel, true);
  await loadEmbedBranding();
  await loadDocuments();

  searchQueryInput.addEventListener("input", renderDocuments);
  searchYearSelect.addEventListener("change", renderDocuments);
  searchResetButton.addEventListener("click", () => {
    searchQueryInput.value = "";
    searchYearSelect.value = "all";
    renderDocuments();
  });
  recordsList.addEventListener("click", handleRecordAction);
  recordsList.addEventListener("keydown", handleRecordKeydown);
  fileModalClose.addEventListener("click", closeFileModal);
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
