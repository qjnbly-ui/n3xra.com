import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

type ResourceType = "pdf" | "radio" | "image" | "file" | "link";
interface Resource { id: number; type: ResourceType; title: string; detail: string }
const icons: Record<ResourceType, string> = { pdf: "PDF", radio: "⌁", image: "⌖", file: "DOC", link: "↗" };
let resources: Resource[] = [
  { id: 1, type: "pdf", title: "Daily Fire Weather Briefing", detail: "NOAA Medford · Updated today at 6:15 AM" },
  { id: 2, type: "radio", title: "Radio Channels", detail: "Command, tactical, air-to-ground, and travel" },
  { id: 3, type: "image", title: "Division Map", detail: "Operational map · Revision 3" },
  { id: 4, type: "file", title: "Incident Action Plan", detail: "PDF · 4.8 MB" },
  { id: 5, type: "link", title: "Check-in & Safety Form", detail: "Opens a secure N3XRA form" },
];
const assignedCards = ["Alex Morgan", "Jordan Lee", "Casey Rivera", "Taylor Brooks", "Morgan Hayes", "Riley Carter", "Cameron Reed"];
const one = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const list = one<HTMLElement>("#pe-resource-list");
const dialog = one<HTMLDialogElement>("#pe-resource-dialog");
const form = one<HTMLFormElement>("#pe-resource-form");
const toast = one<HTMLElement>("#pe-toast");
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function notify(text: string): void { if (!toast) return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2400); }
function renderResources(): void { if (!list) return; list.innerHTML = resources.map((resource, index) => `<article class="pe-resource" data-type="${resource.type}"><span class="pe-resource-icon">${icons[resource.type]}</span><div><h4>${escape(resource.title)}</h4><p>${escape(resource.detail)}</p></div><div class="pe-resource-actions"><button type="button" data-move="up" data-id="${resource.id}" aria-label="Move up"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-move="down" data-id="${resource.id}" aria-label="Move down"${index === resources.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-remove data-id="${resource.id}" aria-label="Remove">×</button></div></article>`).join(""); }
function renderCards(): void { const target = one<HTMLElement>("#pe-assigned-cards"); if (!target) return; target.innerHTML = assignedCards.map((name, index) => `<div class="pe-card-chip"><i>◉</i><div><strong>${escape(name)}</strong><span>N3-${String(index + 1).padStart(3, "0")}</span></div></div>`).join(""); }
function markChanged(): void { const state = one<HTMLElement>("#pe-save-state"); if (state) state.textContent = "Preview changes saved locally · Database comes next"; }

async function authorize(): Promise<void> { if (!hasConfig()) throw new Error("The N3XRA data connection is not configured."); const supabase = createBrowserSupabase(); const session = await getSessionOrNull(supabase); if (!session?.user) { window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; } const { data, error } = await supabase.rpc("is_platform_admin"); if (error || data !== true) { window.location.replace("/client-portal/"); return; } renderResources(); renderCards(); one<HTMLElement>("#pe-status")!.hidden = true; one<HTMLElement>("#pe-app")!.hidden = false; document.body.classList.remove("portal-loading"); }

one("#pe-add-resource")?.addEventListener("click", () => dialog?.showModal());
one("#pe-resource-close")?.addEventListener("click", () => dialog?.close()); one("#pe-resource-cancel")?.addEventListener("click", () => dialog?.close());
form?.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(form); const title = String(values.get("title") || "").trim(); const type = String(values.get("type") || "file") as ResourceType; if (!title || !(type in icons)) return; resources.push({ id: Date.now(), type, title, detail: String(values.get("detail") || "").trim() || "Ready to configure" }); form.reset(); dialog?.close(); renderResources(); markChanged(); notify(`${title} added.`); });
list?.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]"); if (!button) return; const id = Number(button.dataset.id); const index = resources.findIndex((resource) => resource.id === id); if (index < 0) return; if (button.hasAttribute("data-remove")) resources.splice(index, 1); else { const next = button.dataset.move === "up" ? index - 1 : index + 1; if (next >= 0 && next < resources.length) [resources[index], resources[next]] = [resources[next]!, resources[index]!]; } renderResources(); markChanged(); });
document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".pe-settings input,.pe-settings select").forEach((field) => field.addEventListener("change", markChanged));
void authorize().catch((error: unknown) => { const status = one<HTMLElement>("#pe-status"); if (status) status.textContent = error instanceof Error ? error.message : "Unable to open the project editor."; document.body.classList.remove("portal-loading"); });
