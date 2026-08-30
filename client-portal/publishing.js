import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { portalLoginUrl, resolvePortalTenant, scopeWebsitesToPortalTenant } from "./tenant-context.js";
import { readWorkspaceContext, writeWorkspaceContext } from "./workspace-context.js";
const PRIVATE_BUCKET = "website-assets-private";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const websiteSelect = document.querySelector("#publishing-website-select");
const statusElement = document.querySelector("#publishing-status");
const layout = document.querySelector("#publishing-layout");
const form = document.querySelector("#post-form");
const mediaModal = document.querySelector("#media-modal");
const supabase = createBrowserSupabase();
let session;
let websites = [];
let website;
let posts = [];
let assets = [];
let versions = [];
let selectedMedia = [];
let submissions = [];
let selectedSubmissionId = "";
let pageSettings = null;
function element(id) {
    const found = document.getElementById(id);
    if (!found)
        throw new Error(`Missing publishing element: ${id}`);
    return found;
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function slugify(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 110) || "post";
}
function fileKey(value) {
    const base = slugify(value.replace(/\.[^.]+$/, "")).replace(/-/g, "_").slice(0, 70) || "image";
    return `${base}_${crypto.randomUUID().slice(0, 8)}`;
}
function safeFilename(value) {
    return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image.jpg";
}
function postLabel(type) {
    return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function showStatus(copy, error = false) {
    if (!statusElement)
        return;
    statusElement.textContent = copy;
    statusElement.classList.toggle("is-error", error);
    statusElement.hidden = false;
    if (layout)
        layout.hidden = true;
}
function renderPosts(activeId = element("post-id").value) {
    element("post-count").textContent = `${posts.length}`;
    element("post-list").innerHTML = posts.length ? posts.map((post) => `<button type="button" class="${post.id === activeId ? "is-active" : ""}" data-edit-post="${post.id}"><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(postLabel(post.post_type))} · ${escapeHtml(post.status)}</small></button>`).join("") : '<p class="publishing-list-empty">No posts yet. Create the first update.</p>';
}
function renderSelectedMedia() {
    const container = element("selected-media");
    container.innerHTML = selectedMedia.length ? selectedMedia.map((item, index) => `<article class="publishing-media-card"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.altText)}" loading="lazy"><button type="button" data-remove-media="${index}" aria-label="Remove ${escapeHtml(item.label)}">×</button><small>${escapeHtml(item.label)}</small></article>`).join("") : "<p>No photos selected yet.</p>";
}
function resetEditor() {
    form?.reset();
    element("post-id").value = "";
    element("post-status").value = "published";
    element("editor-kicker").textContent = "New post";
    element("editor-title").textContent = "Create a story";
    element("delete-post").hidden = true;
    element("save-post").textContent = "Save changes";
    selectedMedia = [];
    selectedSubmissionId = "";
    renderSelectedMedia();
    renderPosts("");
}
function renderSubmissions() {
    const section = element("publishing-submissions");
    section.hidden = false;
    element("submission-count").textContent = `${submissions.length} pending`;
    element("submission-list").innerHTML = submissions.length ? submissions.map((submission) => {
        const version = versions.find((item) => item.id === submission.asset_version_id);
        const preview = version?.public_url ? `<img src="${escapeHtml(version.public_url)}" alt="">` : '<span aria-hidden="true"></span>';
        return `<article class="publishing-submission">${preview}<div><strong>${escapeHtml(submission.story_title || `A find from ${submission.submitter_name}`)}</strong><small>${escapeHtml(submission.submitter_name)} · ${new Date(submission.created_at).toLocaleDateString()}</small></div><div class="publishing-submission-actions"><button type="button" data-use-submission="${submission.id}">Review submission</button><button type="button" class="publishing-danger" data-delete-submission="${submission.id}">Delete submission</button></div></article>`;
    }).join("") : '<p class="publishing-list-empty">No community stories are waiting for review.</p>';
}
function renderPageSettings() {
    element("page-title").value = pageSettings?.page_title || "From the Greenhouse";
    element("page-kicker").value = pageSettings?.page_kicker || "Stories, finds, and life on the farm";
    element("page-intro").value = pageSettings?.page_intro || "";
    const hero = element("page-hero");
    hero.innerHTML = '<option value="">Use the website default</option>' + assets.flatMap((asset) => {
        const version = versions.find((row) => row.id === asset.current_version_id && row.status === "published" && row.public_url);
        return version ? [`<option value="${version.id}">${escapeHtml(asset.label)}</option>`] : [];
    }).join("");
    hero.value = pageSettings?.hero_asset_version_id || "";
    element("page-settings").hidden = false;
}
async function editPost(id) {
    const post = posts.find((row) => row.id === id);
    if (!post)
        return;
    element("post-id").value = post.id;
    element("post-type").value = post.post_type;
    element("post-status").value = post.status;
    element("post-title").value = post.title;
    element("post-excerpt").value = post.excerpt || "";
    element("post-body").value = post.body || "";
    element("post-featured").checked = post.featured;
    element("editor-kicker").textContent = postLabel(post.post_type);
    element("editor-title").textContent = "Edit post";
    element("delete-post").hidden = false;
    const { data, error } = await supabase.from("website_post_media").select("id,asset_id,asset_version_id,alt_text").eq("post_id", post.id).order("sort_order");
    if (error)
        throw error;
    selectedMedia = (data || []).flatMap((row) => {
        const version = versions.find((item) => item.id === row.asset_version_id);
        const asset = assets.find((item) => item.id === row.asset_id);
        return version?.public_url ? [{ id: row.id, assetId: row.asset_id, versionId: row.asset_version_id, url: version.public_url, label: asset?.label || version.original_filename, altText: row.alt_text || asset?.alt_text || "" }] : [];
    });
    renderSelectedMedia();
    renderPosts(post.id);
}
function renderLibrary() {
    const query = element("media-search").value.trim().toLowerCase();
    const rows = assets.flatMap((asset) => {
        const version = versions.find((item) => item.id === asset.current_version_id && item.status === "published" && item.public_url);
        return version && (!query || `${asset.label} ${version.original_filename}`.toLowerCase().includes(query)) ? [{ asset, version }] : [];
    });
    element("media-library-grid").innerHTML = rows.length ? rows.map(({ asset, version }) => `<button type="button" data-library-version="${version.id}"><img src="${escapeHtml(version.public_url || "")}" alt="${escapeHtml(asset.alt_text || "")}" loading="lazy"><strong>${escapeHtml(asset.label)}</strong></button>`).join("") : "<p>No matching published images were found.</p>";
}
async function loadData() {
    showStatus("Loading website publishing…");
    const [{ data: postRows, error: postError }, { data: assetRows, error: assetError }, { data: submissionRows, error: submissionError }, { data: settingsRow, error: settingsError }] = await Promise.all([
        supabase.from("website_posts").select("*").eq("website_id", website.id).order("updated_at", { ascending: false }),
        supabase.from("website_assets").select("id,asset_key,label,alt_text,current_version_id").eq("website_id", website.id).eq("status", "active").order("updated_at", { ascending: false }),
        supabase.from("website_story_submissions").select("id,submitter_name,story_title,story_body,status,asset_id,asset_version_id,created_at").eq("website_id", website.id).eq("status", "pending").order("created_at", { ascending: false }),
        supabase.from("website_publishing_settings").select("website_id,page_title,page_kicker,page_intro,hero_asset_version_id").eq("website_id", website.id).maybeSingle(),
    ]);
    if (postError)
        throw postError;
    if (assetError)
        throw assetError;
    if (submissionError)
        throw submissionError;
    if (settingsError)
        throw settingsError;
    posts = (postRows || []);
    assets = (assetRows || []);
    submissions = (submissionRows || []);
    pageSettings = (settingsRow || null);
    if (assets.length) {
        const { data, error } = await supabase.from("website_asset_versions").select("id,asset_id,version_number,status,public_url,original_filename").in("asset_id", assets.map((asset) => asset.id)).order("version_number", { ascending: false });
        if (error)
            throw error;
        versions = (data || []);
    }
    else
        versions = [];
    resetEditor();
    renderPosts();
    renderLibrary();
    renderSubmissions();
    renderPageSettings();
    if (statusElement)
        statusElement.hidden = true;
    if (layout)
        layout.hidden = false;
    document.querySelector("#publishing-app")?.setAttribute("aria-busy", "false");
}
async function savePageSettings() {
    const values = { website_id: website.id, page_title: element("page-title").value.trim(), page_kicker: element("page-kicker").value.trim(), page_intro: element("page-intro").value.trim() || null, hero_asset_version_id: element("page-hero").value || null, updated_by_user_id: session.user.id };
    const { error } = await supabase.from("website_publishing_settings").upsert(values, { onConflict: "website_id" });
    if (error)
        throw error;
    pageSettings = { ...values };
    element("page-settings-status").textContent = "Page settings saved.";
}
async function useSubmission(id) {
    const submission = submissions.find((row) => row.id === id);
    if (!submission)
        return;
    resetEditor();
    selectedSubmissionId = submission.id;
    element("post-type").value = "customer_story";
    element("post-title").value = submission.story_title || `A find from ${submission.submitter_name}`;
    element("post-body").value = submission.story_body;
    const asset = assets.find((row) => row.id === submission.asset_id);
    let version = versions.find((row) => row.id === submission.asset_version_id);
    if (asset && version && !version.public_url) {
        const published = await publishVersion(version.id);
        version = { ...version, status: "published", public_url: published.publicUrl };
        versions = versions.map((row) => row.id === version?.id ? version : row);
    }
    if (asset && version?.public_url)
        selectedMedia = [{ assetId: asset.id, versionId: version.id, url: version.public_url, label: asset.label, altText: asset.alt_text || "" }];
    renderSelectedMedia();
    element("editor-kicker").textContent = "Community story";
    element("editor-title").textContent = "Review and publish";
    element("save-post").textContent = "Approve & publish";
    form?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function publishVersion(versionId) {
    const response = await fetch("/api/client-website-publishing", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish_asset_version", websiteId: website.id, versionId }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(String(result.error || "The image could not be published."));
    return result;
}
async function uploadNewImage() {
    const file = element("media-file").files?.[0];
    const uploadStatus = element("upload-status");
    if (!file) {
        uploadStatus.textContent = "Choose an image first.";
        return;
    }
    if (!file.type.startsWith("image/") || file.size > MAX_FILE_BYTES) {
        uploadStatus.textContent = "Choose an image smaller than 10 MB.";
        uploadStatus.classList.add("is-error");
        return;
    }
    const altText = element("media-alt").value.trim();
    const assetId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const label = file.name.replace(/\.[^.]+$/, "").replaceAll(/[-_]+/g, " ");
    uploadStatus.classList.remove("is-error");
    uploadStatus.textContent = "Uploading the full-quality image…";
    const { error: assetError } = await supabase.from("website_assets").insert({ id: assetId, website_id: website.id, asset_key: fileKey(file.name), label, category: "journal", replacement_type: "html_src", alt_text: altText || null, created_by_user_id: session.user.id });
    if (assetError)
        throw assetError;
    const storagePath = `${website.id}/${assetId}/v1-${versionId}-${safeFilename(file.name)}`;
    try {
        const { error: storageError } = await supabase.storage.from(PRIVATE_BUCKET).upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });
        if (storageError)
            throw storageError;
        const { error: versionError } = await supabase.from("website_asset_versions").insert({ id: versionId, asset_id: assetId, version_number: 1, status: "pending_review", storage_bucket: PRIVATE_BUCKET, storage_path: storagePath, original_filename: file.name, mime_type: file.type, size_bytes: file.size, change_note: "Uploaded from Website Publishing", uploaded_by_user_id: session.user.id });
        if (versionError)
            throw versionError;
        const published = await publishVersion(versionId);
        const asset = { id: assetId, asset_key: "", label, alt_text: altText || null, current_version_id: versionId };
        const version = { id: versionId, asset_id: assetId, version_number: 1, status: "published", public_url: published.publicUrl, original_filename: file.name };
        assets.unshift(asset);
        versions.unshift(version);
        selectedMedia.push({ assetId, versionId, url: published.publicUrl, label, altText });
        renderSelectedMedia();
        renderLibrary();
        uploadStatus.textContent = "Uploaded to the CDN and added to this post.";
        element("media-file").value = "";
    }
    catch (error) {
        await supabase.storage.from(PRIVATE_BUCKET).remove([storagePath]);
        await supabase.from("website_assets").delete().eq("id", assetId);
        throw error;
    }
}
async function savePost(forceDraft = false) {
    const id = element("post-id").value;
    const title = element("post-title").value.trim();
    if (!title)
        throw new Error("Add a title before saving.");
    const desiredStatus = forceDraft ? "draft" : element("post-status").value;
    const now = new Date().toISOString();
    const values = { website_id: website.id, post_type: element("post-type").value, title, excerpt: element("post-excerpt").value.trim() || null, body: element("post-body").value.trim(), status: desiredStatus, featured: element("post-featured").checked, published_at: desiredStatus === "published" ? (posts.find((post) => post.id === id)?.published_at || now) : null, updated_by_user_id: session.user.id };
    let postId = id;
    if (id) {
        const { error } = await supabase.from("website_posts").update(values).eq("id", id);
        if (error)
            throw error;
    }
    else {
        const { data, error } = await supabase.from("website_posts").insert({ ...values, slug: `${slugify(title)}-${crypto.randomUUID().slice(0, 8)}`, created_by_user_id: session.user.id }).select("id").single();
        if (error)
            throw error;
        postId = data.id;
    }
    const { error: deleteError } = await supabase.from("website_post_media").delete().eq("post_id", postId);
    if (deleteError)
        throw deleteError;
    if (selectedMedia.length) {
        const { error } = await supabase.from("website_post_media").insert(selectedMedia.map((item, index) => ({ website_id: website.id, post_id: postId, asset_id: item.assetId, asset_version_id: item.versionId, sort_order: index, alt_text: item.altText || null, created_by_user_id: session.user.id })));
        if (error)
            throw error;
    }
    if (selectedSubmissionId) {
        const { error } = await supabase.from("website_story_submissions").update({ status: desiredStatus === "published" ? "published" : "pending", post_id: postId, reviewed_by_user_id: session.user.id, reviewed_at: desiredStatus === "published" ? now : null }).eq("id", selectedSubmissionId);
        if (error)
            throw error;
    }
    element("save-status").textContent = desiredStatus === "published" ? "Published" : "Saved";
    await loadData();
    await editPost(postId);
}
function bindEvents() {
    element("new-post").addEventListener("click", resetEditor);
    element("page-settings-form").addEventListener("submit", (event) => { event.preventDefault(); void savePageSettings().catch((error) => { element("page-settings-status").textContent = error instanceof Error ? error.message : "Settings could not be saved."; }); });
    element("open-media").addEventListener("click", () => mediaModal?.showModal());
    element("close-media").addEventListener("click", () => mediaModal?.close());
    element("media-search").addEventListener("input", renderLibrary);
    element("post-list").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-post]"); if (button)
        void editPost(button.dataset.editPost || ""); });
    element("selected-media").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-media]"); if (!button)
        return; selectedMedia.splice(Number(button.dataset.removeMedia), 1); renderSelectedMedia(); });
    element("submission-list").addEventListener("click", (event) => {
        const target = event.target;
        const deleteButton = target.closest("[data-delete-submission]");
        if (deleteButton) {
            const submissionId = deleteButton.dataset.deleteSubmission || "";
            if (!submissionId || !window.confirm("Delete this submission and its photograph permanently?"))
                return;
            void (async () => {
                deleteButton.disabled = true;
                const response = await fetch("/api/client-website-publishing", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_story_submission", websiteId: website.id, submissionId }) });
                const result = await response.json().catch(() => ({}));
                if (!response.ok)
                    throw new Error(String(result.error || "The submission could not be deleted."));
                await loadData();
            })().catch((error) => { deleteButton.disabled = false; showStatus(error instanceof Error ? error.message : "The submission could not be deleted.", true); });
            return;
        }
        const reviewButton = target.closest("[data-use-submission]");
        if (reviewButton)
            void useSubmission(reviewButton.dataset.useSubmission || "").catch((error) => { showStatus(error instanceof Error ? error.message : "The submission could not be opened.", true); });
    });
    element("media-library-grid").addEventListener("click", (event) => { const button = event.target.closest("[data-library-version]"); const version = versions.find((row) => row.id === button?.dataset.libraryVersion); const asset = assets.find((row) => row.id === version?.asset_id); if (!version?.public_url || !asset || selectedMedia.some((row) => row.versionId === version.id))
        return; selectedMedia.push({ assetId: asset.id, versionId: version.id, url: version.public_url, label: asset.label, altText: asset.alt_text || "" }); renderSelectedMedia(); mediaModal?.close(); });
    document.querySelectorAll("[data-media-tab]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-media-tab]").forEach((tab) => tab.classList.toggle("is-active", tab === button)); element("media-library").hidden = button.dataset.mediaTab !== "library"; element("media-upload").hidden = button.dataset.mediaTab !== "upload"; }));
    element("upload-media").addEventListener("click", () => void uploadNewImage().catch((error) => { const target = element("upload-status"); target.textContent = error instanceof Error ? error.message : "Upload failed."; target.classList.add("is-error"); }));
    form?.addEventListener("submit", (event) => { event.preventDefault(); void savePost().catch((error) => { element("save-status").textContent = error instanceof Error ? error.message : "Save failed."; }); });
    element("save-draft").addEventListener("click", () => void savePost(true).catch((error) => { element("save-status").textContent = error instanceof Error ? error.message : "Save failed."; }));
    element("delete-post").addEventListener("click", () => void (async () => { const id = element("post-id").value; if (!id || !window.confirm("Delete this post permanently?"))
        return; const { error } = await supabase.from("website_posts").delete().eq("id", id); if (error)
        throw error; await loadData(); })().catch((error) => { element("save-status").textContent = error instanceof Error ? error.message : "Delete failed."; }));
}
async function init() {
    if (!hasConfig())
        throw new Error("Portal configuration is unavailable.");
    session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(portalLoginUrl());
        return;
    }
    const tenant = await resolvePortalTenant(supabase);
    const { data, error } = await supabase.from("client_websites").select("id,name").order("name");
    if (error)
        throw error;
    websites = scopeWebsitesToPortalTenant((data || []), tenant);
    if (!websites.length)
        throw new Error("No website publishing workspace is available for this account.");
    const workspaceScope = document.body.dataset.publishingMode === "admin" ? "admin" : "client";
    const context = readWorkspaceContext(workspaceScope, session.user.id);
    const explicitWebsiteId = new URLSearchParams(window.location.search).get("website");
    website = websites.find((row) => row.id === explicitWebsiteId)
        || websites.find((row) => row.id === context.websiteId)
        || websites[0];
    if (websiteSelect) {
        websiteSelect.innerHTML = websites.map((row) => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join("");
        websiteSelect.value = website.id;
        websiteSelect.disabled = tenant.mode !== "unbound" || websites.length < 2;
        websiteSelect.addEventListener("change", () => {
            const next = websites.find((row) => row.id === websiteSelect.value);
            if (!next)
                return;
            website = next;
            writeWorkspaceContext(workspaceScope, session.user.id, { ...readWorkspaceContext(workspaceScope, session.user.id), websiteId: next.id, name: next.name });
            void loadData();
        });
    }
    bindEvents();
    document.body.classList.remove("portal-loading");
    const screen = document.querySelector("#portal-status");
    if (screen)
        screen.hidden = true;
    await loadData();
}
void init().catch((error) => { document.body.classList.remove("portal-loading"); showStatus(error instanceof Error ? error.message : "Website publishing could not be opened.", true); });
