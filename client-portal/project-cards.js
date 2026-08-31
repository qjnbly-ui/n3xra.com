import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
let projects = [
    { id: "medford-fire", name: "Medford Fire Assignment", description: "5 resources · Updated 12 minutes ago", status: "live", tone: "fire" },
    { id: "crew-training", name: "Crew Training Resources", description: "8 resources · Updated yesterday", status: "draft", tone: "forest" },
    { id: "equipment-inspection", name: "Equipment Inspection", description: "3 resources · Updated August 28", status: "live", tone: "slate" },
];
const tokens = ["8K4P2M", "A7XR31", "D5QW92", "M3T8LX", "P9C2VN", "R4J7YK", "S6H1BD", "U2N9GF", "W8E4KM", "Z1V6QP"];
const names = ["Alex Morgan", "Jordan Lee", "Casey Rivera", "Taylor Brooks", "Morgan Hayes", "Riley Carter", "Cameron Reed", "Avery Bennett", "Jamie Collins", "Not assigned"];
let cards = tokens.map((token, index) => ({ id: `N3-${String(index + 1).padStart(3, "0")}`, token, assignedName: names[index] || "Not assigned", projectId: index < 7 ? "medford-fire" : index < 9 ? "crew-training" : null, active: true }));
let selected = new Set();
let managedCardId = null;
let pendingAction = null;
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
function escape(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function projectName(id) { return projects.find((project) => project.id === id)?.name || "Unassigned"; }
function projectCount(id) { return cards.filter((card) => card.projectId === id).length; }
function message(text) { if (!toast)
    return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2800); }
function renderSummary() {
    const values = { "#pc-project-total": projects.length, "#pc-card-total": cards.length, "#pc-assigned-total": cards.filter((card) => card.projectId).length, "#pc-tab-count": cards.length };
    Object.entries(values).forEach(([selector, value]) => { const node = one(selector); if (node)
        node.textContent = String(value); });
}
function renderProjectOptions() {
    if (!target)
        return;
    const current = target.value;
    target.innerHTML = `${projects.map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join("")}<option value="">Unassigned</option>`;
    target.value = projects.some((project) => project.id === current) || current === "" ? current : projects[0]?.id || "";
    if (manageProject)
        manageProject.innerHTML = `${projects.map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join("")}<option value="">Unassigned</option>`;
}
function renderProjects() {
    if (!projectList)
        return;
    const visible = filter?.value && filter.value !== "all" ? projects.filter((project) => project.status === filter.value) : projects;
    projectList.innerHTML = visible.map((project) => { const count = projectCount(project.id); return `<article class="pc-project" data-tone="${project.tone}"><div class="pc-project-visual"><strong>${count}</strong><span>${count === 1 ? "CARD" : "CARDS"}</span></div><div class="pc-project-copy"><span class="pc-project-status${project.status === "draft" ? " is-draft" : ""}">${project.status.toUpperCase()}</span><h4>${escape(project.name)}</h4><span>${escape(project.description)}</span><footer><button type="button" data-open-project="${escape(project.id)}">Open workspace →</button><small>${count} assigned</small></footer></div></article>`; }).join("");
}
function updateSelection() {
    const count = selected.size;
    if (selectionStatus)
        selectionStatus.textContent = count ? `${count} card${count === 1 ? "" : "s"} selected` : "Select cards to assign them together";
    if (assignButton)
        assignButton.disabled = count === 0;
    if (selectAll) {
        selectAll.checked = count === cards.length;
        selectAll.indeterminate = count > 0 && count < cards.length;
    }
}
function renderCards() {
    if (!cardList)
        return;
    cardList.innerHTML = cards.map((card) => { const unassigned = !card.projectId; const stateClass = !card.active ? "is-inactive" : unassigned ? "is-unassigned" : ""; const state = !card.active ? "INACTIVE" : unassigned ? "UNASSIGNED" : "ONLINE"; return `<div class="pc-card-row" role="row"><input type="checkbox" data-card-id="${escape(card.id)}"${selected.has(card.id) ? " checked" : ""} aria-label="Select ${escape(card.id)}"><strong>${escape(card.id)}</strong><span class="pc-name${card.assignedName === "Not assigned" ? " is-empty" : ""}">${escape(card.assignedName)}</span><code>n3xra.com/t/${escape(card.token)}</code><span class="pc-destination">${escape(projectName(card.projectId))}</span><b class="${stateClass}">${state}</b><button class="pc-manage" type="button" data-manage-card="${escape(card.id)}">Manage</button></div>`; }).join("");
    updateSelection();
}
function render() { renderProjectOptions(); renderProjects(); renderCards(); renderSummary(); }
function switchView(view) {
    document.querySelectorAll("[data-pc-view]").forEach((button) => { const active = button.dataset.pcView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll("[data-pc-panel]").forEach((panel) => { panel.hidden = panel.dataset.pcPanel !== view; });
}
async function authorize() {
    if (!hasConfig())
        throw new Error("The N3XRA data connection is not configured.");
    const supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname)}`);
        return;
    }
    const { data, error } = await supabase.rpc("is_platform_admin");
    if (error || data !== true) {
        window.location.replace("/client-portal/");
        return;
    }
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
assignButton?.addEventListener("click", () => { const destination = target?.value || null; const count = selected.size; cards = cards.map((card) => selected.has(card.id) ? { ...card, projectId: destination } : card); selected.clear(); render(); message(`${count} card${count === 1 ? "" : "s"} assigned to ${projectName(destination)}.`); });
one("#pc-new-project")?.addEventListener("click", () => dialog?.showModal());
one("#pc-dialog-close")?.addEventListener("click", () => dialog?.close());
one("#pc-dialog-cancel")?.addEventListener("click", () => dialog?.close());
one("#pc-activate-card")?.addEventListener("click", () => { window.location.href = "/client-portal/project-cards/activate/"; });
projectList?.addEventListener("click", (event) => { const button = event.target.closest("[data-open-project]"); if (button)
    window.location.href = `/client-portal/project-cards/editor/?project=${encodeURIComponent(button.dataset.openProject || "")}`; });
createForm?.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(createForm); const name = String(values.get("name") || "").trim(); if (!name)
    return; const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`; projects = [...projects, { id, name, description: String(values.get("description") || "").trim() || "New resource hub", status: values.get("status") === "live" ? "live" : "draft", tone: "forest" }]; dialog?.close(); createForm.reset(); render(); switchView("projects"); message(`${name} created in this preview.`); });
cardList?.addEventListener("click", (event) => { const button = event.target.closest("[data-manage-card]"); if (!button)
    return; const card = cards.find((item) => item.id === button.dataset.manageCard); if (!card || !manageForm || !manageProject)
    return; managedCardId = card.id; one("#pc-manage-title").textContent = `Manage ${card.id}`; one("#pc-manage-address").textContent = `n3xra.com/t/${card.token}`; const assignedName = manageForm.elements.namedItem("assignedName"); assignedName.value = card.assignedName === "Not assigned" ? "" : card.assignedName; manageProject.value = card.projectId || ""; manageDialog?.showModal(); });
one("#pc-manage-close")?.addEventListener("click", () => manageDialog?.close());
one("#pc-manage-cancel")?.addEventListener("click", () => manageDialog?.close());
manageForm?.addEventListener("submit", (event) => { event.preventDefault(); const card = cards.find((item) => item.id === managedCardId); if (!card)
    return; const values = new FormData(manageForm); card.assignedName = String(values.get("assignedName") || "").trim() || "Not assigned"; card.projectId = String(values.get("projectId") || "") || null; render(); manageDialog?.close(); message(`${card.id} updated in this preview.`); });
document.querySelectorAll("[data-card-action]").forEach((button) => button.addEventListener("click", () => { const card = cards.find((item) => item.id === managedCardId); if (!card)
    return; pendingAction = button.dataset.cardAction; const copy = { unassign: ["Unassign this card?", `${card.id} will remain active but will no longer open a project.`], deactivate: ["Deactivate this card?", `${card.id} will stop resolving until it is reactivated.`], delete: ["Permanently delete this card?", `${card.id} and token ${card.token} will be retired forever and cannot be reused.`] }; const details = pendingAction ? copy[pendingAction] : undefined; if (!details)
    return; one("#pc-confirm-title").textContent = details[0]; one("#pc-confirm-copy").textContent = details[1]; confirmDialog?.showModal(); }));
confirmDialog?.addEventListener("close", () => { if (confirmDialog.returnValue !== "confirm" || !pendingAction || !managedCardId) {
    pendingAction = null;
    return;
} const card = cards.find((item) => item.id === managedCardId); if (!card)
    return; const label = card.id; if (pendingAction === "delete")
    cards = cards.filter((item) => item.id !== managedCardId);
else if (pendingAction === "unassign")
    card.projectId = null;
else
    card.active = false; selected.delete(managedCardId); pendingAction = null; manageDialog?.close(); render(); message(`${label} updated in this preview.`); });
if (new URLSearchParams(window.location.search).get("view") === "cards")
    switchView("cards");
void authorize().catch((error) => { if (status)
    status.textContent = error instanceof Error ? error.message : "Unable to open the project-card workspace."; document.body.classList.remove("portal-loading"); });
