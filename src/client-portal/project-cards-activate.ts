import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId } from "/shared/lib/orgs.js";

interface Project { id: string; name: string }
interface CreatedCard { card_code: string; permanent_url: string; token: string }
const one = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const form = one<HTMLFormElement>("#pa-form");
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
let supabase: any;
let organizationId = "";
let createdCard: CreatedCard | null = null;

function showStep(step: string): void { document.querySelectorAll<HTMLElement>("[data-step]").forEach((panel) => { panel.hidden = panel.dataset.step !== step; }); document.querySelectorAll<HTMLElement>("[data-progress]").forEach((item) => item.classList.toggle("is-active", Number(item.dataset.progress) <= Number(step))); window.scrollTo({ top: 0, behavior: "smooth" }); }
function review(): boolean { if (!form?.reportValidity()) return false; const values = new FormData(form); one<HTMLElement>("#pa-review-name")!.textContent = String(values.get("assignedName") || "Not assigned"); const select = form.elements.namedItem("project") as HTMLSelectElement; one<HTMLElement>("#pa-review-project")!.textContent = select.selectedOptions[0]?.textContent || "Leave unassigned"; return true; }
function detectNfc(): boolean { const supported = "NDEFReader" in window && window.isSecureContext; const title = one<HTMLElement>("#pa-device-title"); const copy = one<HTMLElement>("#pa-device-copy"); if (title) title.textContent = supported ? "NFC writing is available" : "Use a compatible NFC-writing device"; if (copy) copy.textContent = supported ? "Your browser will request permission when you press Write to NFC card." : "Create the identity here, then write it from a supported Android phone or the future N3XRA mobile app."; return supported; }

async function createIdentity(): Promise<void> {
  if (!form || createdCard) return;
  const values = new FormData(form);
  const projectId = String(values.get("project") || "") || null;
  const { data, error } = await supabase.rpc("create_project_card", { input_organization_id: organizationId, input_assigned_name: String(values.get("assignedName") || "").trim(), input_project_id: projectId });
  if (error) throw error;
  createdCard = data as CreatedCard;
  one<HTMLElement>("#pa-created-address")!.textContent = createdCard.permanent_url;
  const write = one<HTMLButtonElement>("#pa-write"); if (write) write.disabled = !detectNfc();
  one<HTMLElement>("#pa-ready-title")!.textContent = `Card ${createdCard.card_code} created`;
  one<HTMLElement>("#pa-ready-copy")!.textContent = "Its permanent address is reserved and will never be reassigned to another card.";
}

async function authorize(): Promise<void> {
  if (!hasConfig()) throw new Error("The N3XRA data connection is not configured.");
  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
  organizationId = new URLSearchParams(window.location.search).get("organization") || getStoredActiveOrganizationId();
  if (!organizationId) throw new Error("Choose a Project Cards organization before activating a card.");
  const { data: canManage, error: accessError } = await supabase.rpc("can_manage_project_cards", { target_organization_id: organizationId });
  if (accessError || canManage !== true) throw new Error("You do not have permission to activate cards for this organization.");
  const { data, error } = await supabase.from("project_card_projects").select("id,name").eq("organization_id", organizationId).neq("status", "archived").order("name");
  if (error) throw error;
  const select = form?.elements.namedItem("project") as HTMLSelectElement | null;
  if (select) select.innerHTML = `${((data || []) as Project[]).map((project) => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join("")}<option value="">Leave unassigned</option>`;
  detectNfc();
  one<HTMLElement>("#pa-status")!.hidden = true;
  one<HTMLElement>("#pa-app")!.hidden = false;
  document.body.classList.remove("portal-loading");
}

document.querySelectorAll<HTMLButtonElement>("[data-next]").forEach((button) => button.addEventListener("click", async () => { const next = button.dataset.next || "1"; if (next === "2" && !review()) return; if (next === "3") { button.disabled = true; try { await createIdentity(); } catch (error) { button.disabled = false; one<HTMLElement>("#pa-status")!.textContent = error instanceof Error ? error.message : "Unable to create this card."; one<HTMLElement>("#pa-status")!.hidden = false; return; } } showStep(next); }));
document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((button) => button.addEventListener("click", () => showStep(button.dataset.back || "1")));
one<HTMLButtonElement>("#pa-write")?.addEventListener("click", async () => { if (!createdCard) return; const Reader = (window as unknown as { NDEFReader: new () => { write(message: { records: Array<{ recordType: string; data: string }> }): Promise<void> } }).NDEFReader; const reader = new Reader(); await reader.write({ records: [{ recordType: "url", data: createdCard.permanent_url }] }); one<HTMLElement>("#pa-ready-copy")!.textContent = "The permanent N3XRA address was written to the NFC card."; });
void authorize().catch((error: unknown) => { const status = one<HTMLElement>("#pa-status"); if (status) status.textContent = error instanceof Error ? error.message : "Unable to open card activation."; document.body.classList.remove("portal-loading"); });
