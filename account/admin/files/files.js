import { renderPdfFirstPage } from "/shared/lib/file-preview.js";
import { promptAdminText } from "/account/admin/admin-dialogs.js";
import { safeWebsiteAssetFilename, validateWebsiteAssetRename } from "/shared/lib/website-asset-utils.js";
import { CDN_BROWSER_CACHE_SECONDS, canOptimizeCdnImage, prepareCdnImage } from "/shared/lib/cdn-image-optimizer.js";

let fileState = { files: [], access: [], admins: [], websites: [], websiteAssets: [], websiteVersions: [] };
let fileSupabase = null;
let fileInvoke = null;
let fileUserId = null;
let currentFolderPath = "";
const expandedFolderPaths = new Set();
const selectedFileKeys = new Set();
const WEBSITE_PRIVATE_BUCKET = "website-assets-private";
const WEBSITE_PUBLIC_BUCKET = "website-assets-public";
const WEBSITE_FOLDER_LABELS = {
  image: "Images",
  images: "Images",
  logo: "Logo",
  brand: "Brand assets",
  social: "Social",
  document: "Documents",
  documents: "Documents",
  video: "Videos",
  font: "Fonts",
  other: "Other files",
  uncategorized: "Uncategorized",
};
let websiteFilesChannel = null;
let websiteFilesRefreshTimer = null;
let websiteFilesVisibilityHandler = null;

function fileEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function fileDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function fileType(file) {
  const extension = pathParts(file.name).at(-1)?.split(".").pop()?.toLowerCase() || "";
  const mime = String(file.mime_type || "").toLowerCase();
  if (mime === "application/pdf" || extension === "pdf") return { label: "PDF", tone: "pdf" };
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg)$/.test(extension)) return { label: "IMG", tone: "image" };
  if (mime.startsWith("video/") || /^(mp4|mov|webm)$/.test(extension)) return { label: "VID", tone: "video" };
  if (mime.startsWith("audio/") || /^(mp3|wav|m4a)$/.test(extension)) return { label: "AUD", tone: "audio" };
  if (/^(docx?|pages|rtf)$/.test(extension)) return { label: "DOC", tone: "document" };
  if (/^(xlsx?|csv|numbers)$/.test(extension)) return { label: "XLS", tone: "sheet" };
  if (/^(pptx?|key)$/.test(extension)) return { label: "PPT", tone: "slides" };
  return { label: (extension || "FILE").slice(0, 4).toUpperCase(), tone: "default" };
}

function filePreviewMarkup(file, type) {
  const key = fileSelectionKey(file);
  return `<span class="n3xra-file-type is-${type.tone}" data-file-preview="${fileEscape(key)}" aria-hidden="true"><img alt="" hidden><canvas hidden></canvas><span>${type.label}</span></span>`;
}

async function hydrateFilePreviews() {
  const previews = Array.from(document.querySelectorAll("#n3xra-file-list [data-file-preview]"));
  await Promise.all(previews.map(async (preview) => {
    const file = fileState.files.find((item) => fileSelectionKey(item) === preview.dataset.filePreview);
    if (!file) return;
    const type = fileType(file);
    if (!["image", "pdf"].includes(type.tone)) return;
    try {
      const data = file.source === "website" ? await websiteFileUrl(file) : await fileInvoke("get-n3xra-file-url", { fileId: file.id });
      const image = preview.querySelector("img");
      const canvas = preview.querySelector("canvas");
      const fallback = preview.querySelector(":scope > span");
      if (!data?.url || !preview.isConnected) return;
      if (type.tone === "pdf" && canvas) {
        await renderPdfFirstPage(data.url, canvas);
        if (!preview.isConnected) return;
        canvas.hidden = false;
        if (fallback) fallback.hidden = true;
        preview.classList.add("has-preview");
        return;
      }
      if (!image) return;
      image.addEventListener("load", () => {
        if (!preview.isConnected) return;
        image.hidden = false;
        if (fallback) fallback.hidden = true;
        preview.classList.add("has-preview");
      }, { once: true });
      image.src = data.url;
    } catch {
      // Keep the file-type badge when a preview URL is unavailable.
    }
  }));
}

function safeUploadPath(value) {
  return String(value || "file")
    .split(/[\\/]+/)
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .replaceAll("..", ".") || "file";
}

function websiteAssetKey(value) {
  const base = String(value || "file").replace(/\.[^.]+$/, "").toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(base) ? base : `file-${base || "upload"}`;
}

function websiteAssetCategory(file) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("pdf") || mime.startsWith("text/") || /\.(docx?|xlsx?|pptx?|csv|txt|md|pdf)$/i.test(file.name)) return "document";
  return "other";
}

function websiteCategoryFolder(value) {
  const category = String(value || "uncategorized").trim().toLowerCase().replaceAll("_", " ");
  return WEBSITE_FOLDER_LABELS[category] || category.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function websiteCategoryForFolder(website, folderPath = currentFolderPath) {
  if (!website) return "";
  const websiteParts = pathParts(website.folder_path);
  const categoryFolder = pathParts(folderPath).slice(websiteParts.length)[0];
  if (!categoryFolder) return "";
  return Object.entries(WEBSITE_FOLDER_LABELS).find(([, label]) => label === categoryFolder)?.[0] || "";
}

function fileStatus(message = "", tone = "") {
  const element = document.getElementById("admin-status");
  if (!element) return;
  element.textContent = message;
  element.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function accessFor(fileId) {
  return new Set(fileState.access.filter((item) => String(item.file_id) === String(fileId)).map((item) => String(item.user_id)));
}

function pathParts(value) {
  return String(value || "").split(/[\\/]+/).filter(Boolean);
}

function websiteFolderSegment(value) {
  return String(value || "Website").replace(/[\\/]+/g, "-").trim() || "Website";
}

function currentWebsite() {
  return fileState.websites.find((website) => currentFolderPath === website.folder_path || currentFolderPath.startsWith(`${website.folder_path}/`)) || null;
}

function fileSelectionKey(file) {
  return `${file.source || "n3xra"}:${file.id}`;
}

function selectedFiles() {
  return fileState.files.filter((file) => selectedFileKeys.has(fileSelectionKey(file)));
}

function publishedUrl(file) {
  return file.cdn_url || file.public_url || "";
}

function isUnderPath(parts, parentParts) {
  return parentParts.every((part, index) => parts[index] === part);
}

function renderBreadcrumb() {
  const breadcrumb = document.querySelector(".n3xra-files-breadcrumb");
  if (!breadcrumb) return;
  const parts = pathParts(currentFolderPath);
  breadcrumb.innerHTML = `<button class="n3xra-breadcrumb-button${parts.length ? "" : " is-current"}" type="button" data-folder-path="">Files</button>${parts.map((part, index) => `<span aria-hidden="true">/</span><button class="n3xra-breadcrumb-button${index === parts.length - 1 ? " is-current" : ""}" type="button" data-folder-path="${fileEscape(parts.slice(0, index + 1).join("/"))}">${fileEscape(part)}</button>`).join("")}`;
}

function renderFolderTree() {
  const tree = document.getElementById("n3xra-folder-tree");
  if (!tree) return;
  const folders = new Map();
  fileState.files.forEach((file) => {
    const parts = pathParts(file.name);
    parts.slice(0, -1).forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const entry = folders.get(path) || { name, path, depth: index, count: 0 };
      entry.count += 1;
      folders.set(path, entry);
    });
  });
  const websiteRoot = folders.get("Websites") || { name: "Websites", path: "Websites", depth: 0, count: 0, protected: true };
  websiteRoot.protected = true;
  folders.set("Websites", websiteRoot);
  const businessRecordsRoot = folders.get("Business Records") || { name: "Business Records", path: "Business Records", depth: 0, count: 0, protected: true };
  businessRecordsRoot.protected = true;
  folders.set("Business Records", businessRecordsRoot);
  fileState.websites.forEach((website) => {
    const existing = folders.get(website.folder_path) || { name: website.name, path: website.folder_path, depth: 1, count: 0 };
    existing.protected = true;
    folders.set(website.folder_path, existing);
    folders.forEach((folder) => {
      if (folder.path.startsWith(`${website.folder_path}/`)) folder.protected = true;
    });
  });
  const children = new Map();
  folders.forEach((folder) => {
    const parts = pathParts(folder.path);
    const parentPath = parts.slice(0, -1).join("/");
    const siblings = children.get(parentPath) || [];
    siblings.push(folder);
    children.set(parentPath, siblings);
  });
  children.forEach((siblings) => siblings.sort((a, b) => a.name.localeCompare(b.name)));
  const renderChildren = (parentPath = "") => (children.get(parentPath) || []).map((folder) => {
    const hasChildren = children.has(folder.path);
    const isExpanded = hasChildren && expandedFolderPaths.has(folder.path);
    return `<div class="n3xra-folder-tree-branch"><div class="n3xra-folder-tree-row${currentFolderPath === folder.path ? " is-current" : ""}" style="--folder-depth:${folder.depth}"><button type="button" data-tree-folder="${fileEscape(folder.path)}"${hasChildren ? ` data-tree-parent="true" aria-expanded="${isExpanded}"` : ""}><span class="n3xra-folder-tree-toggle${hasChildren ? "" : " is-empty"}" aria-hidden="true">${isExpanded ? "⌄" : "›"}</span><span class="n3xra-folder-entry-icon" aria-hidden="true">▰</span><span><strong>${fileEscape(folder.name)}</strong><small>${folder.count} file${folder.count === 1 ? "" : "s"}</small></span></button>${folder.protected ? "" : `<button class="n3xra-folder-tree-delete" type="button" data-folder-delete="${fileEscape(folder.path)}" aria-label="Delete ${fileEscape(folder.name)}">×</button>`}</div>${isExpanded ? renderChildren(folder.path) : ""}</div>`;
  }).join("");
  tree.innerHTML = renderChildren();
}

function syncFileActions() {
  const website = currentWebsite();
  const websiteRoot = currentFolderPath === "Websites";
  const uploadFilesLabel = document.querySelector('label[for="n3xra-file-input"]');
  const uploadFolderButton = document.getElementById("n3xra-folder-button");
  const fileInput = document.getElementById("n3xra-file-input");
  const folderInput = document.getElementById("n3xra-folder-input");
  [uploadFilesLabel, uploadFolderButton].forEach((element) => element?.classList.toggle("is-disabled", websiteRoot));
  if (fileInput) fileInput.disabled = websiteRoot;
  if (folderInput) folderInput.disabled = websiteRoot;
  if (uploadFolderButton) uploadFolderButton.disabled = websiteRoot;
  if (uploadFilesLabel) uploadFilesLabel.title = websiteRoot ? "Choose a website folder before uploading." : website ? `Upload to ${website.name}` : "Upload files";
}

function renderFileSelectionActions() {
  const toolbar = document.getElementById("n3xra-file-selection-toolbar");
  const status = document.getElementById("n3xra-file-selection-status");
  const clearButton = document.getElementById("n3xra-clear-selection");
  const downloadButton = document.getElementById("n3xra-download-selected");
  const publishButton = document.getElementById("n3xra-publish-selected");
  const approveButton = document.getElementById("n3xra-approve-selected");
  const rejectButton = document.getElementById("n3xra-reject-selected");
  const copyButton = document.getElementById("n3xra-copy-selected-links");
  const refreshButton = document.getElementById("n3xra-refresh-selected-cdn");
  const deleteButton = document.getElementById("n3xra-delete-selected");
  if (!toolbar || !status || !clearButton || !downloadButton || !publishButton || !approveButton || !rejectButton || !copyButton || !refreshButton || !deleteButton) return;
  const availableKeys = new Set(fileState.files.map(fileSelectionKey));
  [...selectedFileKeys].forEach((key) => { if (!availableKeys.has(key)) selectedFileKeys.delete(key); });
  const selected = selectedFiles();
  const pendingCount = selected.filter((file) => file.source === "website" && file.status === "pending_review").length;
  const publishableCount = selected.filter((file) => (file.source !== "website" && !file.cdn_url) || (file.source === "website" && file.status === "approved" && String(file.mime_type || "").startsWith("image/"))).length;
  const publishedCount = selected.filter((file) => publishedUrl(file)).length;
  const refreshableCount = selected.filter((file) => file.source === "website" && file.public_url && String(file.mime_type || "").startsWith("image/")).length;
  toolbar.hidden = selected.length === 0;
  clearButton.hidden = selected.length === 0;
  downloadButton.hidden = selected.length === 0;
  status.textContent = `${selected.length} file${selected.length === 1 ? "" : "s"} selected`;
  downloadButton.textContent = `Download selected (${selected.length})`;
  approveButton.hidden = pendingCount === 0;
  approveButton.textContent = `Approve pending (${pendingCount})`;
  rejectButton.hidden = pendingCount === 0;
  rejectButton.textContent = `Reject pending (${pendingCount})`;
  publishButton.hidden = publishableCount === 0;
  publishButton.textContent = `Publish to CDN (${publishableCount})`;
  copyButton.hidden = publishedCount === 0;
  copyButton.textContent = `Copy published links (${publishedCount})`;
  refreshButton.hidden = refreshableCount === 0;
  refreshButton.textContent = `Refresh CDN files (${refreshableCount})`;
  deleteButton.hidden = selected.length === 0;
  deleteButton.textContent = `Delete selected (${selected.length})`;
}

function renderFiles() {
  const list = document.getElementById("n3xra-file-list");
  if (!list) return;
  renderBreadcrumb();
  renderFolderTree();
  syncFileActions();
  const parentParts = pathParts(currentFolderPath);
  const query = String(document.getElementById("n3xra-file-search")?.value || "").trim().toLowerCase();
  const files = [];
  fileState.files.forEach((file) => {
    const parts = pathParts(file.name);
    if (!isUnderPath(parts, parentParts) || parts.length <= parentParts.length) return;
    const remaining = parts.slice(parentParts.length);
    if (remaining.length === 1 && (!query || String(file.name || "").toLowerCase().includes(query))) {
      files.push(file);
    }
  });
  const visibleKeys = files.map(fileSelectionKey);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedFileKeys.has(key));
  const listHeader = `<div class="n3xra-file-list-head is-selectable"><label class="n3xra-file-select"><input type="checkbox" data-file-select-all${allSelected ? " checked" : ""} aria-label="Select all files in this folder"></label><span>Name</span><span>Access</span><span>Modified</span><span>Size</span><span></span></div>`;
  renderFileSelectionActions();
  if (!files.length) {
    list.innerHTML = `${listHeader}<div class="n3xra-empty">This folder is empty. Upload a file to get started.</div>`;
    return;
  }
  const fileMarkup = files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => {
    const websiteFile = file.source === "website";
    const access = websiteFile ? new Set() : accessFor(file.id);
    const type = fileType(file);
    const accessLabel = websiteFile ? String(file.status || "draft").replaceAll("_", " ") : access.size ? `${access.size} admin${access.size === 1 ? "" : "s"}` : "Private";
    const fileMeta = websiteFile ? `${file.asset_key} · Version ${file.version_number}` : `${file.mime_type || "File"}${file.cdn_url ? " · CDN published" : ""}`;
    const asset = websiteFile ? fileState.websiteAssets.find((item) => String(item.id) === String(file.asset_id)) : null;
    const websiteActions = websiteFile ? [
      file.status === "pending_review" ? `<button type="button" data-website-file-approve="${fileEscape(file.id)}">Approve</button><button type="button" data-website-file-reject="${fileEscape(file.id)}">Reject</button>` : "",
      file.status === "approved" && String(file.mime_type || "").startsWith("image/") ? `<button type="button" data-website-file-publish="${fileEscape(file.id)}">Publish to CDN</button>${canOptimizeCdnImage(asset, file) ? `<button type="button" data-website-file-publish-original="${fileEscape(file.id)}">Publish full quality</button>` : ""}` : "",
      `<button type="button" data-website-file-rename="${fileEscape(file.id)}">Rename file</button>`,
      file.public_url ? `<button type="button" data-website-file-copy="${fileEscape(file.id)}">Copy published URL</button>` : "",
      file.public_url && canOptimizeCdnImage(asset, file) ? `<button type="button" data-website-file-optimize="${fileEscape(file.id)}">Optimize CDN file</button><button type="button" data-website-file-original="${fileEscape(file.id)}">Use full-quality CDN file</button>` : file.public_url && String(file.mime_type || "").startsWith("image/") ? `<button type="button" data-website-file-optimize="${fileEscape(file.id)}">Refresh CDN cache</button>` : "",
    ].join("") : "";
    const cdnActions = !websiteFile && file.cdn_url
      ? `<button type="button" data-file-open-cdn="${fileEscape(file.id)}">Open CDN URL</button><button type="button" data-file-copy-cdn="${fileEscape(file.id)}">Copy CDN link</button><button type="button" data-file-unpublish="${fileEscape(file.id)}">Unpublish from CDN</button>`
      : !websiteFile ? `<button type="button" data-file-publish="${fileEscape(file.id)}">Publish to CDN</button>` : websiteActions;
    const selectionKey = fileSelectionKey(file);
    return `<article class="n3xra-file-row is-selectable${selectedFileKeys.has(selectionKey) ? " is-selected" : ""}" data-selectable-file="${fileEscape(selectionKey)}">
      <label class="n3xra-file-select"><input type="checkbox" data-file-select="${fileEscape(selectionKey)}"${selectedFileKeys.has(selectionKey) ? " checked" : ""} aria-label="Select ${fileEscape(pathParts(file.name).at(-1))}"></label>
      <button class="n3xra-file-name" type="button" data-file-open="${fileEscape(file.id)}">${filePreviewMarkup(file, type)}<span><strong>${fileEscape(pathParts(file.name).at(-1))}</strong><small>${fileEscape(fileMeta)}</small></span></button>
      ${websiteFile ? `<span class="n3xra-file-access is-status"><span aria-hidden="true">●</span>${fileEscape(accessLabel)}</span>` : `<button class="n3xra-file-access" type="button" data-file-manage-access="${fileEscape(file.id)}"><span aria-hidden="true">●</span>${accessLabel}</button>`}
      <time datetime="${fileEscape(file.created_at)}">${fileEscape(fileDate(file.created_at))}</time>
      <span class="n3xra-file-size">${fileEscape(fileSize(file.size_bytes))}</span>
      <details class="n3xra-file-menu"><summary aria-label="Actions for ${fileEscape(file.name)}">•••</summary><div class="n3xra-file-menu-popover"><button type="button" data-file-open="${fileEscape(file.id)}">Open</button><button type="button" data-file-download="${fileEscape(file.id)}">Download</button>${cdnActions}${websiteFile ? "" : `<button type="button" data-file-manage-access="${fileEscape(file.id)}">Manage access</button>`}<button class="is-danger" type="button" data-file-delete="${fileEscape(file.id)}">Delete</button></div></details>
      ${websiteFile ? "" : `<section class="n3xra-access-panel" id="file-access-${fileEscape(file.id)}" hidden><div class="n3xra-access-head"><div><strong>Manage access</strong><span>Choose the administrators who can open this file.</span></div><button type="button" data-file-close-access="${fileEscape(file.id)}" aria-label="Close access controls">×</button></div><div class="n3xra-access-options">${fileState.admins.map((admin) => `<label><input type="checkbox" data-file-access="${fileEscape(file.id)}" value="${fileEscape(admin.user_id)}"${access.has(String(admin.user_id)) ? " checked" : ""}>${fileEscape(admin.email)}${admin.role === "owner" ? " (owner)" : ""}</label>`).join("")}</div><div class="n3xra-access-actions"><button class="portal-button portal-button-secondary" type="button" data-file-close-access="${fileEscape(file.id)}">Cancel</button><button class="portal-button" type="button" data-file-save-access="${fileEscape(file.id)}">Save access</button></div></section>`}
    </article>`;
  }).join("");
  list.innerHTML = listHeader + fileMarkup;
  void hydrateFilePreviews();
}

async function loadWebsiteFiles() {
  const websiteResult = await fileSupabase.from("client_websites").select("id,name,slug,status").order("name");
  if (websiteResult.error) throw websiteResult.error;
  const websites = websiteResult.data || [];
  const usedPaths = new Set();
  websites.forEach((website) => {
    const base = `Websites/${websiteFolderSegment(website.name)}`;
    let path = base;
    if (usedPaths.has(path)) path = `${base} (${website.slug || website.id.slice(0, 6)})`;
    usedPaths.add(path);
    website.folder_path = path;
  });
  const websiteIds = websites.map((website) => website.id);
  const assetResult = websiteIds.length
    ? await fileSupabase.from("website_assets").select("id,website_id,asset_key,label,category,replacement_type,current_version_id,status,created_at").in("website_id", websiteIds)
    : { data: [], error: null };
  if (assetResult.error) throw assetResult.error;
  const assets = assetResult.data || [];
  const assetIds = assets.map((asset) => asset.id);
  const versionResult = assetIds.length
    ? await fileSupabase.from("website_asset_versions").select("*").in("asset_id", assetIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (versionResult.error) throw versionResult.error;
  const websiteById = new Map(websites.map((website) => [String(website.id), website]));
  const assetById = new Map(assets.map((asset) => [String(asset.id), asset]));
  const files = (versionResult.data || []).flatMap((version) => {
    const asset = assetById.get(String(version.asset_id));
    const website = asset && websiteById.get(String(asset.website_id));
    return website ? [{ ...version, source: "website", website_id: website.id, website_name: website.name, asset_id: asset.id, asset_key: asset.asset_key, asset_category: asset.category, current_version_id: asset.current_version_id, name: `${website.folder_path}/${websiteCategoryFolder(asset.category)}/${version.original_filename}` }] : [];
  });
  return { websites, assets, versions: versionResult.data || [], files };
}

async function loadFiles() {
  const [data, websiteData] = await Promise.all([fileInvoke("list-n3xra-files"), loadWebsiteFiles()]);
  fileState = { files: [...(data.files || []).map((file) => ({ ...file, source: "n3xra" })), ...websiteData.files], access: data.access || [], admins: data.admins || [], websites: websiteData.websites, websiteAssets: websiteData.assets, websiteVersions: websiteData.versions };
  renderFiles();
  fileStatus();
}

function scheduleWebsiteFilesRefresh() {
  window.clearTimeout(websiteFilesRefreshTimer);
  websiteFilesRefreshTimer = window.setTimeout(() => {
    if (!document.getElementById("n3xra-file-list")) return;
    loadFiles().catch((error) => fileStatus(error.message || "Website libraries could not refresh.", "error"));
  }, 350);
}

async function subscribeToWebsiteLibraries() {
  if (websiteFilesChannel) await fileSupabase.removeChannel(websiteFilesChannel);
  websiteFilesChannel = fileSupabase
    .channel("n3xra-files-website-libraries")
    .on("postgres_changes", { event: "*", schema: "public", table: "client_websites" }, scheduleWebsiteFilesRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "website_assets" }, scheduleWebsiteFilesRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "website_asset_versions" }, scheduleWebsiteFilesRefresh)
    .subscribe();

  if (websiteFilesVisibilityHandler) document.removeEventListener("visibilitychange", websiteFilesVisibilityHandler);
  websiteFilesVisibilityHandler = () => {
    if (document.visibilityState === "visible") scheduleWebsiteFilesRefresh();
  };
  document.addEventListener("visibilitychange", websiteFilesVisibilityHandler);
}

async function uploadFiles(input) {
  const selected = Array.isArray(input) ? input : Array.from(input.target.files || []);
  if (!Array.isArray(input)) input.target.value = "";
  if (!selected.length) return;
  const website = currentWebsite();
  if (currentFolderPath === "Websites") {
    fileStatus("Choose a website folder before uploading.", "error");
    return;
  }
  if (website) {
    await uploadWebsiteFiles(selected, website);
    return;
  }
  for (const file of selected) {
    fileStatus(`Uploading ${file.name}…`);
    const selectedPath = file.webkitRelativePath || file.name;
    const relativeName = currentFolderPath ? `${currentFolderPath}/${selectedPath}` : selectedPath;
    const safeName = safeUploadPath(relativeName).slice(0, 240);
    const path = `uploads/${crypto.randomUUID()}-${safeName}`;
    const { error } = await fileSupabase.storage.from("n3xra-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) { fileStatus(error.message, "error"); return; }
    try {
      await fileInvoke("create-n3xra-file", { name: relativeName, storagePath: path, mimeType: file.type || "application/octet-stream", sizeBytes: file.size });
    } catch (error) {
      await fileSupabase.storage.from("n3xra-files").remove([path]);
      fileStatus(error.message, "error");
      return;
    }
  }
  await loadFiles();
}

async function uploadWebsiteFiles(selected, website) {
  const usedKeys = new Set(fileState.websiteAssets.filter((asset) => String(asset.website_id) === String(website.id)).map((asset) => asset.asset_key));
  const uploadBatchId = crypto.randomUUID();
  let uploadedCount = 0;
  for (const file of selected) {
    let key = websiteAssetKey(file.webkitRelativePath || file.name);
    const keyBase = key;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${keyBase}-${suffix++}`;
    usedKeys.add(key);
    const assetId = crypto.randomUUID();
    let storagePath = "";
    fileStatus(`Uploading ${uploadedCount + 1} of ${selected.length}: ${file.name}…`);
    const { data: asset, error: assetError } = await fileSupabase.from("website_assets").insert({
      id: assetId,
      website_id: website.id,
      asset_key: key,
      label: file.name.replace(/\.[^.]+$/, "") || file.name,
      category: websiteCategoryForFolder(website) || websiteAssetCategory(file),
      replacement_type: "download_only",
      created_by_user_id: fileUserId,
    }).select("id").single();
    if (assetError) { fileStatus(assetError.message, "error"); return; }
    try {
      const { data: nextVersion, error: numberError } = await fileSupabase.rpc("next_website_asset_version_number", { target_asset_id: asset.id });
      if (numberError) throw numberError;
      const safeName = safeUploadPath(file.name).replaceAll("/", "-");
      storagePath = `${website.id}/${asset.id}/v${nextVersion}-${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await fileSupabase.storage.from(WEBSITE_PRIVATE_BUCKET).upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;
      const version = {
        asset_id: asset.id,
        version_number: nextVersion,
        status: "approved",
        storage_bucket: WEBSITE_PRIVATE_BUCKET,
        storage_path: storagePath,
        original_filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by_user_id: fileUserId,
        approved_by_user_id: fileUserId,
        approved_at: new Date().toISOString(),
        upload_batch_id: uploadBatchId,
      };
      let { error: versionError } = await fileSupabase.from("website_asset_versions").insert(version);
      if (versionError && /upload_batch_id.+schema cache|column.+upload_batch_id/i.test(versionError.message || "")) {
        delete version.upload_batch_id;
        ({ error: versionError } = await fileSupabase.from("website_asset_versions").insert(version));
      }
      if (versionError) throw versionError;
      uploadedCount += 1;
    } catch (error) {
      if (storagePath) await fileSupabase.storage.from(WEBSITE_PRIVATE_BUCKET).remove([storagePath]);
      await fileSupabase.from("website_assets").delete().eq("id", asset.id);
      fileStatus(error.message || "Website upload failed.", "error");
      return;
    }
  }
  await loadFiles();
  fileStatus(`${uploadedCount} website file${uploadedCount === 1 ? "" : "s"} uploaded and approved.`, "success");
}

async function readDirectoryFiles(directoryHandle, parentPath = "") {
  const files = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "file") {
      const file = await handle.getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
      files.push(file);
    } else if (handle.kind === "directory") {
      files.push(...await readDirectoryFiles(handle, relativePath));
    }
  }
  return files;
}

async function chooseFolder() {
  try {
    if (typeof window.showDirectoryPicker === "function") {
      const directory = await window.showDirectoryPicker({ mode: "read" });
      const files = await readDirectoryFiles(directory, directory.name);
      if (files.length) await uploadFiles(files);
      else fileStatus("That folder is empty.", "error");
      return;
    }
    document.getElementById("n3xra-folder-input")?.click();
  } catch (error) {
    if (error?.name !== "AbortError") fileStatus(error.message || "Unable to open that folder.", "error");
  }
}

function websitePublicStoragePath(version) {
  if (!version?.public_url) return "";
  try {
    const marker = `/storage/v1/object/public/${WEBSITE_PUBLIC_BUCKET}/`;
    const pathname = new URL(version.public_url).pathname;
    return pathname.includes(marker) ? decodeURIComponent(pathname.split(marker)[1] || "") : "";
  } catch {
    return "";
  }
}

function websiteFileById(id) {
  return fileState.files.find((file) => file.source === "website" && String(file.id) === String(id));
}

function websiteAssetFor(file) {
  return fileState.websiteAssets.find((asset) => String(asset.id) === String(file?.asset_id));
}

async function updateWebsiteFileStatus(id, status) {
  const file = websiteFileById(id);
  if (!file) throw new Error("This website file is no longer available.");
  const now = new Date().toISOString();
  const rejectionReason = status === "rejected"
    ? await promptAdminText("Add an optional note explaining why this file was rejected.", { title: "Reject file", inputLabel: "Rejection note", confirmLabel: "Reject file" })
    : null;
  if (status === "rejected" && rejectionReason === null) return false;
  const values = status === "approved"
    ? { status, approved_by_user_id: fileUserId, approved_at: now, rejection_reason: null }
    : { status, rejected_by_user_id: fileUserId, rejected_at: now, rejection_reason: rejectionReason.trim() || null };
  const { error } = await fileSupabase.from("website_asset_versions").update(values).eq("id", file.id);
  if (error) throw error;
  await loadFiles();
  fileStatus(status === "approved" ? "Website file approved." : "Website file rejected.", "success");
  return true;
}

async function renameWebsiteFile(id) {
  const file = websiteFileById(id);
  if (!file) throw new Error("This website file is no longer available.");
  const nextName = await promptAdminText(
    file.public_url
      ? "Change the filename shown in the library and used for downloads. The published URL will stay unchanged so live website links do not break."
      : "Change the filename shown in the library and used for downloads.",
    { title: "Rename file", inputLabel: "Filename", defaultValue: file.original_filename, confirmLabel: "Rename file" },
  );
  if (nextName === null) return;
  const filename = validateWebsiteAssetRename(nextName, file.original_filename);
  if (filename === file.original_filename) return;
  const { error } = await fileSupabase.from("website_asset_versions").update({ original_filename: filename }).eq("id", file.id);
  if (error) throw error;
  await loadFiles();
  fileStatus(`Renamed to ${filename}.`, "success");
}

async function writeWebsiteCdnObject(file, asset, publicPath, { preserveOriginal = false } = {}) {
  const { data: original, error: downloadError } = await fileSupabase.storage.from(file.storage_bucket).download(file.storage_path);
  if (downloadError || !original) throw downloadError || new Error("The private original could not be read.");
  let prepared;
  try {
    prepared = preserveOriginal
      ? { blob: original, contentType: file.mime_type || original.type || "application/octet-stream", width: null, height: null, optimized: false }
      : await prepareCdnImage(original, asset, file);
  } catch (error) {
    console.warn("CDN image optimization was skipped.", error);
    prepared = { blob: original, contentType: file.mime_type || original.type || "application/octet-stream", width: null, height: null, optimized: false };
  }
  const { error: uploadError } = await fileSupabase.storage.from(WEBSITE_PUBLIC_BUCKET).upload(publicPath, prepared.blob, {
    cacheControl: CDN_BROWSER_CACHE_SECONDS,
    contentType: prepared.contentType,
    upsert: true,
  });
  if (uploadError) throw uploadError;
  return prepared;
}

async function publishWebsiteFile(id, { refresh = true, preserveOriginal = false, copyUrl = true } = {}) {
  const file = websiteFileById(id);
  const asset = websiteAssetFor(file);
  const website = fileState.websites.find((item) => String(item.id) === String(file?.website_id));
  if (!file || !asset || !website) throw new Error("This website file is no longer available.");
  if (file.status !== "approved" || !String(file.mime_type || "").startsWith("image/")) throw new Error("Approve this image before publishing it.");
  const publicPath = `${website.id}/${asset.id}/v${file.version_number}-${safeWebsiteAssetFilename(file.original_filename)}`;
  const cdnResult = await writeWebsiteCdnObject(file, asset, publicPath, { preserveOriginal });
  const { data: urlData } = fileSupabase.storage.from(WEBSITE_PUBLIC_BUCKET).getPublicUrl(publicPath);
  const publicUrl = urlData.publicUrl;
  const now = new Date().toISOString();
  const { error: versionError } = await fileSupabase.from("website_asset_versions").update({
    status: "published",
    public_url: publicUrl,
    cdn_size_bytes: cdnResult.blob.size,
    cdn_mime_type: cdnResult.contentType,
    cdn_width: cdnResult.width,
    cdn_height: cdnResult.height,
    cdn_optimized: cdnResult.optimized,
    cdn_processed_at: now,
    published_by_user_id: fileUserId,
    published_at: now,
  }).eq("id", file.id);
  if (versionError) throw versionError;
  const { error: assetError } = await fileSupabase.from("website_assets").update({ current_version_id: file.id, updated_at: now }).eq("id", asset.id);
  if (assetError) throw assetError;
  if (copyUrl) {
    try { await navigator.clipboard.writeText(publicUrl); } catch { /* The published URL remains available in the menu. */ }
  }
  if (refresh) await loadFiles();
  return { publicUrl, cdnResult };
}

async function refreshWebsiteCdnFile(id, { refresh = true, preserveOriginal = false } = {}) {
  const file = websiteFileById(id);
  const asset = websiteAssetFor(file);
  const publicPath = websitePublicStoragePath(file);
  if (!file || !asset || !publicPath) throw new Error("This published CDN file is no longer available.");
  const cdnResult = await writeWebsiteCdnObject(file, asset, publicPath, { preserveOriginal });
  const { error } = await fileSupabase.from("website_asset_versions").update({
    cdn_size_bytes: cdnResult.blob.size,
    cdn_mime_type: cdnResult.contentType,
    cdn_width: cdnResult.width,
    cdn_height: cdnResult.height,
    cdn_optimized: cdnResult.optimized,
    cdn_processed_at: new Date().toISOString(),
  }).eq("id", file.id);
  if (error) throw error;
  if (refresh) await loadFiles();
  return cdnResult;
}

async function copyWebsitePublishedLink(id) {
  const file = websiteFileById(id);
  if (!file?.public_url) return;
  await navigator.clipboard.writeText(file.public_url);
  fileStatus("Published URL copied.", "success");
}

async function handleWebsiteFileAction(action, id) {
  fileStatus("Updating website file…");
  try {
    if (action === "approve") await updateWebsiteFileStatus(id, "approved");
    if (action === "reject") await updateWebsiteFileStatus(id, "rejected");
    if (action === "rename") await renameWebsiteFile(id);
    if (action === "copy") await copyWebsitePublishedLink(id);
    if (action === "publish" || action === "publish-original") {
      const result = await publishWebsiteFile(id, { preserveOriginal: action === "publish-original" });
      const optimized = result.cdnResult.optimized ? ` Optimized to ${fileSize(result.cdnResult.blob.size)}.` : "";
      fileStatus(`Published to the CDN and copied the URL.${optimized}`, "success");
    }
    if (action === "optimize") {
      const result = await refreshWebsiteCdnFile(id);
      fileStatus(result.optimized ? "CDN file optimized without changing its URL." : "CDN cache refreshed without changing its URL.", "success");
    }
    if (action === "original") {
      const confirmed = await confirmAction({ title: "Use full-quality file?", copy: "The private full-quality original will replace the CDN copy at the same URL.", confirmLabel: "Use full quality" });
      if (!confirmed) return;
      await refreshWebsiteCdnFile(id, { preserveOriginal: true });
      fileStatus("The full-quality original now uses the same CDN URL.", "success");
    }
  } catch (error) {
    fileStatus(error.message || "The website file could not be updated.", "error");
  }
}

async function websiteFileUrl(file, { download = false } = {}) {
  if (file.public_url && !download) return { url: file.public_url, name: file.original_filename, mimeType: file.mime_type };
  const options = download ? { download: file.original_filename } : undefined;
  const { data, error } = await fileSupabase.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, 60 * 10, options);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Unable to prepare the website file.");
  return { url: data.signedUrl, name: file.original_filename, mimeType: file.mime_type };
}

async function downloadFile(id) {
  fileStatus("Preparing download…");
  try {
    const file = fileState.files.find((item) => String(item.id) === String(id));
    if (!file) return;
    const data = await fileDownloadData(file);
    const link = document.createElement("a");
    link.href = data.url;
    link.download = data.name || "download";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
    fileStatus("Download ready.", "success");
  } catch (error) { fileStatus(error.message, "error"); }
}

async function fileDownloadData(file) {
  return file.source === "website"
    ? websiteFileUrl(file, { download: true })
    : fileInvoke("get-n3xra-file-url", { fileId: file.id });
}

async function downloadSelectedFiles() {
  const selected = selectedFiles();
  if (!selected.length) return;
  if (selected.length > 5 && !(await confirmAction({
    title: "Download selected files?",
    copy: `Your browser may ask for permission to download ${selected.length} files.`,
    confirmLabel: "Download files",
  }))) return;
  const button = document.getElementById("n3xra-download-selected");
  if (button) button.disabled = true;
  fileStatus(`Preparing ${selected.length} downloads…`);
  try {
    const downloads = await Promise.all(selected.map(async (file) => ({ file, data: await fileDownloadData(file) })));
    downloads.forEach(({ file, data }) => {
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.name || pathParts(file.name).at(-1) || "download";
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    fileStatus(`${downloads.length} download${downloads.length === 1 ? "" : "s"} started.`, "success");
  } catch (error) {
    fileStatus(error.message || "The selected files could not be downloaded.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function copySelectedPublishedLinks() {
  const published = selectedFiles().filter((file) => publishedUrl(file));
  if (!published.length) return;
  const links = published.map((file) => `${pathParts(file.name).at(-1)} — ${publishedUrl(file)}`).join("\n");
  try {
    await navigator.clipboard.writeText(links);
    fileStatus(`${published.length} published link${published.length === 1 ? "" : "s"} copied.`, "success");
  } catch {
    fileStatus("The published links could not be copied. Check this browser’s clipboard permission.", "error");
  }
}

async function publishFileToCdn(id, { refresh = true } = {}) {
  const file = fileState.files.find((item) => item.source !== "website" && String(item.id) === String(id));
  if (!file || file.cdn_url) return file;
  const data = await fileInvoke("publish-n3xra-file", { fileId: file.id });
  if (refresh) await loadFiles();
  return data.file;
}

async function publishSelectedFiles() {
  const files = selectedFiles().filter((file) => file.source !== "website" && !file.cdn_url);
  const websiteFiles = selectedFiles().filter((file) => file.source === "website" && file.status === "approved" && String(file.mime_type || "").startsWith("image/"));
  const total = files.length + websiteFiles.length;
  if (!total) return;
  if (websiteFiles.length && !(await confirmAction({ title: "Publish selected files?", copy: `${websiteFiles.length} approved website image${websiteFiles.length === 1 ? "" : "s"} will be published to the CDN.`, confirmLabel: "Publish files" }))) return;
  const button = document.getElementById("n3xra-publish-selected");
  if (button) button.disabled = true;
  fileStatus(`Publishing ${total} file${total === 1 ? "" : "s"} to the CDN…`);
  try {
    for (const file of files) await publishFileToCdn(file.id, { refresh: false });
    for (const file of websiteFiles) await publishWebsiteFile(file.id, { refresh: false, copyUrl: false });
    selectedFileKeys.clear();
    await loadFiles();
    fileStatus(`${total} file${total === 1 ? " is" : "s are"} now available on the CDN.`, "success");
  } catch (error) {
    await loadFiles().catch(() => {});
    fileStatus(error.message || "The selected files could not be published.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function approveSelectedWebsiteFiles() {
  const files = selectedFiles().filter((file) => file.source === "website" && file.status === "pending_review");
  if (!files.length) return;
  const button = document.getElementById("n3xra-approve-selected");
  if (button) button.disabled = true;
  fileStatus(`Approving ${files.length} website file${files.length === 1 ? "" : "s"}…`);
  try {
    const now = new Date().toISOString();
    const { error } = await fileSupabase.from("website_asset_versions").update({ status: "approved", approved_by_user_id: fileUserId, approved_at: now, rejection_reason: null }).in("id", files.map((file) => file.id));
    if (error) throw error;
    selectedFileKeys.clear();
    await loadFiles();
    fileStatus(`${files.length} website file${files.length === 1 ? "" : "s"} approved.`, "success");
  } catch (error) {
    fileStatus(error.message || "The selected files could not be approved.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function rejectSelectedWebsiteFiles() {
  const files = selectedFiles().filter((file) => file.source === "website" && file.status === "pending_review");
  if (!files.length) return;
  const reason = await promptAdminText(`Reject ${files.length} selected pending file${files.length === 1 ? "" : "s"}. Add an optional reason.`, { title: "Reject selected files", inputLabel: "Rejection note", confirmLabel: "Reject files" });
  if (reason === null) return;
  const button = document.getElementById("n3xra-reject-selected");
  if (button) button.disabled = true;
  fileStatus(`Rejecting ${files.length} website file${files.length === 1 ? "" : "s"}…`);
  try {
    const { error } = await fileSupabase.from("website_asset_versions").update({ status: "rejected", rejected_by_user_id: fileUserId, rejected_at: new Date().toISOString(), rejection_reason: reason.trim() || null }).in("id", files.map((file) => file.id));
    if (error) throw error;
    selectedFileKeys.clear();
    await loadFiles();
    fileStatus(`${files.length} website file${files.length === 1 ? "" : "s"} rejected.`, "success");
  } catch (error) {
    fileStatus(error.message || "The selected files could not be rejected.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshSelectedWebsiteCdnFiles() {
  const files = selectedFiles().filter((file) => file.source === "website" && file.public_url && String(file.mime_type || "").startsWith("image/"));
  if (!files.length) return;
  if (!(await confirmAction({ title: "Refresh CDN files?", copy: `Refresh ${files.length} published image${files.length === 1 ? "" : "s"} without changing any links? Photos will be optimized; logos and brand files will remain full quality.`, confirmLabel: "Refresh files" }))) return;
  const button = document.getElementById("n3xra-refresh-selected-cdn");
  if (button) button.disabled = true;
  let refreshed = 0;
  try {
    for (const file of files) {
      fileStatus(`Refreshing ${refreshed + 1} of ${files.length}: ${file.original_filename}…`);
      await refreshWebsiteCdnFile(file.id, { refresh: false });
      refreshed += 1;
    }
    selectedFileKeys.clear();
    await loadFiles();
    fileStatus(`${refreshed} CDN file${refreshed === 1 ? "" : "s"} refreshed without changing links.`, "success");
  } catch (error) {
    await loadFiles().catch(() => {});
    fileStatus(`${refreshed ? `${refreshed} refreshed. ` : ""}${error.message || "The remaining CDN files could not be refreshed."}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function publishFile(id) {
  fileStatus("Publishing file to the CDN…");
  try {
    await publishFileToCdn(id);
    fileStatus("File published to the CDN.", "success");
  } catch (error) { fileStatus(error.message || "The file could not be published.", "error"); }
}

async function copyCdnLink(id) {
  const file = fileState.files.find((item) => item.source !== "website" && String(item.id) === String(id));
  if (!file?.cdn_url) return;
  try {
    await navigator.clipboard.writeText(file.cdn_url);
    fileStatus("CDN link copied.", "success");
  } catch {
    fileStatus("The CDN link could not be copied. Check this browser’s clipboard permission.", "error");
  }
}

function openCdnLink(id) {
  const file = fileState.files.find((item) => item.source !== "website" && String(item.id) === String(id));
  if (file?.cdn_url) window.open(file.cdn_url, "_blank", "noopener,noreferrer");
}

async function openFile(id) {
  const file = fileState.files.find((item) => String(item.id) === String(id));
  if (!file) return;
  fileStatus("Preparing preview…");
  try {
    const data = file.source === "website" ? await websiteFileUrl(file) : await fileInvoke("get-n3xra-file-url", { fileId: id });
    const modal = document.getElementById("file-preview-modal");
    const body = document.getElementById("file-preview-body");
    const title = document.getElementById("file-preview-title");
    const download = document.getElementById("file-preview-download");
    if (!modal || !body || !title || !download) return;
    title.textContent = file.name;
    download.href = data.url;
    download.download = file.name;
    body.innerHTML = "";
    const mime = String(data.mimeType || file.mime_type || "").toLowerCase();
    if (mime.startsWith("image/")) {
      const image = document.createElement("img"); image.src = data.url; image.alt = file.name; body.append(image);
    } else if (mime === "application/pdf") {
      const frame = document.createElement("iframe"); frame.src = data.url; frame.title = file.name; body.append(frame);
    } else if (mime.startsWith("video/")) {
      const video = document.createElement("video"); video.src = data.url; video.controls = true; body.append(video);
    } else if (mime.startsWith("audio/")) {
      const audio = document.createElement("audio"); audio.src = data.url; audio.controls = true; body.append(audio);
    } else if (mime.startsWith("text/") || /\.(txt|md|csv|json|html?)$/i.test(file.name)) {
      const text = document.createElement("pre"); text.textContent = await fetch(data.url).then((response) => response.text()); body.append(text);
    } else {
      const message = document.createElement("p"); message.textContent = "This file type cannot be previewed here. Use Download to open it."; body.append(message);
    }
    modal.hidden = false;
    document.body.classList.add("n3xra-modal-open");
    fileStatus("Preview ready.", "success");
  } catch (error) { fileStatus(error.message, "error"); }
}

function closePreview() {
  document.getElementById("file-preview-modal")?.setAttribute("hidden", "");
  document.body.classList.remove("n3xra-modal-open");
}

function confirmAction({ title, copy: message, confirmLabel, danger = false }) {
  const modal = document.getElementById("file-confirm-modal");
  const titleElement = document.getElementById("file-confirm-title");
  const copy = document.getElementById("file-confirm-copy");
  const confirmButton = document.getElementById("file-confirm-delete");
  if (!modal || !titleElement || !copy || !confirmButton) return Promise.resolve(false);
  titleElement.textContent = title;
  copy.textContent = message;
  confirmButton.textContent = confirmLabel;
  confirmButton.classList.toggle("n3xra-danger-button", danger);
  modal.hidden = false;
  document.body.classList.add("n3xra-modal-open");
  return new Promise((resolve) => {
    const finish = (confirmed) => {
      modal.hidden = true;
      document.body.classList.remove("n3xra-modal-open");
      confirmButton.onclick = null;
      modal.querySelectorAll("[data-modal-cancel]").forEach((element) => { element.onclick = null; });
      document.removeEventListener("keydown", onKeyDown);
      resolve(confirmed);
    };
    const onKeyDown = (event) => { if (event.key === "Escape") finish(false); };
    confirmButton.onclick = () => finish(true);
    modal.querySelectorAll("[data-modal-cancel]").forEach((element) => { element.onclick = () => finish(false); });
    document.addEventListener("keydown", onKeyDown);
    confirmButton.focus();
  });
}

function confirmDelete(fileName) {
  return confirmAction({ title: "Delete file?", copy: `“${fileName}” will be permanently removed from Internal Files.`, confirmLabel: "Delete file", danger: true });
}

async function unpublishFile(id) {
  const file = fileState.files.find((item) => item.source !== "website" && String(item.id) === String(id));
  if (!file?.cdn_url) return;
  const confirmed = await confirmAction({
    title: "Remove from CDN?",
    copy: `“${file.name}” will no longer be publicly available at its CDN link. The private file will remain in Internal Files.`,
    confirmLabel: "Unpublish file",
    danger: true,
  });
  if (!confirmed) return;
  fileStatus("Removing file from the CDN…");
  try {
    await fileInvoke("unpublish-n3xra-file", { fileId: file.id });
    await loadFiles();
    fileStatus("File removed from the CDN. The private copy is unchanged.", "success");
  } catch (error) { fileStatus(error.message || "The file could not be unpublished.", "error"); }
}

async function deleteFolder(folderPath) {
  const folderName = pathParts(folderPath).at(-1) || folderPath;
  if (!(await confirmDelete(folderName))) return;
  fileStatus("Deleting folder…");
  try {
    await fileInvoke("delete-n3xra-folder", { folderPath });
    [...expandedFolderPaths].forEach((path) => {
      if (path === folderPath || path.startsWith(`${folderPath}/`)) expandedFolderPaths.delete(path);
    });
    currentFolderPath = "";
    await loadFiles();
  } catch (error) { fileStatus(error.message, "error"); }
}

async function deleteFile(id) {
  const file = fileState.files.find((item) => String(item.id) === String(id));
  if (!file || !(await confirmDelete(file.name))) return;
  if (file.source === "website") {
    const published = file.status === "published" || Boolean(file.public_url) || String(file.current_version_id) === String(file.id);
    if (published && !(await confirmDelete(`${file.original_filename} is published and may be used by the live website. Delete it permanently?`))) return;
    fileStatus("Deleting website file…");
    try {
      if (String(file.current_version_id) === String(file.id)) {
        const { error } = await fileSupabase.from("website_assets").update({ current_version_id: null }).eq("id", file.asset_id);
        if (error) throw error;
      }
      const storedFiles = [{ bucket: file.storage_bucket, path: file.storage_path }];
      const publicPath = websitePublicStoragePath(file);
      if (publicPath && !(file.storage_bucket === WEBSITE_PUBLIC_BUCKET && file.storage_path === publicPath)) storedFiles.push({ bucket: WEBSITE_PUBLIC_BUCKET, path: publicPath });
      for (const storedFile of storedFiles) {
        const { error } = await fileSupabase.storage.from(storedFile.bucket).remove([storedFile.path]);
        if (error) throw error;
      }
      const { error: versionError } = await fileSupabase.from("website_asset_versions").delete().eq("id", file.id);
      if (versionError) throw versionError;
      const remaining = fileState.websiteVersions.filter((version) => String(version.asset_id) === String(file.asset_id) && String(version.id) !== String(file.id));
      if (!remaining.length) {
        const { error: assetError } = await fileSupabase.from("website_assets").delete().eq("id", file.asset_id);
        if (assetError) throw assetError;
      }
      await loadFiles();
    } catch (error) { fileStatus(error.message, "error"); }
    return;
  }
  fileStatus("Deleting file…");
  try { await fileInvoke("delete-n3xra-file", { fileId: id }); await loadFiles(); }
  catch (error) { fileStatus(error.message, "error"); }
}

async function deleteSelectedFiles() {
  const selected = selectedFiles();
  if (!selected.length || !(await confirmDelete(`${selected.length} selected file${selected.length === 1 ? "" : "s"}`))) return;
  const websiteFiles = selected.filter((file) => file.source === "website");
  const n3xraFiles = selected.filter((file) => file.source !== "website");
  const published = websiteFiles.filter((file) => file.status === "published" || file.public_url || String(file.current_version_id) === String(file.id));
  if (published.length && !(await confirmDelete(`${published.length} selected website file${published.length === 1 ? " is" : "s are"} published and may be used by live websites`))) return;

  const button = document.getElementById("n3xra-delete-selected");
  if (button) button.disabled = true;
  fileStatus(`Deleting ${selected.length} selected files…`);
  try {
    if (websiteFiles.length) {
      const selectedWebsiteIds = new Set(websiteFiles.map((file) => String(file.id)));
      const currentAssets = fileState.websiteAssets.filter((asset) => selectedWebsiteIds.has(String(asset.current_version_id)));
      if (currentAssets.length) {
        const { error } = await fileSupabase.from("website_assets").update({ current_version_id: null }).in("id", currentAssets.map((asset) => asset.id));
        if (error) throw error;
      }

      const pathsByBucket = new Map();
      websiteFiles.forEach((file) => {
        if (file.storage_bucket && file.storage_path) {
          const paths = pathsByBucket.get(file.storage_bucket) || [];
          paths.push(file.storage_path);
          pathsByBucket.set(file.storage_bucket, paths);
        }
        const publicPath = websitePublicStoragePath(file);
        if (publicPath && !(file.storage_bucket === WEBSITE_PUBLIC_BUCKET && file.storage_path === publicPath)) {
          const paths = pathsByBucket.get(WEBSITE_PUBLIC_BUCKET) || [];
          paths.push(publicPath);
          pathsByBucket.set(WEBSITE_PUBLIC_BUCKET, paths);
        }
      });
      for (const [bucket, paths] of pathsByBucket) {
        const { error } = await fileSupabase.storage.from(bucket).remove([...new Set(paths)]);
        if (error) throw error;
      }

      const { error: versionError } = await fileSupabase.from("website_asset_versions").delete().in("id", websiteFiles.map((file) => file.id));
      if (versionError) throw versionError;
      const affectedAssetIds = [...new Set(websiteFiles.map((file) => String(file.asset_id)))];
      const emptyAssetIds = affectedAssetIds.filter((assetId) => !fileState.websiteVersions.some((version) => String(version.asset_id) === assetId && !selectedWebsiteIds.has(String(version.id))));
      if (emptyAssetIds.length) {
        const { error: assetError } = await fileSupabase.from("website_assets").delete().in("id", emptyAssetIds);
        if (assetError) throw assetError;
      }
    }

    for (const file of n3xraFiles) {
      await fileInvoke("delete-n3xra-file", { fileId: file.id });
    }
    selectedFileKeys.clear();
    await loadFiles();
    fileStatus(`${selected.length} selected file${selected.length === 1 ? "" : "s"} deleted.`, "success");
  } catch (error) {
    fileStatus(error.message || "The selected files could not be deleted.", "error");
    await loadFiles().catch(() => {});
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveAccess(button) {
  const fileId = button.dataset.fileSaveAccess;
  const userIds = [...document.querySelectorAll(`[data-file-access="${CSS.escape(fileId)}"]:checked`)].map((input) => input.value);
  button.disabled = true;
  try {
    const data = await fileInvoke("update-n3xra-file-access", { fileId, userIds });
    fileState.access = fileState.access.filter((item) => String(item.file_id) !== String(fileId));
    fileState.access.push(...(data.userIds || []).map((userId) => ({ file_id: fileId, user_id: userId })));
    document.getElementById(`file-access-${fileId}`)?.setAttribute("hidden", "");
    renderFiles();
    fileStatus("File access saved.", "success");
  } catch (error) { fileStatus(error.message, "error"); }
  finally { button.disabled = false; }
}

function handleFileSelection(event) {
  const selectAll = event.target.closest("[data-file-select-all]");
  const selectFile = event.target.closest("[data-file-select]");
  if (selectAll) {
    document.querySelectorAll("#n3xra-file-list [data-file-select]").forEach((checkbox) => {
      if (selectAll.checked) selectedFileKeys.add(checkbox.dataset.fileSelect);
      else selectedFileKeys.delete(checkbox.dataset.fileSelect);
    });
    renderFiles();
    return;
  }
  if (!selectFile) return;
  if (selectFile.checked) selectedFileKeys.add(selectFile.dataset.fileSelect);
  else selectedFileKeys.delete(selectFile.dataset.fileSelect);
  renderFiles();
}

export async function startFiles({ supabase, session, invoke }) {
  fileSupabase = supabase;
  fileInvoke = invoke;
  fileUserId = session?.user?.id || null;
  const requestedFolder = new URLSearchParams(window.location.search).get("folder");
  currentFolderPath = requestedFolder ? pathParts(requestedFolder).join("/") : "";
  expandedFolderPaths.clear();
  const requestedParts = pathParts(currentFolderPath);
  requestedParts.slice(0, -1).forEach((_, index) => expandedFolderPaths.add(requestedParts.slice(0, index + 1).join("/")));
  selectedFileKeys.clear();
  document.getElementById("n3xra-file-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-button")?.addEventListener("click", chooseFolder);
  document.getElementById("n3xra-file-list")?.addEventListener("click", (event) => {
    const selectableRow = event.target.closest("[data-selectable-file]");
    if (selectableRow && !event.target.closest("input, label, button, a, summary, details")) {
      const file = fileState.files.find((item) => fileSelectionKey(item) === selectableRow.dataset.selectableFile);
      if (file) void openFile(file.id);
      return;
    }
    const menu = event.target.closest(".n3xra-file-menu");
    const menuSummary = event.target.closest(".n3xra-file-menu > summary");
    if (menuSummary) document.querySelectorAll(".n3xra-file-menu[open]").forEach((item) => { if (item !== menu) item.removeAttribute("open"); });
    const open = event.target.closest("[data-file-open]");
    const download = event.target.closest("[data-file-download]");
    const remove = event.target.closest("[data-file-delete]");
    const publish = event.target.closest("[data-file-publish]");
    const unpublish = event.target.closest("[data-file-unpublish]");
    const copyCdn = event.target.closest("[data-file-copy-cdn]");
    const openCdn = event.target.closest("[data-file-open-cdn]");
    const manage = event.target.closest("[data-file-manage-access]");
    const closeAccess = event.target.closest("[data-file-close-access]");
    const save = event.target.closest("[data-file-save-access]");
    const websiteActionButton = event.target.closest("[data-website-file-approve], [data-website-file-reject], [data-website-file-publish], [data-website-file-publish-original], [data-website-file-rename], [data-website-file-copy], [data-website-file-optimize], [data-website-file-original]");
    if (websiteActionButton) {
      const actionEntry = Object.entries(websiteActionButton.dataset).find(([key]) => key.startsWith("websiteFile"));
      const action = actionEntry?.[0].replace("websiteFile", "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
      menu?.removeAttribute("open");
      if (action && actionEntry?.[1]) void handleWebsiteFileAction(action, actionEntry[1]);
      return;
    }
    if (manage) {
      const panel = document.getElementById(`file-access-${manage.dataset.fileManageAccess}`);
      if (panel) panel.hidden = !panel.hidden;
      menu?.removeAttribute("open");
      return;
    }
    if (closeAccess) {
      document.getElementById(`file-access-${closeAccess.dataset.fileCloseAccess}`)?.setAttribute("hidden", "");
      return;
    }
    if (open) { menu?.removeAttribute("open"); openFile(open.dataset.fileOpen); return; }
    if (download) { menu?.removeAttribute("open"); downloadFile(download.dataset.fileDownload); }
    if (publish) { menu?.removeAttribute("open"); publishFile(publish.dataset.filePublish); }
    if (unpublish) { menu?.removeAttribute("open"); unpublishFile(unpublish.dataset.fileUnpublish); }
    if (copyCdn) { menu?.removeAttribute("open"); copyCdnLink(copyCdn.dataset.fileCopyCdn); }
    if (openCdn) { menu?.removeAttribute("open"); openCdnLink(openCdn.dataset.fileOpenCdn); }
    if (remove) { menu?.removeAttribute("open"); deleteFile(remove.dataset.fileDelete); }
    if (save) saveAccess(save);
  });
  document.getElementById("n3xra-file-list")?.addEventListener("change", handleFileSelection);
  document.getElementById("n3xra-clear-selection")?.addEventListener("click", () => {
    selectedFileKeys.clear();
    renderFiles();
  });
  document.getElementById("n3xra-download-selected")?.addEventListener("click", downloadSelectedFiles);
  document.getElementById("n3xra-approve-selected")?.addEventListener("click", approveSelectedWebsiteFiles);
  document.getElementById("n3xra-reject-selected")?.addEventListener("click", rejectSelectedWebsiteFiles);
  document.getElementById("n3xra-publish-selected")?.addEventListener("click", publishSelectedFiles);
  document.getElementById("n3xra-copy-selected-links")?.addEventListener("click", copySelectedPublishedLinks);
  document.getElementById("n3xra-refresh-selected-cdn")?.addEventListener("click", refreshSelectedWebsiteCdnFiles);
  document.getElementById("n3xra-delete-selected")?.addEventListener("click", deleteSelectedFiles);
  document.getElementById("n3xra-folder-tree")?.addEventListener("click", (event) => {
    const removeFolder = event.target.closest("[data-folder-delete]");
    const folder = event.target.closest("[data-tree-folder]");
    if (removeFolder) { deleteFolder(removeFolder.dataset.folderDelete); return; }
    if (!folder) return;
    currentFolderPath = folder.dataset.treeFolder || "";
    selectedFileKeys.clear();
    if (folder.dataset.treeParent === "true") {
      if (expandedFolderPaths.has(currentFolderPath)) expandedFolderPaths.delete(currentFolderPath);
      else expandedFolderPaths.add(currentFolderPath);
    }
    renderFiles();
  });
  document.querySelector(".n3xra-files-breadcrumb")?.addEventListener("click", (event) => {
    const folder = event.target.closest("[data-folder-path]");
    if (!folder) return;
    currentFolderPath = folder.dataset.folderPath || "";
    selectedFileKeys.clear();
    renderFiles();
  });
  document.getElementById("n3xra-file-search")?.addEventListener("input", renderFiles);
  document.querySelectorAll("[data-preview-close]").forEach((element) => element.addEventListener("click", closePreview));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePreview(); });
  await loadFiles();
  await subscribeToWebsiteLibraries();
}
