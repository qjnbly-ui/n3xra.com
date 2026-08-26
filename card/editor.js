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
const publicAddress = document.querySelector("#card-public-address");
const mediaStatus = document.querySelector("#card-media-status");
const sectionOrderContainer = document.querySelector("#card-editor-section-order");
const slugInput = document.querySelector("#card-activation-slug");
const slugStatus = document.querySelector("#card-slug-status");
const scanInput = document.querySelector("#card-scan-input");
const scanButton = document.querySelector("#card-scan-analyze");
const scanStatus = document.querySelector("#card-scan-status");
const scanPreview = document.querySelector("#card-scan-preview");
const requestState = document.querySelector("#card-request-state");
const supabase = hasConfig() ? createBrowserSupabase() : null;
let card = null;
let ownerUserId = "";
let accessToken = "";
let pendingScanDataUrl = "";
let slugTimer = 0;
let sectionOrder = [...DEFAULT_SECTION_ORDER];
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
    if (branding)
        branding.checked = row.show_n3xra_branding !== false;
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
    if (publicAddress)
        publicAddress.textContent = url;
    form.hidden = false;
    activation?.setAttribute("hidden", "");
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
function applyScan(details) {
    const values = { display_name: details.fullName || "", headline: details.jobTitle || "", company_name: details.companyName || "", email: details.email || "", phone_e164: details.phoneE164 || "", website_url: details.websiteUrl || "" };
    for (const [name, value] of Object.entries(values)) {
        const control = activationControl(name);
        if (control && value)
            control.value = value;
    }
    if (slugInput && !slugInput.value && details.fullName)
        slugInput.value = slugify(details.fullName);
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
        applyScan(details);
        setScanStatus(`Card scanned${details.confidence ? ` · ${Math.round(details.confidence * 100)}% confidence` : ""}. Review every field before activating.`, "success");
        if (slugInput?.value)
            void checkSlug(slugInput.value);
    }
    catch (error) {
        setScanStatus(error instanceof Error ? error.message : "The card could not be analyzed.", "error");
    }
    finally {
        scanButton.disabled = false;
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
    const { data, error } = await supabase.from("contact_card_profiles").select("*").eq("owner_user_id", session.user.id).maybeSingle();
    if (error)
        throw error;
    if (data) {
        card = data;
        fillForm(card);
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
            if (!(await checkSlug(slug)))
                throw new Error("Choose an available card address.");
            const displayName = String(values.get("display_name") || "").trim();
            if (!displayName)
                throw new Error("Enter the name to show on the card.");
            const payload = { owner_user_id: ownerUserId, slug, display_name: displayName, headline: String(values.get("headline") || "").trim(), company_name: String(values.get("company_name") || "").trim(), email: String(values.get("email") || "").trim().toLowerCase() || null, phone_e164: normalizePhone(String(values.get("phone_e164") || "")), website_url: normalizeUrl(String(values.get("website_url") || "")), status: "published", created_by_user_id: ownerUserId, updated_by_user_id: ownerUserId };
            const { data, error } = await supabase.from("contact_card_profiles").insert(payload).select("*").single();
            if (error)
                throw error;
            card = data;
            fillForm(card);
            if (activationStatus)
                activationStatus.textContent = "";
            showStatus("Your Contact Card is connected and live.");
            window.scrollTo({ top: 0, behavior: "smooth" });
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
addLinkButton?.addEventListener("click", () => addLinkRow());
document.querySelectorAll("[data-media-input]").forEach((control) => control.addEventListener("change", () => { const file = control.files?.[0]; const type = control.dataset.mediaInput; if (!file || !(type in MEDIA_CONFIG))
    return; void uploadMedia(type, file).catch((error) => showMediaStatus(error instanceof Error ? error.message : "The image could not be uploaded.", true)).finally(() => { control.value = ""; }); }));
document.querySelectorAll("[data-remove-media]").forEach((button) => button.addEventListener("click", () => { const type = button.dataset.removeMedia; if (!(type in MEDIA_CONFIG))
    return; button.disabled = true; void removeMedia(type).catch((error) => showMediaStatus(error instanceof Error ? error.message : "The image could not be removed.", true)).finally(() => { button.disabled = !card || !mediaPath(card, type); }); }));
form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
        if (!supabase || !card || !form)
            return;
        const button = form.querySelector('button[type="submit"]');
        if (button)
            button.disabled = true;
        if (saveStatus)
            saveStatus.textContent = "Saving…";
        try {
            const values = new FormData(form);
            const currentRequestState = String(card.physical_card_status || "not_requested");
            const requestChecked = values.get("request_physical_card") === "on";
            const physicalStatus = ["processing", "shipped", "delivered"].includes(currentRequestState) ? currentRequestState : requestChecked ? "requested" : "not_requested";
            const slug = slugify(values.get("slug"));
            if (slug !== card.slug && !(await checkSlug(slug, card.slug)))
                throw new Error("Choose an available card address.");
            const payload = { slug, display_name: String(values.get("display_name") || "").trim(), headline: String(values.get("headline") || "").trim(), company_name: String(values.get("company_name") || "").trim(), bio: String(values.get("bio") || "").trim(), email: String(values.get("email") || "").trim().toLowerCase() || null, phone_e164: normalizePhone(String(values.get("phone_e164") || "")), website_url: normalizeUrl(String(values.get("website_url") || "")), location_text: String(values.get("location_text") || "").trim(), links: collectLinks(), section_order: sectionOrder, accent_color: String(values.get("accent_color") || "#2f7d68"), show_n3xra_branding: values.get("show_n3xra_branding") === "on", status: String(values.get("status") || "draft"), physical_card_status: physicalStatus, shipping_name: String(values.get("shipping_name") || "").trim(), shipping_address_line_1: String(values.get("shipping_address_line_1") || "").trim(), shipping_address_line_2: String(values.get("shipping_address_line_2") || "").trim(), shipping_city: String(values.get("shipping_city") || "").trim(), shipping_region: String(values.get("shipping_region") || "").trim(), shipping_postal_code: String(values.get("shipping_postal_code") || "").trim(), shipping_country: String(values.get("shipping_country") || "").trim(), updated_by_user_id: ownerUserId };
            if (!payload.display_name)
                throw new Error("Your card needs a display name.");
            if (requestChecked && (!payload.shipping_name || !payload.shipping_address_line_1 || !payload.shipping_city || !payload.shipping_region || !payload.shipping_postal_code || !payload.shipping_country))
                throw new Error("Complete the mailing address before requesting a physical card.");
            const { data, error } = await supabase.from("contact_card_profiles").update(payload).eq("id", card.id).select("*").single();
            if (error)
                throw error;
            card = data;
            fillForm(card);
            if (saveStatus)
                saveStatus.textContent = requestChecked && currentRequestState === "not_requested" ? "Changes saved and physical card requested." : "Changes saved.";
        }
        catch (error) {
            if (saveStatus)
                saveStatus.textContent = error instanceof Error ? error.message : "Changes could not be saved.";
        }
        finally {
            if (button)
                button.disabled = false;
        }
    })();
});
void initialize().catch((error) => { showStatus(error instanceof Error ? error.message : "The Contact Card could not be loaded.", true); document.body.classList.remove("is-loading"); });
