import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const icons = { pdf: "PDF", radio: "⌁", image: "⌖", file: "DOC", link: "↗" };
let resources = [
    { id: 1, type: "pdf", title: "Daily Fire Weather Briefing", detail: "NOAA Medford · Updated today at 6:15 AM" },
    { id: 2, type: "radio", title: "Radio Channels", detail: "Command, tactical, air-to-ground, and travel" },
    { id: 3, type: "image", title: "Division Map", detail: "Operational map · Revision 3" },
    { id: 4, type: "file", title: "Incident Action Plan", detail: "PDF · 4.8 MB" },
    { id: 5, type: "link", title: "Check-in & Safety Form", detail: "Opens a secure N3XRA form" },
];
const assignedCards = ["Alex Morgan", "Jordan Lee", "Casey Rivera", "Taylor Brooks", "Morgan Hayes", "Riley Carter", "Cameron Reed"];
const one = (selector) => document.querySelector(selector);
const list = one("#pe-resource-list");
const dialog = one("#pe-resource-dialog");
const form = one("#pe-resource-form");
const toast = one("#pe-toast");
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
function notify(text) { if (!toast)
    return; toast.textContent = `✓ ${text}`; toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 2400); }
function renderResources() { if (!list)
    return; list.innerHTML = resources.map((resource, index) => `<article class="pe-resource" data-type="${resource.type}"><span class="pe-resource-icon">${icons[resource.type]}</span><div><h4>${escape(resource.title)}</h4><p>${escape(resource.detail)}</p></div><div class="pe-resource-actions"><button type="button" data-move="up" data-id="${resource.id}" aria-label="Move up"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-move="down" data-id="${resource.id}" aria-label="Move down"${index === resources.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-remove data-id="${resource.id}" aria-label="Remove">×</button></div></article>`).join(""); }
function renderCards() { const target = one("#pe-assigned-cards"); if (!target)
    return; target.innerHTML = assignedCards.map((name, index) => `<div class="pe-card-chip"><i>◉</i><div><strong>${escape(name)}</strong><span>N3-${String(index + 1).padStart(3, "0")}</span></div></div>`).join(""); }
function markChanged() { const state = one("#pe-save-state"); if (state)
    state.textContent = "Preview changes saved locally · Database comes next"; }
async function authorize() { if (!hasConfig())
    throw new Error("The N3XRA data connection is not configured."); const supabase = createBrowserSupabase(); const session = await getSessionOrNull(supabase); if (!session?.user) {
    window.location.replace(`/client-portal/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return;
} const { data, error } = await supabase.rpc("is_platform_admin"); if (error || data !== true) {
    window.location.replace("/client-portal/");
    return;
} renderResources(); renderCards(); one("#pe-status").hidden = true; one("#pe-app").hidden = false; document.body.classList.remove("portal-loading"); }
one("#pe-add-resource")?.addEventListener("click", () => dialog?.showModal());
one("#pe-resource-close")?.addEventListener("click", () => dialog?.close());
one("#pe-resource-cancel")?.addEventListener("click", () => dialog?.close());
form?.addEventListener("submit", (event) => { event.preventDefault(); const values = new FormData(form); const title = String(values.get("title") || "").trim(); const type = String(values.get("type") || "file"); if (!title || !(type in icons))
    return; resources.push({ id: Date.now(), type, title, detail: String(values.get("detail") || "").trim() || "Ready to configure" }); form.reset(); dialog?.close(); renderResources(); markChanged(); notify(`${title} added.`); });
list?.addEventListener("click", (event) => { const button = event.target.closest("button[data-id]"); if (!button)
    return; const id = Number(button.dataset.id); const index = resources.findIndex((resource) => resource.id === id); if (index < 0)
    return; if (button.hasAttribute("data-remove"))
    resources.splice(index, 1);
else {
    const next = button.dataset.move === "up" ? index - 1 : index + 1;
    if (next >= 0 && next < resources.length)
        [resources[index], resources[next]] = [resources[next], resources[index]];
} renderResources(); markChanged(); });
document.querySelectorAll(".pe-settings input,.pe-settings select").forEach((field) => field.addEventListener("change", markChanged));
void authorize().catch((error) => { const status = one("#pe-status"); if (status)
    status.textContent = error instanceof Error ? error.message : "Unable to open the project editor."; document.body.classList.remove("portal-loading"); });
