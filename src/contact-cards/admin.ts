import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

type Row = Record<string, any>;
const supabase = hasConfig() ? createBrowserSupabase() : null;
const form = document.querySelector<HTMLFormElement>("#contact-card-admin-form");
const empty = document.querySelector<HTMLElement>("#contact-card-empty");
const list = document.querySelector<HTMLElement>("#contact-card-list");
const count = document.querySelector<HTMLElement>("#contact-card-count");
const search = document.querySelector<HTMLInputElement>("#contact-card-search");
const newButton = document.querySelector<HTMLButtonElement>("#contact-card-new");
const deleteButton = document.querySelector<HTMLButtonElement>("#contact-card-delete");
const formStatus = document.querySelector<HTMLElement>("#contact-card-form-status");
const publicLink = document.querySelector<HTMLAnchorElement>("#contact-card-public-link");
let cards: Row[] = [];
let accounts: Row[] = [];
let selectedId = "";

function escapeHtml(value: unknown): string { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function slugify(value: unknown): string { return String(value || "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); }
function normalizePhone(value: unknown): string | null { let digits = String(value || "").replace(/\D/g, ""); if (!digits) return null; if (digits.length === 10) digits = `1${digits}`; if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw new Error("Enter a valid phone number."); return `+${digits}`; }
function normalizeUrl(value: unknown): string | null { const raw = String(value || "").trim(); if (!raw) return null; return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); }
function owner(card: Row): Row | undefined { return accounts.find((account) => account.id === card.owner_user_id); }
function field(name: string): HTMLInputElement | HTMLSelectElement { return form?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement; }
function setFormStatus(message = "", tone = ""): void { if (formStatus) { formStatus.textContent = message; formStatus.className = tone ? `is-${tone}` : ""; } }

async function invoke(action: string): Promise<Row> {
  if (!supabase) throw new Error("Supabase is not configured."); const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action } }); if (error || data?.error) throw new Error(data?.error || error?.message || "Admin request failed."); return data || {};
}

function renderList(): void {
  if (!list) return; const query = search?.value.trim().toLowerCase() || ""; const visible = cards.filter((card) => { const account = owner(card); return !query || [card.display_name, card.slug, card.email, account?.email, account?.name].some((value) => String(value || "").toLowerCase().includes(query)); });
  list.innerHTML = visible.length ? visible.map((card) => `<button type="button" data-card-id="${escapeHtml(card.id)}" class="${card.id === selectedId ? "is-selected" : ""}"><strong>${escapeHtml(card.display_name)}</strong><small>/${escapeHtml(card.slug)} · ${escapeHtml(owner(card)?.email || "Account")}</small><i>${escapeHtml(card.physical_card_status === "requested" ? "Card requested" : card.status)}</i></button>`).join("") : '<p class="contact-card-list-empty">No Contact Cards match this view.</p>';
  if (count) count.textContent = String(cards.length);
}

function renderOwnerOptions(selected = "", locked = false): void {
  const select = field("owner_user_id") as HTMLSelectElement; select.innerHTML = '<option value="">Choose an account…</option>' + accounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selected ? " selected" : ""}>${escapeHtml(account.name || account.email)} · ${escapeHtml(account.email)}</option>`).join(""); select.disabled = locked;
}

function showCard(card: Row | null): void {
  if (!form || !empty) return; empty.hidden = true; form.classList.remove("hidden"); form.hidden = false; selectedId = String(card?.id || ""); form.reset(); field("id").value = selectedId; renderOwnerOptions(String(card?.owner_user_id || ""), Boolean(card));
  for (const name of ["slug", "status", "physical_card_status", "display_name", "headline", "company_name", "email", "phone_e164", "website_url", "shipping_name", "shipping_address_line_1", "shipping_address_line_2", "shipping_city", "shipping_region", "shipping_postal_code", "shipping_country"]) field(name).value = String(card?.[name] ?? (name === "shipping_country" ? "United States" : name === "status" ? "draft" : name === "physical_card_status" ? "not_requested" : ""));
  const title = document.querySelector<HTMLElement>("#contact-card-form-title"); const kicker = document.querySelector<HTMLElement>("#contact-card-form-kicker"); const summary = document.querySelector<HTMLElement>("#contact-card-form-summary");
  if (title) title.textContent = card?.display_name || "Add Contact Card"; if (kicker) kicker.textContent = card ? "Existing card" : "Manual setup"; if (summary) summary.textContent = card ? `${owner(card)?.email || "N3XRA account"} · n3xra.com/card/${card.slug}` : "Choose an existing account and reserve an available public address.";
  if (deleteButton) deleteButton.hidden = !card; if (publicLink) { publicLink.hidden = !card?.slug; publicLink.href = card?.slug ? `/card/${encodeURIComponent(card.slug)}` : "#"; } setFormStatus(); renderList();
}

async function loadData(selectId = selectedId): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured."); const [accountResponse, cardResponse] = await Promise.all([invoke("list-platform-accounts"), supabase.from("contact_card_profiles").select("*").order("created_at", { ascending: false })]); if (cardResponse.error) throw cardResponse.error; accounts = Array.isArray(accountResponse.accounts) ? accountResponse.accounts : []; cards = cardResponse.data || []; renderList(); const selected = cards.find((item) => item.id === selectId); if (selected) showCard(selected);
}

function payload(): Row {
  const slug = slugify(field("slug").value); if (slug.length < 2) throw new Error("Use at least two letters or numbers for the card address."); field("slug").value = slug; const ownerUserId = field("owner_user_id").value; if (!ownerUserId) throw new Error("Choose the account owner."); const displayName = field("display_name").value.trim(); if (!displayName) throw new Error("Enter the name shown on the card.");
  return { owner_user_id: ownerUserId, slug, status: field("status").value, physical_card_status: field("physical_card_status").value, display_name: displayName, headline: field("headline").value.trim(), company_name: field("company_name").value.trim(), email: field("email").value.trim().toLowerCase() || null, phone_e164: normalizePhone(field("phone_e164").value), website_url: normalizeUrl(field("website_url").value), shipping_name: field("shipping_name").value.trim(), shipping_address_line_1: field("shipping_address_line_1").value.trim(), shipping_address_line_2: field("shipping_address_line_2").value.trim(), shipping_city: field("shipping_city").value.trim(), shipping_region: field("shipping_region").value.trim(), shipping_postal_code: field("shipping_postal_code").value.trim(), shipping_country: field("shipping_country").value.trim() || "United States" };
}

form?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { if (!supabase || !form) return; const button = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (button) button.disabled = true; setFormStatus("Saving Contact Card…"); try { const values = payload(); const session = await getSessionOrNull(supabase); let result; if (selectedId) result = await supabase.from("contact_card_profiles").update({ ...values, updated_by_user_id: session?.user?.id || null }).eq("id", selectedId).select("*").single(); else result = await supabase.from("contact_card_profiles").insert({ ...values, created_by_user_id: session?.user?.id || null, updated_by_user_id: session?.user?.id || null }).select("*").single(); if (result.error) throw result.error; selectedId = result.data.id; await loadData(selectedId); setFormStatus("Contact Card saved.", "success"); } catch (error) { const message = error instanceof Error ? error.message : "The Contact Card could not be saved."; setFormStatus(message.includes("duplicate") ? "That account already has a card, or that public address is taken." : message, "error"); } finally { if (button) button.disabled = false; } })(); });

deleteButton?.addEventListener("click", () => { void (async () => { if (!supabase || !selectedId) return; const selected = cards.find((item) => item.id === selectedId); if (!selected || !window.confirm(`Delete the Contact Card for ${selected.display_name}? This cannot be undone.`)) return; setFormStatus("Deleting Contact Card…"); const mediaPaths = [selected.profile_image_path, selected.company_logo_path, selected.background_image_path].filter(Boolean); if (mediaPaths.length) await supabase.storage.from("contact-card-media").remove(mediaPaths); const { error } = await supabase.from("contact_card_profiles").delete().eq("id", selectedId); if (error) return setFormStatus(error.message, "error"); selectedId = ""; if (form) form.hidden = true; if (empty) empty.hidden = false; await loadData(); })(); });
newButton?.addEventListener("click", () => showCard(null)); search?.addEventListener("input", renderList); list?.addEventListener("click", (event) => { const id = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-card-id]")?.dataset.cardId; const selected = cards.find((item) => item.id === id); if (selected) showCard(selected); });

void (async () => { if (!supabase) throw new Error("Supabase is not configured."); const session = await getSessionOrNull(supabase); if (!session?.user) { window.location.replace("/account/?next=/n3xra-admin/contact-cards/"); return; } await loadData(); document.body.classList.remove("portal-loading"); const screen = document.querySelector<HTMLElement>("#portal-status"); if (screen) screen.hidden = true; })().catch((error: unknown) => { const screen = document.querySelector<HTMLElement>("#portal-status"); if (screen) screen.textContent = error instanceof Error ? error.message : "Contact Cards could not be opened."; });
