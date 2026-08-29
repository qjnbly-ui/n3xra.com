import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const MEDIA_BUCKET = "contact-card-media";
const MAX_SCAN_BYTES = 3_350_000;
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
const additionalEmailContainer = document.querySelector("#admin-card-additional-emails");
const additionalPhoneContainer = document.querySelector("#admin-card-additional-phones");
const scanInput = document.querySelector("#admin-card-scan-input");
const scanButton = document.querySelector("#admin-card-scan-analyze");
const scanStatus = document.querySelector("#admin-card-scan-status");
const scanPreview = document.querySelector("#admin-card-scan-preview");
const scanReview = document.querySelector("#admin-card-scan-review");
const scanReviewFields = document.querySelector("#admin-card-scan-review-fields");
const scanApplySelected = document.querySelector("#admin-card-scan-apply-selected");
const scanApplyAll = document.querySelector("#admin-card-scan-apply-all");
const accessControls = document.querySelector("#contact-card-access-controls");
const accessState = document.querySelector("#contact-card-access-state");
const accessFacts = document.querySelector("#contact-card-access-facts");
const accessTerm = document.querySelector("#contact-card-access-term");
const accessEndLabel = document.querySelector("#contact-card-access-end-label");
const accessEnd = document.querySelector("#contact-card-access-end");
const accessSource = document.querySelector("#contact-card-access-source");
const accessNote = document.querySelector("#contact-card-access-note");
const accessGrant = document.querySelector("#contact-card-access-grant");
const accessPause = document.querySelector("#contact-card-access-pause");
const accessRevoke = document.querySelector("#contact-card-access-revoke");
const accessStatus = document.querySelector("#contact-card-access-status");
const accessHistory = document.querySelector("#contact-card-access-history");
const brandingHelp = document.querySelector("#contact-card-admin-branding-help");
let cards = [];
let accounts = [];
let selectedId = "";
let adminUserId = "";
let sectionOrder = [...DEFAULT_SECTION_ORDER];
let modalReturnFocus = null;
let accessToken = "";
let pendingScanDataUrl = "";
let pendingScanDetails = null;
let changesPending = false;
let changeVersion = 0;
let saveTimer = 0;
let savePromise = null;
let accessData = { grants: [], events: [], billing: null };
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function slugify(value) { return String(value || "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); }
function normalizePhone(value) { let digits = String(value || "").replace(/\D/g, ""); if (!digits)
    return null; if (digits.length === 10)
    digits = `1${digits}`; if (!/^[1-9][0-9]{7,14}$/.test(digits))
    throw new Error("Enter a valid phone number."); return `+${digits}`; }
function normalizeUrl(value) { const raw = String(value || "").trim(); if (!raw)
    return null; return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); }
function normalizeEmail(value) { const email = String(value || "").trim().toLowerCase(); if (!email)
    return null; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address."); return email; }
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
function setScanStatus(message = "", tone = "") { if (scanStatus) {
    scanStatus.textContent = message;
    scanStatus.className = tone ? `is-${tone}` : "";
} }
function setAccessStatus(message = "", isError = false) { if (accessStatus) {
    accessStatus.textContent = message;
    accessStatus.className = isError ? "is-error" : "";
} }
function markChanged() { changesPending = true; changeVersion += 1; setFormStatus("Unsaved changes"); window.clearTimeout(saveTimer); if (selectedId)
    saveTimer = window.setTimeout(() => void saveCard(), 750); }
function formatDate(value) { if (!value)
    return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date); }
function accessIsCurrent(grant) { return Boolean(grant && grant.status === "active" && (grant.lifetime || new Date(String(grant.ends_at || "")).getTime() > Date.now())); }
function currentAccessGrant() { return (accessData.grants || []).find((grant) => accessIsCurrent(grant)) || (accessData.grants || []).find((grant) => grant.status === "paused") || null; }
function renderProductAccess() {
    if (!accessControls || !accessState || !accessFacts || !accessHistory)
        return;
    const billing = accessData.billing || {};
    const paid = billing.premium_active === true;
    const trialActive = Boolean(billing.premium_trial_ends_at && new Date(String(billing.premium_trial_ends_at)).getTime() > Date.now());
    const grant = currentAccessGrant();
    const grantActive = accessIsCurrent(grant);
    const grantExpired = Boolean(grant && grant.status === "active" && !grant.lifetime && !grantActive);
    const label = paid ? "Paid Premium" : trialActive ? "Free trial" : grantActive ? "Complimentary Premium" : grant?.status === "paused" ? "Access paused" : grantExpired ? "Access expired" : "Basic access";
    accessState.textContent = label;
    accessState.className = `product-access-state${paid ? " is-paid" : grantActive || trialActive ? " is-active" : grant?.status === "paused" ? " is-paused" : grantExpired ? " is-expired" : ""}`;
    const term = paid ? formatDate(billing.premium_current_period_end) : trialActive ? formatDate(billing.premium_trial_ends_at) : grantActive ? grant?.lifetime ? "Lifetime" : formatDate(grant?.ends_at) : "—";
    const source = paid ? "Stripe" : trialActive ? "Self-service trial" : grant ? String(grant.source || "admin").replaceAll("_", " ") : "Administrator setup";
    const facts = [["Base card", billing.base_access ? "Active" : "Setup"], ["Premium tools", paid || trialActive || grantActive ? "Unlocked" : "Not active"], ["Access source", source], ["Ends", String(term || "—")]];
    accessFacts.replaceChildren();
    for (const [name, value] of facts) {
        const item = document.createElement("div");
        const span = document.createElement("span");
        span.textContent = name;
        const strong = document.createElement("strong");
        strong.textContent = String(value);
        item.append(span, strong);
        accessFacts.append(item);
    }
    if (accessGrant)
        accessGrant.textContent = grant ? "Extend or replace access" : "Grant Premium access";
    if (accessPause) {
        accessPause.hidden = !grant || grant.status === "revoked" || grantExpired;
        accessPause.textContent = grant?.status === "paused" ? "Restore access" : "Pause access";
    }
    if (accessRevoke)
        accessRevoke.hidden = !grant || grant.status === "revoked";
    const branding = field("show_n3xra_branding");
    branding.disabled = !paid;
    if (!paid)
        branding.checked = true;
    if (brandingHelp)
        brandingHelp.textContent = paid ? "Paid Premium unlocks branding removal. The client can still turn the N3XRA credit back on." : "Only paid Premium can remove branding. Trials and complimentary access keep it visible.";
    accessHistory.replaceChildren();
    const events = accessData.events || [];
    if (!events.length) {
        const empty = document.createElement("p");
        empty.textContent = "No administrator access changes yet.";
        accessHistory.append(empty);
    }
    for (const event of events) {
        const item = document.createElement("article");
        const strong = document.createElement("strong");
        strong.textContent = String(event.action || "updated").replaceAll("_", " ");
        const time = document.createElement("time");
        time.textContent = formatDate(event.created_at);
        const small = document.createElement("small");
        small.textContent = String(event.note || "No administrator note.");
        item.append(strong, time, small);
        accessHistory.append(item);
    }
}
async function loadProductAccess(card) {
    if (!accessControls)
        return;
    accessControls.hidden = false;
    setAccessStatus("Loading access…");
    try {
        accessData = await invoke("get-product-access", { userId: card.owner_user_id, productKey: "contact_cards" });
        renderProductAccess();
        setAccessStatus();
    }
    catch (error) {
        setAccessStatus(error instanceof Error ? error.message : "Access could not be loaded.", true);
    }
}
function accessExpiration() {
    const value = accessTerm?.value || "30";
    if (value === "lifetime")
        return { lifetime: true, endsAt: null };
    if (value === "custom") {
        const selected = String(accessEnd?.value || "");
        if (!selected)
            throw new Error("Choose the access end date.");
        return { lifetime: false, endsAt: new Date(`${selected}T23:59:59`).toISOString() };
    }
    const date = new Date();
    date.setDate(date.getDate() + Number(value));
    return { lifetime: false, endsAt: date.toISOString() };
}
async function grantProductAccess() {
    const card = cards.find((item) => item.id === selectedId);
    if (!card || !accessGrant)
        return;
    accessGrant.disabled = true;
    setAccessStatus("Granting access…");
    try {
        const term = accessExpiration();
        await invoke("grant-product-access", { userId: card.owner_user_id, productKey: "contact_cards", accessLevel: "premium", source: accessSource?.value || "admin", note: accessNote?.value || "", ...term });
        if (accessNote)
            accessNote.value = "";
        await loadProductAccess(card);
        setAccessStatus("Premium tools are available now. N3XRA branding remains visible.");
    }
    catch (error) {
        setAccessStatus(error instanceof Error ? error.message : "Access could not be granted.", true);
    }
    finally {
        accessGrant.disabled = false;
    }
}
async function updateProductAccessStatus(status) {
    const card = cards.find((item) => item.id === selectedId);
    const grant = currentAccessGrant();
    if (!card || !grant)
        return;
    setAccessStatus("Updating access…");
    try {
        await invoke("set-product-access-grant-status", { grantId: grant.id, status, note: accessNote?.value || "" });
        if (accessNote)
            accessNote.value = "";
        await loadProductAccess(card);
        setAccessStatus(status === "active" ? "Access restored." : status === "paused" ? "Access paused." : "Access revoked.");
    }
    catch (error) {
        setAccessStatus(error instanceof Error ? error.message : "Access could not be updated.", true);
    }
}
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
            button.addEventListener("click", () => { const nextIndex = index + direction; const next = [...sectionOrder]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; sectionOrder = next; renderSectionOrder(); markChanged(); });
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
    remove.addEventListener("click", () => { row.remove(); markChanged(); });
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
function addContactRow(type, value = "", contactLabel = "") {
    const container = type === "email" ? additionalEmailContainer : additionalPhoneContainer;
    if (!container || container.children.length >= 5)
        return;
    const row = document.createElement("div");
    row.className = "card-repeatable-row";
    const label = document.createElement("input");
    label.type = "text";
    label.maxLength = 60;
    label.placeholder = type === "email" ? "Work, personal…" : "Mobile, office…";
    label.value = contactLabel || (type === "email" ? "Email" : "Phone");
    label.dataset.contactLabel = type;
    label.setAttribute("aria-label", `${type === "email" ? "Email" : "Phone"} description`);
    const input = document.createElement("input");
    input.type = type === "email" ? "email" : "tel";
    input.maxLength = type === "email" ? 320 : 40;
    input.placeholder = type === "email" ? "Additional email address" : "Additional phone number";
    input.value = value;
    input.dataset.additionalContact = type;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove additional ${type}`);
    remove.addEventListener("click", () => { row.remove(); markChanged(); });
    row.append(label, input, remove);
    container.append(row);
}
function renderContacts(type, values, labels) { const container = type === "email" ? additionalEmailContainer : additionalPhoneContainer; container?.replaceChildren(); if (Array.isArray(values))
    for (const [index, value] of values.slice(0, 5).entries())
        if (String(value || "").trim())
            addContactRow(type, String(value), Array.isArray(labels) ? String(labels[index] || "") : ""); }
function collectContacts(type) { const container = type === "email" ? additionalEmailContainer : additionalPhoneContainer; if (!container)
    return []; const seen = new Set(); return Array.from(container.querySelectorAll(".card-repeatable-row")).flatMap((row) => { const input = row.querySelector("[data-additional-contact]"); const label = row.querySelector("[data-contact-label]")?.value.trim() || (type === "email" ? "Email" : "Phone"); const value = input ? (type === "email" ? normalizeEmail(input.value) : normalizePhone(input.value)) : null; if (!value || seen.has(value))
    return []; seen.add(value); return [{ value, label }]; }); }
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
function closeModalNow() {
    if (!modal || !form)
        return;
    modal.hidden = true;
    form.hidden = true;
    document.body.classList.remove("contact-card-modal-open");
    modalReturnFocus?.focus();
    modalReturnFocus = null;
}
async function requestClose() {
    window.clearTimeout(saveTimer);
    if (changesPending) {
        const saved = await saveCard();
        if (!saved)
            return;
    }
    else if (savePromise) {
        const saved = await savePromise;
        if (!saved)
            return;
    }
    closeModalNow();
}
async function invoke(action, details = {}) {
    if (!supabase)
        throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action, ...details } });
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
    changesPending = false;
    window.clearTimeout(saveTimer);
    form.classList.remove("hidden");
    selectedId = String(card?.id || "");
    form.reset();
    field("id").value = selectedId;
    renderOwnerOptions(String(card?.owner_user_id || ""), Boolean(card));
    for (const name of ["slug", "status", "physical_card_status", "display_name", "headline", "company_name", "bio", "email", "email_label", "phone_e164", "phone_label", "website_url", "location_text", "accent_color", "shipping_name", "shipping_address_line_1", "shipping_address_line_2", "shipping_city", "shipping_region", "shipping_postal_code", "shipping_country"])
        field(name).value = String(card?.[name] ?? (name === "email_label" ? "Email" : name === "phone_label" ? "Phone" : name === "shipping_country" ? "United States" : name === "status" ? "published" : name === "physical_card_status" ? "not_requested" : name === "accent_color" ? "#2f7d68" : ""));
    const branding = field("show_n3xra_branding");
    branding.checked = card?.show_n3xra_branding !== false;
    branding.disabled = !card;
    renderContacts("email", card?.additional_emails, card?.additional_email_labels);
    renderContacts("phone", card?.additional_phones, card?.additional_phone_labels);
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
    if (accessControls)
        accessControls.hidden = !card;
    if (card)
        void loadProductAccess(card);
    else {
        accessData = { grants: [], events: [], billing: null };
        setAccessStatus();
    }
    if (deleteButton)
        deleteButton.hidden = !card;
    if (publicLink) {
        publicLink.hidden = !card?.slug;
        publicLink.href = card?.slug ? `/card/${encodeURIComponent(card.slug)}` : "#";
    }
    setFormStatus(card ? "All changes saved" : "Complete the card details, then save.");
    setScanStatus();
    pendingScanDataUrl = "";
    if (scanButton)
        scanButton.disabled = true;
    if (scanPreview)
        scanPreview.innerHTML = "<span>Business card photo</span>";
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
    const primaryEmail = normalizeEmail(field("email").value);
    const primaryPhone = normalizePhone(field("phone_e164").value);
    const emailContacts = collectContacts("email").filter((item) => item.value !== primaryEmail);
    const phoneContacts = collectContacts("phone").filter((item) => item.value !== primaryPhone);
    return { owner_user_id: ownerUserId, slug, status: field("status").value, physical_card_status: field("physical_card_status").value, display_name: displayName, headline: field("headline").value.trim(), company_name: field("company_name").value.trim(), bio: field("bio").value.trim(), email: primaryEmail, email_label: field("email_label").value.trim() || "Email", phone_e164: primaryPhone, phone_label: field("phone_label").value.trim() || "Phone", additional_emails: emailContacts.map((item) => item.value), additional_email_labels: emailContacts.map((item) => item.label), additional_phones: phoneContacts.map((item) => item.value), additional_phone_labels: phoneContacts.map((item) => item.label), website_url: normalizeUrl(field("website_url").value), location_text: field("location_text").value.trim(), links: collectLinks(), section_order: sectionOrder, accent_color: field("accent_color").value || "#2f7d68", show_n3xra_branding: field("show_n3xra_branding").checked, shipping_name: field("shipping_name").value.trim(), shipping_address_line_1: field("shipping_address_line_1").value.trim(), shipping_address_line_2: field("shipping_address_line_2").value.trim(), shipping_city: field("shipping_city").value.trim(), shipping_region: field("shipping_region").value.trim(), shipping_postal_code: field("shipping_postal_code").value.trim(), shipping_country: field("shipping_country").value.trim() || "United States" };
}
function imageElement(file) { return new Promise((resolve, reject) => { const image = new Image(); const url = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The photo could not be opened.")); }; image.src = url; }); }
function canvasBlob(canvas, quality) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The photo could not be prepared.")), "image/jpeg", quality)); }
async function compressCard(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type))
        throw new Error("Choose a JPEG, PNG, or WebP image.");
    if (file.size > 16_000_000)
        throw new Error("Choose a business-card image smaller than 16 MB.");
    const image = await imageElement(file);
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.88, .78, .68, .58]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= MAX_SCAN_BYTES)
            return blob;
    }
    throw new Error("Crop closer to the business card and try again.");
}
function blobDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("The photo could not be read.")); reader.readAsDataURL(blob); }); }
async function prepareScan(file) { setScanStatus("Preparing photo…"); const blob = await compressCard(file); pendingScanDataUrl = await blobDataUrl(blob); if (scanPreview) {
    scanPreview.replaceChildren();
    const image = document.createElement("img");
    image.src = URL.createObjectURL(blob);
    image.alt = "Business card preview";
    scanPreview.append(image);
} if (scanButton)
    scanButton.disabled = false; setScanStatus("Photo ready. Scan it, then review the fields.", "success"); }
function scanValues(details) {
    const emails = Array.from(new Set([details.email, ...(details.emails || [])].filter((value) => Boolean(value))));
    const phones = Array.from(new Set([details.phoneE164, ...(details.phonesE164 || [])].filter((value) => Boolean(value))));
    return [{ key: "display_name", label: "Name", value: details.fullName || "" }, { key: "headline", label: "Job title", value: details.jobTitle || "" }, { key: "company_name", label: "Company", value: details.companyName || "" }, { key: "email", label: "Primary email", value: emails[0] || "" }, ...emails.slice(1).map((value, index) => ({ key: `additional_email_${index}`, label: "Additional email", value })), { key: "phone_e164", label: "Primary phone", value: phones[0] || "" }, ...phones.slice(1).map((value, index) => ({ key: `additional_phone_${index}`, label: "Additional phone", value })), { key: "website_url", label: "Website", value: details.websiteUrl || "" }, { key: "location_text", label: "Location / address", value: details.addressText || "" }].filter((item) => item.value);
}
function applyScanSelection(useAll) {
    if (!pendingScanDetails || !scanReviewFields)
        return;
    const selected = new Set(useAll ? scanValues(pendingScanDetails).map((item) => item.key) : Array.from(scanReviewFields.querySelectorAll("input:checked")).map((input) => input.value));
    for (const item of scanValues(pendingScanDetails)) {
        if (!selected.has(item.key))
            continue;
        if (item.key.startsWith("additional_email_"))
            addContactRow("email", item.value);
        else if (item.key.startsWith("additional_phone_"))
            addContactRow("phone", item.value);
        else
            field(item.key).value = item.value;
    }
    markChanged();
    setScanStatus("Scanned details applied and queued to save.", "success");
    scanReview?.close();
}
function showScanReview(details) { if (!scanReview || !scanReviewFields)
    return; pendingScanDetails = details; scanReviewFields.replaceChildren(); for (const item of scanValues(details)) {
    const label = document.createElement("label");
    label.className = "card-scan-review-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.key;
    checkbox.checked = true;
    const strong = document.createElement("strong");
    strong.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = item.value;
    label.append(checkbox, strong, value);
    scanReviewFields.append(label);
} if (!scanReviewFields.children.length)
    throw new Error("No contact details were recognized. Try a clearer photo."); scanReview.showModal(); }
async function analyzeScan() { if (!pendingScanDataUrl || !accessToken || !scanButton)
    return; scanButton.disabled = true; setScanStatus("Reading the business card…"); try {
    const response = await fetch("/api/admin-prospect-card-scan", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl: pendingScanDataUrl }) });
    const responsePayload = await response.json();
    if (!response.ok)
        throw new Error(responsePayload.error || "The card could not be analyzed.");
    const details = responsePayload.details;
    showScanReview(details);
    setScanStatus(`Card scanned${details.confidence ? ` · ${Math.round(details.confidence * 100)}% confidence` : ""}. Choose which details to use.`, "success");
}
catch (error) {
    setScanStatus(error instanceof Error ? error.message : "The card could not be analyzed.", "error");
}
finally {
    scanButton.disabled = false;
} }
async function saveCard() {
    if (!supabase || !form)
        return false;
    if (!changesPending && selectedId)
        return true;
    if (savePromise)
        return savePromise;
    window.clearTimeout(saveTimer);
    const version = changeVersion;
    setFormStatus("Saving…", "saving");
    form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
    savePromise = (async () => { try {
        const values = payload();
        let result;
        if (selectedId)
            result = await supabase.from("contact_card_profiles").update({ ...values, updated_by_user_id: adminUserId }).eq("id", selectedId).select("*").single();
        else
            result = await supabase.from("contact_card_profiles").insert({ ...values, created_by_user_id: adminUserId, updated_by_user_id: adminUserId }).select("*").single();
        if (result.error)
            throw result.error;
        selectedId = result.data.id;
        cards = [result.data, ...cards.filter((item) => item.id !== result.data.id)];
        if (version === changeVersion)
            changesPending = false;
        field("id").value = selectedId;
        renderOwnerOptions(String(result.data.owner_user_id || ""), true);
        if (deleteButton)
            deleteButton.hidden = false;
        if (publicLink) {
            publicLink.hidden = false;
            publicLink.href = `/card/${encodeURIComponent(result.data.slug)}`;
        }
        if (accessControls) {
            accessControls.hidden = false;
            await loadProductAccess(result.data);
        }
        setFormStatus(changesPending ? "Saving latest changes…" : "All changes saved", changesPending ? "saving" : "success");
        renderList();
        return true;
    }
    catch (error) {
        setFormStatus(saveErrorMessage(error), "error");
        return false;
    }
    finally {
        form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = false; });
    } })();
    try {
        return await savePromise;
    }
    finally {
        savePromise = null;
        if (changesPending && version !== changeVersion && selectedId)
            saveTimer = window.setTimeout(() => void saveCard(), 250);
    }
}
form?.addEventListener("submit", (event) => { event.preventDefault(); markChanged(); void saveCard(); });
deleteButton?.addEventListener("click", () => { void (async () => { if (!supabase || !selectedId)
    return; const selected = cards.find((item) => item.id === selectedId); if (!selected || !window.confirm(`Delete the Contact Card for ${selected.display_name}? This cannot be undone.`))
    return; setFormStatus("Deleting Contact Card…"); const mediaPaths = [selected.profile_image_path, selected.company_logo_path, selected.background_image_path].filter(Boolean); if (mediaPaths.length)
    await supabase.storage.from("contact-card-media").remove(mediaPaths); const { error } = await supabase.from("contact_card_profiles").delete().eq("id", selectedId); if (error)
    return setFormStatus(error.message, "error"); selectedId = ""; changesPending = false; closeModalNow(); await loadData(); })(); });
newButton?.addEventListener("click", () => showCard(null));
search?.addEventListener("input", renderList);
list?.addEventListener("click", (event) => { const id = event.target.closest("[data-card-id]")?.dataset.cardId; const selected = cards.find((item) => item.id === id); if (selected)
    showCard(selected); });
addLinkButton?.addEventListener("click", () => { addLinkRow(); markChanged(); });
document.querySelectorAll("[data-admin-add-contact]").forEach((button) => button.addEventListener("click", () => { addContactRow(button.dataset.adminAddContact); markChanged(); }));
document.querySelectorAll("[data-admin-media-input]").forEach((control) => control.addEventListener("change", () => { const file = control.files?.[0]; const type = control.dataset.adminMediaInput; if (!file || !(type in MEDIA_CONFIG))
    return; void uploadMedia(type, file).catch((error) => setMediaStatus(error instanceof Error ? error.message : "The image could not be uploaded.", true)).finally(() => { control.value = ""; }); }));
document.querySelectorAll("[data-admin-remove-media]").forEach((button) => button.addEventListener("click", () => { const type = button.dataset.adminRemoveMedia; if (!(type in MEDIA_CONFIG))
    return; button.disabled = true; void removeMedia(type).catch((error) => setMediaStatus(error instanceof Error ? error.message : "The image could not be removed.", true)).finally(() => { const card = cards.find((item) => item.id === selectedId); button.disabled = !card || !mediaPath(card, type); }); }));
scanInput?.addEventListener("change", () => { const file = scanInput.files?.[0]; if (!file)
    return; void prepareScan(file).catch((error) => setScanStatus(error instanceof Error ? error.message : "The photo could not be prepared.", "error")).finally(() => { scanInput.value = ""; }); });
scanButton?.addEventListener("click", () => void analyzeScan());
scanApplySelected?.addEventListener("click", (event) => { event.preventDefault(); applyScanSelection(false); });
scanApplyAll?.addEventListener("click", (event) => { event.preventDefault(); applyScanSelection(true); });
accessTerm?.addEventListener("change", () => { if (accessEndLabel)
    accessEndLabel.hidden = accessTerm.value !== "custom"; });
accessGrant?.addEventListener("click", () => void grantProductAccess());
accessPause?.addEventListener("click", () => { const grant = currentAccessGrant(); void updateProductAccessStatus(grant?.status === "paused" ? "active" : "paused"); });
accessRevoke?.addEventListener("click", () => { if (window.confirm("Revoke this complimentary Premium access? Paid Stripe service, if present, will not be changed."))
    void updateProductAccessStatus("revoked"); });
form?.addEventListener("input", (event) => { if (!event.target.closest("[data-access-controls]"))
    markChanged(); });
form?.addEventListener("change", (event) => { if (!event.target.closest("[data-access-controls]"))
    markChanged(); });
modalClose?.addEventListener("click", () => void requestClose());
modalBackdrop?.addEventListener("click", () => void requestClose());
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal && !modal.hidden && !scanReview?.open) {
    event.preventDefault();
    void requestClose();
} });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && changesPending)
    void saveCard(); });
window.addEventListener("pagehide", () => { if (changesPending)
    void saveCard(); });
void (async () => { if (!supabase)
    throw new Error("Supabase is not configured."); const session = await getSessionOrNull(supabase); if (!session?.user) {
    window.location.replace("/account/?next=/n3xra-admin/contact-cards/");
    return;
} adminUserId = session.user.id; accessToken = String(session.access_token || ""); const requestedCard = new URLSearchParams(window.location.search).get("card") || ""; await loadData(requestedCard); document.body.classList.remove("portal-loading"); const screen = document.querySelector("#portal-status"); if (screen)
    screen.hidden = true; })().catch((error) => { const screen = document.querySelector("#portal-status"); if (screen)
    screen.textContent = error instanceof Error ? error.message : "Contact Cards could not be opened."; });
