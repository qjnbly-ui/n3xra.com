import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const icons = { pdf: "PDF", image: "IMG", file: "DOC", link: "↗", text: "TXT" };
const labels = { pdf: "PDF OR BRIEFING", image: "IMAGE", file: "DOCUMENT OR FILE", link: "WEB LINK", text: "TEXT" };
const supabase = hasConfig() ? createBrowserSupabase() : null;
const dialog = document.querySelector("#ph-dialog");
const dialogTitle = document.querySelector("#ph-dialog-title");
const dialogKicker = document.querySelector("#ph-dialog-kicker");
const dialogContent = document.querySelector("#ph-dialog-content");
const dialogOpen = document.querySelector("#ph-dialog-open");
const toast = document.querySelector("#ph-toast");
let page = null;
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
function slugFromLocation() { return new URLSearchParams(location.search).get("slug") || location.pathname.split("/").filter(Boolean).at(-1) || ""; }
function resourceUrl(resource) { return resource.external_url || resource.preview_url || (resource.has_file || resource.organization_file_id || resource.storage_path ? `/api/project-card-file?slug=${encodeURIComponent(page?.slug || slugFromLocation())}&resource=${encodeURIComponent(resource.id)}` : ""); }
async function loadPreview(slug) {
    if (!supabase || new URLSearchParams(location.search).get("preview") !== "1")
        return null;
    const session = await getSessionOrNull(supabase);
    if (!session?.user)
        return null;
    const { data: project, error } = await supabase.from("project_card_projects").select("id,slug,name,description,location_text,updated_at").eq("slug", slug).maybeSingle();
    if (error || !project)
        return null;
    const { data: resources, error: resourceError } = await supabase.from("project_card_resources").select("id,resource_type,title,detail,content,external_url,storage_path,organization_file_id,sort_order").eq("project_id", project.id).eq("is_visible", true).order("sort_order");
    if (resourceError)
        return null;
    const rows = (resources || []);
    const fileIds = rows.map((resource) => resource.organization_file_id).filter((id) => Boolean(id));
    const { data: files } = fileIds.length ? await supabase.from("organization_files").select("id,storage_bucket,storage_path").in("id", fileIds) : { data: [] };
    const fileById = new Map((files || []).map((file) => [file.id, file]));
    await Promise.all(rows.map(async (resource) => {
        const stored = resource.organization_file_id ? fileById.get(resource.organization_file_id) : null;
        const bucket = stored?.storage_bucket || (resource.storage_path ? "project-card-resources" : "");
        const path = stored?.storage_path || resource.storage_path;
        if (!bucket || !path)
            return;
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
        resource.preview_url = data?.signedUrl || "";
    }));
    return { ...project, resources: rows };
}
async function loadPage() {
    if (!supabase)
        throw new Error("This Project Card is not configured.");
    const slug = slugFromLocation();
    if (new URLSearchParams(location.search).get("preview") === "1") {
        const preview = await loadPreview(slug);
        if (preview)
            return preview;
    }
    const { data, error } = await supabase.rpc("get_project_card_page", { input_slug: slug });
    if (error)
        throw error;
    return data;
}
function renderPage(project) {
    page = project;
    document.title = `${project.name} | N3XRA`;
    document.querySelector("#ph-project-name").textContent = project.name;
    document.querySelector("#ph-project-description").textContent = project.description || "Current resources shared from this Project Card.";
    document.querySelector("#ph-location").textContent = project.location_text || "PROJECT RESOURCES";
    const updated = new Date(project.updated_at);
    document.querySelector("#ph-live-label").textContent = `LIVE · UPDATED ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    document.querySelector("#ph-updated").textContent = updated.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
    const target = document.querySelector("#ph-resource-list");
    if (!target)
        return;
    const visible = project.resources.filter((resource) => resource.resource_type in icons);
    target.innerHTML = visible.length ? visible.map((resource, index) => `<button class="ph-resource${index === 0 ? " is-featured" : ""}" type="button" data-resource-id="${resource.id}"><span class="ph-icon">${icons[resource.resource_type]}</span><span><small>${labels[resource.resource_type]}</small><strong>${escape(resource.title)}</strong><i>${escape(resource.detail || (resource.resource_type === "text" ? "Read on this page" : "Open resource"))}</i></span><b>${resource.resource_type === "text" || resource.resource_type === "image" ? "VIEW" : "OPEN"} →</b></button>`).join("") : `<div class="ph-preview"><strong>No resources have been published yet.</strong><br>Check back after the project owner adds page content.</div>`;
}
function showResource(resource) {
    const url = resourceUrl(resource);
    if (resource.resource_type !== "text" && resource.resource_type !== "image" && url) {
        window.open(url, "_blank", "noopener");
        return;
    }
    if (!dialogTitle || !dialogKicker || !dialogContent || !dialogOpen)
        return;
    dialogTitle.textContent = resource.title;
    dialogKicker.textContent = labels[resource.resource_type];
    dialogContent.replaceChildren();
    if (resource.resource_type === "text") {
        const body = document.createElement("p");
        body.className = "ph-resource-text";
        body.textContent = String(resource.content?.text || resource.detail || "");
        dialogContent.append(body);
    }
    else if (resource.resource_type === "image" && url) {
        const image = document.createElement("img");
        image.className = "ph-resource-image";
        image.src = url;
        image.alt = resource.title;
        dialogContent.append(image);
    }
    else {
        const empty = document.createElement("p");
        empty.textContent = "This resource does not have a file or shared URL yet.";
        dialogContent.append(empty);
    }
    dialogOpen.hidden = !url;
    dialogOpen.href = url || "#";
    dialog?.showModal();
}
document.querySelector("#ph-resource-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resource-id]");
    const resource = page?.resources.find((item) => item.id === button?.dataset.resourceId);
    if (resource)
        showResource(resource);
});
document.querySelector("#ph-close")?.addEventListener("click", () => dialog?.close());
document.querySelector("#ph-done")?.addEventListener("click", () => dialog?.close());
document.querySelector("#ph-share")?.addEventListener("click", async () => { try {
    if (navigator.share)
        await navigator.share({ title: document.title, url: window.location.href });
    else {
        await navigator.clipboard.writeText(window.location.href);
        if (toast) {
            toast.textContent = "Link copied";
            toast.hidden = false;
            window.setTimeout(() => { toast.hidden = true; }, 2200);
        }
    }
}
catch { /* A canceled share needs no error. */ } });
void loadPage().then((project) => {
    if (!project)
        throw new Error("This project page is unavailable. Publish it as a public page or open it from the editor preview.");
    renderPage(project);
}).catch((error) => {
    document.querySelector("#ph-project-name").textContent = "Project unavailable";
    document.querySelector("#ph-project-description").textContent = error instanceof Error ? error.message : "This Project Card could not be opened.";
    document.querySelector("#ph-live-label").textContent = "NOT AVAILABLE";
    document.querySelector("#ph-resource-list").innerHTML = "";
});
