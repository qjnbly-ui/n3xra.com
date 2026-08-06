let fileState = { files: [], access: [], admins: [] };
let fileSupabase = null;
let fileInvoke = null;

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

function fileStatus(message = "", tone = "") {
  const element = document.getElementById("admin-status");
  if (!element) return;
  element.textContent = message;
  element.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function accessFor(fileId) {
  return new Set(fileState.access.filter((item) => String(item.file_id) === String(fileId)).map((item) => String(item.user_id)));
}

function renderFiles() {
  const list = document.getElementById("n3xra-file-list");
  if (!list) return;
  if (!fileState.files.length) {
    list.innerHTML = '<div class="n3xra-empty">This folder is empty. Upload a file to get started.</div>';
    return;
  }
  list.innerHTML = fileState.files.map((file) => {
    const access = accessFor(file.id);
    return `<article class="n3xra-file-row">
      <div class="n3xra-file-meta"><span aria-hidden="true">📄</span><div><strong>${fileEscape(file.name)}</strong><small>${fileEscape(fileSize(file.size_bytes))} · added ${fileEscape(fileDate(file.created_at))}</small></div></div>
      <div class="n3xra-file-controls"><button class="portal-button portal-button-secondary" type="button" data-file-download="${fileEscape(file.id)}">Download</button><button class="portal-button portal-button-secondary" type="button" data-file-delete="${fileEscape(file.id)}">Delete</button></div>
      <details class="n3xra-access-panel"><summary>Assign access</summary><div class="n3xra-access-options">${fileState.admins.map((admin) => `<label><input type="checkbox" data-file-access="${fileEscape(file.id)}" value="${fileEscape(admin.user_id)}"${access.has(String(admin.user_id)) ? " checked" : ""}>${fileEscape(admin.email)}${admin.role === "owner" ? " (owner)" : ""}</label>`).join("")}</div><button class="portal-button portal-button-secondary" type="button" data-file-save-access="${fileEscape(file.id)}">Save access</button></details>
    </article>`;
  }).join("");
}

async function loadFiles() {
  const data = await fileInvoke("list-n3xra-files");
  fileState = { files: data.files || [], access: data.access || [], admins: data.admins || [] };
  renderFiles();
  fileStatus(`${fileState.files.length} file${fileState.files.length === 1 ? "" : "s"} available to you.`, "success");
}

async function uploadFiles(event) {
  const selected = Array.from(event.target.files || []);
  event.target.value = "";
  if (!selected.length) return;
  for (const file of selected) {
    fileStatus(`Uploading ${file.name}…`);
    const safeName = file.name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
    const path = `uploads/${crypto.randomUUID()}-${safeName.slice(0, 180)}`;
    const { error } = await fileSupabase.storage.from("n3xra-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) { fileStatus(error.message, "error"); return; }
    try {
      await fileInvoke("create-n3xra-file", { name: file.name, storagePath: path, mimeType: file.type || "application/octet-stream", sizeBytes: file.size });
    } catch (error) {
      await fileSupabase.storage.from("n3xra-files").remove([path]);
      fileStatus(error.message, "error");
      return;
    }
  }
  await loadFiles();
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

async function deleteFile(id) {
  const file = fileState.files.find((item) => String(item.id) === String(id));
  if (!file || !window.confirm(`Delete ${file.name}?`)) return;
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
    document.getElementById("n3xra-folder-view")?.classList.add("hidden");
    document.getElementById("n3xra-file-view")?.classList.remove("hidden");
    loadFiles().catch((error) => fileStatus(error.message, "error"));
  });
  document.getElementById("close-files-folder")?.addEventListener("click", () => {
    document.getElementById("n3xra-file-view")?.classList.add("hidden");
    document.getElementById("n3xra-folder-view")?.classList.remove("hidden");
  });
  document.getElementById("n3xra-file-input")?.addEventListener("change", uploadFiles);
  document.getElementById("n3xra-file-list")?.addEventListener("click", (event) => {
    const download = event.target.closest("[data-file-download]");
    const remove = event.target.closest("[data-file-delete]");
    const save = event.target.closest("[data-file-save-access]");
    if (download) downloadFile(download.dataset.fileDownload);
    if (remove) deleteFile(remove.dataset.fileDelete);
    if (save) saveAccess(save);
  });
}
