import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const MEDIA_BUCKET = "contact-card-media";
const MAX_SCAN_BYTES = 3_350_000;
const MEDIA_CONFIG = {
    profile: { column: "profile_image_path", stem: "profile" }, logo: { column: "company_logo_path", stem: "logo" }, background: { column: "background_image_path", stem: "background" },
};
const SECTION_DETAILS = {
    about: { label: "About", description: "Your short biography" }, contact: { label: "Contact", description: "Email, phone, and website" }, links: { label: "Links", description: "Social, booking, portfolio, and custom links" },
};
const DEFAULT_SECTION_ORDER = ["about", "contact", "links"];
const form = document.querySelector("#card-editor-form");
const activation = document.querySelector("#card-activation");
const activationForm = document.querySelector("#card-activation-form");
const activationStatus = document.querySelector("#card-activation-status");
const status = document.querySelector("#card-editor-status");
const saveStatus = document.querySelector("#card-save-status");
const linksContainer = document.querySelector("#card-editor-links");
const addLinkButton = document.querySelector("#card-editor-add-link");
const publicLink = document.querySelector("#card-public-link");
const editorToolbar = document.querySelector("#card-editor-toolbar");
const publicAddress = document.querySelector("#card-public-address");
const mediaStatus = document.querySelector("#card-media-status");
const sectionOrderContainer = document.querySelector("#card-editor-section-order");
const slugInput = document.querySelector("#card-activation-slug");
const slugStatus = document.querySelector("#card-slug-status");
const scanInput = document.querySelector("#card-scan-input");
const scanButton = document.querySelector("#card-scan-analyze");
const scanStatus = document.querySelector("#card-scan-status");
const scanPreview = document.querySelector("#card-scan-preview");
const scanPanel = document.querySelector("#card-scan-panel");
const scanReview = document.querySelector("#card-scan-review");
const scanReviewFields = document.querySelector("#card-scan-review-fields");
const scanApplySelected = document.querySelector("#card-scan-apply-selected");
const scanApplyAll = document.querySelector("#card-scan-apply-all");
const requestState = document.querySelector("#card-request-state");
const removeBrandingButton = document.querySelector("#card-remove-branding");
const brandingHelp = document.querySelector("#card-branding-help");
const brandingToggle = form?.elements.namedItem("show_n3xra_branding");
const supabase = hasConfig() ? createBrowserSupabase() : null;
let card = null;
let draftCard = null;
let hasBrandingRemoval = false;
let ownerUserId = "";
let accessToken = "";
let pendingScanDataUrl = "";
let slugTimer = 0;
let sectionOrder = [...DEFAULT_SECTION_ORDER];
let pendingScanDetails = null;
let changeVersion = 0;
let changesPending = false;
let saveTimer = 0;
let savePromise = null;
const repeatableContainers = {
    "activation-email": document.querySelector("#card-activation-additional-emails"),
    "activation-phone": document.querySelector("#card-activation-additional-phones"),
    "editor-email": document.querySelector("#card-editor-additional-emails"),
    "editor-phone": document.querySelector("#card-editor-additional-phones"),
};
function showStatus(message = "", isError = false) { if (status) {
    status.textContent = message;
    status.style.color = isError ? "#a33041" : "";
} }
function showMediaStatus(message = "", isError = false) { if (mediaStatus) {
    mediaStatus.textContent = message;
    mediaStatus.style.color = isError ? "#a33041" : "";
} }
function setScanStatus(message = "", tone = "") { if (scanStatus) {
    scanStatus.textContent = message;
    scanStatus.className = tone ? `is-${tone}` : "";
} }
function setSaveStatus(message, tone = "") { if (saveStatus) {
    saveStatus.textContent = message;
    saveStatus.className = `card-auto-save-status${tone ? ` is-${tone}` : ""}`;
} }
async function startCheckout(product, button) {
    if (!supabase)
        throw new Error("Checkout is not available.");
    if (button)
        button.disabled = true;
    try {
        const { data, error } = await supabase.functions.invoke("contact-card-billing", { body: { product } });
        if (error)
            throw error;
        if (!data?.url)
            throw new Error(data?.error || "Checkout could not be opened.");
        window.location.assign(String(data.url));
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
function markChanged() { if (!card)
    return; changesPending = true; changeVersion += 1; setSaveStatus("Unsaved changes"); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveChanges(), 750); }
function slugify(value) { return String(value || "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); }
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
            button.addEventListener("click", () => moveSection(index, direction));
            actions.append(button);
        }
        row.append(number, copy, actions);
        sectionOrderContainer.append(row);
    });
}
function moveSection(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sectionOrder.length)
        return;
    const next = [...sectionOrder];
    const current = next[index];
    const replacement = next[nextIndex];
    if (!current || !replacement)
        return;
    next[index] = replacement;
    next[nextIndex] = current;
    sectionOrder = next;
    renderSectionOrder();
    markChanged();
}
function mediaPath(row, type) { return String(row[MEDIA_CONFIG[type].column] || ""); }
function setMediaPreview(type, url = "") {
    const preview = document.querySelector(`#card-media-${type}-preview`);
    const remove = document.querySelector(`[data-remove-media="${type}"]`);
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
async function loadMediaPreviews(row) {
    if (!supabase)
        return;
    await Promise.all(Object.keys(MEDIA_CONFIG).map(async (type) => { const path = mediaPath(row, type); if (!path)
        return setMediaPreview(type); const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600); setMediaPreview(type, error ? "" : `${data?.signedUrl || ""}${data?.signedUrl ? `&v=${Date.now()}` : ""}`); }));
}
function mediaExtension(file) { if (file.type === "image/jpeg")
    return "jpg"; if (file.type === "image/png")
    return "png"; if (file.type === "image/webp")
    return "webp"; throw new Error("Choose a JPEG, PNG, or WebP image."); }
async function uploadMedia(type, file) {
    if (!supabase || !card || !ownerUserId)
        return;
    if (file.size > 5_242_880)
        throw new Error("Choose an image smaller than 5 MB.");
    const config = MEDIA_CONFIG[type];
    const oldPath = mediaPath(card, type);
    const path = `${ownerUserId}/${card.id}/${config.stem}.${mediaExtension(file)}`;
    showMediaStatus("Uploading image…");
    const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError)
        throw uploadError;
    const { data, error } = await supabase.from("contact_card_profiles").update({ [config.column]: path, updated_by_user_id: ownerUserId }).eq("id", card.id).select("*").single();
    if (error) {
        if (path !== oldPath)
            await supabase.storage.from(MEDIA_BUCKET).remove([path]);
        throw error;
    }
    if (oldPath && oldPath !== path)
        await supabase.storage.from(MEDIA_BUCKET).remove([oldPath]);
    card = data;
    await loadMediaPreviews(card);
    showMediaStatus("Image updated.");
}
async function removeMedia(type) {
    if (!supabase || !card)
        return;
    const config = MEDIA_CONFIG[type];
    const oldPath = mediaPath(card, type);
    if (!oldPath)
        return;
    showMediaStatus("Removing image…");
    const { data, error } = await supabase.from("contact_card_profiles").update({ [config.column]: null, updated_by_user_id: ownerUserId }).eq("id", card.id).select("*").single();
    if (error)
        throw error;
    card = data;
    await supabase.storage.from(MEDIA_BUCKET).remove([oldPath]);
    setMediaPreview(type);
    showMediaStatus("Image removed.");
}
function normalizePhone(value) { let digits = value.replace(/\D/g, ""); if (!digits)
    return null; if (digits.length === 10)
    digits = `1${digits}`; if (!/^[1-9][0-9]{7,14}$/.test(digits))
    throw new Error("Enter a valid phone number with area code."); return `+${digits}`; }
function normalizeUrl(value) { const raw = value.trim(); if (!raw)
    return null; const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); if (!['http:', 'https:'].includes(url.protocol))
    throw new Error("Links must use http or https."); return url.toString(); }
function normalizeEmail(value) { const email = value.trim().toLowerCase(); if (!email)
    return null; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address."); return email; }
function addContactRow(key, value = "") {
    const container = repeatableContainers[key];
    if (!container || container.children.length >= 5)
        return;
    const isEmail = key.endsWith("email");
    const row = document.createElement("div");
    row.className = "card-repeatable-row";
    const input = document.createElement("input");
    input.type = isEmail ? "email" : "tel";
    input.maxLength = isEmail ? 320 : 40;
    input.placeholder = isEmail ? "Additional email address" : "Additional phone number";
    input.value = value;
    input.dataset.additionalContact = isEmail ? "email" : "phone";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove additional ${isEmail ? "email" : "phone number"}`);
    remove.addEventListener("click", () => { row.remove(); markChanged(); });
    row.append(input, remove);
    container.append(row);
}
function renderContacts(key, values) { const container = repeatableContainers[key]; if (!container)
    return; container.replaceChildren(); if (Array.isArray(values))
    for (const value of values.slice(0, 5))
        if (String(value || "").trim())
            addContactRow(key, String(value)); }
function collectContacts(key) {
    const container = repeatableContainers[key];
    if (!container)
        return [];
    const isEmail = key.endsWith("email");
    return Array.from(new Set(Array.from(container.querySelectorAll("[data-additional-contact]")).map((input) => isEmail ? normalizeEmail(input.value) : normalizePhone(input.value)).filter((value) => Boolean(value))));
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
function setRequestState(row) {
    if (!form || !requestState)
        return;
    const state = String(row.physical_card_status || "not_requested");
    const toggle = form.elements.namedItem("request_physical_card");
    requestState.className = `card-request-state${state === "not_requested" ? "" : ["shipped", "delivered"].includes(state) ? " is-shipped" : " is-requested"}`;
    requestState.textContent = state === "not_requested" ? "No physical card requested yet." : state === "requested" ? "Request received. N3XRA will review the mailing details." : state === "processing" ? "Your physical card is being prepared." : state === "delivered" ? "Your physical card has been delivered." : "Your physical card has shipped.";
    if (toggle) {
        toggle.checked = state !== "not_requested";
        toggle.disabled = ["processing", "shipped", "delivered"].includes(state);
    }
}
function fillForm(row) {
    if (!form)
        return;
    for (const name of ["display_name", "headline", "company_name", "bio", "email", "phone_e164", "website_url", "location_text", "accent_color", "status", "slug", "shipping_name", "shipping_address_line_1", "shipping_address_line_2", "shipping_city", "shipping_region", "shipping_postal_code", "shipping_country"]) {
        const control = form.elements.namedItem(name);
        if (control)
            control.value = String(row[name] ?? "");
    }
    const branding = form.elements.namedItem("show_n3xra_branding");
    if (branding) {
        branding.checked = hasBrandingRemoval ? row.show_n3xra_branding !== false : true;
        branding.dataset.locked = String(!hasBrandingRemoval);
    }
    if (removeBrandingButton)
        removeBrandingButton.hidden = hasBrandingRemoval;
    if (brandingHelp)
        brandingHelp.textContent = hasBrandingRemoval ? "This permanent upgrade is active. You can show or hide the N3XRA credit anytime." : "Turn this off to open the one-time $9.99 checkout. After payment, it stays unlocked permanently.";
    renderContacts("editor-email", row.additional_emails);
    renderContacts("editor-phone", row.additional_phones);
    setRequestState(row);
    sectionOrder = validSectionOrder(row.section_order);
    renderSectionOrder();
    void loadMediaPreviews(row);
    linksContainer?.replaceChildren();
    for (const link of row.links || [])
        addLinkRow(link);
    if (!row.links?.length)
        addLinkRow();
    const url = `${window.location.origin}/card/${row.slug}`;
    if (publicLink) {
        publicLink.href = url;
        publicLink.hidden = false;
    }
    if (editorToolbar)
        editorToolbar.hidden = false;
    if (publicAddress)
        publicAddress.textContent = url;
    if (scanPanel)
        scanPanel.hidden = false;
    form.hidden = false;
    activation?.setAttribute("hidden", "");
    changesPending = false;
    setSaveStatus("All changes saved");
}
async function checkSlug(rawSlug, current = "") {
    const slug = slugify(rawSlug);
    if (!slug || slug.length < 2) {
        if (slugStatus) {
            slugStatus.textContent = "Use at least two letters or numbers.";
            slugStatus.className = "is-unavailable";
        }
        return false;
    }
    const response = await fetch(`/api/contact-card-slug?slug=${encodeURIComponent(slug)}${current ? `&current=${encodeURIComponent(current)}` : ""}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    const payload = await response.json();
    if (slugStatus) {
        slugStatus.textContent = payload.available ? `n3xra.com/card/${slug} is available.` : "That card address is already taken.";
        slugStatus.className = payload.available ? "is-available" : "is-unavailable";
    }
    return Boolean(response.ok && payload.available);
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
async function prepareScan(file) {
    setScanStatus("Preparing photo…");
    const blob = await compressCard(file);
    pendingScanDataUrl = await blobDataUrl(blob);
    if (scanPreview) {
        scanPreview.replaceChildren();
        const image = document.createElement("img");
        image.src = URL.createObjectURL(blob);
        image.alt = "Business card preview";
        scanPreview.append(image);
    }
    if (scanButton)
        scanButton.disabled = false;
    setScanStatus("Photo ready. Scan it, then review the fields.", "success");
}
function activationControl(name) { return activationForm?.elements.namedItem(name); }
function activeControl(name) { const activeForm = card ? form : activationForm; return activeForm?.elements.namedItem(name); }
function scanValues(details) {
    const emails = Array.from(new Set([details.email, ...(details.emails || [])].filter((value) => Boolean(value))));
    const phones = Array.from(new Set([details.phoneE164, ...(details.phonesE164 || [])].filter((value) => Boolean(value))));
    return [
        { key: "display_name", label: "Name", value: details.fullName || "" }, { key: "headline", label: "Job title", value: details.jobTitle || "" }, { key: "company_name", label: "Company", value: details.companyName || "" },
        { key: "email", label: "Primary email", value: emails[0] || "" }, ...emails.slice(1).map((value, index) => ({ key: `additional_email_${index}`, label: "Additional email", value })),
        { key: "phone_e164", label: "Primary phone", value: phones[0] || "" }, ...phones.slice(1).map((value, index) => ({ key: `additional_phone_${index}`, label: "Additional phone", value })),
        { key: "website_url", label: "Website", value: details.websiteUrl || "" }, { key: "location_text", label: "Location / address", value: details.addressText || "" },
    ].filter((item) => item.value);
}
function applyScanSelection(useAll) {
    if (!pendingScanDetails || !scanReviewFields)
        return;
    const selected = new Set(useAll ? scanValues(pendingScanDetails).map((item) => item.key) : Array.from(scanReviewFields.querySelectorAll("input:checked")).map((input) => input.value));
    const values = scanValues(pendingScanDetails);
    for (const item of values) {
        if (!selected.has(item.key))
            continue;
        if (item.key.startsWith("additional_email_"))
            addContactRow(card ? "editor-email" : "activation-email", item.value);
        else if (item.key.startsWith("additional_phone_"))
            addContactRow(card ? "editor-phone" : "activation-phone", item.value);
        else {
            const control = activeControl(item.key);
            if (control)
                control.value = item.value;
        }
    }
    if (!card && slugInput && !slugInput.value && pendingScanDetails.fullName)
        slugInput.value = slugify(pendingScanDetails.fullName);
    if (!card && slugInput?.value)
        void checkSlug(slugInput.value);
    if (card)
        markChanged();
    setScanStatus(card ? "Scanned details added and queued to save." : "Scanned details added. Review them, then activate your card.", "success");
    scanReview?.close();
}
function showScanReview(details) {
    if (!scanReview || !scanReviewFields)
        return;
    pendingScanDetails = details;
    scanReviewFields.replaceChildren();
    for (const item of scanValues(details)) {
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
    }
    if (!scanReviewFields.children.length)
        throw new Error("No contact details were recognized. Try a clearer photo.");
    scanReview.showModal();
}
async function analyzeScan() {
    if (!pendingScanDataUrl || !accessToken || !scanButton)
        return;
    scanButton.disabled = true;
    setScanStatus("Reading the business card…");
    try {
        const response = await fetch("/api/contact-card-scan", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl: pendingScanDataUrl }) });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || "The card could not be analyzed.");
        const details = payload.details;
        showScanReview(details);
        setScanStatus(`Card scanned${details.confidence ? ` · ${Math.round(details.confidence * 100)}% confidence` : ""}. Choose which details to use.`, "success");
    }
    catch (error) {
        setScanStatus(error instanceof Error ? error.message : "The card could not be analyzed.", "error");
    }
    finally {
        scanButton.disabled = false;
    }
}
async function saveChanges() {
    if (!supabase || !card || !form || !changesPending)
        return;
    if (savePromise) {
        await savePromise;
        if (changesPending)
            return saveChanges();
        return;
    }
    window.clearTimeout(saveTimer);
    const version = changeVersion;
    setSaveStatus("Saving…", "saving");
    savePromise = (async () => {
        try {
            const values = new FormData(form);
            const currentRequestState = String(card?.physical_card_status || "not_requested");
            const requestChecked = values.get("request_physical_card") === "on";
            const physicalStatus = ["processing", "shipped", "delivered"].includes(currentRequestState) ? currentRequestState : requestChecked ? "requested" : "not_requested";
            const slug = slugify(values.get("slug"));
            if (slug !== card?.slug && !(await checkSlug(slug, String(card?.slug || ""))))
                throw new Error("Choose an available card address.");
            const primaryEmail = normalizeEmail(String(values.get("email") || ""));
            const primaryPhone = normalizePhone(String(values.get("phone_e164") || ""));
            const payload = { slug, display_name: String(values.get("display_name") || "").trim(), headline: String(values.get("headline") || "").trim(), company_name: String(values.get("company_name") || "").trim(), bio: String(values.get("bio") || "").trim(), email: primaryEmail, phone_e164: primaryPhone, additional_emails: collectContacts("editor-email").filter((value) => value !== primaryEmail), additional_phones: collectContacts("editor-phone").filter((value) => value !== primaryPhone), website_url: normalizeUrl(String(values.get("website_url") || "")), location_text: String(values.get("location_text") || "").trim(), links: collectLinks(), section_order: sectionOrder, accent_color: String(values.get("accent_color") || "#2f7d68"), show_n3xra_branding: hasBrandingRemoval ? values.get("show_n3xra_branding") === "on" : true, status: String(values.get("status") || "draft"), physical_card_status: physicalStatus, shipping_name: String(values.get("shipping_name") || "").trim(), shipping_address_line_1: String(values.get("shipping_address_line_1") || "").trim(), shipping_address_line_2: String(values.get("shipping_address_line_2") || "").trim(), shipping_city: String(values.get("shipping_city") || "").trim(), shipping_region: String(values.get("shipping_region") || "").trim(), shipping_postal_code: String(values.get("shipping_postal_code") || "").trim(), shipping_country: String(values.get("shipping_country") || "").trim(), updated_by_user_id: ownerUserId };
            if (!payload.display_name)
                throw new Error("Your card needs a display name.");
            if (requestChecked && (!payload.shipping_name || !payload.shipping_address_line_1 || !payload.shipping_city || !payload.shipping_region || !payload.shipping_postal_code || !payload.shipping_country))
                throw new Error("Complete the mailing address before requesting a physical card.");
            const { data, error } = await supabase.from("contact_card_profiles").update(payload).eq("id", card.id).select("*").single();
            if (error)
                throw error;
            card = data;
            if (version === changeVersion) {
                changesPending = false;
                setSaveStatus(requestChecked && currentRequestState === "not_requested" ? "Saved · physical card requested" : "All changes saved");
            }
            else {
                setSaveStatus("Saving latest changes…", "saving");
            }
            const url = `${window.location.origin}/card/${card.slug}`;
            if (publicLink)
                publicLink.href = url;
            if (publicAddress)
                publicAddress.textContent = url;
            setRequestState(card);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error?.message || "Changes could not be saved.");
            setSaveStatus(`${message} Retrying automatically…`, "error");
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => void saveChanges(), 4000);
        }
    })();
    try {
        await savePromise;
    }
    finally {
        savePromise = null;
        if (changesPending && version !== changeVersion)
            saveTimer = window.setTimeout(() => void saveChanges(), 250);
    }
}
async function initialize() {
    if (!supabase || !form || !activationForm || !activation)
        throw new Error("The Contact Card product is not configured.");
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(`/account/?next=${encodeURIComponent("/client-portal/contact-card/")}`);
        return;
    }
    ownerUserId = String(session.user.id || "");
    accessToken = String(session.access_token || "");
    const [{ data: initialData, error }, entitlementResult] = await Promise.all([supabase.from("contact_card_profiles").select("*").eq("owner_user_id", session.user.id).maybeSingle(), supabase.from("contact_card_entitlements").select("base_access, branding_removal").eq("owner_user_id", session.user.id).maybeSingle()]);
    if (error)
        throw error;
    let data = initialData;
    let entitlement = entitlementResult.data;
    const checkoutParams = new URLSearchParams(window.location.search);
    const checkoutSucceeded = checkoutParams.get("checkout") === "success";
    const checkoutProduct = checkoutParams.get("product");
    const purchaseConfirmed = () => checkoutProduct === "branding_removal" ? Boolean(entitlement?.branding_removal) : checkoutProduct === "base" ? Boolean(entitlement?.base_access) : true;
    if (data && checkoutSucceeded && !purchaseConfirmed()) {
        showStatus("Confirming your purchase…");
        for (let attempt = 0; attempt < 12 && !purchaseConfirmed(); attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 750));
            const result = await supabase.from("contact_card_entitlements").select("base_access, branding_removal").eq("owner_user_id", session.user.id).maybeSingle();
            entitlement = result.data;
        }
        if (purchaseConfirmed()) {
            const refreshed = await supabase.from("contact_card_profiles").select("*").eq("owner_user_id", session.user.id).maybeSingle();
            if (!refreshed.error)
                data = refreshed.data;
        }
    }
    hasBrandingRemoval = Boolean(entitlement?.branding_removal);
    if (data && entitlement?.base_access) {
        card = data;
        fillForm(card);
        showStatus(checkoutSucceeded ? purchaseConfirmed() ? checkoutProduct === "branding_removal" ? "Branding removal is permanently unlocked." : "Purchase complete. Your Contact Card is ready." : "Payment received. The update is still processing; refresh in a moment." : "");
    }
    else if (data) {
        draftCard = data;
        const names = ["display_name", "headline", "company_name", "email", "phone_e164", "website_url", "slug"];
        for (const name of names) {
            const control = activationControl(name);
            if (control)
                control.value = String(draftCard[name] || "");
        }
        renderContacts("activation-email", draftCard.additional_emails);
        renderContacts("activation-phone", draftCard.additional_phones);
        if (scanPanel)
            scanPanel.hidden = false;
        activation.hidden = false;
        showStatus("");
    }
    else {
        const name = String(session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "").trim();
        const nameControl = activationControl("display_name");
        const emailControl = activationControl("email");
        if (nameControl)
            nameControl.value = name;
        if (emailControl)
            emailControl.value = String(session.user.email || "");
        if (slugInput)
            slugInput.value = slugify(name);
        if (scanPanel)
            scanPanel.hidden = false;
        activation.hidden = false;
        showStatus("");
        if (slugInput?.value)
            void checkSlug(slugInput.value);
    }
    document.body.classList.remove("is-loading");
}
slugInput?.addEventListener("input", () => { slugInput.value = slugify(slugInput.value); window.clearTimeout(slugTimer); slugTimer = window.setTimeout(() => void checkSlug(slugInput.value), 350); });
scanInput?.addEventListener("change", () => { const file = scanInput.files?.[0]; if (!file)
    return; void prepareScan(file).catch((error) => setScanStatus(error instanceof Error ? error.message : "The photo could not be prepared.", "error")).finally(() => { scanInput.value = ""; }); });
scanButton?.addEventListener("click", () => void analyzeScan());
scanApplySelected?.addEventListener("click", (event) => { event.preventDefault(); applyScanSelection(false); });
scanApplyAll?.addEventListener("click", (event) => { event.preventDefault(); applyScanSelection(true); });
document.querySelectorAll("[data-add-contact]").forEach((button) => button.addEventListener("click", () => { addContactRow(button.dataset.addContact); if (card)
    markChanged(); }));
activationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
        if (!supabase || !activationForm)
            return;
        const button = activationForm.querySelector('button[type="submit"]');
        if (button)
            button.disabled = true;
        if (activationStatus)
            activationStatus.textContent = "Activating…";
        try {
            const values = new FormData(activationForm);
            const slug = slugify(values.get("slug"));
            if (!(await checkSlug(slug, String(draftCard?.slug || ""))))
                throw new Error("Choose an available card address.");
            const displayName = String(values.get("display_name") || "").trim();
            if (!displayName)
                throw new Error("Enter the name to show on the card.");
            const primaryEmail = normalizeEmail(String(values.get("email") || ""));
            const primaryPhone = normalizePhone(String(values.get("phone_e164") || ""));
            const payload = { owner_user_id: ownerUserId, slug, display_name: displayName, headline: String(values.get("headline") || "").trim(), company_name: String(values.get("company_name") || "").trim(), email: primaryEmail, phone_e164: primaryPhone, additional_emails: collectContacts("activation-email").filter((value) => value !== primaryEmail), additional_phones: collectContacts("activation-phone").filter((value) => value !== primaryPhone), website_url: normalizeUrl(String(values.get("website_url") || "")), status: "draft", show_n3xra_branding: true, physical_card_status: "not_requested", created_by_user_id: ownerUserId, updated_by_user_id: ownerUserId };
            const query = draftCard ? supabase.from("contact_card_profiles").update(payload).eq("id", draftCard.id) : supabase.from("contact_card_profiles").insert(payload);
            const { data, error } = await query.select("*").single();
            if (error)
                throw error;
            draftCard = data;
            if (activationStatus)
                activationStatus.textContent = "Opening secure checkout…";
            await startCheckout("base", button);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "The Contact Card could not be activated.";
            if (activationStatus)
                activationStatus.textContent = message.includes("duplicate") ? "That card address is already taken." : message;
        }
        finally {
            if (button)
                button.disabled = false;
        }
    })();
});
addLinkButton?.addEventListener("click", () => { addLinkRow(); markChanged(); });
removeBrandingButton?.addEventListener("click", () => { void startCheckout("branding_removal", removeBrandingButton).catch((error) => setSaveStatus(error instanceof Error ? error.message : "Checkout could not be opened.", "error")); });
brandingToggle?.addEventListener("change", (event) => { if (hasBrandingRemoval || brandingToggle.checked)
    return; event.preventDefault(); event.stopPropagation(); brandingToggle.checked = true; void startCheckout("branding_removal", removeBrandingButton).catch((error) => setSaveStatus(error instanceof Error ? error.message : "Checkout could not be opened.", "error")); });
document.querySelectorAll("[data-contact-card-product]").forEach((button) => button.addEventListener("click", () => { void startCheckout(button.dataset.contactCardProduct, button).catch((error) => setSaveStatus(error instanceof Error ? error.message : "Checkout could not be opened.", "error")); }));
document.querySelectorAll("[data-media-input]").forEach((control) => control.addEventListener("change", () => { const file = control.files?.[0]; const type = control.dataset.mediaInput; if (!file || !(type in MEDIA_CONFIG))
    return; void uploadMedia(type, file).catch((error) => showMediaStatus(error instanceof Error ? error.message : "The image could not be uploaded.", true)).finally(() => { control.value = ""; }); }));
document.querySelectorAll("[data-remove-media]").forEach((button) => button.addEventListener("click", () => { const type = button.dataset.removeMedia; if (!(type in MEDIA_CONFIG))
    return; button.disabled = true; void removeMedia(type).catch((error) => showMediaStatus(error instanceof Error ? error.message : "The image could not be removed.", true)).finally(() => { button.disabled = !card || !mediaPath(card, type); }); }));
form?.addEventListener("input", markChanged);
form?.addEventListener("change", markChanged);
form?.addEventListener("submit", (event) => { event.preventDefault(); markChanged(); void saveChanges(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden")
    void saveChanges(); });
window.addEventListener("pagehide", () => { void saveChanges(); });
void initialize().catch((error) => { showStatus(error instanceof Error ? error.message : "The Contact Card could not be loaded.", true); document.body.classList.remove("is-loading"); });
