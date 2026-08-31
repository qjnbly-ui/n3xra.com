import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const icons = { pdf: "PDF", radio: "⌁", image: "⌖", file: "DOC", link: "↗" };
let supabase;
let project;
let resources = [];
let assignedCards = [];
const one = (selector) => document.querySelector(selector);
const list = one("#pe-resource-list");
const dialog = one("#pe-resource-dialog");
const form = one("#pe-resource-form");
const toast = one("#pe-toast");
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
function notify(text) { if (!toast)
    return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2400); }
function renderResources() { if (!list)
    return; list.innerHTML = resources.length ? resources.map((resource, index) => `<article class="pe-resource" data-type="${resource.resource_type}"><span class="pe-resource-icon">${icons[resource.resource_type]}</span><div><h4>${escape(resource.title)}</h4><p>${escape(resource.detail || "Ready to configure")}</p></div><div class="pe-resource-actions"><button type="button" data-move="up" data-id="${resource.id}" aria-label="Move up"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-move="down" data-id="${resource.id}" aria-label="Move down"${index === resources.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-remove data-id="${resource.id}" aria-label="Remove">×</button></div></article>`).join("") : `<div class="pe-empty"><strong>No resources yet</strong><p>Add the first item people should see when they scan a card assigned to this project.</p></div>`; }
function renderCards() { const target = one("#pe-assigned-cards"); if (!target)
    return; target.innerHTML = assignedCards.length ? assignedCards.map((card) => `<div class="pe-card-chip"><i>◉</i><div><strong>${escape(card.assigned_name || "Not assigned")}</strong><span>${escape(card.card_code)}</span></div></div>`).join("") : `<div class="pe-empty"><strong>No cards assigned</strong><p>This project can stay available without a physical card.</p></div>`; one("#pe-card-count").textContent = String(assignedCards.length); }
function saved() { const state = one("#pe-save-state"); if (state)
    state.textContent = "All changes saved"; }
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
        supabase.from("project_card_resources").select("id,resource_type,title,detail,sort_order").eq("project_id", project.id).order("sort_order"),
        supabase.from("project_card_devices").select("card_code,assigned_name").eq("project_id", project.id).neq("status", "retired").order("card_code"),
    ]);
    if (resourceError)
        throw resourceError;
    if (cardError)
        throw cardError;
    resources = (resourceRows || []);
    assignedCards = (cardRows || []);
    one("#pe-project-kicker").textContent = project.name.toUpperCase();
    one("#pe-project-name").value = project.name;
    one("#pe-project-location").value = project.location_text;
    one("#pe-project-status").value = project.status;
    one("#pe-project-access").value = project.access_level;
    one("#pe-project-address").textContent = `n3xra.com/p/${project.slug}`;
    const preview = one("#pe-preview-link");
    if (preview)
        preview.href = `/p/${encodeURIComponent(project.slug)}`;
    renderResources();
    renderCards();
    saved();
    one("#pe-status").hidden = true;
    one("#pe-app").hidden = false;
    document.body.classList.remove("portal-loading");
}
one("#pe-add-resource")?.addEventListener("click", () => dialog?.showModal());
one("#pe-resource-close")?.addEventListener("click", () => dialog?.close());
one("#pe-resource-cancel")?.addEventListener("click", () => dialog?.close());
form?.addEventListener("submit", async (event) => { event.preventDefault(); const values = new FormData(form); const title = String(values.get("title") || "").trim(); const type = String(values.get("type") || "file"); if (!title || !(type in icons))
    return; const { data, error } = await supabase.from("project_card_resources").insert({ project_id: project.id, resource_type: type, title, detail: String(values.get("detail") || "").trim(), sort_order: resources.length * 10, created_by_user_id: (await supabase.auth.getUser()).data.user.id }).select("id,resource_type,title,detail,sort_order").single(); if (error) {
    notify(error.message);
    return;
} resources.push(data); form.reset(); dialog?.close(); renderResources(); saved(); notify(`${title} added.`); });
list?.addEventListener("click", async (event) => { const button = event.target.closest("button[data-id]"); if (!button)
    return; const id = String(button.dataset.id || ""); const index = resources.findIndex((resource) => resource.id === id); if (index < 0)
    return; if (button.hasAttribute("data-remove")) {
    const { error } = await supabase.from("project_card_resources").delete().eq("id", id);
    if (error) {
        notify(error.message);
        return;
    }
    resources.splice(index, 1);
}
else {
    const next = button.dataset.move === "up" ? index - 1 : index + 1;
    if (next >= 0 && next < resources.length) {
        [resources[index], resources[next]] = [resources[next], resources[index]];
        const updates = resources.map((resource, position) => supabase.from("project_card_resources").update({ sort_order: position * 10 }).eq("id", resource.id));
        await Promise.all(updates);
    }
} renderResources(); saved(); });
document.querySelectorAll(".pe-settings input,.pe-settings select").forEach((field) => field.addEventListener("change", () => { void saveProject(); }));
void authorize().catch((error) => { const status = one("#pe-status"); if (status)
    status.textContent = error instanceof Error ? error.message : "Unable to open the project editor."; document.body.classList.remove("portal-loading"); });
