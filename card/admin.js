import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const MEDIA_BUCKET = "contact-card-media";
const MEDIA_CONFIG = {
    profile: { column: "profile_image_path", stem: "profile" }, logo: { column: "company_logo_path", stem: "logo" }, background: { column: "background_image_path", stem: "background" },
};
const SECTION_DETAILS = {
    about: { label: "About", description: "Short biography" }, contact: { label: "Contact", description: "Email, phone, and website" }, links: { label: "Links", description: "Social, booking, portfolio, and custom links" },
};
const DEFAULT_SECTION_ORDER = ["about", "contact", "links"];
const supabase = hasConfig() ? createBrowserSupabase() : null;
const form = document.querySelector("#contact-card-admin-form");
const list = document.querySelector("#contact-card-list");
const count = document.querySelector("#contact-card-count");
const search = document.querySelector("#contact-card-search");
const newButton = document.querySelector("#contact-card-new");
const deleteButton = document.querySelector("#contact-card-delete");
const formStatus = document.querySelector("#contact-card-form-status");
const publicLink = document.querySelector("#contact-card-public-link");
const modal = document.querySelector("#contact-card-modal");
const modalClose = document.querySelector("#contact-card-modal-close");
const modalBackdrop = document.querySelector("#contact-card-modal-backdrop");
const linksContainer = document.querySelector("#admin-card-links");
const addLinkButton = document.querySelector("#admin-card-add-link");
const sectionOrderContainer = document.querySelector("#admin-card-section-order");
const mediaStatus = document.querySelector("#admin-card-media-status");
let cards = [];
let accounts = [];
let selectedId = "";
let adminUserId = "";
let sectionOrder = [...DEFAULT_SECTION_ORDER];
let modalReturnFocus = null;
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function slugify(value) { return String(value || "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); }
function normalizePhone(value) { let digits = String(value || "").replace(/\D/g, ""); if (!digits)
    return null; if (digits.length === 10)
    digits = `1${digits}`; if (!/^[1-9][0-9]{7,14}$/.test(digits))
    throw new Error("Enter a valid phone number."); return `+${digits}`; }
function normalizeUrl(value) { const raw = String(value || "").trim(); if (!raw)
    return null; return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); }
function owner(card) { return accounts.find((account) => account.id === card.owner_user_id); }
function field(name) { return form?.elements.namedItem(name); }
function setFormStatus(message = "", tone = "") { if (formStatus) {
    formStatus.textContent = message;
    formStatus.className = tone ? `is-${tone}` : "";
} }
function setMediaStatus(message = "", isError = false) { if (mediaStatus) {
    mediaStatus.textContent = message;
    mediaStatus.style.color = isError ? "#a33041" : "";
} }
function validSectionOrder(value) {
    if (!Array.isArray(value))
        return [...DEFAULT_SECTION_ORDER];
    const keys = value.filter((item) => typeof item === "string" && item in SECTION_DETAILS);
    return keys.length === 3 && new Set(keys).size === 3 ? keys : [...DEFAULT_SECTION_ORDER];
}
function renderSectionOrder() {
    if (!sectionOrderContainer)
        return;
    sectionOrderContainer.replaceChildren();
    sectionOrder.forEach((key, index) => {
        const row = document.createElement("div");
        row.className = "card-editor-order-row";
        const number = document.createElement("span");
        number.className = "card-editor-order-number";
        number.textContent = String(index + 1).padStart(2, "0");
        const copy = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = SECTION_DETAILS[key].label;
        const small = document.createElement("small");
        small.textContent = SECTION_DETAILS[key].description;
        copy.append(strong, small);
        const actions = document.createElement("span");
        actions.className = "card-editor-order-actions";
        for (const [label, direction] of [["↑", -1], ["↓", 1]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.disabled = direction < 0 ? index === 0 : index === sectionOrder.length - 1;
            button.setAttribute("aria-label", `Move ${SECTION_DETAILS[key].label} ${direction < 0 ? "up" : "down"}`);
            button.addEventListener("click", () => { const nextIndex = index + direction; const next = [...sectionOrder]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; sectionOrder = next; renderSectionOrder(); });
            actions.append(button);
        }
        row.append(number, copy, actions);
        sectionOrderContainer.append(row);
    });
}
function addLinkRow(link = { label: "", url: "" }) {
    if (!linksContainer || linksContainer.children.length >= 12)
        return;
    const row = document.createElement("div");
    row.className = "card-editor-link-row";
    const label = document.createElement("input");
    label.placeholder = "Label, e.g. LinkedIn";
    label.maxLength = 80;
    label.value = link.label;
    label.dataset.cardLinkLabel = "true";
    const url = document.createElement("input");
    url.type = "url";
    url.placeholder = "https://";
    url.maxLength = 500;
    url.value = link.url;
    url.dataset.cardLinkUrl = "true";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove link");
    remove.addEventListener("click", () => row.remove());
    row.append(label, url, remove);
    linksContainer.append(row);
}
function collectLinks() {
    if (!linksContainer)
        return [];
    return Array.from(linksContainer.querySelectorAll(".card-editor-link-row")).flatMap((row) => { const label = row.querySelector("[data-card-link-label]")?.value.trim() || ""; const rawUrl = row.querySelector("[data-card-link-url]")?.value.trim() || ""; if (!label && !rawUrl)
        return []; if (!label || !rawUrl)
        throw new Error("Each link needs both a label and an address."); const url = normalizeUrl(rawUrl); return url ? [{ label, url }] : []; });
}
function mediaPath(card, type) { return String(card[MEDIA_CONFIG[type].column] || ""); }
function setMediaPreview(type, url = "") {
    const preview = document.querySelector(`#admin-card-media-${type}-preview`);
    const remove = document.querySelector(`[data-admin-remove-media="${type}"]`);
    if (!preview)
        return;
    preview.replaceChildren();
    const child = url ? document.createElement("img") : document.createElement("span");
    if (child instanceof HTMLImageElement) {
        child.src = url;
        child.alt = `Current ${type} image`;
    }
    else
        child.textContent = type === "profile" ? "Photo" : type === "logo" ? "Logo" : "Background";
    preview.append(child);
    if (remove)
        remove.disabled = !url;
}
async function loadMediaPreviews(card) {
    if (!supabase)
        return;
    await Promise.all(Object.keys(MEDIA_CONFIG).map(async (type) => { const path = card ? mediaPath(card, type) : ""; if (!path)
        return setMediaPreview(type); const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600); setMediaPreview(type, error ? "" : `${data?.signedUrl || ""}${data?.signedUrl ? `&v=${Date.now()}` : ""}`); }));
}
function mediaExtension(file) { if (file.type === "image/jpeg")
    return "jpg"; if (file.type === "image/png")
    return "png"; if (file.type === "image/webp")
    return "webp"; throw new Error("Choose a JPEG, PNG, or WebP image."); }
async function uploadMedia(type, file) {
    if (!supabase || !selectedId)
        throw new Error("Save the Contact Card before adding images.");
    const card = cards.find((item) => item.id === selectedId);
    if (!card)
        throw new Error("Select a Contact Card first.");
    if (file.size > 5_242_880)
        throw new Error("Choose an image smaller than 5 MB.");
    const config = MEDIA_CONFIG[type];
    const oldPath = mediaPath(card, type);
    const path = `${card.owner_user_id}/${card.id}/${config.stem}.${mediaExtension(file)}`;
    setMediaStatus("Uploading image…");
    const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError)
        throw uploadError;
    const { data, error } = await supabase.from("contact_card_profiles").update({ [config.column]: path, updated_by_user_id: adminUserId }).eq("id", card.id).select("*").single();
    if (error) {
        if (path !== oldPath)
            await supabase.storage.from(MEDIA_BUCKET).remove([path]);
        throw error;
    }
    if (oldPath && oldPath !== path)
        await supabase.storage.from(MEDIA_BUCKET).remove([oldPath]);
    cards = cards.map((item) => item.id === data.id ? data : item);
    await loadMediaPreviews(data);
    setMediaStatus("Image updated.");
}
async function removeMedia(type) {
    if (!supabase || !selectedId)
        return;
    const card = cards.find((item) => item.id === selectedId);
    if (!card)
        return;
    const config = MEDIA_CONFIG[type];
    const oldPath = mediaPath(card, type);
    if (!oldPath)
        return;
    setMediaStatus("Removing image…");
    const { data, error } = await supabase.from("contact_card_profiles").update({ [config.column]: null, updated_by_user_id: adminUserId }).eq("id", card.id).select("*").single();
    if (error)
        throw error;
    cards = cards.map((item) => item.id === data.id ? data : item);
    await supabase.storage.from(MEDIA_BUCKET).remove([oldPath]);
    setMediaPreview(type);
    setMediaStatus("Image removed.");
}
function saveErrorMessage(error) {
    const details = error && typeof error === "object" ? error : {};
    const message = error instanceof Error ? error.message : String(details.message || details.details || details.hint || "");
    if (details.code === "23505")
        return "That account already has a card, or that public address is taken.";
    if (details.code === "42501")
        return "Your administrator session does not have permission to save this Contact Card. Sign in again and try once more.";
    return message || "The Contact Card could not be saved. Review the information and try again.";
}
function openModal(preferredFocus) {
    if (!modal || !form)
        return;
    if (modal.hidden)
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.hidden = false;
    form.hidden = false;
    document.body.classList.add("contact-card-modal-open");
    window.requestAnimationFrame(() => preferredFocus?.focus());
}
function closeModal() {
    if (!modal || !form)
        return;
    modal.hidden = true;
    form.hidden = true;
    document.body.classList.remove("contact-card-modal-open");
    modalReturnFocus?.focus();
    modalReturnFocus = null;
}
async function invoke(action) {
    if (!supabase)
        throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action } });
    if (error || data?.error)
        throw new Error(data?.error || error?.message || "Admin request failed.");
    return data || {};
}
function renderList() {
    if (!list)
        return;
    const query = search?.value.trim().toLowerCase() || "";
    const visible = cards.filter((card) => { const account = owner(card); return !query || [card.display_name, card.slug, card.email, account?.email, account?.name].some((value) => String(value || "").toLowerCase().includes(query)); });
    list.innerHTML = visible.length ? visible.map((card) => `<button type="button" data-card-id="${escapeHtml(card.id)}" class="${card.id === selectedId ? "is-selected" : ""}"><strong>${escapeHtml(card.display_name)}</strong><small>/${escapeHtml(card.slug)} · ${escapeHtml(owner(card)?.email || "Account")}</small><i>${escapeHtml(card.physical_card_status === "requested" ? "Card requested" : card.status)}</i></button>`).join("") : '<p class="contact-card-list-empty">No Contact Cards match this view.</p>';
    if (count)
        count.textContent = String(cards.length);
}
function renderOwnerOptions(selected = "", locked = false) {
    const select = field("owner_user_id");
    select.innerHTML = '<option value="">Choose an account…</option>' + accounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selected ? " selected" : ""}>${escapeHtml(account.name || account.email)} · ${escapeHtml(account.email)}</option>`).join("");
    select.disabled = locked;
}
function showCard(card) {
    if (!form)
        return;
    form.classList.remove("hidden");
    selectedId = String(card?.id || "");
    form.reset();
    field("id").value = selectedId;
    renderOwnerOptions(String(card?.owner_user_id || ""), Boolean(card));
    for (const name of ["slug", "status", "physical_card_status", "display_name", "headline", "company_name", "bio", "email", "phone_e164", "website_url", "location_text", "accent_color", "shipping_name", "shipping_address_line_1", "shipping_address_line_2", "shipping_city", "shipping_region", "shipping_postal_code", "shipping_country"])
        field(name).value = String(card?.[name] ?? (name === "shipping_country" ? "United States" : name === "status" ? "published" : name === "physical_card_status" ? "not_requested" : name === "accent_color" ? "#2f7d68" : ""));
    const branding = field("show_n3xra_branding");
    branding.checked = card?.show_n3xra_branding !== false;
    sectionOrder = validSectionOrder(card?.section_order);
    renderSectionOrder();
    linksContainer?.replaceChildren();
    for (const link of (card?.links || []))
        addLinkRow(link);
    if (!card?.links?.length)
        addLinkRow();
    void loadMediaPreviews(card);
    setMediaStatus();
    const title = document.querySelector("#contact-card-form-title");
    const kicker = document.querySelector("#contact-card-form-kicker");
    const summary = document.querySelector("#contact-card-form-summary");
    if (title)
        title.textContent = card?.display_name || "Add Contact Card";
    if (kicker)
        kicker.textContent = card ? "Existing card" : "Manual setup";
    if (summary)
        summary.textContent = card ? `${owner(card)?.email || "N3XRA account"} · n3xra.com/card/${card.slug}` : "Choose an existing account and reserve an available public address.";
    if (deleteButton)
        deleteButton.hidden = !card;
    if (publicLink) {
        publicLink.hidden = !card?.slug;
        publicLink.href = card?.slug ? `/card/${encodeURIComponent(card.slug)}` : "#";
    }
    setFormStatus();
    renderList();
    openModal(card ? field("slug") : field("owner_user_id"));
}
async function loadData(selectId = selectedId) {
    if (!supabase)
        throw new Error("Supabase is not configured.");
    const [accountResponse, cardResponse] = await Promise.all([invoke("list-platform-accounts"), supabase.from("contact_card_profiles").select("*").order("created_at", { ascending: false })]);
    if (cardResponse.error)
        throw cardResponse.error;
    accounts = Array.isArray(accountResponse.accounts) ? accountResponse.accounts : [];
    cards = cardResponse.data || [];
    renderList();
    const selected = cards.find((item) => item.id === selectId);
    if (selected)
        showCard(selected);
}
function payload() {
    const slug = slugify(field("slug").value);
    if (slug.length < 2)
        throw new Error("Use at least two letters or numbers for the card address.");
    field("slug").value = slug;
    const ownerUserId = field("owner_user_id").value;
    if (!ownerUserId)
        throw new Error("Choose the account owner.");
    const displayName = field("display_name").value.trim();
    if (!displayName)
        throw new Error("Enter the name shown on the card.");
    return { owner_user_id: ownerUserId, slug, status: field("status").value, physical_card_status: field("physical_card_status").value, display_name: displayName, headline: field("headline").value.trim(), company_name: field("company_name").value.trim(), bio: field("bio").value.trim(), email: field("email").value.trim().toLowerCase() || null, phone_e164: normalizePhone(field("phone_e164").value), website_url: normalizeUrl(field("website_url").value), location_text: field("location_text").value.trim(), links: collectLinks(), section_order: sectionOrder, accent_color: field("accent_color").value || "#2f7d68", show_n3xra_branding: field("show_n3xra_branding").checked, shipping_name: field("shipping_name").value.trim(), shipping_address_line_1: field("shipping_address_line_1").value.trim(), shipping_address_line_2: field("shipping_address_line_2").value.trim(), shipping_city: field("shipping_city").value.trim(), shipping_region: field("shipping_region").value.trim(), shipping_postal_code: field("shipping_postal_code").value.trim(), shipping_country: field("shipping_country").value.trim() || "United States" };
}
form?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { if (!supabase || !form)
    return; const button = form.querySelector('button[type="submit"]'); if (button)
    button.disabled = true; setFormStatus("Saving Contact Card…"); try {
    const values = payload();
    let result;
    if (selectedId)
        result = await supabase.from("contact_card_profiles").update({ ...values, updated_by_user_id: adminUserId }).eq("id", selectedId).select("*").single();
    else
        result = await supabase.from("contact_card_profiles").insert({ ...values, created_by_user_id: adminUserId, updated_by_user_id: adminUserId }).select("*").single();
    if (result.error)
        throw result.error;
    selectedId = result.data.id;
    await loadData(selectedId);
    closeModal();
}
catch (error) {
    setFormStatus(saveErrorMessage(error), "error");
}
finally {
    if (button)
        button.disabled = false;
} })(); });
deleteButton?.addEventListener("click", () => { void (async () => { if (!supabase || !selectedId)
    return; const selected = cards.find((item) => item.id === selectedId); if (!selected || !window.confirm(`Delete the Contact Card for ${selected.display_name}? This cannot be undone.`))
    return; setFormStatus("Deleting Contact Card…"); const mediaPaths = [selected.profile_image_path, selected.company_logo_path, selected.background_image_path].filter(Boolean); if (mediaPaths.length)
    await supabase.storage.from("contact-card-media").remove(mediaPaths); const { error } = await supabase.from("contact_card_profiles").delete().eq("id", selectedId); if (error)
    return setFormStatus(error.message, "error"); selectedId = ""; closeModal(); await loadData(); })(); });
newButton?.addEventListener("click", () => showCard(null));
search?.addEventListener("input", renderList);
list?.addEventListener("click", (event) => { const id = event.target.closest("[data-card-id]")?.dataset.cardId; const selected = cards.find((item) => item.id === id); if (selected)
    showCard(selected); });
addLinkButton?.addEventListener("click", () => addLinkRow());
document.querySelectorAll("[data-admin-media-input]").forEach((control) => control.addEventListener("change", () => { const file = control.files?.[0]; const type = control.dataset.adminMediaInput; if (!file || !(type in MEDIA_CONFIG))
    return; void uploadMedia(type, file).catch((error) => setMediaStatus(error instanceof Error ? error.message : "The image could not be uploaded.", true)).finally(() => { control.value = ""; }); }));
document.querySelectorAll("[data-admin-remove-media]").forEach((button) => button.addEventListener("click", () => { const type = button.dataset.adminRemoveMedia; if (!(type in MEDIA_CONFIG))
    return; button.disabled = true; void removeMedia(type).catch((error) => setMediaStatus(error instanceof Error ? error.message : "The image could not be removed.", true)).finally(() => { const card = cards.find((item) => item.id === selectedId); button.disabled = !card || !mediaPath(card, type); }); }));
modalClose?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal && !modal.hidden)
    closeModal(); });
void (async () => { if (!supabase)
    throw new Error("Supabase is not configured."); const session = await getSessionOrNull(supabase); if (!session?.user) {
    window.location.replace("/account/?next=/n3xra-admin/contact-cards/");
    return;
} adminUserId = session.user.id; const requestedCard = new URLSearchParams(window.location.search).get("card") || ""; await loadData(requestedCard); document.body.classList.remove("portal-loading"); const screen = document.querySelector("#portal-status"); if (screen)
    screen.hidden = true; })().catch((error) => { const screen = document.querySelector("#portal-status"); if (screen)
    screen.textContent = error instanceof Error ? error.message : "Contact Cards could not be opened."; });
