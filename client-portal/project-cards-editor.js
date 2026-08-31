import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const STORAGE_BUCKET = "project-card-resources";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const icons = { pdf: "PDF", image: "IMG", file: "DOC", link: "↗", text: "TXT" };
let supabase;
let project;
let resources = [];
let assignedCards = [];
let editingResourceId = "";
const one = (selector) => document.querySelector(selector);
const list = one("#pe-resource-list");
const dialog = one("#pe-resource-dialog");
const form = one("#pe-resource-form");
const toast = one("#pe-toast");
const formStatus = one("#pe-resource-form-status");
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
function notify(text) {
    if (!toast)
        return;
    toast.textContent = `✓ ${text}`;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2400);
}
function sourceLabel(resource) {
    if (resource.resource_type === "text")
        return "Text shown directly on the page";
    if (resource.storage_path)
        return "Stored securely by N3XRA";
    if (resource.external_url) {
        try {
            return `Linked from ${new URL(resource.external_url).hostname.replace(/^www\./, "")}`;
        }
        catch {
            return "Shared URL";
        }
    }
    return "Select to finish configuring";
}
function renderResources() {
    if (!list)
        return;
    list.innerHTML = resources.length ? resources.map((resource, index) => `
    <article class="pe-resource" data-type="${resource.resource_type}">
      <button class="pe-resource-main" type="button" data-edit data-id="${resource.id}" aria-label="Edit ${escape(resource.title)}">
        <span class="pe-resource-icon">${icons[resource.resource_type]}</span>
        <span><h4>${escape(resource.title)}</h4><p>${escape(resource.detail || "No description")}</p><small>${escape(sourceLabel(resource))} · Click to edit</small></span>
      </button>
      <div class="pe-resource-actions">
        <button type="button" data-move="up" data-id="${resource.id}" aria-label="Move up"${index === 0 ? " disabled" : ""}>↑</button>
        <button type="button" data-move="down" data-id="${resource.id}" aria-label="Move down"${index === resources.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" data-remove data-id="${resource.id}" aria-label="Remove">×</button>
      </div>
    </article>`).join("") : `<div class="pe-empty"><strong>No resources yet</strong><p>Add the first item people should see when they scan a card assigned to this project.</p></div>`;
}
function renderCards() {
    const target = one("#pe-assigned-cards");
    if (!target)
        return;
    target.innerHTML = assignedCards.length ? assignedCards.map((card) => `<div class="pe-card-chip"><i>◉</i><div><strong>${escape(card.assigned_name || "Not assigned")}</strong><span>${escape(card.card_code)}</span></div></div>`).join("") : `<div class="pe-empty"><strong>No cards assigned</strong><p>This project can stay available without a physical card.</p></div>`;
    one("#pe-card-count").textContent = String(assignedCards.length);
}
function saved() { const state = one("#pe-save-state"); if (state)
    state.textContent = "All changes saved"; }
function updateResourceFields() {
    if (!form)
        return;
    const type = String(new FormData(form).get("type") || "file");
    const source = String(new FormData(form).get("source") || "url");
    const sourcePanel = one("#pe-resource-source");
    const sourceChoice = one("#pe-source-choice");
    const urlWrap = one("#pe-resource-url-wrap");
    const fileWrap = one("#pe-resource-file-wrap");
    const textWrap = one("#pe-resource-text-wrap");
    const help = one("#pe-resource-source-help");
    if (sourcePanel)
        sourcePanel.hidden = type === "text";
    if (textWrap)
        textWrap.hidden = type !== "text";
    if (sourceChoice)
        sourceChoice.hidden = type === "link";
    if (urlWrap)
        urlWrap.hidden = type !== "link" && source !== "url";
    if (fileWrap)
        fileWrap.hidden = type === "link" || source !== "upload";
    if (help)
        help.textContent = source === "upload" && type !== "link"
            ? "This file will be stored by N3XRA and can be replaced later without changing the project link."
            : "Paste a public or shared link from Google Drive, Microsoft OneDrive, Dropbox, or another storage provider.";
    const upload = form.elements.namedItem("upload");
    if (upload)
        upload.accept = type === "image" ? "image/*" : type === "pdf" ? "application/pdf" : "";
}
function openResourceDialog(resource) {
    if (!form || !dialog)
        return;
    form.reset();
    editingResourceId = resource?.id || "";
    one("#pe-resource-kicker").textContent = resource ? "EDIT PAGE ITEM" : "NEW PAGE ITEM";
    one("#pe-resource-dialog-title").textContent = resource ? "Edit resource" : "Add a resource";
    one("#pe-resource-submit").textContent = resource ? "Save changes" : "Add to page";
    if (resource) {
        form.elements.namedItem("type").value = resource.resource_type;
        form.elements.namedItem("title").value = resource.title;
        form.elements.namedItem("detail").value = resource.detail;
        form.elements.namedItem("external_url").value = resource.external_url || "";
        form.elements.namedItem("text_body").value = String(resource.content?.text || "");
        const source = resource.storage_path ? "upload" : "url";
        const sourceRadio = form.querySelector(`input[name="source"][value="${source}"]`);
        if (sourceRadio)
            sourceRadio.checked = true;
    }
    if (formStatus)
        formStatus.textContent = "";
    updateResourceFields();
    dialog.showModal();
}
async function uploadFile(file) {
    if (file.size > MAX_UPLOAD_BYTES)
        throw new Error("Choose a file smaller than 50 MB.");
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
    const path = `${project.organization_id}/${project.id}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (error)
        throw error;
    return path;
}
async function removeStoredFile(path) {
    if (!path)
        return;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    if (error)
        console.warn("Unable to remove the replaced Project Card resource.", error);
}
async function saveProject() {
    const name = one("#pe-project-name")?.value.trim() || "";
    if (!name)
        return;
    const update = { name, location_text: one("#pe-project-location")?.value.trim() || "", status: one("#pe-project-status")?.value || "draft", access_level: one("#pe-project-access")?.value || "public" };
    const { error } = await supabase.from("project_card_projects").update(update).eq("id", project.id).eq("organization_id", project.organization_id);
    if (error) {
        notify(error.message);
        return;
    }
    project = { ...project, ...update };
    one("#pe-project-kicker").textContent = project.name.toUpperCase();
    saved();
}
async function authorize() {
    if (!hasConfig())
        throw new Error("The N3XRA data connection is not configured.");
    supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
    }
    const projectId = new URLSearchParams(window.location.search).get("project") || "";
    if (!projectId) {
        window.location.replace("/client-portal/project-cards/");
        return;
    }
    const { data: projectRow, error: projectError } = await supabase.from("project_card_projects").select("id,organization_id,slug,name,location_text,status,access_level").eq("id", projectId).maybeSingle();
    if (projectError)
        throw projectError;
    if (!projectRow)
        throw new Error("This project was not found or you do not have access to it.");
    project = projectRow;
    const { data: canManage, error: accessError } = await supabase.rpc("can_manage_project_cards", { target_organization_id: project.organization_id });
    if (accessError || canManage !== true)
        throw new Error("You do not have permission to edit this project.");
    const [{ data: resourceRows, error: resourceError }, { data: cardRows, error: cardError }] = await Promise.all([
        supabase.from("project_card_resources").select("id,resource_type,title,detail,sort_order,content,external_url,storage_path").eq("project_id", project.id).order("sort_order"),
        supabase.from("project_card_devices").select("card_code,assigned_name").eq("project_id", project.id).neq("status", "retired").order("card_code"),
    ]);
    if (resourceError)
        throw resourceError;
    if (cardError)
        throw cardError;
    resources = (resourceRows || []).filter((resource) => resource.resource_type in icons);
    assignedCards = (cardRows || []);
    one("#pe-project-kicker").textContent = project.name.toUpperCase();
    one("#pe-project-name").value = project.name;
    one("#pe-project-location").value = project.location_text;
    one("#pe-project-status").value = project.status;
    one("#pe-project-access").value = project.access_level;
    one("#pe-project-address").textContent = `n3xra.com/p/${project.slug}`;
    const preview = one("#pe-preview-link");
    if (preview)
        preview.href = `/p/${encodeURIComponent(project.slug)}?preview=1`;
    renderResources();
    renderCards();
    saved();
    one("#pe-status").hidden = true;
    one("#pe-app").hidden = false;
    document.body.classList.remove("portal-loading");
}
one("#pe-add-resource")?.addEventListener("click", () => openResourceDialog());
one("#pe-resource-close")?.addEventListener("click", () => dialog?.close());
one("#pe-resource-cancel")?.addEventListener("click", () => dialog?.close());
one("#pe-resource-type")?.addEventListener("change", updateResourceFields);
form?.querySelectorAll('input[name="source"]').forEach((input) => input.addEventListener("change", updateResourceFields));
form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form)
        return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const type = String(values.get("type") || "file");
    const source = String(values.get("source") || "url");
    const externalUrl = String(values.get("external_url") || "").trim();
    const textBody = String(values.get("text_body") || "").trim();
    const file = values.get("upload") instanceof File && values.get("upload").size ? values.get("upload") : null;
    const existing = resources.find((resource) => resource.id === editingResourceId);
    if (!title || !(type in icons))
        return;
    if (type === "text" && !textBody) {
        if (formStatus)
            formStatus.textContent = "Add the text you want shown on the page.";
        return;
    }
    if (type !== "text" && source === "url" && !externalUrl) {
        if (formStatus)
            formStatus.textContent = "Paste a shared URL for this resource.";
        return;
    }
    if (type !== "text" && type !== "link" && source === "upload" && !file && !existing?.storage_path) {
        if (formStatus)
            formStatus.textContent = "Choose a file to upload.";
        return;
    }
    const submit = one("#pe-resource-submit");
    if (submit) {
        submit.disabled = true;
        submit.textContent = file ? "Uploading…" : "Saving…";
    }
    if (formStatus)
        formStatus.textContent = "";
    let newStoragePath = null;
    try {
        if (file)
            newStoragePath = await uploadFile(file);
        const storagePath = type !== "text" && source === "upload" ? newStoragePath || existing?.storage_path || null : null;
        const payload = {
            resource_type: type,
            title,
            detail: String(values.get("detail") || "").trim(),
            content: type === "text" ? { text: textBody } : file ? { file_name: file.name, file_size: file.size, mime_type: file.type } : {},
            external_url: type !== "text" && (type === "link" || source === "url") ? externalUrl : null,
            storage_path: storagePath,
        };
        if (existing) {
            const { data, error } = await supabase.from("project_card_resources").update(payload).eq("id", existing.id).select("id,resource_type,title,detail,sort_order,content,external_url,storage_path").single();
            if (error)
                throw error;
            resources[resources.indexOf(existing)] = data;
            if (existing.storage_path && existing.storage_path !== storagePath)
                await removeStoredFile(existing.storage_path);
        }
        else {
            const user = (await supabase.auth.getUser()).data.user;
            const { data, error } = await supabase.from("project_card_resources").insert({ ...payload, project_id: project.id, sort_order: resources.length * 10, created_by_user_id: user.id }).select("id,resource_type,title,detail,sort_order,content,external_url,storage_path").single();
            if (error)
                throw error;
            resources.push(data);
        }
        form.reset();
        dialog?.close();
        renderResources();
        saved();
        notify(`${title} ${existing ? "updated" : "added"}.`);
    }
    catch (error) {
        if (newStoragePath)
            await removeStoredFile(newStoragePath);
        if (formStatus)
            formStatus.textContent = error instanceof Error ? error.message : "Unable to save this resource.";
    }
    finally {
        if (submit) {
            submit.disabled = false;
            submit.textContent = editingResourceId ? "Save changes" : "Add to page";
        }
    }
});
list?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button)
        return;
    const id = String(button.dataset.id || "");
    const index = resources.findIndex((resource) => resource.id === id);
    if (index < 0)
        return;
    if (button.hasAttribute("data-edit")) {
        openResourceDialog(resources[index]);
        return;
    }
    if (button.hasAttribute("data-remove")) {
        if (!window.confirm(`Remove “${resources[index].title}” from this page?`))
            return;
        const { error } = await supabase.from("project_card_resources").delete().eq("id", id);
        if (error) {
            notify(error.message);
            return;
        }
        await removeStoredFile(resources[index].storage_path);
        resources.splice(index, 1);
    }
    else {
        const next = button.dataset.move === "up" ? index - 1 : index + 1;
        if (next >= 0 && next < resources.length) {
            [resources[index], resources[next]] = [resources[next], resources[index]];
            await Promise.all(resources.map((resource, position) => supabase.from("project_card_resources").update({ sort_order: position * 10 }).eq("id", resource.id)));
        }
    }
    renderResources();
    saved();
});
document.querySelectorAll(".pe-settings input,.pe-settings select").forEach((field) => field.addEventListener("change", () => { void saveProject(); }));
void authorize().catch((error) => { const status = one("#pe-status"); if (status)
    status.textContent = error instanceof Error ? error.message : "Unable to open the project editor."; document.body.classList.remove("portal-loading"); });
