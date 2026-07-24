import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const PRIVATE_BUCKET = "website-assets-private";
const statusScreen = document.getElementById("portal-status");
const logoutButton = document.getElementById("portal-logout");
const websiteSelect = document.getElementById("website-select");
const websiteSummary = document.getElementById("website-summary");
const websiteName = document.getElementById("website-name");
const websiteRole = document.getElementById("website-role");
const websiteStatus = document.getElementById("website-status");
const websiteDomain = document.getElementById("website-domain");
const websiteLiveLink = document.getElementById("website-live-link");
const filesWebsiteName = document.getElementById("files-website-name");
const filesLiveLink = document.getElementById("files-live-link");
const portalViewButtons = Array.from(document.querySelectorAll("[data-portal-view]"));
const portalViewPanels = Array.from(document.querySelectorAll("[data-portal-panel]"));
const portalViewOpeners = Array.from(document.querySelectorAll("[data-open-portal-view]"));
const assetToolbar = document.getElementById("asset-toolbar");
const assetGrid = document.getElementById("asset-grid");
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
let selectedWebsite = null;
let selectedRole = "";
let canEditSelectedWebsite = false;
let assets = [];
let versions = [];
let batchItems = [];
let batchReviewIndex = 0;
let activePortalView = "overview";
let toastTimer;
const isAssetsRoute = document.body.classList.contains("client-assets-view")
  || document.body.dataset.portalView === "assets"
  || window.location.pathname.startsWith("/client-portal/assets")
  || new URLSearchParams(window.location.search).get("view") === "files";

function showPortalView(view) {
  const nextView = portalViewPanels.some((panel) => panel.dataset.portalPanel === view) ? view : "overview";
  activePortalView = nextView;
  portalViewButtons.forEach((button) => {
    const isCurrent = button.dataset.portalView === nextView;
    button.classList.toggle("is-current", isCurrent);
    button.setAttribute("aria-current", isCurrent ? "page" : "false");
  });
  portalViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.portalPanel !== nextView;
  });
  const nextHash = nextView === "files"
    ? "#files-assets"
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

function displayHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return String(value);
  }
}

function formatLabel(value, fallback = "") {
  const label = String(value || fallback).replaceAll("_", " ").trim();
  return label ? label.replace(/\b\w/g, (character) => character.toUpperCase()) : "";
}

function formatAccessRole(value) {
  const normalized = String(value || "").toLowerCase().replaceAll("_", " ").trim();
  const labels = {
    "platform admin": "Full access",
    owner: "Owner",
    manager: "Manager",
    editor: "Editor",
    viewer: "View only",
  };
  return labels[normalized] || formatLabel(normalized, "Website access");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function slugifyFilename(filename) {
  const parts = String(filename || "asset").split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const base = parts.join(".").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
  return `${base}${extension}`;
}

function keyFromLabel(value) {
  const words = String(value || "").trim().replace(/[^a-zA-Z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words[0].toLowerCase() + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
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
  const { data, error } = await supabase
    .from("client_websites")
    .select("id,name,slug,live_url,status,website_members(role,status,user_id)")
    .order("name");
  if (error) throw error;

  websites = data || [];
  websiteSelect.innerHTML = websites.length
    ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("")
    : '<option value="">No websites assigned</option>';

  if (!websites.length) {
    websiteSummary.hidden = true;
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
  const previous = readWorkspaceContext("client", currentSession.user.id);
  writeWorkspaceContext("client", currentSession.user.id, {
    websiteId: selectedWebsite.id,
    name: selectedWebsite.name,
    ...(previous.websiteId && previous.websiteId !== selectedWebsite.id
      ? { projectId: null, requestId: null, proposalId: null, onboardingId: null }
      : {}),
  });
  const membership = (selectedWebsite.website_members || []).find((row) => row.user_id === currentSession.user.id && row.status === "active");
  selectedRole = membership?.role || "platform admin";

  const { data: canEdit, error: accessError } = await supabase.rpc("can_edit_client_website", {
    target_website_id: selectedWebsite.id,
  });
  if (accessError) throw accessError;
  canEditSelectedWebsite = Boolean(canEdit);

  websiteName.textContent = selectedWebsite.name;
  websiteRole.textContent = formatAccessRole(selectedRole);
  websiteStatus.textContent = formatLabel(selectedWebsite.status, "Website project");
  websiteStatus.dataset.status = String(selectedWebsite.status || "").toLowerCase();
  websiteDomain.textContent = displayHostname(selectedWebsite.live_url);
  websiteDomain.href = selectedWebsite.live_url || "#";
  websiteDomain.hidden = !selectedWebsite.live_url;
  websiteLiveLink.href = selectedWebsite.live_url || "#";
  websiteLiveLink.hidden = !selectedWebsite.live_url;
  filesWebsiteName.textContent = selectedWebsite.name;
  filesLiveLink.href = selectedWebsite.live_url || "#";
  filesLiveLink.hidden = !selectedWebsite.live_url;
  websiteSummary.hidden = false;
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
    emptyState.hidden = false;
    emptyState.innerHTML = "<p>No files or assets have been added to this website yet.</p>";
    return;
  }

  emptyState.hidden = true;
  assetGrid.innerHTML = assets.map((asset) => {
    const assetVersions = versions.filter((version) => version.asset_id === asset.id);
    const previewVersion = assetVersions.find((version) => String(version.mime_type || "").startsWith("image/"));
    const versionMarkup = assetVersions.length
      ? assetVersions.map((version) => `
          <div class="portal-version-row">
            <div>
              <p><strong>Version ${version.version_number}</strong> · ${escapeHtml(version.status.replace("_", " "))}</p>
              <p>${escapeHtml(version.original_filename)}${version.size_bytes ? ` · ${formatBytes(version.size_bytes)}` : ""} · ${formatDate(version.created_at)}</p>
            </div>
            <div class="portal-version-actions">
              <button class="portal-link-button" type="button" data-download-version="${version.id}">Download</button>
              ${canDeleteClientVersion(asset, version) ? `<button class="portal-link-button" type="button" data-delete-version="${version.id}">Delete</button>` : ""}
              ${version.public_url ? `<a class="portal-link-button" href="${escapeHtml(version.public_url)}" target="_blank" rel="noopener">Published file</a>` : ""}
            </div>
          </div>
        `).join("")
      : '<p>No versions uploaded.</p>';

    return `
      <article class="portal-asset-card">
        <div class="portal-asset-preview"${previewVersion ? ` data-preview-version="${previewVersion.id}"` : ""}>
          <img alt="" hidden>
          <div class="portal-asset-preview-fallback">${escapeHtml(asset.category || "asset")}</div>
        </div>
        <div class="portal-asset-body">
          <div class="portal-asset-head">
            <div>
              <h3>${escapeHtml(asset.label)}</h3>
              <div class="portal-asset-meta">
                <span class="portal-pill">${escapeHtml(asset.category)}</span>
                <span class="portal-pill">${escapeHtml(asset.replacement_type.replaceAll("_", " "))}</span>
                <span class="portal-pill">${escapeHtml(asset.asset_key)}</span>
              </div>
            </div>
            ${canEditSelectedWebsite ? `
              <div class="portal-version-actions">
                <button class="portal-link-button" type="button" data-replace-asset="${asset.id}">Replace</button>
                ${canDeleteEmptyClientAsset(asset, assetVersions) ? `<button class="portal-link-button" type="button" data-delete-empty-asset="${asset.id}">Delete</button>` : ""}
              </div>
            ` : ""}
          </div>
          <div class="portal-version-list">${versionMarkup}</div>
        </div>
      </article>
    `;
  }).join("");
  void hydrateAssetPreviews();
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

async function hydrateAssetPreviews() {
  const previews = Array.from(assetGrid.querySelectorAll("[data-preview-version]"));
  await Promise.all(previews.map(async (preview) => {
    const version = versions.find((row) => row.id === preview.dataset.previewVersion);
    if (!version) return;
    let url = version.public_url;
    if (!url) {
      const { data, error } = await supabase.storage.from(version.storage_bucket).createSignedUrl(version.storage_path, 600);
      if (error) return;
      url = data.signedUrl;
    }
    const image = preview.querySelector("img");
    const fallback = preview.querySelector(".portal-asset-preview-fallback");
    if (!image || !url) return;
    image.addEventListener("load", () => {
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    }, { once: true });
    image.src = url;
  }));
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

  if (version.public_url) {
    window.open(version.public_url, "_blank", "noopener");
    return;
  }

  const { data, error } = await supabase.storage
    .from(version.storage_bucket)
    .createSignedUrl(version.storage_path, 600, { download: version.original_filename });
  if (error) {
    setInlineStatus(error.message || "Unable to create a download link.", true);
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
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
        : window.location.hash === "#new-project"
          ? "new-request"
          : "overview"
    );
    document.body.classList.remove("portal-loading");
    statusScreen.hidden = true;

    websiteSelect.addEventListener("change", () => selectWebsite(websiteSelect.value).catch((error) => showStatus(error.message)));
    portalViewButtons.forEach((button) => {
      button.addEventListener("click", () => showPortalView(button.dataset.portalView));
    });
    portalViewOpeners.forEach((button) => {
      button.addEventListener("click", () => showPortalView(button.dataset.openPortalView));
    });
    window.addEventListener("hashchange", () => {
      if (isAssetsRoute || window.location.hash === "#files-assets") showPortalView("files");
      else if (window.location.hash === "#new-project") showPortalView("new-request");
      else showPortalView("overview");
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
      const replaceButton = event.target.closest("[data-replace-asset]");
      const downloadButton = event.target.closest("[data-download-version]");
      const deleteButton = event.target.closest("[data-delete-version]");
      const deleteEmptyButton = event.target.closest("[data-delete-empty-asset]");
      if (replaceButton) openUploadForm(replaceButton.dataset.replaceAsset, { chooseFile: true });
      if (downloadButton) downloadVersion(downloadButton.dataset.downloadVersion);
      if (deleteButton) {
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
