import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
const PRIVATE_BUCKET = "organization-files-private";
const WEBSITE_PRIVATE_BUCKET = "website-assets-private";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const CATEGORY_LABELS = { image: "Images", logo: "Logo", document: "Documents", brand: "Brand assets", social: "Social", journal: "Journal", visitor_submission: "Visitor submissions", other: "Other files" };
const CATEGORY_KEYS = Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([key, label]) => [label.toLowerCase(), key]));
let supabase;
let userId = "";
let memberships = [];
let activeOrganization = null;
let folders = [];
let organizationFiles = [];
let websites = [];
let websiteAssets = [];
let websiteVersions = [];
let activeLocation = "all";
const one = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const bytes = (value) => { const size = Number(value || 0); if (size < 1024)
    return `${size} B`; if (size < 1024 ** 2)
    return `${(size / 1024).toFixed(1)} KB`; if (size < 1024 ** 3)
    return `${(size / 1024 ** 2).toFixed(1)} MB`; return `${(size / 1024 ** 3).toFixed(1)} GB`; };
const date = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const safeName = (value) => value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
const assetKey = (value) => { const base = value.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset"; return /^[a-z]/.test(base) ? base : `file-${base}`; };
const folderLabel = (category) => CATEGORY_LABELS[category] || category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
function normalizeMembership(row) {
    const organization = Array.isArray(row.organization) ? row.organization[0] : row.organization;
    return organization ? { organization_id: row.organization_id, role: row.role, organization } : null;
}
function canManage() {
    return memberships.find((membership) => membership.organization_id === activeOrganization?.id)?.role !== "viewer";
}
function websiteFiles() {
    const assetById = new Map(websiteAssets.map((asset) => [asset.id, asset]));
    const websiteById = new Map(websites.map((website) => [website.id, website]));
    return websiteVersions.flatMap((version) => {
        const asset = assetById.get(version.asset_id);
        const website = asset && websiteById.get(asset.website_id);
        return asset && website ? [{ ...version, source: "website", website_id: website.id, website_name: website.name, category: asset.category, display_name: version.original_filename, shared_with_n3xra: true }] : [];
    });
}
function allFiles() { return [...organizationFiles, ...websiteFiles()]; }
function locationFiles() {
    if (activeLocation === "all")
        return allFiles();
    if (activeLocation === "private")
        return organizationFiles.filter((file) => !file.folder_id);
    if (activeLocation.startsWith("folder:"))
        return organizationFiles.filter((file) => file.folder_id === activeLocation.slice(7));
    if (activeLocation.startsWith("website:")) {
        const [, websiteId = "", category = ""] = activeLocation.split(":");
        return websiteFiles().filter((file) => file.website_id === websiteId && (!category || file.category === category));
    }
    if (activeLocation === "websites")
        return websiteFiles();
    if (activeLocation === "projects")
        return organizationFiles.filter((file) => folders.some((folder) => folder.id === file.folder_id && folder.source_product === "project_cards"));
    if (activeLocation === "maps")
        return organizationFiles.filter((file) => folders.some((folder) => folder.id === file.folder_id && folder.source_product === "maps"));
    return [];
}
function fileType(file) {
    const mime = String(file.mime_type || "").toLowerCase();
    const extension = file.original_filename.split(".").pop()?.toUpperCase() || "FILE";
    if (mime.includes("pdf") || extension === "PDF")
        return "PDF";
    if (mime.startsWith("image/"))
        return "IMG";
    if (mime.startsWith("video/"))
        return "VID";
    return extension.slice(0, 4);
}
function renderTree() {
    const target = one("#files-folder-tree");
    if (!target || !activeOrganization)
        return;
    const privateFolders = folders.filter((folder) => folder.source_product === "files_assets");
    const projectFolders = folders.filter((folder) => folder.source_product === "project_cards");
    const mapFolders = folders.filter((folder) => folder.source_product === "maps");
    const mapAssetFolders = mapFolders.filter((folder) => folder.parent_id);
    const button = (location, name, count, className = "", badge = "") => `<button class="files-folder ${className}${activeLocation === location ? " is-current" : ""}" type="button" data-location="${escape(location)}"><i>▰</i><span><strong>${escape(name)}</strong><small>${count} file${count === 1 ? "" : "s"}</small></span>${badge ? `<em>${escape(badge)}</em>` : ""}</button>`;
    target.innerHTML = [
        button("all", "All files", allFiles().length, "", "Private"),
        button("private", "Private files", organizationFiles.filter((file) => !file.folder_id).length),
        ...privateFolders.map((folder) => button(`folder:${folder.id}`, folder.name, organizationFiles.filter((file) => file.folder_id === folder.id).length, "is-child")),
        button("websites", "Websites", websiteFiles().length, "", "Shared"),
        ...websites.flatMap((website) => {
            const websiteFileRows = websiteFiles().filter((file) => file.website_id === website.id);
            const categories = [...new Set([...Object.keys(CATEGORY_LABELS), ...websiteFileRows.map((file) => file.category)])];
            return [button(`website:${website.id}`, website.name, websiteFileRows.length, "is-child"), ...categories.map((category) => button(`website:${website.id}:${category}`, folderLabel(category), websiteFileRows.filter((file) => file.category === category).length, "is-grandchild"))];
        }),
        button("projects", "Project Cards", projectFolders.reduce((total, folder) => total + organizationFiles.filter((file) => file.folder_id === folder.id).length, 0), "", "Private"),
        ...projectFolders.map((folder) => button(`folder:${folder.id}`, folder.name, organizationFiles.filter((file) => file.folder_id === folder.id).length, "is-child")),
        button("maps", "Maps", mapFolders.reduce((total, folder) => total + organizationFiles.filter((file) => file.folder_id === folder.id).length, 0), "", "Private"),
        ...mapAssetFolders.map((folder) => button(`folder:${folder.id}`, folder.name, organizationFiles.filter((file) => file.folder_id === folder.id).length, "is-child")),
    ].join("");
}
function locationName() {
    if (activeLocation === "all")
        return "All files";
    if (activeLocation === "private")
        return "Private files";
    if (activeLocation === "websites")
        return "Websites";
    if (activeLocation === "projects")
        return "Project Cards";
    if (activeLocation === "maps")
        return "Maps";
    if (activeLocation.startsWith("folder:"))
        return folders.find((folder) => folder.id === activeLocation.slice(7))?.name || "Folder";
    if (activeLocation.startsWith("website:")) {
        const [, websiteId = "", category = ""] = activeLocation.split(":");
        const website = websites.find((row) => row.id === websiteId);
        return category ? `${website?.name || "Website"} / ${folderLabel(category)}` : website?.name || "Website";
    }
    return "Files";
}
function renderFiles() {
    const list = one("#files-list");
    const status = one("#files-status");
    const query = one("#files-search")?.value.trim().toLowerCase() || "";
    const visible = locationFiles().filter((file) => `${file.display_name} ${file.original_filename} ${file.mime_type || ""}`.toLowerCase().includes(query));
    const title = locationName();
    if (one("#files-title"))
        one("#files-title").textContent = title;
    if (one("#files-breadcrumb"))
        one("#files-breadcrumb").textContent = `Files / ${title}`;
    if (one("#files-summary"))
        one("#files-summary").textContent = `${visible.length} file${visible.length === 1 ? "" : "s"} · ${bytes(visible.reduce((total, file) => total + Number(file.size_bytes || 0), 0))}`;
    if (!list || !status)
        return;
    status.hidden = true;
    list.hidden = false;
    const header = '<div class="files-list-head"><span>Name</span><span>Access</span><span>Modified</span><span>Size</span><span></span></div>';
    list.innerHTML = visible.length ? header + visible.map((file) => {
        const website = file.source === "website";
        const access = website ? "Shared for website" : file.shared_with_n3xra ? "Shared with N3XRA" : "Private";
        return `<article class="files-row"><button class="files-open" type="button" data-open="${escape(file.source)}:${escape(file.id)}"><span class="files-type">${escape(fileType(file))}</span><span><strong>${escape(file.display_name)}</strong><small>${escape(file.original_filename)}${website ? ` · ${escape(file.website_name)}` : ""}</small></span></button><button class="files-access ${website ? "is-website" : file.shared_with_n3xra ? "" : "is-private"}" type="button" ${website ? "disabled" : `data-share="${escape(file.id)}"`}>${escape(access)}</button><time>${escape(date(file.updated_at || file.created_at))}</time><span class="files-size">${escape(bytes(file.size_bytes))}</span><details class="files-menu"><summary aria-label="File actions">•••</summary><div><button type="button" data-open="${escape(file.source)}:${escape(file.id)}">Open</button>${website ? "" : `<button type="button" data-share="${escape(file.id)}">${file.shared_with_n3xra ? "Stop sharing with N3XRA" : "Share with N3XRA"}</button><button type="button" data-delete="${escape(file.id)}">Delete</button>`}</div></details></article>`;
    }).join("") : '<div class="files-empty"><strong>This folder is empty.</strong><p>Upload a file here when you are ready.</p></div>';
    renderTree();
    syncActions();
}
function syncActions() {
    const websiteLocation = activeLocation.startsWith("website:");
    const upload = one("#files-upload");
    const label = document.querySelector('label[for="files-upload"]');
    const folderButton = one("#files-new-folder");
    const allowed = canManage() && activeLocation !== "websites" && activeLocation !== "projects" && activeLocation !== "maps" && activeLocation !== "all";
    if (upload)
        upload.disabled = !allowed;
    if (label) {
        label.style.opacity = allowed ? "1" : ".45";
        label.style.pointerEvents = allowed ? "auto" : "none";
        label.textContent = websiteLocation ? "Upload website files" : "Upload files";
    }
    if (folderButton)
        folderButton.hidden = !canManage() || activeLocation.startsWith("website:") || activeLocation === "websites" || activeLocation === "projects" || activeLocation === "maps";
}
async function loadLibrary() {
    if (!activeOrganization)
        return;
    await supabase.rpc("activate_files_assets", { input_organization_id: activeOrganization.id });
    const [folderResult, fileResult, websiteResult] = await Promise.all([
        supabase.from("organization_file_folders").select("id,organization_id,parent_id,name,source_product,source_entity_id,is_system").eq("organization_id", activeOrganization.id).order("name"),
        supabase.from("organization_files").select("id,organization_id,folder_id,display_name,original_filename,storage_bucket,storage_path,mime_type,size_bytes,shared_with_n3xra,created_at,updated_at").eq("organization_id", activeOrganization.id).order("updated_at", { ascending: false }),
        supabase.from("client_websites").select("id,organization_id,name").eq("organization_id", activeOrganization.id).order("name"),
    ]);
    const firstError = folderResult.error || fileResult.error || websiteResult.error;
    if (firstError)
        throw firstError;
    folders = (folderResult.data || []);
    organizationFiles = (fileResult.data || []).map((file) => ({ ...file, source: "private" }));
    websites = (websiteResult.data || []);
    const websiteIds = websites.map((website) => website.id);
    const assetResult = websiteIds.length ? await supabase.from("website_assets").select("id,website_id,label,category,current_version_id").in("website_id", websiteIds).eq("status", "active") : { data: [], error: null };
    if (assetResult.error)
        throw assetResult.error;
    websiteAssets = (assetResult.data || []);
    const assetIds = websiteAssets.map((asset) => asset.id);
    const versionResult = assetIds.length ? await supabase.from("website_asset_versions").select("id,asset_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,status,created_at,updated_at").in("asset_id", assetIds).order("updated_at", { ascending: false }) : { data: [], error: null };
    if (versionResult.error)
        throw versionResult.error;
    websiteVersions = (versionResult.data || []);
    renderFiles();
}
async function signedFile(file, download = false) {
    const bucket = file.storage_bucket;
    const path = file.storage_path;
    if (!bucket || !path)
        throw new Error("This file does not have a stored copy.");
    const options = download ? { download: file.original_filename } : undefined;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600, options);
    if (error || !data?.signedUrl)
        throw new Error(error?.message || "Unable to prepare this file.");
    return data.signedUrl;
}
async function previewFile(key) {
    const [source = "", id = ""] = key.split(":");
    const file = allFiles().find((row) => row.source === source && row.id === id);
    if (!file)
        return;
    const url = await signedFile(file);
    const dialog = one("#files-preview-dialog");
    const body = one("#files-preview-body");
    if (!dialog || !body)
        return;
    one("#files-preview-title").textContent = file.display_name;
    one("#files-preview-kicker").textContent = file.source === "website" ? "WEBSITE ASSET · SHARED WITH N3XRA" : file.shared_with_n3xra ? "SHARED WITH N3XRA" : "PRIVATE FILE";
    const download = one("#files-preview-download");
    if (download) {
        download.href = await signedFile(file, true);
        download.download = file.original_filename;
    }
    const mime = String(file.mime_type || "").toLowerCase();
    body.innerHTML = mime.startsWith("image/") ? `<img src="${escape(url)}" alt="${escape(file.display_name)}">` : mime === "application/pdf" ? `<iframe src="${escape(url)}" title="${escape(file.display_name)}"></iframe>` : mime.startsWith("video/") ? `<video src="${escape(url)}" controls></video>` : `<p>This file is ready to download.</p>`;
    dialog.showModal();
}
async function uploadPrivateFile(file) {
    if (!activeOrganization)
        return;
    if (file.size > MAX_UPLOAD_BYTES)
        throw new Error(`${file.name} is larger than 50 MB.`);
    const folderId = activeLocation.startsWith("folder:") ? activeLocation.slice(7) : null;
    const id = crypto.randomUUID();
    const path = `${activeOrganization.id}/files/${id}-${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (uploadError)
        throw uploadError;
    const { error } = await supabase.from("organization_files").insert({ id, organization_id: activeOrganization.id, folder_id: folderId, display_name: file.name.replace(/\.[^.]+$/, "") || file.name, original_filename: file.name, source_kind: "upload", provider: "n3xra", storage_bucket: PRIVATE_BUCKET, storage_path: path, mime_type: file.type || null, size_bytes: file.size, shared_with_n3xra: false, created_by_user_id: userId });
    if (error) {
        await supabase.storage.from(PRIVATE_BUCKET).remove([path]);
        throw error;
    }
}
async function uploadWebsiteFile(file, websiteId, category) {
    if (file.size > MAX_UPLOAD_BYTES)
        throw new Error(`${file.name} is larger than 50 MB.`);
    let key = assetKey(file.name);
    let suffix = 2;
    const used = new Set(websiteAssets.filter((asset) => asset.website_id === websiteId).map((asset) => asset.label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")));
    while (used.has(key))
        key = `${assetKey(file.name)}-${suffix++}`;
    const assetId = crypto.randomUUID();
    const { error: assetError } = await supabase.from("website_assets").insert({ id: assetId, website_id: websiteId, asset_key: key, label: file.name.replace(/\.[^.]+$/, "") || file.name, category: category || "other", replacement_type: "download_only", created_by_user_id: userId });
    if (assetError)
        throw assetError;
    const path = `${websiteId}/${assetId}/v1-${crypto.randomUUID()}-${safeName(file.name)}`;
    try {
        const { error: uploadError } = await supabase.storage.from(WEBSITE_PRIVATE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (uploadError)
            throw uploadError;
        const { error: versionError } = await supabase.from("website_asset_versions").insert({ asset_id: assetId, version_number: 1, status: "pending_review", storage_bucket: WEBSITE_PRIVATE_BUCKET, storage_path: path, original_filename: file.name, mime_type: file.type || null, size_bytes: file.size, change_note: "Uploaded from Files & Assets", uploaded_by_user_id: userId });
        if (versionError)
            throw versionError;
    }
    catch (error) {
        await supabase.storage.from(WEBSITE_PRIVATE_BUCKET).remove([path]);
        await supabase.from("website_assets").delete().eq("id", assetId);
        throw error;
    }
}
async function start() {
    if (!hasConfig())
        throw new Error("The N3XRA data connection is not configured.");
    supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
    }
    userId = session.user.id;
    const { data, error } = await supabase.from("organization_memberships").select("organization_id,role,organization:organizations(id,name)").eq("user_id", userId);
    if (error)
        throw error;
    memberships = (data || []).map(normalizeMembership).filter((row) => Boolean(row));
    if (!memberships.length)
        throw new Error("Files & Assets needs an organization workspace.");
    const requested = new URLSearchParams(window.location.search).get("organization") || getStoredActiveOrganizationId();
    activeOrganization = memberships.find((membership) => membership.organization_id === requested)?.organization || memberships[0].organization;
    setStoredActiveOrganizationId(activeOrganization.id);
    const select = one("#files-organization");
    if (select) {
        select.innerHTML = memberships.map((membership) => `<option value="${escape(membership.organization_id)}">${escape(membership.organization.name)}</option>`).join("");
        select.value = activeOrganization.id;
        select.disabled = memberships.length === 1;
    }
    await loadLibrary();
    document.body.classList.remove("files-loading");
}
one("#files-folder-tree")?.addEventListener("click", (event) => { const button = event.target.closest("[data-location]"); if (!button)
    return; activeLocation = button.dataset.location || "all"; renderFiles(); });
one("#files-search")?.addEventListener("input", renderFiles);
one("#files-organization")?.addEventListener("change", (event) => { const id = event.target.value; activeOrganization = memberships.find((membership) => membership.organization_id === id)?.organization || null; if (!activeOrganization)
    return; setStoredActiveOrganizationId(id); activeLocation = "all"; void loadLibrary().catch(showError); });
one("#files-new-folder")?.addEventListener("click", () => one("#files-folder-dialog")?.showModal());
document.querySelectorAll("[data-folder-close]").forEach((button) => button.addEventListener("click", () => one("#files-folder-dialog")?.close()));
document.querySelectorAll("[data-preview-close]").forEach((button) => button.addEventListener("click", () => one("#files-preview-dialog")?.close()));
one("#files-folder-form")?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { if (!activeOrganization)
    return; const form = event.currentTarget; const name = String(new FormData(form).get("name") || "").trim(); const { error } = await supabase.from("organization_file_folders").insert({ organization_id: activeOrganization.id, parent_id: null, name, source_product: "files_assets", shared_with_n3xra: false, is_system: false, created_by_user_id: userId }); if (error)
    throw error; form.reset(); one("#files-folder-dialog")?.close(); await loadLibrary(); })().catch(showError); });
one("#files-upload")?.addEventListener("change", (event) => { const input = event.target; const selected = [...(input.files || [])]; input.value = ""; void (async () => { const websiteParts = activeLocation.startsWith("website:") ? activeLocation.split(":") : []; const websiteId = websiteParts[1] || ""; const category = websiteParts[2] || "other"; for (const file of selected) {
    showStatus(`Uploading ${file.name}…`);
    if (websiteId)
        await uploadWebsiteFile(file, websiteId, CATEGORY_KEYS[folderLabel(category).toLowerCase()] || category);
    else
        await uploadPrivateFile(file);
} await loadLibrary(); })().catch(showError); });
one("#files-list")?.addEventListener("click", (event) => { const target = event.target.closest("[data-open],[data-share],[data-delete]"); if (!target)
    return; if (target.dataset.open)
    void previewFile(target.dataset.open).catch(showError); if (target.dataset.share)
    void (async () => { const file = organizationFiles.find((row) => row.id === target.dataset.share); if (!file)
        return; const next = !file.shared_with_n3xra; if (next && !window.confirm("Share this file with N3XRA support? N3XRA administrators will be able to open and download it until you stop sharing."))
        return; const { error } = await supabase.from("organization_files").update({ shared_with_n3xra: next }).eq("id", file.id); if (error)
        throw error; await loadLibrary(); })().catch(showError); if (target.dataset.delete)
    void (async () => { const file = organizationFiles.find((row) => row.id === target.dataset.delete); if (!file || !window.confirm(`Delete “${file.display_name}”? This cannot be undone.`))
        return; const { error } = await supabase.from("organization_files").delete().eq("id", file.id); if (error)
        throw error; if (file.storage_bucket && file.storage_path)
        await supabase.storage.from(file.storage_bucket).remove([file.storage_path]); await loadLibrary(); })().catch(showError); });
function showStatus(message) { const status = one("#files-status"); if (status) {
    status.hidden = false;
    status.textContent = message;
} }
function showError(error) { showStatus(error instanceof Error ? error.message : "Unable to update Files & Assets."); }
void start().catch(showError);
