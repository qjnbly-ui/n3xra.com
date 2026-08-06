let fileState = { files: [], access: [], admins: [], websites: [], websiteAssets: [], websiteVersions: [] };
let fileSupabase = null;
let fileInvoke = null;
let fileUserId = null;
let currentFolderPath = "";
const expandedFolderPaths = new Set();
const selectedFileKeys = new Set();
const WEBSITE_PRIVATE_BUCKET = "website-assets-private";
const WEBSITE_PUBLIC_BUCKET = "website-assets-public";

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
  return `<span class="n3xra-file-type is-${type.tone}" data-file-preview="${fileEscape(key)}" aria-hidden="true"><img alt="" hidden><span>${type.label}</span></span>`;
}

async function hydrateFilePreviews() {
  const previews = Array.from(document.querySelectorAll("#n3xra-file-list [data-file-preview]"));
  await Promise.all(previews.map(async (preview) => {
    const file = fileState.files.find((item) => fileSelectionKey(item) === preview.dataset.filePreview);
    if (!file || fileType(file).tone !== "image") return;
    try {
      const data = file.source === "website" ? await websiteFileUrl(file) : await fileInvoke("get-n3xra-file-url", { fileId: file.id });
      const image = preview.querySelector("img");
      const fallback = preview.querySelector(":scope > span");
      if (!image || !data?.url || !preview.isConnected) return;
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
  return fileState.websites.find((website) => website.folder_path === currentFolderPath) || null;
}

function fileSelectionKey(file) {
  return `${file.source || "n3xra"}:${file.id}`;
}

function selectedFiles() {
  return fileState.files.filter((file) => selectedFileKeys.has(fileSelectionKey(file)));
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
  fileState.websites.forEach((website) => {
    const existing = folders.get(website.folder_path) || { name: website.name, path: website.folder_path, depth: 1, count: 0 };
    existing.protected = true;
    folders.set(website.folder_path, existing);
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
  const copyButton = document.getElementById("n3xra-copy-selected-links");
  const deleteButton = document.getElementById("n3xra-delete-selected");
  if (!toolbar || !status || !clearButton || !downloadButton || !copyButton || !deleteButton) return;
  const availableKeys = new Set(fileState.files.map(fileSelectionKey));
  [...selectedFileKeys].forEach((key) => { if (!availableKeys.has(key)) selectedFileKeys.delete(key); });
  const selected = selectedFiles();
  const publishedCount = selected.filter((file) => file.public_url).length;
  toolbar.hidden = selected.length === 0;
  clearButton.hidden = selected.length === 0;
  downloadButton.hidden = selected.length === 0;
  status.textContent = `${selected.length} file${selected.length === 1 ? "" : "s"} selected`;
  downloadButton.textContent = `Download selected (${selected.length})`;
  copyButton.hidden = publishedCount === 0;
  copyButton.textContent = `Copy published links (${publishedCount})`;
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
    const fileMeta = websiteFile ? `${file.asset_key} · Version ${file.version_number}` : file.mime_type || "File";
    const selectionKey = fileSelectionKey(file);
    return `<article class="n3xra-file-row is-selectable${selectedFileKeys.has(selectionKey) ? " is-selected" : ""}" data-selectable-file="${fileEscape(selectionKey)}">
      <label class="n3xra-file-select"><input type="checkbox" data-file-select="${fileEscape(selectionKey)}"${selectedFileKeys.has(selectionKey) ? " checked" : ""} aria-label="Select ${fileEscape(pathParts(file.name).at(-1))}"></label>
      <button class="n3xra-file-name" type="button" data-file-open="${fileEscape(file.id)}">${filePreviewMarkup(file, type)}<span><strong>${fileEscape(pathParts(file.name).at(-1))}</strong><small>${fileEscape(fileMeta)}</small></span></button>
      ${websiteFile ? `<span class="n3xra-file-access is-status"><span aria-hidden="true">●</span>${fileEscape(accessLabel)}</span>` : `<button class="n3xra-file-access" type="button" data-file-manage-access="${fileEscape(file.id)}"><span aria-hidden="true">●</span>${accessLabel}</button>`}
      <time datetime="${fileEscape(file.created_at)}">${fileEscape(fileDate(file.created_at))}</time>
      <span class="n3xra-file-size">${fileEscape(fileSize(file.size_bytes))}</span>
      <details class="n3xra-file-menu"><summary aria-label="Actions for ${fileEscape(file.name)}">•••</summary><div class="n3xra-file-menu-popover"><button type="button" data-file-open="${fileEscape(file.id)}">Open</button><button type="button" data-file-download="${fileEscape(file.id)}">Download</button>${websiteFile ? "" : `<button type="button" data-file-manage-access="${fileEscape(file.id)}">Manage access</button>`}<button class="is-danger" type="button" data-file-delete="${fileEscape(file.id)}">Delete</button></div></details>
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
    ? await fileSupabase.from("website_asset_versions").select("id,asset_id,version_number,status,storage_bucket,storage_path,public_url,original_filename,mime_type,size_bytes,uploaded_by_user_id,created_at").in("asset_id", assetIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (versionResult.error) throw versionResult.error;
  const websiteById = new Map(websites.map((website) => [String(website.id), website]));
  const assetById = new Map(assets.map((asset) => [String(asset.id), asset]));
  const files = (versionResult.data || []).flatMap((version) => {
    const asset = assetById.get(String(version.asset_id));
    const website = asset && websiteById.get(String(asset.website_id));
    return website ? [{ ...version, source: "website", website_id: website.id, website_name: website.name, asset_id: asset.id, asset_key: asset.asset_key, current_version_id: asset.current_version_id, name: `${website.folder_path}/${version.original_filename}` }] : [];
  });
  return { websites, assets, versions: versionResult.data || [], files };
}

async function loadFiles() {
  const [data, websiteData] = await Promise.all([fileInvoke("list-n3xra-files"), loadWebsiteFiles()]);
  fileState = { files: [...(data.files || []).map((file) => ({ ...file, source: "n3xra" })), ...websiteData.files], access: data.access || [], admins: data.admins || [], websites: websiteData.websites, websiteAssets: websiteData.assets, websiteVersions: websiteData.versions };
  renderFiles();
  fileStatus();
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
      category: websiteAssetCategory(file),
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
        status: "pending_review",
        storage_bucket: WEBSITE_PRIVATE_BUCKET,
        storage_path: storagePath,
        original_filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by_user_id: fileUserId,
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
  fileStatus(`${uploadedCount} website file${uploadedCount === 1 ? "" : "s"} uploaded for review.`, "success");
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
  if (selected.length > 5 && !window.confirm(`Download ${selected.length} selected files? Your browser may ask for permission to download multiple files.`)) return;
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
  const published = selectedFiles().filter((file) => file.public_url);
  if (!published.length) return;
  const links = published.map((file) => `${pathParts(file.name).at(-1)} — ${file.public_url}`).join("\n");
  try {
    await navigator.clipboard.writeText(links);
    fileStatus(`${published.length} published link${published.length === 1 ? "" : "s"} copied.`, "success");
  } catch {
    fileStatus("The published links could not be copied. Check this browser’s clipboard permission.", "error");
  }
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

function confirmDelete(fileName) {
  const modal = document.getElementById("file-confirm-modal");
  const copy = document.getElementById("file-confirm-copy");
  const confirmButton = document.getElementById("file-confirm-delete");
  if (!modal || !copy || !confirmButton) return Promise.resolve(false);
  copy.textContent = `“${fileName}” will be permanently removed from N3XRA Files.`;
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
  currentFolderPath = "";
  expandedFolderPaths.clear();
  selectedFileKeys.clear();
  document.getElementById("n3xra-file-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-button")?.addEventListener("click", chooseFolder);
  document.getElementById("n3xra-file-list")?.addEventListener("click", (event) => {
    const selectableRow = event.target.closest("[data-selectable-file]");
    if (selectableRow && !event.target.closest("input, label, button, a, summary, details")) {
      const key = selectableRow.dataset.selectableFile;
      if (selectedFileKeys.has(key)) selectedFileKeys.delete(key);
      else selectedFileKeys.add(key);
      renderFiles();
      return;
    }
    const menu = event.target.closest(".n3xra-file-menu");
    const menuSummary = event.target.closest(".n3xra-file-menu > summary");
    if (menuSummary) document.querySelectorAll(".n3xra-file-menu[open]").forEach((item) => { if (item !== menu) item.removeAttribute("open"); });
    const open = event.target.closest("[data-file-open]");
    const download = event.target.closest("[data-file-download]");
    const remove = event.target.closest("[data-file-delete]");
    const manage = event.target.closest("[data-file-manage-access]");
    const closeAccess = event.target.closest("[data-file-close-access]");
    const save = event.target.closest("[data-file-save-access]");
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
    if (remove) { menu?.removeAttribute("open"); deleteFile(remove.dataset.fileDelete); }
    if (save) saveAccess(save);
  });
  document.getElementById("n3xra-file-list")?.addEventListener("change", handleFileSelection);
  document.getElementById("n3xra-clear-selection")?.addEventListener("click", () => {
    selectedFileKeys.clear();
    renderFiles();
  });
  document.getElementById("n3xra-download-selected")?.addEventListener("click", downloadSelectedFiles);
  document.getElementById("n3xra-copy-selected-links")?.addEventListener("click", copySelectedPublishedLinks);
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
}
