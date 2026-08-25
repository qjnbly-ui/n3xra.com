const BUCKET = "prospect-business-cards";
const MAX_SCAN_BYTES = 3_350_000;
let supabase;
let session;
let confirmAdminAction;
let contacts = [];
let currentContact = null;
let pendingCardBlob = null;
let pendingCardDataUrl = "";
let pendingPreviewUrl = "";
let scanMetadata = {};
const element = (id) => {
    const found = document.getElementById(id);
    if (!found)
        throw new Error(`Prospects control is missing: ${id}`);
    return found;
};
const input = (id) => element(id);
const select = (id) => element(id);
function clean(value, limit = 500) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function label(value) {
    return clean(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
function normalizeEmail(value) {
    const email = clean(value, 320).toLowerCase();
    if (!email)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email address.");
    return email;
}
function normalizePhone(value) {
    let digits = clean(value, 40).replace(/\D/g, "");
    if (!digits)
        return null;
    if (digits.length === 10)
        digits = `1${digits}`;
    if (!/^[1-9][0-9]{7,14}$/.test(digits))
        throw new Error("Enter a valid phone number with area code.");
    return `+${digits}`;
}
function normalizeUrl(value) {
    const raw = clean(value, 500);
    if (!raw)
        return null;
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!["http:", "https:"].includes(url.protocol))
            throw new Error();
        return url.toString();
    }
    catch {
        throw new Error("Enter a valid website address.");
    }
}
function formatPhone(value) {
    const digits = clean(value).replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1")
        ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
        : clean(value) || "No phone";
}
function setPageStatus(message = "", tone = "") {
    const status = element("admin-status");
    status.textContent = message;
    status.className = `admin-status${tone ? ` ${tone}` : ""}`;
}
function setDialogStatus(message = "", tone = "") {
    const status = element("prospect-form-status");
    status.textContent = message;
    status.className = `prospect-form-status${tone ? ` is-${tone}` : ""}`;
}
function setScanStatus(message = "", tone = "") {
    const status = element("prospect-scan-status");
    status.textContent = message;
    status.className = `prospect-scan-status${tone ? ` is-${tone}` : ""}`;
}
function tagsFromInput() {
    return Array.from(new Set(input("prospect-interests").value.split(",").map((tag) => clean(tag, 80)).filter(Boolean))).slice(0, 20);
}
function displayName(contact) {
    return clean(contact.full_name) || [clean(contact.first_name), clean(contact.last_name)].filter(Boolean).join(" ") || clean(contact.company_name) || clean(contact.email) || formatPhone(contact.phone_e164);
}
function filteredContacts() {
    const query = input("prospect-search").value.trim().toLowerCase();
    const status = select("prospect-status-filter").value;
    const interest = select("prospect-interest-filter").value;
    return contacts.filter((contact) => {
        if (status !== "all" && contact.relationship_status !== status)
            return false;
        if (interest !== "all" && !(contact.interest_tags || []).includes(interest))
            return false;
        if (!query)
            return true;
        return [contact.full_name, contact.first_name, contact.last_name, contact.company_name, contact.job_title, contact.email, contact.phone_e164, contact.source_label, contact.notes, ...(contact.interest_tags || [])]
            .join(" ").toLowerCase().includes(query);
    });
}
function renderMetrics() {
    element("prospect-total").textContent = String(contacts.length);
    element("prospect-email-audience").textContent = String(contacts.filter((contact) => contact.email_marketing_status === "subscribed").length);
    element("prospect-sms-audience").textContent = String(contacts.filter((contact) => contact.sms_marketing_status === "subscribed").length);
    element("prospect-new-count").textContent = String(contacts.filter((contact) => contact.relationship_status === "new").length);
}
function renderInterestFilter() {
    const control = select("prospect-interest-filter");
    const selected = control.value || "all";
    const tags = Array.from(new Set(contacts.flatMap((contact) => Array.isArray(contact.interest_tags) ? contact.interest_tags : []))).sort();
    control.innerHTML = `<option value="all">All interests</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}`;
    control.value = tags.includes(selected) ? selected : "all";
}
function renderContacts() {
    const list = element("prospect-list");
    const rows = filteredContacts();
    list.innerHTML = rows.length ? rows.map((contact) => {
        const tags = (contact.interest_tags || []).slice(0, 4).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("");
        return `<button class="prospect-row" type="button" data-prospect-id="${escapeHtml(contact.id)}">
      <span><strong>${escapeHtml(displayName(contact))}</strong><small>${escapeHtml([contact.job_title, contact.company_name].filter(Boolean).join(" · ") || "Potential client")}</small>${tags ? `<span class="prospect-row-tags">${tags}</span>` : ""}</span>
      <span><strong>${escapeHtml(contact.email || "No email")}</strong><small>${escapeHtml(formatPhone(contact.phone_e164))}</small></span>
      <span><strong>${escapeHtml(label(contact.relationship_status))}</strong><small>${escapeHtml(contact.source_label || "Prospect")}</small></span>
      <span class="prospect-channel-stack"><i class="prospect-channel${contact.email_marketing_status === "subscribed" ? " is-on" : ""}">Email</i><i class="prospect-channel${contact.sms_marketing_status === "subscribed" ? " is-on" : ""}">Text</i></span>
    </button>`;
    }).join("") : '<div class="prospects-empty">No prospects match this view.</div>';
    setPageStatus(`${rows.length} prospect${rows.length === 1 ? "" : "s"}`);
}
function render() {
    renderMetrics();
    renderInterestFilter();
    renderContacts();
}
async function loadContacts() {
    setPageStatus("Loading prospects…");
    const { data, error } = await supabase.from("prospect_contacts").select("*").order("created_at", { ascending: false }).limit(5000);
    if (error)
        throw error;
    contacts = data || [];
    render();
}
function clearPreviewUrl() {
    if (pendingPreviewUrl.startsWith("blob:"))
        URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = "";
}
function showCardPreview(url = "") {
    clearPreviewUrl();
    pendingPreviewUrl = url;
    element("prospect-card-preview").innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Business card preview">` : "<span>Business card photo</span>";
}
function resetForm() {
    element("prospect-form").reset();
    input("prospect-id").value = "";
    input("prospect-source").value = "Business card";
    select("prospect-relationship").value = "new";
    select("prospect-email-status").value = "not_requested";
    select("prospect-sms-status").value = "not_requested";
    currentContact = null;
    pendingCardBlob = null;
    pendingCardDataUrl = "";
    scanMetadata = {};
    showCardPreview();
    element("prospect-card-analyze").disabled = true;
    element("prospect-delete").hidden = true;
    setScanStatus();
    setDialogStatus();
}
function populateForm(contact) {
    input("prospect-id").value = contact.id || "";
    input("prospect-full-name").value = contact.full_name || "";
    input("prospect-first-name").value = contact.first_name || "";
    input("prospect-last-name").value = contact.last_name || "";
    input("prospect-company").value = contact.company_name || "";
    input("prospect-job-title").value = contact.job_title || "";
    input("prospect-email").value = contact.email || "";
    input("prospect-phone").value = contact.phone_e164 || "";
    input("prospect-website").value = contact.website_url || "";
    input("prospect-address").value = contact.address_text || "";
    input("prospect-source").value = contact.source_label || "";
    input("prospect-interests").value = (contact.interest_tags || []).join(", ");
    element("prospect-notes").value = contact.notes || "";
    select("prospect-relationship").value = contact.relationship_status || "new";
    select("prospect-email-status").value = contact.email_marketing_status || "not_requested";
    select("prospect-sms-status").value = contact.sms_marketing_status || "not_requested";
    input("prospect-consent-notes").value = contact.consent_notes || "";
    scanMetadata = contact.scan_raw || {};
}
async function openDialog(contact = null, scanFirst = false) {
    resetForm();
    currentContact = contact;
    element("prospect-dialog-title").textContent = contact ? "Edit prospect" : scanFirst ? "Scan a business card" : "Add a prospect";
    element("prospect-delete").hidden = !contact;
    if (contact) {
        populateForm(contact);
        if (contact.card_image_path) {
            const { data } = await supabase.storage.from(BUCKET).createSignedUrl(contact.card_image_path, 600);
            showCardPreview(data?.signedUrl || "");
        }
    }
    element("prospect-dialog").showModal();
    if (scanFirst)
        input("prospect-card-input").click();
    else
        input("prospect-full-name").focus();
}
function closeDialog() {
    element("prospect-dialog").close();
    clearPreviewUrl();
}
async function imageElement(file) {
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
        image.src = url;
        await image.decode();
        return image;
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The photo could not be prepared.")), "image/jpeg", quality));
}
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
    throw new Error("The photo is still too large. Crop closer to the business card and try again.");
}
function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("The photo could not be read."));
        reader.readAsDataURL(blob);
    });
}
async function chooseCard(event) {
    const file = event.target.files?.[0];
    if (!file)
        return;
    setScanStatus("Preparing photo…");
    try {
        pendingCardBlob = await compressCard(file);
        pendingCardDataUrl = await blobDataUrl(pendingCardBlob);
        showCardPreview(URL.createObjectURL(pendingCardBlob));
        element("prospect-card-analyze").disabled = false;
        setScanStatus("Photo ready. Analyze it, then review every field.", "success");
    }
    catch (error) {
        pendingCardBlob = null;
        pendingCardDataUrl = "";
        setScanStatus(error instanceof Error ? error.message : "The photo could not be prepared.", "error");
    }
}
function applyScan(details) {
    input("prospect-full-name").value = details.fullName;
    input("prospect-first-name").value = details.firstName;
    input("prospect-last-name").value = details.lastName;
    input("prospect-company").value = details.companyName;
    input("prospect-job-title").value = details.jobTitle;
    input("prospect-email").value = details.email;
    input("prospect-phone").value = details.phoneE164;
    input("prospect-website").value = details.websiteUrl;
    input("prospect-address").value = details.addressText;
    input("prospect-interests").value = details.interestTags.join(", ");
    element("prospect-notes").value = details.notes;
}
async function analyzeCard() {
    if (!pendingCardDataUrl || !session?.access_token)
        return;
    const button = element("prospect-card-analyze");
    button.disabled = true;
    setScanStatus("Groq is reading the card…");
    try {
        const response = await fetch("/api/admin-prospect-card-scan", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ imageDataUrl: pendingCardDataUrl }),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || "The card could not be analyzed.");
        applyScan(payload.details);
        scanMetadata = { ...payload.details, provider: payload.provider, model: payload.model };
        setScanStatus(`Card analyzed${payload.details?.confidence ? ` · ${Math.round(payload.details.confidence * 100)}% confidence` : ""}. Review the fields before saving.`, "success");
    }
    catch (error) {
        setScanStatus(error instanceof Error ? error.message : "The card could not be analyzed.", "error");
    }
    finally {
        button.disabled = false;
    }
}
function consentTimestamp(status, currentValue) {
    if (status !== "subscribed")
        return currentValue ? String(currentValue) : null;
    return currentValue ? String(currentValue) : new Date().toISOString();
}
function formPayload() {
    const email = normalizeEmail(input("prospect-email").value);
    const phone = normalizePhone(input("prospect-phone").value);
    const emailStatus = select("prospect-email-status").value;
    const smsStatus = select("prospect-sms-status").value;
    const consentNotes = clean(input("prospect-consent-notes").value, 1000);
    if (emailStatus === "subscribed" && !email)
        throw new Error("Add an email before enabling email messages.");
    if (smsStatus === "subscribed" && !phone)
        throw new Error("Add a phone number before enabling text messages.");
    if ((emailStatus === "subscribed" || smsStatus === "subscribed") && !consentNotes)
        throw new Error("Record how permission was received before enabling messages.");
    const fullName = clean(input("prospect-full-name").value, 180);
    const companyName = clean(input("prospect-company").value, 220);
    if (!fullName && !companyName && !email && !phone)
        throw new Error("Add a name, company, email, or phone number.");
    const userId = session?.user?.id || null;
    return {
        full_name: fullName,
        first_name: clean(input("prospect-first-name").value, 100),
        last_name: clean(input("prospect-last-name").value, 100),
        job_title: clean(input("prospect-job-title").value, 180),
        company_name: companyName,
        email,
        phone_e164: phone,
        website_url: normalizeUrl(input("prospect-website").value),
        address_text: clean(input("prospect-address").value, 500),
        notes: clean(element("prospect-notes").value, 4000),
        interest_tags: tagsFromInput(),
        source_label: clean(input("prospect-source").value, 180) || "Business card",
        relationship_status: select("prospect-relationship").value,
        email_marketing_status: emailStatus,
        sms_marketing_status: smsStatus,
        email_consent_at: consentTimestamp(emailStatus, currentContact?.email_consent_at),
        sms_consent_at: consentTimestamp(smsStatus, currentContact?.sms_consent_at),
        consent_notes: consentNotes,
        scan_provider: scanMetadata.provider || currentContact?.scan_provider || null,
        scan_model: scanMetadata.model || currentContact?.scan_model || null,
        scan_confidence: scanMetadata.confidence ?? currentContact?.scan_confidence ?? null,
        scan_raw: scanMetadata,
        scanned_at: scanMetadata.provider ? new Date().toISOString() : currentContact?.scanned_at || null,
        updated_by_user_id: userId,
    };
}
async function uploadPendingCard() {
    if (!pendingCardBlob)
        return currentContact?.card_image_path || null;
    const path = `${crypto.randomUUID()}/${Date.now()}-business-card.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, pendingCardBlob, { contentType: "image/jpeg", upsert: false });
    if (error)
        throw error;
    return path;
}
async function saveProspect(event) {
    event.preventDefault();
    const button = element("prospect-save");
    button.disabled = true;
    setDialogStatus("Saving prospect…");
    let uploadedPath = null;
    try {
        const values = formPayload();
        uploadedPath = await uploadPendingCard();
        values.card_image_path = uploadedPath;
        let result;
        if (currentContact?.id) {
            result = await supabase.from("prospect_contacts").update(values).eq("id", currentContact.id).select("*").single();
        }
        else {
            values.created_by_user_id = session?.user?.id || null;
            result = await supabase.from("prospect_contacts").insert(values).select("*").single();
        }
        if (result.error)
            throw result.error;
        if (pendingCardBlob && currentContact?.card_image_path && currentContact.card_image_path !== uploadedPath) {
            await supabase.storage.from(BUCKET).remove([currentContact.card_image_path]);
        }
        setDialogStatus("Prospect saved.", "success");
        await loadContacts();
        window.setTimeout(closeDialog, 350);
    }
    catch (error) {
        if (uploadedPath && uploadedPath !== currentContact?.card_image_path)
            await supabase.storage.from(BUCKET).remove([uploadedPath]);
        const message = error instanceof Error ? error.message : String(error?.message || "The prospect could not be saved.");
        setDialogStatus(message.includes("duplicate key") ? "A prospect with that email already exists." : message, "error");
    }
    finally {
        button.disabled = false;
    }
}
async function deleteProspect() {
    if (!currentContact?.id)
        return;
    const confirmed = await confirmAdminAction("Permanently delete this prospect and saved business-card image?", { title: "Delete prospect", confirmLabel: "Delete prospect" });
    if (!confirmed)
        return;
    setDialogStatus("Deleting prospect…");
    const { error } = await supabase.from("prospect_contacts").delete().eq("id", currentContact.id);
    if (error)
        return setDialogStatus(error.message, "error");
    if (currentContact.card_image_path)
        await supabase.storage.from(BUCKET).remove([currentContact.card_image_path]);
    closeDialog();
    await loadContacts();
}
function bindEvents() {
    element("prospect-add").addEventListener("click", () => void openDialog());
    element("prospect-scan").addEventListener("click", () => void openDialog(null, true));
    input("prospect-card-input").addEventListener("change", (event) => void chooseCard(event));
    element("prospect-card-analyze").addEventListener("click", () => void analyzeCard());
    element("prospect-close").addEventListener("click", closeDialog);
    element("prospect-cancel").addEventListener("click", closeDialog);
    element("prospect-delete").addEventListener("click", () => void deleteProspect());
    element("prospect-form").addEventListener("submit", (event) => void saveProspect(event));
    input("prospect-search").addEventListener("input", renderContacts);
    select("prospect-status-filter").addEventListener("change", renderContacts);
    select("prospect-interest-filter").addEventListener("change", renderContacts);
    element("prospect-list").addEventListener("click", (event) => {
        const id = event.target.closest("[data-prospect-id]")?.dataset.prospectId;
        const contact = contacts.find((item) => item.id === id);
        if (contact)
            void openDialog(contact);
    });
    element("prospect-dialog").addEventListener("click", (event) => {
        if (event.target === element("prospect-dialog"))
            closeDialog();
    });
}
export async function startProspects(dependencies) {
    supabase = dependencies.supabase;
    session = dependencies.session;
    confirmAdminAction = dependencies.confirmAdminAction;
    contacts = [];
    bindEvents();
    await loadContacts();
}
