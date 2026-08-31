import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";

type Status = "live" | "draft" | "archived";
interface Project { id: string; organization_id: string; slug: string; name: string; description: string; location_text: string; status: Status; updated_at: string }
interface Card { id: string; card_code: string; token: string; assigned_name: string; project_id: string | null; status: "active" | "inactive" | "retired" }
interface Access { organization_id: string; role: string; organization: { id: string; name: string } | Array<{ id: string; name: string }> | null }

let supabase: any;
let userId = "";
let organizationId = "";
let projects: Project[] = [];
let cards: Card[] = [];
let selected = new Set<string>();
let managedCardId: string | null = null;
let pendingAction: "unassign" | "deactivate" | "retire" | null = null;

const one = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const app = one<HTMLElement>("#pc-app");
const status = one<HTMLElement>("#pc-status");
const projectList = one<HTMLElement>("#pc-project-list");
const cardList = one<HTMLElement>("#pc-card-list");
const filter = one<HTMLSelectElement>("#pc-project-filter");
const target = one<HTMLSelectElement>("#pc-project-target");
const selectAll = one<HTMLInputElement>("#pc-select-all");
const assignButton = one<HTMLButtonElement>("#pc-assign-selected");
const selectionStatus = one<HTMLElement>("#pc-selection-status");
const dialog = one<HTMLDialogElement>("#pc-dialog");
const createForm = one<HTMLFormElement>("#pc-create-form");
const toast = one<HTMLElement>("#pc-toast");
const manageDialog = one<HTMLDialogElement>("#pc-manage-dialog");
const manageForm = one<HTMLFormElement>("#pc-manage-form");
const manageProject = one<HTMLSelectElement>("#pc-manage-project");
const confirmDialog = one<HTMLDialogElement>("#pc-confirm-dialog");

function escape(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function projectName(id: string | null): string { return projects.find((project) => project.id === id)?.name || "Unassigned"; }
function projectCount(id: string): number { return cards.filter((card) => card.project_id === id).length; }
function message(text: string): void { if (!toast) return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2800); }
function organization(access: Access): { id: string; name: string } | null { return Array.isArray(access.organization) ? access.organization[0] || null : access.organization; }

function renderSummary(): void {
  const values: Record<string, number> = { "#pc-project-total": projects.length, "#pc-card-total": cards.length, "#pc-assigned-total": cards.filter((card) => card.project_id).length, "#pc-tab-count": cards.length };
  Object.entries(values).forEach(([selector, value]) => { const node = one<HTMLElement>(selector); if (node) node.textContent = String(value); });
}

function renderProjectOptions(): void {
  const options = `${projects.filter((project) => project.status !== "archived").map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join("")}<option value="">Unassigned</option>`;
  if (target) target.innerHTML = options;
  if (manageProject) manageProject.innerHTML = options;
}

function renderProjects(): void {
  if (!projectList) return;
  const visible = filter?.value && filter.value !== "all" ? projects.filter((project) => project.status === filter.value) : projects.filter((project) => project.status !== "archived");
  projectList.innerHTML = visible.map((project, index) => { const count = projectCount(project.id); const tone = ["fire", "forest", "slate"][index % 3] || "forest"; return `<article class="pc-project" data-tone="${tone}"><div class="pc-project-visual"><strong>${count}</strong><span>${count === 1 ? "CARD" : "CARDS"}</span></div><div class="pc-project-copy"><span class="pc-project-status${project.status === "draft" ? " is-draft" : ""}">${escape(project.status.toUpperCase())}</span><h4>${escape(project.name)}</h4><span>${escape(project.description || project.location_text || "New resource hub")}</span><footer><button type="button" data-open-project="${escape(project.id)}">Open workspace →</button><small>${count} assigned</small></footer></div></article>`; }).join("");
  const empty = one<HTMLElement>("#pc-project-empty");
  if (empty) empty.hidden = visible.length !== 0;
}

function updateSelection(): void {
  const count = selected.size;
  if (selectionStatus) selectionStatus.textContent = count ? `${count} card${count === 1 ? "" : "s"} selected` : "Select cards to assign them together";
  if (assignButton) assignButton.disabled = count === 0;
  if (selectAll) { selectAll.checked = cards.length > 0 && count === cards.length; selectAll.indeterminate = count > 0 && count < cards.length; }
}

function renderCards(): void {
  if (!cardList) return;
  cardList.innerHTML = cards.map((card) => { const unassigned = !card.project_id; const stateClass = card.status !== "active" ? "is-inactive" : unassigned ? "is-unassigned" : ""; const state = card.status === "retired" ? "RETIRED" : card.status === "inactive" ? "INACTIVE" : unassigned ? "UNASSIGNED" : "ONLINE"; return `<div class="pc-card-row" role="row"><input type="checkbox" data-card-id="${escape(card.id)}"${selected.has(card.id) ? " checked" : ""} aria-label="Select ${escape(card.card_code)}"><strong>${escape(card.card_code)}</strong><span class="pc-name${card.assigned_name ? "" : " is-empty"}">${escape(card.assigned_name || "Not assigned")}</span><code>n3xra.com/t/${escape(card.token)}</code><span class="pc-destination">${escape(projectName(card.project_id))}</span><b class="${stateClass}">${state}</b><button class="pc-manage" type="button" data-manage-card="${escape(card.id)}">Manage</button></div>`; }).join("");
  const hasCards = cards.length > 0;
  const bulk = one<HTMLElement>("#pc-bulk"); if (bulk) bulk.hidden = !hasCards;
  const table = one<HTMLElement>("#pc-table"); if (table) table.hidden = !hasCards;
  const empty = one<HTMLElement>("#pc-card-empty"); if (empty) empty.hidden = hasCards;
  updateSelection();
}

function render(): void { renderProjectOptions(); renderProjects(); renderCards(); renderSummary(); }
function switchView(view: string): void {
  document.querySelectorAll<HTMLButtonElement>("[data-pc-view]").forEach((button) => { const active = button.dataset.pcView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
  document.querySelectorAll<HTMLElement>("[data-pc-panel]").forEach((panel) => { panel.hidden = panel.dataset.pcPanel !== view; });
}

async function loadWorkspace(): Promise<void> {
  const [{ data: projectRows, error: projectError }, { data: cardRows, error: cardError }] = await Promise.all([
    supabase.from("project_card_projects").select("id,organization_id,slug,name,description,location_text,status,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }),
    supabase.from("project_card_devices").select("id,card_code,token,assigned_name,project_id,status").eq("organization_id", organizationId).neq("status", "retired").order("updated_at", { ascending: false }),
  ]);
  if (projectError) throw projectError;
  if (cardError) throw cardError;
  projects = (projectRows || []) as Project[];
  cards = (cardRows || []) as Card[];
}

async function authorize(): Promise<void> {
  if (!hasConfig()) throw new Error("The N3XRA data connection is not configured.");
  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
  userId = session.user.id;
  const { data, error } = await supabase.from("organization_product_member_access").select("organization_id,role,organization:organizations(id,name)").eq("user_id", userId).eq("product_key", "project_cards").eq("status", "active");
  if (error) throw error;
  const accesses = (data || []) as Access[];
  const requested = new URLSearchParams(window.location.search).get("organization") || getStoredActiveOrganizationId();
  const access = accesses.find((row) => row.organization_id === requested) || accesses[0];
  if (!access) throw new Error("Project Cards has not been activated for your organization yet.");
  organizationId = access.organization_id;
  setStoredActiveOrganizationId(organizationId);
  const workspaceName = one<HTMLElement>("#pc-workspace-name");
  if (workspaceName) workspaceName.innerHTML = `${escape(organization(access)?.name || "Your workspace")}<small>Private to your organization</small>`;
  await loadWorkspace();
  render();
  if (status) status.hidden = true;
  if (app) app.hidden = false;
  document.body.classList.remove("portal-loading");
}

document.querySelectorAll<HTMLButtonElement>("[data-pc-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.pcView || "projects")));
filter?.addEventListener("change", renderProjects);
selectAll?.addEventListener("change", () => { selected = selectAll.checked ? new Set(cards.map((card) => card.id)) : new Set<string>(); renderCards(); });
cardList?.addEventListener("change", (event) => { const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-card-id]"); if (!input) return; const id = input.dataset.cardId || ""; if (input.checked) selected.add(id); else selected.delete(id); updateSelection(); });
assignButton?.addEventListener("click", async () => { const destination = target?.value || null; const chosen = [...selected]; if (!chosen.length) return; const { error } = await supabase.from("project_card_devices").update({ project_id: destination }).in("id", chosen).eq("organization_id", organizationId); if (error) { message(error.message); return; } await loadWorkspace(); selected.clear(); render(); message(`${chosen.length} card${chosen.length === 1 ? "" : "s"} updated.`); });
function openCreateDialog(): void { dialog?.showModal(); }
one("#pc-new-project")?.addEventListener("click", openCreateDialog);
one("[data-empty-new-project]")?.addEventListener("click", openCreateDialog);
one("#pc-dialog-close")?.addEventListener("click", () => dialog?.close());
one("#pc-dialog-cancel")?.addEventListener("click", () => dialog?.close());
function openActivation(): void { window.location.href = `/client-portal/project-cards/activate/?organization=${encodeURIComponent(organizationId)}`; }
one("#pc-activate-card")?.addEventListener("click", openActivation);
one("[data-empty-activate-card]")?.addEventListener("click", openActivation);
projectList?.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-project]"); if (button) window.location.href = `/client-portal/project-cards/editor/?project=${encodeURIComponent(button.dataset.openProject || "")}`; });
createForm?.addEventListener("submit", async (event) => { event.preventDefault(); const values = new FormData(createForm); const name = String(values.get("name") || "").trim(); if (!name) return; const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "project"; const payload = { organization_id: organizationId, slug: `${slugBase}-${Date.now().toString(36)}`, name, description: String(values.get("description") || "").trim(), status: values.get("status") === "live" ? "live" : "draft", created_by_user_id: userId };
  const { data, error } = await supabase.from("project_card_projects").insert(payload).select("id").single();
  if (error) { message(error.message); return; }
  dialog?.close(); createForm.reset(); window.location.href = `/client-portal/project-cards/editor/?project=${encodeURIComponent(String(data.id))}`;
});

cardList?.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-manage-card]"); if (!button) return; const card = cards.find((item) => item.id === button.dataset.manageCard); if (!card || !manageForm || !manageProject) return; managedCardId = card.id; one<HTMLElement>("#pc-manage-title")!.textContent = `Manage ${card.card_code}`; one<HTMLElement>("#pc-manage-address")!.textContent = `n3xra.com/t/${card.token}`; (manageForm.elements.namedItem("assignedName") as HTMLInputElement).value = card.assigned_name; manageProject.value = card.project_id || ""; manageDialog?.showModal(); });
one("#pc-manage-close")?.addEventListener("click", () => manageDialog?.close());
one("#pc-manage-cancel")?.addEventListener("click", () => manageDialog?.close());
manageForm?.addEventListener("submit", async (event) => { event.preventDefault(); const values = new FormData(manageForm); const { error } = await supabase.from("project_card_devices").update({ assigned_name: String(values.get("assignedName") || "").trim(), project_id: String(values.get("projectId") || "") || null }).eq("id", managedCardId).eq("organization_id", organizationId); if (error) { message(error.message); return; } await loadWorkspace(); render(); manageDialog?.close(); message("Card updated."); });
document.querySelectorAll<HTMLButtonElement>("[data-card-action]").forEach((button) => button.addEventListener("click", () => { const card = cards.find((item) => item.id === managedCardId); if (!card) return; pendingAction = button.dataset.cardAction as typeof pendingAction; const copy: Record<string, [string, string]> = { unassign: ["Unassign this card?", `${card.card_code} will remain active but will no longer open a project.`], deactivate: ["Deactivate this card?", `${card.card_code} will stop resolving until it is reactivated.`], retire: ["Permanently retire this card?", `${card.card_code} will never be issued again.`] }; const details = pendingAction ? copy[pendingAction] : undefined; if (!details) return; one<HTMLElement>("#pc-confirm-title")!.textContent = details[0]; one<HTMLElement>("#pc-confirm-copy")!.textContent = details[1]; confirmDialog?.showModal(); }));
confirmDialog?.addEventListener("close", async () => { if (confirmDialog.returnValue !== "confirm" || !pendingAction || !managedCardId) { pendingAction = null; return; } const update = pendingAction === "unassign" ? { project_id: null } : pendingAction === "deactivate" ? { status: "inactive" } : { status: "retired", retired_at: new Date().toISOString() }; const { error } = await supabase.from("project_card_devices").update(update).eq("id", managedCardId).eq("organization_id", organizationId); pendingAction = null; if (error) { message(error.message); return; } manageDialog?.close(); await loadWorkspace(); render(); message("Card updated."); });

if (new URLSearchParams(window.location.search).get("view") === "cards") switchView("cards");
void authorize().catch((error: unknown) => { if (status) status.textContent = error instanceof Error ? error.message : "Unable to open the Project Cards workspace."; document.body.classList.remove("portal-loading"); });
