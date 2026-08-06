let fileState = { files: [], access: [], admins: [] };
let fileSupabase = null;
let fileInvoke = null;
let currentFolderPath = "";

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

function safeUploadPath(value) {
  return String(value || "file")
    .split(/[\\/]+/)
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .replaceAll("..", ".") || "file";
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

function isUnderPath(parts, parentParts) {
  return parentParts.every((part, index) => parts[index] === part);
}

function renderBreadcrumb() {
  const breadcrumb = document.querySelector(".n3xra-files-breadcrumb");
  if (!breadcrumb) return;
  const parts = pathParts(currentFolderPath);
  breadcrumb.innerHTML = `<button class="n3xra-breadcrumb-button${parts.length ? "" : " is-current"}" type="button" data-folder-path="">N3XRA Files</button>${parts.map((part, index) => `<span aria-hidden="true">/</span><button class="n3xra-breadcrumb-button${index === parts.length - 1 ? " is-current" : ""}" type="button" data-folder-path="${fileEscape(parts.slice(0, index + 1).join("/"))}">${fileEscape(part)}</button>`).join("")}`;
}

function renderFiles() {
  const list = document.getElementById("n3xra-file-list");
  if (!list) return;
  renderBreadcrumb();
  const parentParts = pathParts(currentFolderPath);
  const query = String(document.getElementById("n3xra-file-search")?.value || "").trim().toLowerCase();
  const folders = new Map();
  const files = [];
  const visibleFiles = query ? fileState.files.filter((file) => String(file.name || "").toLowerCase().includes(query)) : fileState.files;
  visibleFiles.forEach((file) => {
    if (query) { files.push(file); return; }
    const parts = pathParts(file.name);
    if (!isUnderPath(parts, parentParts) || parts.length <= parentParts.length) return;
    const remaining = parts.slice(parentParts.length);
    if (remaining.length > 1) {
      const folderName = remaining[0];
      const folderPath = [...parentParts, folderName].join("/");
      const entry = folders.get(folderPath) || { name: folderName, path: folderPath, count: 0 };
      entry.count += 1;
      folders.set(folderPath, entry);
    } else {
      files.push(file);
    }
  });
  const folderEntries = [...folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!folderEntries.length && !files.length) {
    list.innerHTML = '<div class="n3xra-empty">This folder is empty. Upload a file to get started.</div>';
    return;
  }
  const folderMarkup = query ? "" : folderEntries.map((folder) => `<div class="n3xra-folder-entry"><button class="n3xra-folder-open" type="button" data-folder-path="${fileEscape(folder.path)}"><span class="n3xra-folder-entry-icon" aria-hidden="true">▰</span><span><strong>${fileEscape(folder.name)}</strong><small>${folder.count} file${folder.count === 1 ? "" : "s"}</small></span><span class="n3xra-folder-entry-chevron" aria-hidden="true">›</span></button><button class="portal-button portal-button-secondary n3xra-folder-delete" type="button" data-folder-delete="${fileEscape(folder.path)}">Delete folder</button></div>`).join("");
  const fileMarkup = files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => {
    const access = accessFor(file.id);
    return `<article class="n3xra-file-row">
      <div class="n3xra-file-meta"><span aria-hidden="true">📄</span><div><strong>${fileEscape(pathParts(file.name).at(-1))}</strong><small>${fileEscape(fileSize(file.size_bytes))} · added ${fileEscape(fileDate(file.created_at))}</small></div></div>
      <div class="n3xra-file-controls"><button class="portal-button" type="button" data-file-open="${fileEscape(file.id)}">Open</button><button class="portal-button portal-button-secondary" type="button" data-file-download="${fileEscape(file.id)}">Download</button><button class="portal-button portal-button-secondary" type="button" data-file-delete="${fileEscape(file.id)}">Delete</button></div>
      <details class="n3xra-access-panel"><summary>Assign access</summary><div class="n3xra-access-options">${fileState.admins.map((admin) => `<label><input type="checkbox" data-file-access="${fileEscape(file.id)}" value="${fileEscape(admin.user_id)}"${access.has(String(admin.user_id)) ? " checked" : ""}>${fileEscape(admin.email)}${admin.role === "owner" ? " (owner)" : ""}</label>`).join("")}</div><button class="portal-button portal-button-secondary" type="button" data-file-save-access="${fileEscape(file.id)}">Save access</button></details>
    </article>`;
  }).join("");
  list.innerHTML = folderMarkup + fileMarkup;
}

async function loadFiles() {
  const data = await fileInvoke("list-n3xra-files");
  fileState = { files: data.files || [], access: data.access || [], admins: data.admins || [] };
  renderFiles();
  fileStatus(`${fileState.files.length} file${fileState.files.length === 1 ? "" : "s"} available to you.`, "success");
}

async function uploadFiles(input) {
  const selected = Array.isArray(input) ? input : Array.from(input.target.files || []);
  if (!Array.isArray(input)) input.target.value = "";
  if (!selected.length) return;
  for (const file of selected) {
    fileStatus(`Uploading ${file.name}…`);
    const relativeName = file.webkitRelativePath || file.name;
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

async function downloadFile(id) {
  fileStatus("Preparing download…");
  try {
    const data = await fileInvoke("get-n3xra-file-url", { fileId: id });
    const link = document.createElement("a");
    link.href = data.url;
    link.download = data.name || "download";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
    fileStatus("Download ready.", "success");
  } catch (error) { fileStatus(error.message, "error"); }
}

async function openFile(id) {
  const file = fileState.files.find((item) => String(item.id) === String(id));
  if (!file) return;
  fileStatus("Preparing preview…");
  try {
    const data = await fileInvoke("get-n3xra-file-url", { fileId: id });
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
    currentFolderPath = "";
    await loadFiles();
  } catch (error) { fileStatus(error.message, "error"); }
}

async function deleteFile(id) {
  const file = fileState.files.find((item) => String(item.id) === String(id));
  if (!file || !(await confirmDelete(file.name))) return;
  fileStatus("Deleting file…");
  try { await fileInvoke("delete-n3xra-file", { fileId: id }); await loadFiles(); }
  catch (error) { fileStatus(error.message, "error"); }
}

async function saveAccess(button) {
  const fileId = button.dataset.fileSaveAccess;
  const userIds = [...document.querySelectorAll(`[data-file-access="${CSS.escape(fileId)}"]:checked`)].map((input) => input.value);
  button.disabled = true;
  try {
    const data = await fileInvoke("update-n3xra-file-access", { fileId, userIds });
    fileState.access = fileState.access.filter((item) => String(item.file_id) !== String(fileId));
    fileState.access.push(...(data.userIds || []).map((userId) => ({ file_id: fileId, user_id: userId })));
    fileStatus("File access saved.", "success");
  } catch (error) { fileStatus(error.message, "error"); }
  finally { button.disabled = false; }
}

export async function startFiles({ supabase, invoke }) {
  fileSupabase = supabase;
  fileInvoke = invoke;
  document.getElementById("open-files-folder")?.addEventListener("click", () => {
    currentFolderPath = "";
    document.getElementById("n3xra-folder-view")?.classList.add("hidden");
    document.getElementById("n3xra-file-view")?.classList.remove("hidden");
    loadFiles().catch((error) => fileStatus(error.message, "error"));
  });
  document.getElementById("close-files-folder")?.addEventListener("click", () => {
    currentFolderPath = "";
    document.getElementById("n3xra-file-view")?.classList.add("hidden");
    document.getElementById("n3xra-folder-view")?.classList.remove("hidden");
  });
  document.getElementById("n3xra-file-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-folder-button")?.addEventListener("click", chooseFolder);
  document.getElementById("n3xra-file-list")?.addEventListener("click", (event) => {
    const folder = event.target.closest("[data-folder-path]");
    const open = event.target.closest("[data-file-open]");
    const download = event.target.closest("[data-file-download]");
    const remove = event.target.closest("[data-file-delete]");
    const removeFolder = event.target.closest("[data-folder-delete]");
    const save = event.target.closest("[data-file-save-access]");
    if (folder) {
      currentFolderPath = folder.dataset.folderPath || "";
      renderFiles();
      return;
    }
    if (removeFolder) { deleteFolder(removeFolder.dataset.folderDelete); return; }
    if (open) { openFile(open.dataset.fileOpen); return; }
    if (download) downloadFile(download.dataset.fileDownload);
    if (remove) deleteFile(remove.dataset.fileDelete);
    if (save) saveAccess(save);
  });
  document.querySelector(".n3xra-files-breadcrumb")?.addEventListener("click", (event) => {
    const folder = event.target.closest("[data-folder-path]");
    if (!folder) return;
    currentFolderPath = folder.dataset.folderPath || "";
    renderFiles();
  });
  document.getElementById("n3xra-file-search")?.addEventListener("input", renderFiles);
  document.querySelectorAll("[data-preview-close]").forEach((element) => element.addEventListener("click", closePreview));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePreview(); });
}
