"use strict";
let activeCard = null;
const byId = (id) => {
    const value = document.getElementById(id);
    if (!value)
        throw new Error(`Missing card element: ${id}`);
    return value;
};
function text(value) {
    return String(value ?? "").trim();
}
function slugFromLocation() {
    const querySlug = new URLSearchParams(window.location.search).get("slug");
    if (querySlug)
        return text(querySlug).toLowerCase();
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] === "card" ? text(parts[1]).toLowerCase() : "";
}
function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "N3";
}
function formatPhone(value) {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1")
        ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
        : value;
}
function safeUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.toString() : "";
    }
    catch {
        return "";
    }
}
function serviceName(label, value) {
    const haystack = `${label} ${value}`.toLowerCase();
    if (haystack.includes("instagram"))
        return "instagram";
    if (haystack.includes("facebook") || haystack.includes("fb.com"))
        return "facebook";
    if (haystack.includes("linkedin"))
        return "linkedin";
    if (haystack.includes("twitter") || haystack.includes("x.com"))
        return "x";
    if (haystack.includes("tiktok"))
        return "tiktok";
    if (haystack.includes("youtube") || haystack.includes("youtu.be"))
        return "youtube";
    if (haystack.includes("github"))
        return "github";
    if (value.startsWith("mailto:"))
        return "email";
    if (value.startsWith("tel:"))
        return "phone";
    return "website";
}
function serviceIcon(label, value) {
    const service = serviceName(label, value);
    const icon = document.createElement("span");
    icon.className = `contact-card-link-icon is-${service}`;
    icon.setAttribute("aria-hidden", "true");
    const paths = {
        instagram: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.6" cy="6.5" r="1" class="fill"/></svg>',
        facebook: '<svg viewBox="0 0 24 24"><path class="fill" d="M13.8 21v-8h2.8l.4-3h-3.2V8.1c0-.9.3-1.6 1.7-1.6H17V3.8c-.3 0-1.2-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10H8v3h2.5v8h3.3Z"/></svg>',
        linkedin: '<svg viewBox="0 0 24 24"><rect class="fill" x="4" y="9" width="3.5" height="11"/><circle class="fill" cx="5.75" cy="5.75" r="2"/><path class="fill" d="M10 9h3.3v1.5h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.2 2.3 4.2 5.4v6h-3.5v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H10V9Z"/></svg>',
        x: '<svg viewBox="0 0 24 24"><path class="fill" d="M4 4h4.2l4.5 6.1L18 4h2l-6.4 7.5L20.6 21h-4.2l-4.9-6.6L5.9 21h-2l6.7-8L4 4Zm3.1 1.8 10.2 13.4h1.2L8.3 5.8H7.1Z"/></svg>',
        tiktok: '<svg viewBox="0 0 24 24"><path class="fill" d="M15 3c.3 2.1 1.5 3.5 3.7 4v3.1a8.2 8.2 0 0 1-3.7-1v6.2a5.8 5.8 0 1 1-5-5.7v3.2a2.7 2.7 0 1 0 1.8 2.5V3H15Z"/></svg>',
        youtube: '<svg viewBox="0 0 24 24"><rect class="fill" x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9 5 3-5 3Z" class="cut"/></svg>',
        github: '<svg viewBox="0 0 24 24"><path class="fill" d="M12 2.8a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.3-2.3-.3-4.7-1.1-4.7-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1a9.8 9.8 0 0 1 5.1 0c2-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.7 5 .4.3.7 1 .7 1.9v2.5c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.8Z"/></svg>',
        email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
        phone: '<svg viewBox="0 0 24 24"><path d="M7.2 3.8 10 8.6 7.8 11c1.1 2.3 2.9 4.1 5.2 5.2l2.4-2.2 4.8 2.8-.7 3c-.2.8-.9 1.3-1.7 1.3C9.6 20.8 3.2 14.4 3 6.2c0-.8.5-1.5 1.3-1.7l2.9-.7Z"/></svg>',
        website: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"/></svg>',
    };
    icon.innerHTML = paths[service] || paths.website || "";
    return icon;
}
function addLink(container, label, detail, url) {
    const href = safeUrl(url);
    if (!href)
        return;
    const link = document.createElement("a");
    link.className = "contact-card-link";
    link.href = href;
    if (href.startsWith("http")) {
        link.target = "_blank";
        link.rel = "noopener";
    }
    const icon = serviceIcon(label, href);
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = detail;
    copy.append(strong, small);
    const arrow = document.createElement("span");
    arrow.className = "contact-card-link-arrow";
    arrow.textContent = "›";
    arrow.setAttribute("aria-hidden", "true");
    link.append(icon, copy, arrow);
    container.append(link);
}
function vCard(card) {
    const escaped = (value) => value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${escaped(card.display_name)}`,
        card.company_name ? `ORG:${escaped(card.company_name)}` : "",
        card.headline ? `TITLE:${escaped(card.headline)}` : "",
        ...[card.email, ...(card.additional_emails || [])].filter(Boolean).map((email) => `EMAIL;TYPE=INTERNET:${email}`),
        ...[card.phone_e164, ...(card.additional_phones || [])].filter(Boolean).map((phone) => `TEL;TYPE=CELL:${phone}`),
        card.website_url ? `URL:${card.website_url}` : "",
        card.location_text ? `ADR;TYPE=WORK:;;;;;;${escaped(card.location_text)}` : "",
        `NOTE:${escaped(`Digital contact card: ${window.location.href}`)}`,
        "END:VCARD",
    ];
    return lines.filter(Boolean).join("\r\n");
}
function downloadContact(card) {
    const blob = new Blob([vCard(card)], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${card.slug}.vcf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render(card) {
    activeCard = card;
    document.documentElement.style.setProperty("--card-accent", card.accent_color || "#2f7d68");
    document.title = `${card.display_name} | Digital contact card`;
    byId("card-initials").textContent = initials(card.display_name);
    byId("card-company").textContent = card.company_name;
    byId("card-name").textContent = card.display_name;
    byId("card-headline").textContent = card.headline;
    byId("card-location").textContent = card.location_text;
    const mediaUrl = (type) => `/api/contact-card-media?slug=${encodeURIComponent(card.slug)}&type=${type}`;
    if (card.media?.profile) {
        const image = byId("card-profile-image");
        image.src = mediaUrl("profile");
        image.alt = card.display_name;
        image.hidden = false;
        byId("card-initials").hidden = true;
    }
    if (card.media?.logo) {
        const logo = byId("card-logo");
        logo.src = mediaUrl("logo");
        logo.alt = card.company_name ? `${card.company_name} logo` : "Company logo";
        logo.hidden = false;
    }
    if (card.media?.background) {
        const background = byId("card-background");
        background.src = mediaUrl("background");
        background.hidden = false;
    }
    const actions = byId("card-primary-actions");
    if (card.phone_e164) {
        const call = document.createElement("a");
        call.href = `tel:${card.phone_e164}`;
        call.textContent = "Call";
        actions.append(call);
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "is-primary";
    save.textContent = "Save contact";
    save.addEventListener("click", () => downloadContact(card));
    actions.append(save);
    if (!card.phone_e164)
        actions.style.gridTemplateColumns = "1fr";
    const connectButton = byId("card-connect-button");
    connectButton.hidden = card.exchange_enabled === false;
    if (card.bio) {
        byId("card-bio").textContent = card.bio;
        byId("card-about-section").hidden = false;
    }
    const contactLinks = byId("card-contact-links");
    if (card.email)
        addLink(contactLinks, text(card.email_label) || "Email", card.email, `mailto:${card.email}`);
    for (const [index, email] of (card.additional_emails || []).entries())
        addLink(contactLinks, text(card.additional_email_labels?.[index]) || "Email", email, `mailto:${email}`);
    if (card.phone_e164)
        addLink(contactLinks, text(card.phone_label) || "Phone", formatPhone(card.phone_e164), `tel:${card.phone_e164}`);
    for (const [index, phone] of (card.additional_phones || []).entries())
        addLink(contactLinks, text(card.additional_phone_labels?.[index]) || "Phone", formatPhone(phone), `tel:${phone}`);
    if (card.website_url)
        addLink(contactLinks, "Website", new URL(card.website_url).hostname.replace(/^www\./, ""), card.website_url);
    byId("card-contact-section").hidden = contactLinks.children.length === 0;
    const links = byId("card-links");
    for (const item of card.links || [])
        addLink(links, text(item.label), text(item.url).replace(/^https?:\/\//, ""), text(item.url));
    byId("card-custom-links-section").hidden = links.children.length === 0;
    const order = Array.isArray(card.section_order) ? card.section_order : ["about", "contact", "links"];
    for (const [index, key] of order.entries()) {
        const section = document.querySelector(`[data-card-section="${key}"]`);
        if (section)
            section.style.order = String(index);
    }
    byId("card-branding-footer").hidden = card.show_n3xra_branding === false;
    byId("card-loading").hidden = true;
    byId("contact-card").hidden = false;
}
function openConnectDialog() {
    if (!activeCard)
        return;
    const dialog = byId("card-connect-dialog");
    byId("card-connect-intro").textContent = `Share your contact information with ${activeCard.display_name}.`;
    byId("card-connect-disclosure").textContent = `Your details will be shared with ${activeCard.display_name} and stored in their private N3XRA Contacts.`;
    byId("card-connect-fields").hidden = false;
    byId("card-connect-success").hidden = true;
    byId("card-connect-status").textContent = "";
    const footer = dialog.querySelector("footer");
    if (footer)
        footer.hidden = false;
    dialog.showModal();
    window.setTimeout(() => dialog.querySelector('input[name="name"]')?.focus(), 50);
}
function closeConnectDialog() {
    byId("card-connect-dialog").close();
}
async function submitConnection(event) {
    event.preventDefault();
    if (!activeCard)
        return;
    const form = event.currentTarget;
    const submit = byId("card-connect-submit");
    const status = byId("card-connect-status");
    const values = new FormData(form);
    submit.disabled = true;
    status.textContent = "Sharing…";
    status.className = "contact-card-connect-status";
    try {
        const response = await fetch("/api/contact-card-connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slug: activeCard.slug,
                name: values.get("name"),
                email: values.get("email"),
                phone: values.get("phone"),
                company: values.get("company"),
                message: values.get("message"),
                website: values.get("website"),
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(payload.error || "Your information could not be shared.");
        form.reset();
        byId("card-connect-fields").hidden = true;
        byId("card-connect-success").hidden = false;
        const footer = byId("card-connect-dialog").querySelector("footer");
        if (footer)
            footer.hidden = true;
        window.setTimeout(closeConnectDialog, 2200);
    }
    catch (error) {
        status.textContent = error instanceof Error ? error.message : "Your information could not be shared.";
        status.className = "contact-card-connect-status is-error";
    }
    finally {
        submit.disabled = false;
    }
}
byId("card-connect-button").addEventListener("click", openConnectDialog);
byId("card-connect-close").addEventListener("click", closeConnectDialog);
byId("card-connect-cancel").addEventListener("click", closeConnectDialog);
byId("card-connect-form").addEventListener("submit", (event) => void submitConnection(event));
byId("card-connect-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget)
        closeConnectDialog();
});
async function initialize() {
    const slug = slugFromLocation();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error("This card address is not valid.");
    const response = await fetch(`/api/contact-card?slug=${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.card)
        throw new Error(body.error || "This digital card is not published right now.");
    render(body.card);
}
void initialize().catch((error) => {
    byId("card-loading").hidden = true;
    byId("card-error-message").textContent = error instanceof Error ? error.message : "This digital card is not available.";
    byId("card-error").hidden = false;
});
