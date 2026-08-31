import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
let supabase;
let userId = "";
let organizationId = "";
let projects = [];
let cards = [];
let selected = new Set();
let managedCardId = null;
let pendingAction = null;
let createdCard = null;
const standaloneApp = document.body.classList.contains("project-cards-standalone");
const appBase = standaloneApp ? "/project-cards/app/" : "/client-portal/project-cards/";
const one = (selector) => document.querySelector(selector);
const app = one("#pc-app");
const status = one("#pc-status");
const projectList = one("#pc-project-list");
const cardList = one("#pc-card-list");
const filter = one("#pc-project-filter");
const target = one("#pc-project-target");
const selectAll = one("#pc-select-all");
const assignButton = one("#pc-assign-selected");
const selectionStatus = one("#pc-selection-status");
const dialog = one("#pc-dialog");
const createForm = one("#pc-create-form");
const toast = one("#pc-toast");
const manageDialog = one("#pc-manage-dialog");
const manageForm = one("#pc-manage-form");
const manageProject = one("#pc-manage-project");
const confirmDialog = one("#pc-confirm-dialog");
const activateDialog = one("#pc-activate-dialog");
const activateForm = one("#pc-activate-form");
const activateProject = one("#pc-activate-project");
const activateFields = one("#pc-activate-fields");
const activateResult = one("#pc-activate-result");
const activateStatus = one("#pc-activate-status");
const writeCardButton = one("#pc-write-card");
function escape(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function projectName(id) { return projects.find((project) => project.id === id)?.name || "Unassigned"; }
function projectCount(id) { return cards.filter((card) => card.project_id === id).length; }
function message(text) { if (!toast)
    return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2800); }
function errorMessage(error, fallback) {
    if (error instanceof Error)
        return error.message;
    if (error && typeof error === "object" && "message" in error)
        return String(error.message || fallback);
    return fallback;
}
function renderSummary() {
    const values = { "#pc-project-total": projects.length, "#pc-card-total": cards.length, "#pc-assigned-total": cards.filter((card) => card.project_id).length, "#pc-tab-count": cards.length };
    Object.entries(values).forEach(([selector, value]) => { const node = one(selector); if (node)
        node.textContent = String(value); });
}
function renderProjectOptions() {
    const options = `${projects.filter((project) => project.status !== "archived").map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join("")}<option value="">Unassigned</option>`;
    if (target)
        target.innerHTML = options;
    if (manageProject)
        manageProject.innerHTML = options;
    if (activateProject)
        activateProject.innerHTML = options;
}
function renderProjects() {
    if (!projectList)
        return;
    const visible = filter?.value && filter.value !== "all" ? projects.filter((project) => project.status === filter.value) : projects.filter((project) => project.status !== "archived");
    projectList.innerHTML = visible.map((project, index) => { const count = projectCount(project.id); const tone = ["fire", "forest", "slate"][index % 3] || "forest"; return `<article class="pc-project" data-tone="${tone}"><div class="pc-project-visual"><strong>${count}</strong><span>${count === 1 ? "CARD" : "CARDS"}</span></div><div class="pc-project-copy"><span class="pc-project-status${project.status === "draft" ? " is-draft" : ""}">${escape(project.status.toUpperCase())}</span><h4>${escape(project.name)}</h4><span>${escape(project.description || project.location_text || "New resource hub")}</span><footer><button type="button" data-open-project="${escape(project.id)}">Open workspace →</button><small>${count} assigned</small></footer></div></article>`; }).join("");
    const empty = one("#pc-project-empty");
    if (empty)
        empty.hidden = visible.length !== 0;
}
function updateSelection() {
    const count = selected.size;
    if (selectionStatus)
        selectionStatus.textContent = count ? `${count} card${count === 1 ? "" : "s"} selected` : "Select cards to assign them together";
    if (assignButton)
        assignButton.disabled = count === 0;
    if (selectAll) {
        selectAll.checked = cards.length > 0 && count === cards.length;
        selectAll.indeterminate = count > 0 && count < cards.length;
    }
}
function renderCards() {
    if (!cardList)
        return;
    cardList.innerHTML = cards.map((card) => { const unassigned = !card.project_id; const stateClass = card.status !== "active" ? "is-inactive" : unassigned ? "is-unassigned" : ""; const state = card.status === "retired" ? "RETIRED" : card.status === "inactive" ? "INACTIVE" : unassigned ? "UNASSIGNED" : "ONLINE"; return `<div class="pc-card-row" role="row"><input type="checkbox" data-card-id="${escape(card.id)}"${selected.has(card.id) ? " checked" : ""} aria-label="Select ${escape(card.card_code)}"><strong>${escape(card.card_code)}</strong><span class="pc-name${card.assigned_name ? "" : " is-empty"}">${escape(card.assigned_name || "Not assigned")}</span><code>n3xra.com/t/${escape(card.token)}</code><span class="pc-destination">${escape(projectName(card.project_id))}</span><b class="${stateClass}">${state}</b><button class="pc-manage" type="button" data-manage-card="${escape(card.id)}">Manage</button></div>`; }).join("");
    const hasCards = cards.length > 0;
    const bulk = one("#pc-bulk");
    if (bulk)
        bulk.hidden = !hasCards;
    const table = one("#pc-table");
    if (table)
        table.hidden = !hasCards;
    const empty = one("#pc-card-empty");
    if (empty)
        empty.hidden = hasCards;
    updateSelection();
}
function render() { renderProjectOptions(); renderProjects(); renderCards(); renderSummary(); }
function switchView(view) {
    document.querySelectorAll("[data-pc-view]").forEach((button) => { const active = button.dataset.pcView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll("[data-pc-panel]").forEach((panel) => { panel.hidden = panel.dataset.pcPanel !== view; });
}
function nfcWritingAvailable() { return "NDEFReader" in window && window.isSecureContext; }
function updateNfcSupport() {
    const available = nfcWritingAvailable();
    const title = one("#pc-device-title");
    const copy = one("#pc-device-copy");
    if (title)
        title.textContent = available ? "NFC writing is available" : "NFC writing is not available on this device";
    if (copy)
        copy.textContent = available ? "After creating the card, this browser can write its permanent address." : "The card will still be added here. Write it later from a compatible Android device or the future N3XRA iPhone app.";
}
function resetActivation() {
    createdCard = null;
    activateForm?.reset();
    if (activateFields)
        activateFields.hidden = false;
    if (activateResult)
        activateResult.hidden = true;
    if (activateStatus)
        activateStatus.textContent = "";
    if (writeCardButton) {
        writeCardButton.disabled = true;
        writeCardButton.textContent = "Hold NFC card near device to write";
    }
    updateNfcSupport();
}
function closeActivation() { activateDialog?.close(); }
function openActivation() {
    switchView("cards");
    resetActivation();
    activateDialog?.showModal();
}
async function loadWorkspace() {
    const [{ data: projectRows, error: projectError }, { data: cardRows, error: cardError }] = await Promise.all([
        supabase.from("project_card_projects").select("id,organization_id,slug,name,description,location_text,status,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }),
        supabase.from("project_card_devices").select("id,card_code,token,assigned_name,project_id,status").eq("organization_id", organizationId).neq("status", "retired").order("updated_at", { ascending: false }),
    ]);
    if (projectError)
        throw projectError;
    if (cardError)
        throw cardError;
    projects = (projectRows || []);
    cards = (cardRows || []);
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
    userId = session.user.id;
    const parameters = new URLSearchParams(window.location.search);
    let requested = parameters.get("organization") || getStoredActiveOrganizationId();
    if (parameters.get("activate") === "1") {
        if (!requested) {
            const { data: workspace, error: workspaceError } = await supabase.rpc("create_owned_organization", { input_organization_name: "Project Cards" });
            if (workspaceError)
                throw workspaceError;
            requested = String(workspace?.organization_id || "");
        }
        if (!requested)
            throw new Error("Unable to create your Project Cards workspace.");
        const { error: activationError } = await supabase.rpc("activate_project_cards", { input_organization_id: requested });
        if (activationError)
            throw activationError;
        parameters.delete("activate");
        parameters.set("organization", requested);
        const nextQuery = parameters.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    }
    const { data, error } = await supabase.from("organization_product_member_access").select("organization_id,role").eq("user_id", userId).eq("product_key", "project_cards").eq("status", "active");
    if (error)
        throw error;
    const accesses = (data || []);
    const access = accesses.find((row) => row.organization_id === requested) || accesses[0];
    if (!access)
        throw new Error("Project Cards has not been activated for your organization yet.");
    organizationId = access.organization_id;
    setStoredActiveOrganizationId(organizationId);
    const { data: organizationRow, error: organizationError } = await supabase.from("organizations").select("id,name").eq("id", organizationId).maybeSingle();
    if (organizationError)
        throw organizationError;
    const workspaceName = one("#pc-workspace-name");
    if (workspaceName)
        workspaceName.innerHTML = `${escape(String(organizationRow?.name || "Your workspace"))}<small>${standaloneApp ? "Independent N3XRA workspace" : "Connected to your organization"}</small>`;
    await loadWorkspace();
    render();
    if (status)
        status.hidden = true;
    if (app)
        app.hidden = false;
    document.body.classList.remove("portal-loading");
}
document.querySelectorAll("[data-pc-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.pcView || "projects")));
filter?.addEventListener("change", renderProjects);
selectAll?.addEventListener("change", () => { selected = selectAll.checked ? new Set(cards.map((card) => card.id)) : new Set(); renderCards(); });
cardList?.addEventListener("change", (event) => { const input = event.target.closest("[data-card-id]"); if (!input)
    return; const id = input.dataset.cardId || ""; if (input.checked)
    selected.add(id);
else
    selected.delete(id); updateSelection(); });
assignButton?.addEventListener("click", async () => { const destination = target?.value || null; const chosen = [...selected]; if (!chosen.length)
    return; const { error } = await supabase.from("project_card_devices").update({ project_id: destination }).in("id", chosen).eq("organization_id", organizationId); if (error) {
    message(error.message);
    return;
} await loadWorkspace(); selected.clear(); render(); message(`${chosen.length} card${chosen.length === 1 ? "" : "s"} updated.`); });
function openCreateDialog() { dialog?.showModal(); }
one("#pc-new-project")?.addEventListener("click", openCreateDialog);
one("[data-empty-new-project]")?.addEventListener("click", openCreateDialog);
one("#pc-dialog-close")?.addEventListener("click", () => dialog?.close());
one("#pc-dialog-cancel")?.addEventListener("click", () => dialog?.close());
one("#pc-activate-card")?.addEventListener("click", openActivation);
one("[data-empty-activate-card]")?.addEventListener("click", openActivation);
one("#pc-activate-close")?.addEventListener("click", closeActivation);
one("#pc-activate-cancel")?.addEventListener("click", closeActivation);
one("#pc-finish-card")?.addEventListener("click", closeActivation);
activateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activateForm.reportValidity())
        return;
    const submit = one("#pc-activate-submit");
    if (submit)
        submit.disabled = true;
    if (activateStatus)
        activateStatus.textContent = "Creating the permanent card address…";
    const values = new FormData(activateForm);
    const { data, error } = await supabase.rpc("create_project_card", { input_organization_id: organizationId, input_assigned_name: String(values.get("assignedName") || "").trim(), input_project_id: String(values.get("projectId") || "") || null });
    if (submit)
        submit.disabled = false;
    if (error) {
        if (activateStatus)
            activateStatus.textContent = error.message;
        return;
    }
    createdCard = data;
    one("#pc-created-card-code").textContent = createdCard.card_code;
    one("#pc-created-card-address").textContent = createdCard.permanent_url;
    one("#pc-created-card-copy").textContent = nfcWritingAvailable() ? "The card is in your library. You can write it now or close this window." : "The card is in your library. You can write the NFC card later from a supported device.";
    if (writeCardButton)
        writeCardButton.disabled = !nfcWritingAvailable();
    if (activateFields)
        activateFields.hidden = true;
    if (activateResult)
        activateResult.hidden = false;
    if (activateStatus)
        activateStatus.textContent = "";
    await loadWorkspace();
    render();
});
writeCardButton?.addEventListener("click", async () => {
    if (!createdCard || !nfcWritingAvailable())
        return;
    const Reader = window.NDEFReader;
    writeCardButton.disabled = true;
    try {
        const reader = new Reader();
        await reader.write({ records: [{ recordType: "url", data: createdCard.permanent_url }] });
        one("#pc-created-card-copy").textContent = "The permanent N3XRA address was written to the NFC card.";
        writeCardButton.textContent = "NFC card written";
    }
    catch (error) {
        writeCardButton.disabled = false;
        if (activateStatus)
            activateStatus.textContent = errorMessage(error, "Unable to write this NFC card.");
    }
});
projectList?.addEventListener("click", (event) => { const button = event.target.closest("[data-open-project]"); if (button)
    window.location.href = `${appBase}editor/?project=${encodeURIComponent(button.dataset.openProject || "")}`; });
createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(createForm);
    const name = String(values.get("name") || "").trim();
    if (!name)
        return;
    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "project";
    const payload = { organization_id: organizationId, slug: `${slugBase}-${Date.now().toString(36)}`, name, description: String(values.get("description") || "").trim(), status: values.get("status") === "live" ? "live" : "draft", created_by_user_id: userId };
    const { data, error } = await supabase.from("project_card_projects").insert(payload).select("id").single();
    if (error) {
        message(error.message);
        return;
    }
    dialog?.close();
    createForm.reset();
    window.location.href = `${appBase}editor/?project=${encodeURIComponent(String(data.id))}`;
});
cardList?.addEventListener("click", (event) => { const button = event.target.closest("[data-manage-card]"); if (!button)
    return; const card = cards.find((item) => item.id === button.dataset.manageCard); if (!card || !manageForm || !manageProject)
    return; managedCardId = card.id; one("#pc-manage-title").textContent = `Manage ${card.card_code}`; one("#pc-manage-address").textContent = `n3xra.com/t/${card.token}`; manageForm.elements.namedItem("assignedName").value = card.assigned_name; manageProject.value = card.project_id || ""; manageDialog?.showModal(); });
one("#pc-manage-close")?.addEventListener("click", () => manageDialog?.close());
one("#pc-manage-cancel")?.addEventListener("click", () => manageDialog?.close());
manageForm?.addEventListener("submit", async (event) => { event.preventDefault(); const values = new FormData(manageForm); const { error } = await supabase.from("project_card_devices").update({ assigned_name: String(values.get("assignedName") || "").trim(), project_id: String(values.get("projectId") || "") || null }).eq("id", managedCardId).eq("organization_id", organizationId); if (error) {
    message(error.message);
    return;
} await loadWorkspace(); render(); manageDialog?.close(); message("Card updated."); });
document.querySelectorAll("[data-card-action]").forEach((button) => button.addEventListener("click", () => { const card = cards.find((item) => item.id === managedCardId); if (!card)
    return; pendingAction = button.dataset.cardAction; const copy = { unassign: ["Unassign this card?", `${card.card_code} will remain active but will no longer open a project.`], deactivate: ["Deactivate this card?", `${card.card_code} will stop resolving until it is reactivated.`], retire: ["Permanently retire this card?", `${card.card_code} will never be issued again.`] }; const details = pendingAction ? copy[pendingAction] : undefined; if (!details)
    return; one("#pc-confirm-title").textContent = details[0]; one("#pc-confirm-copy").textContent = details[1]; confirmDialog?.showModal(); }));
confirmDialog?.addEventListener("close", async () => { if (confirmDialog.returnValue !== "confirm" || !pendingAction || !managedCardId) {
    pendingAction = null;
    return;
} const update = pendingAction === "unassign" ? { project_id: null } : pendingAction === "deactivate" ? { status: "inactive" } : { status: "retired", retired_at: new Date().toISOString() }; const { error } = await supabase.from("project_card_devices").update(update).eq("id", managedCardId).eq("organization_id", organizationId); pendingAction = null; if (error) {
    message(error.message);
    return;
} manageDialog?.close(); await loadWorkspace(); render(); message("Card updated."); });
if (new URLSearchParams(window.location.search).get("view") === "cards")
    switchView("cards");
void authorize().catch((error) => { if (status)
    status.textContent = errorMessage(error, "Unable to open the Project Cards workspace."); document.body.classList.remove("portal-loading"); });
