import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { renderPdfFirstPage } from "/shared/lib/file-preview.js";
import { openAssetPreview } from "/client-portal/asset-preview-modal.js?v=1";
import { resolveWebsiteUrl } from "/client-portal/website-url.js";

const PRIVATE_BUCKET = "website-assets-private";
const statusScreen = document.getElementById("portal-status");
const logoutButton = document.getElementById("portal-logout");
const websiteSelect = document.getElementById("website-select");
const filesWebsiteSelect = document.getElementById("files-website-select");
const filesWebsiteName = document.getElementById("files-website-name");
const filesLiveLink = document.getElementById("files-live-link");
const portalViewButtons = Array.from(document.querySelectorAll("[data-portal-view]"));
const portalViewPanels = Array.from(document.querySelectorAll("[data-portal-panel]"));
const portalViewOpeners = Array.from(document.querySelectorAll("[data-open-portal-view]"));
const assetToolbar = document.getElementById("asset-toolbar");
const assetGrid = document.getElementById("asset-grid");
const assetFolderList = document.getElementById("client-asset-folders");
const assetSearch = document.getElementById("client-asset-search");
const selectedAssetName = document.getElementById("client-selected-asset-name");
const selectedAssetMeta = document.getElementById("client-selected-asset-meta");
const clientSelectionToolbar = document.getElementById("client-selection-toolbar");
const clientSelectionStatus = document.getElementById("client-selection-status");
const clientClearSelectionButton = document.getElementById("client-clear-selection");
const clientDownloadSelectedButton = document.getElementById("client-download-selected");
const clientCopyLinksButton = document.getElementById("client-copy-links");
const clientDeleteSelectedButton = document.getElementById("client-delete-selected");
const emptyState = document.getElementById("portal-empty");
const uploadForm = document.getElementById("asset-upload-form");
const openUploadButton = document.getElementById("open-upload");
const closeUploadButton = document.getElementById("close-upload");
const uploadAssetId = document.getElementById("upload-asset-id");
const uploadFile = document.getElementById("upload-file");
const uploadLabel = document.getElementById("upload-label");
const uploadKey = document.getElementById("upload-key");
const uploadCategory = document.getElementById("upload-category");
const uploadReplacementType = document.getElementById("upload-replacement-type");
const uploadNote = document.getElementById("upload-note");
const uploadStatus = document.getElementById("upload-status");
const batchReview = document.getElementById("batch-review");
const batchPrevious = document.getElementById("batch-previous");
const batchNext = document.getElementById("batch-next");
const batchPosition = document.getElementById("batch-position");
const uploadSubmit = document.getElementById("upload-submit");
const newAssetFields = Array.from(document.querySelectorAll("[data-new-asset-field]"));

let supabase = null;
let currentSession = null;
let websites = [];
let websiteDomains = [];
let selectedWebsite = null;
let canEditSelectedWebsite = false;
let assets = [];
let versions = [];
let selectedAssetCategory = "";
const selectedClientVersionIds = new Set();
let batchItems = [];
let batchReviewIndex = 0;
let activePortalView = "files";
let toastTimer;
const isAssetsRoute = document.body.classList.contains("client-assets-view")
  || document.body.dataset.portalView === "assets"
  || window.location.pathname.startsWith("/client-portal/assets")
  || new URLSearchParams(window.location.search).get("view") === "files";

function showPortalView(view) {
  const nextView = portalViewPanels.some((panel) => panel.dataset.portalPanel === view) ? view : "files";
  activePortalView = nextView;
  portalViewButtons.forEach((button) => {
    const isCurrent = button.dataset.portalView === nextView;
    button.classList.toggle("is-current", isCurrent);
    button.setAttribute("aria-current", isCurrent ? "page" : "false");
  });
  portalViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.portalPanel !== nextView;
  });
  document.body.classList.toggle("client-files-active", nextView === "files");
  const nextHash = nextView === "files"
    ? "#files-assets"
    : nextView === "support"
      ? "#support"
    : nextView === "new-request"
      ? "#new-project"
      : "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function showStatus(message) {
  if (!statusScreen) return;
  statusScreen.textContent = message;
  statusScreen.hidden = false;
}

function setInlineStatus(message = "", isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("is-error", isError);
}

function showToast(message, type = "success") {
  let toast = document.getElementById("portal-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "portal-toast";
    toast.className = "portal-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  window.clearTimeout(toastTimer);
  toast.className = `portal-toast is-${type} is-visible`;
  toast.innerHTML = `
    <span class="portal-toast-icon" aria-hidden="true">${type === "error" ? "!" : "✓"}</span>
    <span>${escapeHtml(message)}</span>
    <button type="button" aria-label="Dismiss notification">×</button>
  `;
  toast.querySelector("button")?.addEventListener("click", () => toast.classList.remove("is-visible"), { once: true });
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 5000);
}

function openLogin() {
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.replace(`/account?next=${next}`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatLabel(value, fallback = "") {
  const label = String(value || fallback).replaceAll("_", " ").trim();
  return label ? label.replace(/\b\w/g, (character) => character.toUpperCase()) : "";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function assetFileType(version) {
  const extension = String(version?.original_filename || "").split(".").pop()?.toLowerCase() || "";
  const mime = String(version?.mime_type || "").toLowerCase();
  if (mime === "application/pdf" || extension === "pdf") return { label: "PDF", tone: "pdf" };
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg)$/.test(extension)) return { label: "IMG", tone: "image" };
  if (/^(docx?|txt|rtf|md)$/.test(extension)) return { label: "DOC", tone: "document" };
  return { label: (extension || "FILE").slice(0, 4).toUpperCase(), tone: "default" };
}

function assetFilePreviewMarkup(version, type) {
  return `<span class="website-asset-file-type is-${type.tone}" data-version-preview="${version.id}" aria-hidden="true"><img alt="" hidden><canvas hidden></canvas><span>${type.label}</span></span>`;
}

async function hydrateVersionPreviews() {
  const previews = Array.from(assetGrid?.querySelectorAll("[data-version-preview]") || []);
  await Promise.all(previews.map(async (preview) => {
    const version = versions.find((row) => row.id === preview.dataset.versionPreview);
    if (!version) return;
    const type = assetFileType(version);
    if (!['image', 'pdf'].includes(type.tone)) return;
    let url = version.public_url;
    if (!url) {
      const { data, error } = await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 600);
      if (error || !data?.signedUrl) return;
      url = data.signedUrl;
    }
    const image = preview.querySelector("img");
    const canvas = preview.querySelector("canvas");
    const fallback = preview.querySelector(":scope > span");
    if (!url || !preview.isConnected) return;
    if (type.tone === "pdf" && canvas) {
      try {
        await renderPdfFirstPage(url, canvas);
        if (!preview.isConnected) return;
        canvas.hidden = false;
        if (fallback) fallback.hidden = true;
        preview.classList.add("has-preview");
      } catch {
        // Keep the PDF badge when the first page cannot be rendered.
      }
      return;
    }
    if (!image) return;
    image.addEventListener("load", () => {
      if (!preview.isConnected) return;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
      preview.classList.add("has-preview");
    }, { once: true });
    image.src = url;
  }));
}

function assetTableHeader(versionIds = []) {
  const allSelected = versionIds.length > 0 && versionIds.every((id) => selectedClientVersionIds.has(id));
  return `<div class="website-assets-table-head is-selectable"><label class="website-asset-select"><input type="checkbox" data-client-select-all${allSelected ? " checked" : ""} aria-label="Select all files in this folder"></label><span>File</span><span>Status</span><span>Modified</span><span>Size</span><span></span></div>`;
}

function assetCategory(asset) {
  return String(asset?.category || "Uncategorized").trim() || "Uncategorized";
}

function folderLabel(value) {
  const normalized = String(value || "Uncategorized").trim().toLowerCase().replaceAll("_", " ");
  const labels = { image: "Images", images: "Images", brand: "Brand assets", document: "Documents", documents: "Documents", video: "Videos", font: "Fonts", other: "Other files", uncategorized: "Uncategorized" };
  return labels[normalized] || normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugifyFilename(filename) {
  const parts = String(filename || "asset").split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const base = parts.join(".").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
  return `${base}${extension}`;
}

function keyFromLabel(value) {
  const base = String(value || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
  // Keep this aligned with the N3XRA Files uploader and the database rule.
  // Filenames such as "12-roots-relics-logo-light.png" cannot begin an
  // asset key directly because website_assets.asset_key must start with a letter.
  return /^[a-z]/.test(base) ? base : `file-${base}`;
}

function isValidAssetKey(value) {
  return /^[a-z][a-zA-Z0-9._-]*$/.test(String(value || ""));
}

function uniqueAssetKey(preferredKey, reservedKeys = new Set()) {
  const baseKey = String(preferredKey || "asset").trim() || "asset";
  if (!reservedKeys.has(baseKey)) return baseKey;
  let suffix = 2;
  while (reservedKeys.has(`${baseKey}${suffix}`)) suffix += 1;
  return `${baseKey}${suffix}`;
}

function humanizeFilename(filename) {
  const withoutExtension = String(filename || "").replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d+)/g, "$1 $2")
    .replace(/(\d+)([a-zA-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function inferAssetDefaults(file) {
  const filename = String(file?.name || "");
  const searchable = filename.toLowerCase().replace(/\.[^.]+$/, "");
  const mimeType = String(file?.type || "").toLowerCase();
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  let category = mimeType.startsWith("image/") ? "image" : "other";
  let replacementType = mimeType.startsWith("image/") ? "html_src" : "download_only";

  if (mimeType === "application/pdf" || ["pdf", "zip", "txt"].includes(extension)) {
    category = "document";
    replacementType = "download_only";
  } else if (/(social|open.?graph|og.?image|twitter|share)/.test(searchable)) {
    category = "social";
    replacementType = "metadata";
  } else if (/(favicon|apple.?touch|app.?icon|site.?icon)/.test(searchable)) {
    category = "brand";
    replacementType = "metadata";
  } else if (/(logo|wordmark|brandmark)/.test(searchable)) {
    category = "logo";
    replacementType = "html_src";
  } else if (/(background|backdrop|wallpaper|banner)/.test(searchable)) {
    category = "image";
    replacementType = "css_background";
  } else if (/(carousel|slider|slide|gallery)/.test(searchable) || /photo.?0*\d+$/.test(searchable)) {
    category = "image";
    replacementType = "carousel_slide";
  }

  const label = humanizeFilename(filename) || "Website Asset";
  return { label, key: keyFromLabel(label), category, replacementType };
}

function applySuggestion(control, value) {
  if (!control || !value || control.dataset.userEdited === "true") return;
  control.value = value;
  control.dataset.autoValue = value;
}

function saveCurrentBatchItem() {
  const item = batchItems[batchReviewIndex];
  if (!item || uploadAssetId.value) return;
  item.label = uploadLabel.value.trim();
  item.key = uploadKey.value.trim();
  item.category = uploadCategory.value;
  item.replacementType = uploadReplacementType.value;
  item.note = uploadNote.value.trim();
}

function renderBatchItem() {
  const item = batchItems[batchReviewIndex];
  if (!item || uploadAssetId.value) {
    batchReview.hidden = true;
    uploadSubmit.textContent = "Submit for review";
    return;
  }
  clearAutoSuggestions();
  uploadLabel.value = item.label;
  uploadKey.value = item.key;
  uploadCategory.value = item.category;
  uploadReplacementType.value = item.replacementType;
  uploadNote.value = item.note;
  batchReview.hidden = batchItems.length < 2;
  batchPosition.textContent = `Reviewing ${item.file.name} · ${batchReviewIndex + 1} of ${batchItems.length}`;
  batchPrevious.disabled = batchReviewIndex === 0;
  batchNext.disabled = batchReviewIndex === batchItems.length - 1;
  uploadSubmit.textContent = batchItems.length > 1 ? `Submit ${batchItems.length} files for review` : "Submit for review";
}

function prepareSelectedFiles() {
  const files = Array.from(uploadFile.files || []);
  if (!files.length) return;
  if (uploadAssetId.value && files.length > 1) {
    uploadAssetId.value = "";
    syncNewAssetFields();
  }
  if (uploadAssetId.value) {
    batchItems = [];
    batchReview.hidden = true;
    setInlineStatus("This file will be uploaded as a replacement version.");
    return;
  }
  const reservedKeys = new Set(assets.map((asset) => asset.asset_key));
  batchItems = files.map((file) => {
    const defaults = inferAssetDefaults(file);
    defaults.key = uniqueAssetKey(defaults.key, reservedKeys);
    reservedKeys.add(defaults.key);
    return { file, ...defaults, note: "" };
  });
  batchReviewIndex = 0;
  renderBatchItem();
  setInlineStatus(batchItems.length > 1
    ? "Review each file with Previous and Next, then submit the batch."
    : "Suggested details were filled from the filename. You can change any of them.");
}

function moveBatchReview(direction) {
  saveCurrentBatchItem();
  const nextIndex = batchReviewIndex + direction;
  if (nextIndex < 0 || nextIndex >= batchItems.length) return;
  batchReviewIndex = nextIndex;
  renderBatchItem();
}

function clearAutoSuggestions() {
  [uploadLabel, uploadKey, uploadCategory, uploadReplacementType].forEach((control) => {
    delete control.dataset.autoValue;
    delete control.dataset.userEdited;
  });
}

function syncNewAssetFields() {
  const creating = !uploadAssetId.value;
  newAssetFields.forEach((field) => {
    field.hidden = !creating;
  });
  uploadLabel.required = creating;
  uploadKey.required = creating;
}

async function loadWebsites() {
  const [websiteResult, domainResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,slug,live_url,status,website_members(role,status,user_id)").order("name"),
    supabase.from("website_domains").select("website_id,domain_name,is_primary").order("is_primary", { ascending: false }),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;

  websites = websiteResult.data || [];
  websiteDomains = domainResult.data || [];
  websiteSelect.innerHTML = websites.length
    ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("")
    : '<option value="">No websites assigned</option>';
  if (filesWebsiteSelect) filesWebsiteSelect.innerHTML = websiteSelect.innerHTML;

  if (!websites.length) {
    assetToolbar.hidden = true;
    filesWebsiteName.textContent = "No website selected";
    filesLiveLink.hidden = true;
    emptyState.hidden = false;
    emptyState.innerHTML = "<p>No projects are currently assigned to this account.</p>";
    return;
  }

  const context = readWorkspaceContext("client", currentSession.user.id);
  const requestedWebsiteId = new URLSearchParams(window.location.search).get("website") || context.websiteId;
  const initialWebsite = websites.find((website) => website.id === requestedWebsiteId) || websites[0];
  await selectWebsite(initialWebsite.id);
}

async function selectWebsite(websiteId) {
  selectedWebsite = websites.find((website) => website.id === websiteId) || null;
  if (!selectedWebsite) return;

  websiteSelect.value = selectedWebsite.id;
  if (filesWebsiteSelect) filesWebsiteSelect.value = selectedWebsite.id;
  selectedAssetCategory = "";
  selectedClientVersionIds.clear();
  if (assetSearch) assetSearch.value = "";
  const previous = readWorkspaceContext("client", currentSession.user.id);
  writeWorkspaceContext("client", currentSession.user.id, {
    websiteId: selectedWebsite.id,
    name: selectedWebsite.name,
    ...(previous.websiteId && previous.websiteId !== selectedWebsite.id
      ? { projectId: null, requestId: null, proposalId: null, onboardingId: null }
      : {}),
  });
  const { data: canEdit, error: accessError } = await supabase.rpc("can_edit_client_website", {
    target_website_id: selectedWebsite.id,
  });
  if (accessError) throw accessError;
  canEditSelectedWebsite = Boolean(canEdit);

  const websiteUrl = resolveWebsiteUrl(selectedWebsite, websiteDomains);
  filesWebsiteName.textContent = selectedWebsite.name;
  filesLiveLink.href = websiteUrl || "#";
  filesLiveLink.hidden = !websiteUrl;
  assetToolbar.hidden = false;
  openUploadButton.hidden = !canEditSelectedWebsite;
  closeUploadForm();
  await loadAssets();
}

async function loadAssets() {
  assetGrid.innerHTML = "";
  emptyState.hidden = true;

  const { data: assetRows, error: assetError } = await supabase
    .from("website_assets")
    .select("*")
    .eq("website_id", selectedWebsite.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (assetError) throw assetError;
  assets = assetRows || [];

  if (assets.length) {
    const { data: versionRows, error: versionError } = await supabase
      .from("website_asset_versions")
      .select("*")
      .in("asset_id", assets.map((asset) => asset.id))
      .order("version_number", { ascending: false });
    if (versionError) throw versionError;
    versions = versionRows || [];
  } else {
    versions = [];
  }

  uploadAssetId.innerHTML = '<option value="">Add as a new file</option>' +
    assets.map((asset) => `<option value="${asset.id}">${escapeHtml(asset.label)}</option>`).join("");
  syncNewAssetFields();
  renderAssets();
}

function renderAssets() {
  if (!assets.length) {
    assetGrid.innerHTML = "";
    if (assetFolderList) assetFolderList.innerHTML = "";
    selectedAssetCategory = "";
    selectedClientVersionIds.clear();
    if (clientSelectionToolbar) clientSelectionToolbar.hidden = true;
    if (selectedAssetName) selectedAssetName.textContent = "Select a folder";
    if (selectedAssetMeta) selectedAssetMeta.textContent = "Choose a folder from the left.";
    emptyState.hidden = false;
    emptyState.innerHTML = "<p>No files or assets have been added to this website yet.</p>";
    return;
  }

  const categories = [...new Set(assets.map(assetCategory))].sort((left, right) => left.localeCompare(right));
  if (!categories.includes(selectedAssetCategory)) selectedAssetCategory = categories[0];
  const folderAssets = assets.filter((asset) => assetCategory(asset) === selectedAssetCategory);
  const query = String(assetSearch?.value || "").trim().toLowerCase();
  const visibleAssets = folderAssets.filter((asset) => [asset.label, asset.asset_key, asset.category].some((value) => String(value || "").toLowerCase().includes(query)));
  const folderVersions = versions.filter((version) => folderAssets.some((asset) => asset.id === version.asset_id));
  if (selectedAssetName) selectedAssetName.textContent = folderLabel(selectedAssetCategory);
  if (selectedAssetMeta) selectedAssetMeta.textContent = `${folderAssets.length} file${folderAssets.length === 1 ? "" : "s"} · ${folderVersions.length} version${folderVersions.length === 1 ? "" : "s"}`;
  if (assetFolderList) assetFolderList.innerHTML = categories.map((category) => {
    const categoryAssets = assets.filter((asset) => assetCategory(asset) === category);
    return `<button class="website-asset-folder${category === selectedAssetCategory ? " is-current" : ""}" type="button" data-select-category="${escapeHtml(category)}"><span class="website-asset-folder-icon" aria-hidden="true"></span><span><strong>${escapeHtml(folderLabel(category))}</strong><small>${categoryAssets.length} file${categoryAssets.length === 1 ? "" : "s"}</small></span><span class="website-asset-folder-count">${categoryAssets.length}</span></button>`;
  }).join("");
  emptyState.hidden = true;
  const rows = visibleAssets.flatMap((asset) => {
    const assetVersions = versions.filter((version) => version.asset_id === asset.id);
    if (!assetVersions.length) {
      const actions = canEditSelectedWebsite ? `<button type="button" data-replace-asset="${asset.id}">Upload first version</button>` : "";
      const deleteAction = canDeleteEmptyClientAsset(asset, assetVersions) ? `<button class="is-danger" type="button" data-delete-empty-asset="${asset.id}">Delete empty asset</button>` : "";
      const menu = actions || deleteAction ? `<details class="website-asset-actions"><summary aria-label="Actions for ${escapeHtml(asset.label)}">•••</summary><div class="website-asset-action-menu">${actions}${deleteAction}</div></details>` : "<span></span>";
      return [`<article class="website-asset-version is-selectable"><span></span><div class="website-asset-file"><span class="website-asset-file-type" aria-hidden="true">FILE</span><span><strong>${escapeHtml(asset.label)}</strong><small>${escapeHtml(asset.asset_key)} · No versions uploaded</small></span></div><span class="website-asset-status">Empty</span><span class="website-asset-date">—</span><span class="website-asset-size">—</span>${menu}</article>`];
    }
    return assetVersions.map((version, index) => {
      const type = assetFileType(version);
      const replaceAction = canEditSelectedWebsite && index === 0 ? `<button type="button" data-replace-asset="${asset.id}">Upload replacement</button>` : "";
      return `<article class="website-asset-version is-selectable${selectedClientVersionIds.has(version.id) ? " is-selected" : ""}" data-client-selectable-version="${version.id}"><label class="website-asset-select"><input type="checkbox" data-client-select-version="${version.id}"${selectedClientVersionIds.has(version.id) ? " checked" : ""} aria-label="Select ${escapeHtml(version.original_filename)}"></label><div class="website-asset-file">${assetFilePreviewMarkup(version, type)}<span><strong>${escapeHtml(version.original_filename)}</strong><small>${escapeHtml(asset.label)} · Version ${version.version_number}${version.change_note ? ` · ${escapeHtml(version.change_note)}` : ""}</small></span></div><span class="website-asset-status is-${escapeHtml(version.status)}">${escapeHtml(version.status.replaceAll("_", " "))}</span><time datetime="${escapeHtml(version.created_at)}">${formatDate(version.created_at)}</time><span class="website-asset-size">${formatBytes(version.size_bytes) || "—"}</span><details class="website-asset-actions"><summary aria-label="Actions for ${escapeHtml(version.original_filename)}">•••</summary><div class="website-asset-action-menu">${replaceAction}<button type="button" data-download-version="${version.id}">Download</button>${version.public_url ? `<a href="${escapeHtml(version.public_url)}" target="_blank" rel="noopener">Open published file</a>` : ""}${canDeleteClientVersion(asset, version) ? `<button class="is-danger" type="button" data-delete-version="${version.id}">Delete</button>` : ""}</div></details></article>`;
    });
  });
  const visibleVersionIds = visibleAssets.flatMap((asset) => versions.filter((version) => version.asset_id === asset.id).map((version) => version.id));
  assetGrid.innerHTML = assetTableHeader(visibleVersionIds) + (rows.length ? rows.join("") : '<div class="website-assets-empty"><p>No files match this search.</p></div>');
  void hydrateVersionPreviews();
  renderClientSelectionActions();
}

function renderClientSelectionActions() {
  if (!clientSelectionToolbar) return;
  const availableIds = new Set(versions.map((version) => version.id));
  [...selectedClientVersionIds].forEach((id) => { if (!availableIds.has(id)) selectedClientVersionIds.delete(id); });
  const selectedVersions = versions.filter((version) => selectedClientVersionIds.has(version.id));
  const publishedCount = selectedVersions.filter((version) => version.public_url).length;
  const deletableCount = selectedVersions.filter((version) => {
    const asset = assets.find((row) => row.id === version.asset_id);
    return asset && canDeleteClientVersion(asset, version);
  }).length;
  clientSelectionToolbar.hidden = selectedVersions.length === 0;
  clientClearSelectionButton.hidden = selectedVersions.length === 0;
  clientDownloadSelectedButton.hidden = selectedVersions.length === 0;
  clientSelectionStatus.textContent = `${selectedVersions.length} file${selectedVersions.length === 1 ? "" : "s"} selected`;
  clientDownloadSelectedButton.textContent = `Download selected (${selectedVersions.length})`;
  clientCopyLinksButton.hidden = publishedCount === 0;
  clientCopyLinksButton.textContent = `Copy published links (${publishedCount})`;
  clientDeleteSelectedButton.hidden = selectedVersions.length === 0 || deletableCount === 0;
  clientDeleteSelectedButton.textContent = `Delete eligible (${deletableCount})`;
}

function handleClientAssetSelection(event) {
  const selectAll = event.target.closest("[data-client-select-all]");
  const selectVersion = event.target.closest("[data-client-select-version]");
  if (selectAll) {
    assetGrid.querySelectorAll("[data-client-select-version]").forEach((checkbox) => {
      if (selectAll.checked) selectedClientVersionIds.add(checkbox.dataset.clientSelectVersion);
      else selectedClientVersionIds.delete(checkbox.dataset.clientSelectVersion);
    });
    renderAssets();
    return;
  }
  if (!selectVersion) return;
  if (selectVersion.checked) selectedClientVersionIds.add(selectVersion.dataset.clientSelectVersion);
  else selectedClientVersionIds.delete(selectVersion.dataset.clientSelectVersion);
  renderAssets();
}

function canDeleteClientVersion(asset, version) {
  return canEditSelectedWebsite
    && version.uploaded_by_user_id === currentSession?.user?.id
    && ["draft", "pending_review", "rejected"].includes(version.status)
    && !version.public_url
    && !version.published_at
    && asset.current_version_id !== version.id;
}

function canDeleteEmptyClientAsset(asset, assetVersions) {
  return canEditSelectedWebsite
    && asset.created_by_user_id === currentSession?.user?.id
    && !asset.current_version_id
    && assetVersions.length === 0;
}

function openUploadForm(assetId = "", { chooseFile = false } = {}) {
  uploadForm.hidden = false;
  uploadAssetId.value = assetId;
  syncNewAssetFields();
  setInlineStatus("");
  uploadForm.scrollIntoView({ behavior: "smooth", block: "start" });
  if (chooseFile) {
    // Keep the file picker in the original click gesture. Browsers can block
    // delayed programmatic file dialogs after smooth scrolling has started.
    uploadFile.click();
  }
}

function closeUploadForm() {
  uploadForm.hidden = true;
  uploadForm.reset();
  uploadAssetId.value = "";
  batchItems = [];
  batchReviewIndex = 0;
  batchReview.hidden = true;
  clearAutoSuggestions();
  syncNewAssetFields();
  setInlineStatus("");
}

async function uploadReviewedItem(item, existingAsset = null, uploadBatchId = null) {
  const file = item.file;
  let asset = existingAsset;
  let storagePath = "";
  let createdAsset = false;
  if (!asset) {
    const { data, error } = await supabase.from("website_assets").insert({
      id: crypto.randomUUID(),
      website_id: selectedWebsite.id,
      asset_key: item.key,
      label: item.label,
      category: item.category,
      replacement_type: item.replacementType,
      created_by_user_id: currentSession.user.id,
    }).select().single();
    if (error) throw error;
    asset = data;
    createdAsset = true;
  }
  try {
    const { data: nextVersion, error: numberError } = await supabase.rpc("next_website_asset_version_number", { target_asset_id: asset.id });
    if (numberError) throw numberError;
    storagePath = `${selectedWebsite.id}/${asset.id}/v${nextVersion}-${crypto.randomUUID()}-${slugifyFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(PRIVATE_BUCKET)
      .upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (uploadError) throw uploadError;
    const versionRecord = {
      asset_id: asset.id,
      version_number: nextVersion,
      status: "pending_review",
      storage_bucket: PRIVATE_BUCKET,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      change_note: item.note || null,
      uploaded_by_user_id: currentSession.user.id,
      upload_batch_id: uploadBatchId,
    };
    let { error: versionError } = await supabase.from("website_asset_versions").insert(versionRecord);
    if (versionError && /upload_batch_id.+schema cache|column.+upload_batch_id/i.test(versionError.message || "")) {
      delete versionRecord.upload_batch_id;
      ({ error: versionError } = await supabase.from("website_asset_versions").insert(versionRecord));
    }
    if (versionError) throw versionError;
  } catch (error) {
    const cleanupErrors = [];
    if (storagePath) {
      const { error: storageCleanupError } = await supabase.storage.from(PRIVATE_BUCKET).remove([storagePath]);
      if (storageCleanupError) cleanupErrors.push("uploaded file");
    }
    if (createdAsset) {
      const { error: assetCleanupError } = await supabase.from("website_assets").delete().eq("id", asset.id);
      if (assetCleanupError) cleanupErrors.push("empty asset record");
    }
    if (cleanupErrors.length) {
      throw new Error(`${error?.message || "Upload failed."} Automatic cleanup could not remove the ${cleanupErrors.join(" and ")}.`);
    }
    throw error;
  }
}

async function uploadAssetVersion(event) {
  event.preventDefault();
  if (!selectedWebsite || !canEditSelectedWebsite || !uploadFile.files?.[0]) return;
  saveCurrentBatchItem();
  const existingAsset = assets.find((row) => row.id === uploadAssetId.value) || null;
  const items = existingAsset ? [{
    file: uploadFile.files[0],
    note: uploadNote.value.trim(),
  }] : batchItems;
  if (!items.length || (!existingAsset && items.some((item) => !item.label || !item.key))) {
    setInlineStatus("Review every file and provide an asset name and key.", true);
    return;
  }
  const duplicateKey = items.find((item, index) => items.some((other, otherIndex) => otherIndex !== index && other.key === item.key));
  if (duplicateKey) {
    setInlineStatus(`Asset key “${duplicateKey.key}” is used more than once. Give each file a unique key.`, true);
    return;
  }
  const existingKey = !existingAsset
    ? items.find((item) => assets.some((asset) => asset.asset_key === item.key))
    : null;
  if (existingKey) {
    setInlineStatus(`Asset key “${existingKey.key}” already exists. Change the key, or use Replace on the existing asset.`, true);
    return;
  }
  const invalidKey = !existingAsset ? items.find((item) => !isValidAssetKey(item.key)) : null;
  if (invalidKey) {
    setInlineStatus(`Asset key “${invalidKey.key}” for ${invalidKey.file.name} is invalid. Use a key that starts with a letter and contains only letters, numbers, periods, underscores, or hyphens.`, true);
    return;
  }

  uploadSubmit.disabled = true;
  let uploadedCount = 0;
  const uploadBatchId = crypto.randomUUID();
  try {
    for (const item of items) {
      setInlineStatus(`Uploading ${uploadedCount + 1} of ${items.length}: ${item.file.name}`);
      await uploadReviewedItem(item, existingAsset, uploadBatchId);
      uploadedCount += 1;
    }
    setInlineStatus(`${uploadedCount} file${uploadedCount === 1 ? "" : "s"} submitted for review.`);
    await loadAssets();
    window.setTimeout(closeUploadForm, 900);
  } catch (error) {
    if (!existingAsset && uploadedCount) {
      batchItems = items.slice(uploadedCount);
      batchReviewIndex = 0;
      renderBatchItem();
      await loadAssets();
    }
    setInlineStatus(`${uploadedCount ? `${uploadedCount} uploaded. ` : ""}${error?.message || "The remaining files could not be uploaded."}`, true);
  } finally {
    uploadSubmit.disabled = false;
  }
}

async function downloadVersion(versionId) {
  const version = versions.find((row) => row.id === versionId);
  if (!version) return;
  const url = await clientDownloadUrl(version);
  if (url) window.open(url, "_blank", "noopener");
}

async function openClientVersion(versionId) {
  const version = versions.find((row) => row.id === versionId);
  if (!version) return;
  const previewResult = version.public_url
    ? { data: { signedUrl: version.public_url }, error: null }
    : await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 600);
  if (previewResult.error || !previewResult.data?.signedUrl) throw previewResult.error || new Error("A preview link could not be created.");
  const downloadUrl = version.public_url || await clientDownloadUrl(version);
  await openAssetPreview({ name: version.original_filename, mimeType: version.mime_type, url: previewResult.data.signedUrl, downloadUrl, kicker: "Client Files & Assets" });
}

async function clientDownloadUrl(version) {
  if (version.public_url) return version.public_url;
  const { data, error } = await supabase.storage
    .from(version.storage_bucket)
    .createSignedUrl(version.storage_path, 600, { download: version.original_filename });
  if (error) {
    setInlineStatus(error.message || "Unable to create a download link.", true);
    throw error;
  }
  return data.signedUrl;
}

async function downloadSelectedClientFiles() {
  const selectedVersions = versions.filter((version) => selectedClientVersionIds.has(version.id));
  if (!selectedVersions.length) return;
  if (selectedVersions.length > 5 && !window.confirm(`Download ${selectedVersions.length} selected files? Your browser may ask for permission to download multiple files.`)) return;
  clientDownloadSelectedButton.disabled = true;
  clientSelectionStatus.textContent = `Preparing ${selectedVersions.length} downloads…`;
  try {
    const downloads = await Promise.all(selectedVersions.map(async (version) => ({ version, url: await clientDownloadUrl(version) })));
    downloads.forEach(({ version, url }) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = version.original_filename;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    clientSelectionStatus.textContent = `${downloads.length} download${downloads.length === 1 ? "" : "s"} started.`;
  } catch (error) {
    showToast(error?.message || "The selected files could not be downloaded.", "error");
  } finally {
    clientDownloadSelectedButton.disabled = false;
  }
}

async function copySelectedClientLinks() {
  const publishedVersions = versions.filter((version) => selectedClientVersionIds.has(version.id) && version.public_url);
  if (!publishedVersions.length) return;
  const links = publishedVersions.map((version) => {
    const asset = assets.find((row) => row.id === version.asset_id);
    return `${asset?.label || version.original_filename} · v${version.version_number} — ${version.public_url}`;
  }).join("\n");
  try {
    await navigator.clipboard.writeText(links);
    clientSelectionStatus.textContent = `${publishedVersions.length} published link${publishedVersions.length === 1 ? "" : "s"} copied.`;
  } catch {
    showToast("The published links could not be copied. Check this browser’s clipboard permission.", "error");
  }
}

async function deleteSelectedClientFiles() {
  const deletableVersions = versions.filter((version) => {
    if (!selectedClientVersionIds.has(version.id)) return false;
    const asset = assets.find((row) => row.id === version.asset_id);
    return asset && canDeleteClientVersion(asset, version);
  });
  if (!deletableVersions.length) return;
  if (!window.confirm(`Permanently delete ${deletableVersions.length} selected unused upload${deletableVersions.length === 1 ? "" : "s"}? Published and in-use files will not be deleted.`)) return;

  clientDeleteSelectedButton.disabled = true;
  clientSelectionStatus.textContent = `Deleting ${deletableVersions.length} files…`;
  try {
    const ids = new Set(deletableVersions.map((version) => version.id));
    const pathsByBucket = new Map();
    deletableVersions.forEach((version) => {
      const paths = pathsByBucket.get(version.storage_bucket) || [];
      paths.push(version.storage_path);
      pathsByBucket.set(version.storage_bucket, paths);
    });
    for (const [bucket, paths] of pathsByBucket) {
      const { error } = await supabase.storage.from(bucket).remove([...new Set(paths)]);
      if (error) throw error;
    }
    const { error: versionError } = await supabase.from("website_asset_versions").delete().in("id", [...ids]);
    if (versionError) throw versionError;
    const affectedAssets = assets.filter((asset) => deletableVersions.some((version) => version.asset_id === asset.id));
    const emptyAssetIds = affectedAssets
      .filter((asset) => !asset.current_version_id && !versions.some((version) => version.asset_id === asset.id && !ids.has(version.id)))
      .map((asset) => asset.id);
    if (emptyAssetIds.length) {
      const { error: assetError } = await supabase.from("website_assets").delete().in("id", emptyAssetIds);
      if (assetError) throw assetError;
    }
    selectedClientVersionIds.clear();
    showToast(`${deletableVersions.length} unused upload${deletableVersions.length === 1 ? "" : "s"} deleted.`);
    await loadAssets();
  } catch (error) {
    showToast(error?.message || "The selected files could not be deleted.", "error");
  } finally {
    clientDeleteSelectedButton.disabled = false;
  }
}

async function deleteUnusedVersion(versionId) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  if (!version || !asset || !canDeleteClientVersion(asset, version)) {
    showToast("Only your unused, unpublished uploads can be deleted.", "error");
    return;
  }
  if (!window.confirm(`Delete “${version.original_filename}”? This unused upload will be permanently removed.`)) return;

  const { error: storageError } = await supabase.storage.from(version.storage_bucket).remove([version.storage_path]);
  if (storageError) {
    showToast(storageError.message || "The stored file could not be deleted.", "error");
    return;
  }
  const { error: versionError } = await supabase.from("website_asset_versions").delete().eq("id", version.id);
  if (versionError) {
    showToast(versionError.message || "The file record could not be deleted.", "error");
    return;
  }

  const remainingVersions = versions.filter((row) => row.asset_id === asset.id && row.id !== version.id);
  if (!remainingVersions.length && !asset.current_version_id) {
    const { error: assetError } = await supabase.from("website_assets").delete().eq("id", asset.id);
    if (assetError) {
      showToast("The file was deleted, but its empty asset entry could not be removed.", "error");
      await loadAssets();
      return;
    }
  }
  showToast("Unused file deleted.");
  await loadAssets();
}

async function deleteEmptyAsset(assetId) {
  const asset = assets.find((row) => row.id === assetId);
  const assetVersions = versions.filter((row) => row.asset_id === assetId);
  if (!asset || !canDeleteEmptyClientAsset(asset, assetVersions)) {
    showToast("Only your empty, unpublished failed uploads can be deleted.", "error");
    return;
  }
  if (!window.confirm(`Delete the empty failed upload “${asset.label}”? This cannot be undone.`)) return;
  const { error } = await supabase.from("website_assets").delete().eq("id", asset.id);
  if (error) {
    showToast(error.message || "The failed upload could not be deleted.", "error");
    return;
  }
  showToast("Failed upload deleted.");
  await loadAssets();
}

async function initPortal() {
  if (!hasConfig()) {
    document.body.classList.add("portal-denied");
    showStatus("The website portal is not connected yet.");
    return;
  }

  supabase = createBrowserSupabase();
  try {
    currentSession = await getSessionOrNull(supabase);
    if (!currentSession?.user) {
      openLogin();
      return;
    }

    await loadWebsites();
    showPortalView(
      isAssetsRoute || window.location.hash === "#files-assets"
        ? "files"
        : window.location.hash === "#support"
          ? "support"
        : window.location.hash === "#new-project"
          ? "new-request"
          : "files"
    );
    document.body.classList.remove("portal-loading");
    statusScreen.hidden = true;

    websiteSelect.addEventListener("change", () => selectWebsite(websiteSelect.value).catch((error) => showStatus(error.message)));
    filesWebsiteSelect?.addEventListener("change", () => selectWebsite(filesWebsiteSelect.value).catch((error) => showStatus(error.message)));
    portalViewButtons.forEach((button) => {
      button.addEventListener("click", () => showPortalView(button.dataset.portalView));
    });
    portalViewOpeners.forEach((button) => {
      button.addEventListener("click", () => showPortalView(button.dataset.openPortalView));
    });
    window.addEventListener("hashchange", () => {
      if (isAssetsRoute || window.location.hash === "#files-assets") showPortalView("files");
      else if (window.location.hash === "#support") showPortalView("support");
      else if (window.location.hash === "#new-project") showPortalView("new-request");
      else showPortalView("files");
    });
    openUploadButton.addEventListener("click", () => openUploadForm("", { chooseFile: true }));
    closeUploadButton.addEventListener("click", closeUploadForm);
    uploadAssetId.addEventListener("change", () => {
      syncNewAssetFields();
      if (!uploadAssetId.value) prepareSelectedFiles();
      else {
        batchItems = [];
        batchReview.hidden = true;
        uploadSubmit.textContent = "Submit replacement for review";
      }
    });
    uploadFile.addEventListener("change", prepareSelectedFiles);
    batchPrevious.addEventListener("click", () => moveBatchReview(-1));
    batchNext.addEventListener("click", () => moveBatchReview(1));
    uploadLabel.addEventListener("input", () => {
      delete uploadLabel.dataset.autoValue;
      uploadLabel.dataset.userEdited = "true";
      if (!uploadKey.value || uploadKey.value === uploadKey.dataset.autoValue) {
        const suggestedKey = keyFromLabel(uploadLabel.value);
        uploadKey.value = suggestedKey;
        uploadKey.dataset.autoValue = suggestedKey;
      }
    });
    uploadKey.addEventListener("input", () => {
      delete uploadKey.dataset.autoValue;
      uploadKey.dataset.userEdited = "true";
    });
    uploadCategory.addEventListener("change", () => {
      delete uploadCategory.dataset.autoValue;
      uploadCategory.dataset.userEdited = "true";
    });
    uploadReplacementType.addEventListener("change", () => {
      delete uploadReplacementType.dataset.autoValue;
      uploadReplacementType.dataset.userEdited = "true";
    });
    uploadForm.addEventListener("submit", uploadAssetVersion);
    assetGrid.addEventListener("click", async (event) => {
      const selectableRow = event.target.closest("[data-client-selectable-version]");
      if (selectableRow && !event.target.closest("input, label, button, a, summary, details")) {
        try { await openClientVersion(selectableRow.dataset.clientSelectableVersion); }
        catch (error) { showToast(error?.message || "The file could not be opened.", "error"); }
        return;
      }
      const menu = event.target.closest(".website-asset-actions");
      if (event.target.closest(".website-asset-actions > summary")) {
        document.querySelectorAll(".website-asset-actions[open]").forEach((item) => { if (item !== menu) item.removeAttribute("open"); });
      }
      const replaceButton = event.target.closest("[data-replace-asset]");
      const downloadButton = event.target.closest("[data-download-version]");
      const deleteButton = event.target.closest("[data-delete-version]");
      const deleteEmptyButton = event.target.closest("[data-delete-empty-asset]");
      if (replaceButton) openUploadForm(replaceButton.dataset.replaceAsset, { chooseFile: true });
      if (downloadButton) {
        menu?.removeAttribute("open");
        try { await downloadVersion(downloadButton.dataset.downloadVersion); }
        catch (error) { showToast(error?.message || "The file could not be downloaded.", "error"); }
      }
      if (deleteButton) {
        menu?.removeAttribute("open");
        deleteButton.disabled = true;
        try {
          await deleteUnusedVersion(deleteButton.dataset.deleteVersion);
        } finally {
          deleteButton.disabled = false;
        }
      }
      if (deleteEmptyButton) {
        deleteEmptyButton.disabled = true;
        try {
          await deleteEmptyAsset(deleteEmptyButton.dataset.deleteEmptyAsset);
        } finally {
          deleteEmptyButton.disabled = false;
        }
      }
    });
    assetGrid.addEventListener("change", handleClientAssetSelection);
    clientClearSelectionButton?.addEventListener("click", () => {
      selectedClientVersionIds.clear();
      renderAssets();
    });
    clientDownloadSelectedButton?.addEventListener("click", downloadSelectedClientFiles);
    clientCopyLinksButton?.addEventListener("click", copySelectedClientLinks);
    clientDeleteSelectedButton?.addEventListener("click", deleteSelectedClientFiles);
    assetFolderList?.addEventListener("click", (event) => {
      const folder = event.target.closest("[data-select-category]");
      if (!folder) return;
      selectedAssetCategory = folder.dataset.selectCategory;
      selectedClientVersionIds.clear();
      if (assetSearch) assetSearch.value = "";
      renderAssets();
    });
    assetSearch?.addEventListener("input", renderAssets);

    logoutButton?.addEventListener("click", async () => {
      logoutButton.disabled = true;
      await supabase.auth.signOut();
      window.location.replace("/account");
    });

    supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT" || !nextSession?.user) openLogin();
    });
  } catch (error) {
    document.body.classList.add("portal-denied");
    showStatus(error?.message || "The website portal could not be opened.");
  }
}

initPortal();
