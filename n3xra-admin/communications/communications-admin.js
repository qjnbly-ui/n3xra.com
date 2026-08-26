import { getAdminSession } from "/account/admin/admin-session.js";
const root = document.querySelector("#communications-admin-root");
const statusLayer = document.querySelector("#communications-admin-status");
const section = (root?.dataset.section || "overview");
const sections = [
    { key: "overview", label: "Overview", href: "/n3xra-admin/communications/", group: "workspace" },
    { key: "websites-forms", label: "Websites & forms", href: "/n3xra-admin/communications/websites-forms/", group: "workspace" },
    { key: "subscribers", label: "Subscribers", href: "/n3xra-admin/communications/subscribers/", group: "workspace" },
    { key: "topics-signup", label: "Topics & signup", href: "/n3xra-admin/communications/topics-signup/", group: "workspace" },
    { key: "activity-usage", label: "Activity & usage", href: "/n3xra-admin/communications/activity-usage/", group: "workspace" },
    { key: "email-readiness", label: "Email readiness", href: "/n3xra-admin/communications/email-readiness/", group: "readiness" },
    { key: "texting-readiness", label: "Texting readiness", href: "/n3xra-admin/communications/texting-readiness/", group: "readiness" },
    { key: "pricing-activation", label: "Pricing & activation", href: "/n3xra-admin/communications/pricing-activation/", group: "readiness" },
];
const pageDetails = {
    overview: { title: "Overview", description: "Workspace configuration, connected websites, channel readiness, and current usage." },
    "websites-forms": { title: "Websites & Forms", description: "Connected websites, subscription forms, fields, actions, and verified signup sources." },
    subscribers: { title: "Subscribers", description: "Read-only subscriber directory with channel consent and topic preferences." },
    "topics-signup": { title: "Topics & Signup", description: "Topics, keywords, hosted signup links, and QR attribution sources." },
    "activity-usage": { title: "Activity & Usage", description: "Consent history, message events, form processing, queue state, and measured usage." },
    "email-readiness": { title: "Email Readiness", description: "Resend sending-domain and email-channel readiness without exposing provider credentials." },
    "texting-readiness": { title: "Texting Readiness", description: "Twilio number and carrier-registration readiness without provider activation controls." },
    "pricing-activation": { title: "Pricing & Activation", description: "Entitlement, workspace status, included usage, overages, and channel activation state." },
    requests: { title: "Requests", description: "Read-only review queue for Communications and number requests." },
};
const displayLabels = {
    call_external_webhook: "Call external webhook",
    mms: "MMS",
    notify_organization: "Notify organization",
    qr_campaign: "QR campaign",
    queue_autoresponder: "Queue automatic reply",
    record_consent: "Record consent",
    resend: "Resend",
    save_submission: "Save submission",
    save_topics: "Save topic preferences",
    sms: "SMS",
    sms_keyword: "SMS keyword",
    subscribe_email: "Subscribe to email",
    subscribe_sms: "Subscribe to text messages",
    twilio: "Twilio",
    upsert_communications_subscriber: "Add or update subscriber",
    website_embed: "Website embed",
};
let adminContext;
let indexPayload;
let selectedWorkspaceId = "";
let emailProviderPayload = null;
function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function label(value, fallback = "Not configured") {
    const text = String(value || "").trim();
    if (!text)
        return fallback;
    const normalized = text.toLowerCase();
    return displayLabels[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
function formatDate(value) {
    if (!value)
        return "Not recorded";
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function formatMoney(cents) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}
function safeUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    }
    catch {
        return "";
    }
}
function badge(value, tone = "neutral") {
    return `<span class="communications-admin-badge is-${tone}">${escapeHtml(label(value))}</span>`;
}
function empty(message) {
    return `<div class="communications-admin-empty"><strong>No records</strong><p>${escapeHtml(message)}</p></div>`;
}
function fact(labelText, value) {
    const displayedValue = value === null || value === undefined || value === "" ? "Not configured" : value;
    return `<div class="communications-admin-fact"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(displayedValue)}</strong></div>`;
}
function card(title, copy, body, extraClass = "") {
    const emptyClass = body.includes("communications-admin-empty") ? " is-empty" : "";
    return `<section class="communications-admin-card${emptyClass}${extraClass ? ` ${extraClass}` : ""}"><header><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></header>${body}</section>`;
}
async function api(scope, workspaceId = "") {
    const token = adminContext.session?.access_token;
    if (!token)
        throw new Error("Your administrator session is unavailable.");
    const params = new URLSearchParams({ scope });
    if (workspaceId)
        params.set("workspaceId", workspaceId);
    const response = await fetch(`/api/communications-admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || "Communications Admin could not be loaded.");
    return payload;
}
async function mutate(operation, values) {
    const token = adminContext.session?.access_token;
    if (!token)
        throw new Error("Your administrator session is unavailable.");
    const response = await fetch("/api/communications-admin-mutations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ operation, idempotencyKey: crypto.randomUUID(), ...values }),
    });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || "Communications Admin could not save those changes.");
    return payload;
}
async function emailApi(operation = "", values = {}) {
    const token = adminContext.session?.access_token;
    if (!token)
        throw new Error("Your administrator session is unavailable.");
    const isMutation = Boolean(operation);
    const response = await fetch(isMutation
        ? "/api/communications-admin-email"
        : `/api/communications-admin-email?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`, {
        method: isMutation ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            ...(isMutation ? { "Content-Type": "application/json" } : {}),
        },
        ...(isMutation ? { body: JSON.stringify({ operation, idempotencyKey: crypto.randomUUID(), workspaceId: selectedWorkspaceId, ...values }) } : {}),
        cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || "Communications email setup could not complete that action.");
    return payload;
}
function option(value, text, selected = false) {
    return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(text)}</option>`;
}
function field(name, title, value, type = "text", attributes = "") {
    return `<label><span>${escapeHtml(title)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${attributes}></label>`;
}
function selectField(name, title, options) {
    return `<label><span>${escapeHtml(title)}</span><select name="${escapeHtml(name)}">${options}</select></label>`;
}
function textareaField(name, title, value, attributes = "") {
    return `<label class="communications-admin-field-wide"><span>${escapeHtml(title)}</span><textarea name="${escapeHtml(name)}" ${attributes}>${escapeHtml(value)}</textarea></label>`;
}
function checkField(name, title, checked) {
    return `<label class="communications-admin-check"><input name="${escapeHtml(name)}" type="checkbox"${checked ? " checked" : ""}><span>${escapeHtml(title)}</span></label>`;
}
function formShell(id, body, buttonText) {
    return `<form class="communications-admin-form" id="${escapeHtml(id)}">${body}<div class="communications-admin-form-footer"><p class="communications-admin-form-status" role="status" aria-live="polite"></p><button class="portal-button" type="submit">${escapeHtml(buttonText)}</button></div></form>`;
}
function workspaceStorageKey() {
    return `n3xra-communications-admin-workspace:${adminContext.user?.id || "admin"}`;
}
function selectWorkspace(workspaces) {
    if (section === "overview" && new URLSearchParams(window.location.search).get("new") === "1")
        return "";
    const requested = String(new URLSearchParams(window.location.search).get("workspace") || "").trim();
    if (workspaces.some((workspace) => workspace.id === requested))
        return requested;
    const stored = sessionStorage.getItem(workspaceStorageKey()) || "";
    return workspaces.some((workspace) => workspace.id === stored) ? stored : workspaces[0]?.id || "";
}
function readiness(data, channelName) {
    const channel = data.channels.find((row) => row.channel === channelName);
    if (channelName === "email") {
        const domain = data.sending_domains[0];
        if (!domain)
            return { label: "Not configured", tone: "neutral", detail: "No sending domain is connected." };
        if (domain.status === "verified" && channel?.status === "active")
            return { label: "Ready", tone: "ready", detail: `${domain.domain} is verified and the email channel is active.` };
        if (["pending", "pending_verification"].includes(domain.status) || channel?.status === "pending_verification")
            return { label: "Pending verification", tone: "pending", detail: `${domain.domain} is awaiting provider verification.` };
        return { label: label(channel?.status || domain.status), tone: "pending", detail: `Domain status: ${label(domain.status)}.` };
    }
    const number = data.numbers[0];
    if (!number)
        return { label: "Not configured", tone: "neutral", detail: "No Communications number is assigned." };
    if (number.carrier_registration_status !== "approved" && number.carrier_registration_status !== "registered") {
        return { label: "Pending carrier registration", tone: "pending", detail: `${number.phone_e164} is ${label(number.carrier_registration_status).toLowerCase()}.` };
    }
    if (number.status === "active" && number.texting_activated_at && channel?.status === "active")
        return { label: "Ready", tone: "ready", detail: `${number.phone_e164} is registered and active.` };
    return { label: label(channel?.status || number.status), tone: "pending", detail: `${number.phone_e164} is not activated for sending.` };
}
function renderContext(workspaces) {
    const panel = root?.querySelector("#communications-admin-context");
    if (!panel)
        return;
    const current = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null;
    const workspaceOptions = `${option("__new__", "Create new workspace…", !selectedWorkspaceId)}`
        + (workspaces.length
            ? workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}"${workspace.id === selectedWorkspaceId ? " selected" : ""}>${escapeHtml(workspace.organization?.name || workspace.sender_name)} — ${escapeHtml(workspace.program_name)}</option>`).join("")
            : '<option value="" disabled>No Communications workspaces yet</option>');
    const navigation = (group) => sections.filter((item) => item.group === group).map((item) => `<a class="${item.key === section ? "is-current" : ""}" href="${item.href}">${escapeHtml(item.label)}</a>`).join("");
    panel.innerHTML = `
    <div class="communications-admin-context-head">
      <p class="portal-kicker">Organization workspace</p>
      <label>Working with<select id="communications-workspace-select">${workspaceOptions}</select></label>
    </div>
    ${current ? `<section class="communications-admin-context-card"><span>${escapeHtml(label(current.status))}</span><strong>${escapeHtml(current.organization?.name || current.sender_name)}</strong><small>${escapeHtml(current.program_name)}</small></section>` : ""}
    <nav class="communications-admin-context-nav" aria-label="Selected Communications workspace sections">
      <p>Workspace</p>${navigation("workspace")}
      <p>Readiness & activation</p>${navigation("readiness")}
    </nav>
    <div class="communications-admin-context-footer"><a href="/n3xra-admin/communications/?new=1">Create new workspace</a><span>${indexPayload.request_summary.submitted} submitted request${indexPayload.request_summary.submitted === 1 ? "" : "s"}</span><a class="${section === "requests" ? "is-current" : ""}" href="/n3xra-admin/communications/requests/">Open requests</a></div>
  `;
    panel.querySelector("#communications-workspace-select")?.addEventListener("change", (event) => {
        const value = event.currentTarget.value;
        if (value === "__new__") {
            window.location.href = "/n3xra-admin/communications/?new=1";
            return;
        }
        if (!value)
            return;
        sessionStorage.setItem(workspaceStorageKey(), value);
        selectedWorkspaceId = value;
        void loadCurrentSection();
    });
}
function renderPagebar() {
    const details = pageDetails[section];
    const pagebar = root?.querySelector("#communications-admin-pagebar");
    if (!pagebar)
        return;
    pagebar.innerHTML = `<div><p class="portal-kicker">Communications</p><h1>${escapeHtml(details.title)}</h1><p>${escapeHtml(details.description)}</p></div><div class="communications-admin-page-actions">${badge("Secure admin controls", "ready")}<button class="portal-button portal-button-secondary" id="communications-admin-refresh" type="button">Refresh</button></div>`;
    pagebar.querySelector("#communications-admin-refresh")?.addEventListener("click", () => void loadCurrentSection());
}
function renderWorkspaceForm(data) {
    const workspace = data?.workspace || {};
    const organizationId = workspace.organization_id || "";
    const entitlement = data?.entitlement || {};
    const organizationOptions = option("", "Choose an organization", !organizationId) + indexPayload.organizations.map((organization) => option(organization.id, `${organization.name} — ${label(organization.account_status)}`, organization.id === organizationId)).join("");
    const websiteOptions = [option("", "No website link")].concat(indexPayload.websites
        .filter((website) => website.organization_id === organizationId)
        .map((website) => option(website.id, website.name, data?.website_links.some((link) => link.website_id === website.id))))
        .join("");
    const body = `
    <input name="workspaceId" type="hidden" value="${escapeHtml(workspace.id || "")}">
    ${selectField("organizationId", "Organization", organizationOptions)}
    ${selectField("websiteId", "Connected website", websiteOptions)}
    ${field("slug", "Workspace slug", workspace.slug || "", "text", "required pattern=\"[a-z0-9]+(?:-[a-z0-9]+)*\" maxlength=\"80\"")}
    ${field("programName", "Program name", workspace.program_name || "", "text", "required maxlength=\"120\"")}
    ${field("senderName", "Sender name", workspace.sender_name || "", "text", "required maxlength=\"120\"")}
    ${field("supportEmail", "Support email", workspace.support_email || "", "email", "required maxlength=\"320\"")}
    ${field("supportPhone", "Support phone (E.164)", workspace.support_phone || "", "tel", "placeholder=\"+15415550138\"")}
    ${field("websiteUrl", "Website URL", workspace.website_url || "", "url", "required")}
    ${field("privacyPolicyUrl", "Privacy policy URL", workspace.privacy_policy_url || "", "url", "required")}
    ${field("programTermsUrl", "Program terms URL", workspace.program_terms_url || "", "url", "required")}
    ${textareaField("expectedMessageFrequency", "Expected message frequency", workspace.expected_message_frequency || "Message frequency varies.", "required maxlength=\"240\"")}
    ${selectField("workspaceStatus", "Workspace status", ["setup", "carrier_pending", "paused", "canceled"].map((value) => option(value, label(value), value === (workspace.status || "setup"))).join(""))}
    ${selectField("entitlementStatus", "Entitlement status", ["trialing", "active", "paused", "canceled"].map((value) => option(value, label(value), value === (entitlement.status || "trialing"))).join(""))}
    ${field("includedSmsSegments", "Included SMS segments", workspace.included_sms_segments ?? 500, "number", "required min=\"0\" step=\"1\"")}
    ${field("smsOverageCents", "SMS overage (cents)", workspace.sms_overage_cents ?? 3, "number", "required min=\"0\" step=\"1\"")}
    ${field("mmsUnitCents", "MMS unit price (cents)", workspace.mms_unit_cents ?? 8, "number", "required min=\"0\" step=\"1\"")}
    ${checkField("portalEnabled", "Enable the customer portal entitlement", Boolean(entitlement.portal_enabled))}
  `;
    return card(data ? "Workspace configuration" : "Create Communications workspace", data
        ? "Update this workspace's identity, website link, entitlement, and stored pricing. Provider activation is handled separately."
        : "Choose the customer organization and enter its program details. This creates only N3XRA records; it does not contact Resend or Twilio.", formShell("communications-workspace-form", body, data ? "Save workspace" : "Create workspace"), "full-width");
}
function renderOverview(data) {
    const metrics = data.metrics || {};
    const email = readiness(data, "email");
    const sms = readiness(data, "sms");
    const activeForm = data.forms.some((form) => form.status === "active");
    const activeTopics = data.topics.filter((topic) => topic.active).length;
    const carrierOnboardingStatus = data.carrier_onboarding?.status || "not_started";
    const setupGuide = `
    <article class="communications-admin-list-row"><div><strong>1. Workspace identity</strong><small>Organization, public sender details, website, privacy policy, and terms.</small></div>${badge("Saved", "ready")}</article>
    <article class="communications-admin-list-row"><div><a href="/n3xra-admin/communications/websites-forms/"><strong>2. Website signup form</strong></a><small>Choose the website, write the exact email consent language, and publish the form.</small></div>${badge(activeForm ? "Ready" : "Needs setup", activeForm ? "ready" : "pending")}</article>
    <article class="communications-admin-list-row"><div><a href="/n3xra-admin/communications/topics-signup/"><strong>3. Topics and signup link</strong></a><small>Create the choices subscribers see, then open the hosted signup page yourself.</small></div>${badge(activeTopics ? `${activeTopics} active` : "Needs setup", activeTopics ? "ready" : "pending")}</article>
    <article class="communications-admin-list-row"><div><a href="/n3xra-admin/communications/email-readiness/"><strong>4. Email domain and activation</strong></a><small>Add the domain, install its DNS records, activate email, and send one controlled test.</small></div>${badge(email.label, email.tone)}</article>
    <article class="communications-admin-list-row"><div><a href="/n3xra-admin/communications/texting-readiness/"><strong>5. Twilio onboarding</strong></a><small>Review the client's private business, consent, and campaign details before provider submission.</small></div>${badge(carrierOnboardingStatus, carrierOnboardingStatus === "submitted" ? "pending" : ["approved", "active"].includes(carrierOnboardingStatus) ? "ready" : "neutral")}</article>`;
    return `
    <section class="communications-admin-summary">
      <div><p class="portal-kicker">${escapeHtml(label(data.workspace.status))} workspace</p><h2>${escapeHtml(data.organization?.name || data.workspace.sender_name)}</h2><p>${escapeHtml(data.workspace.program_name)} · ${escapeHtml(data.workspace.slug)}</p></div>
      <div class="communications-admin-summary-badges">${badge(`Email: ${email.label}`, email.tone)}${badge(`Texting: ${sms.label}`, sms.tone)}</div>
    </section>
    <section class="communications-admin-metrics">
      ${fact("Subscribers", Number(metrics.total_subscribers || 0).toLocaleString())}
      ${fact("Email consent", Number(metrics.email_subscribers || 0).toLocaleString())}
      ${fact("Text consent", Number(metrics.sms_subscribers || 0).toLocaleString())}
      ${fact("Connected websites", data.websites.length)}
      ${fact("Active topics", Number(metrics.active_topics || 0))}
      ${fact("SMS segments this month", Number(metrics.sms_segments_current_month || 0).toLocaleString())}
    </section>
    <div class="communications-admin-grid two-column">
      ${card("Email readiness", email.detail, `<div class="communications-admin-readiness">${badge(email.label, email.tone)}${fact("Sending domains", data.sending_domains.length)}${fact("Email channel", label(data.channels.find((row) => row.channel === "email")?.status))}</div>`)}
      ${card("Texting readiness", sms.detail, `<div class="communications-admin-readiness">${badge(sms.label, sms.tone)}${fact("Assigned numbers", data.numbers.length)}${fact("Text channel", label(data.channels.find((row) => row.channel === "sms")?.status))}</div>`)}
    </div>
    ${card("Guided setup", "Work from top to bottom. You enter and approve every customer-facing detail; N3XRA reports what is ready.", setupGuide)}
    ${card("Workspace identity", "The public program identity and support details currently stored for this workspace.", `<div class="communications-admin-facts-grid">${fact("Sender", data.workspace.sender_name)}${fact("Program", data.workspace.program_name)}${fact("Website", data.workspace.website_url)}${fact("Support email", data.workspace.support_email)}${fact("Message frequency", data.workspace.expected_message_frequency)}${fact("Updated", formatDate(data.workspace.updated_at))}</div>`)}
    <div class="communications-admin-grid">${renderWorkspaceForm(data)}</div>
  `;
}
function renderWebsitesForms(data) {
    const linksByWebsite = new Map(data.website_links.map((row) => [row.website_id, row]));
    const websites = data.websites.length ? data.websites.map((website) => {
        const link = linksByWebsite.get(website.id);
        const liveUrl = safeUrl(website.live_url);
        return `<article class="communications-admin-list-row"><div><strong>${escapeHtml(website.name)}</strong><small>${escapeHtml(liveUrl || "No live URL")}</small></div><div>${badge(link?.status || website.status, link?.status === "active" ? "ready" : "neutral")}</div></article>`;
    }).join("") : empty("No websites are connected to this Communications workspace.");
    const forms = data.forms.length ? data.forms.map((form) => {
        const fields = data.form_fields.filter((field) => field.form_id === form.id);
        const actions = data.form_actions.filter((action) => action.form_id === form.id);
        const sources = data.signup_sources.filter((source) => source.form_id === form.id);
        return `<article class="communications-admin-detail-row"><header><div><strong>${escapeHtml(form.name)}</strong><small>${escapeHtml(label(form.form_type))} · ${escapeHtml(form.public_id)}</small></div>${badge(form.status, form.status === "active" ? "ready" : "neutral")}</header><div class="communications-admin-facts-grid">${fact("Website", data.websites.find((website) => website.id === form.website_id)?.name)}${fact("Allowed origins", (form.allowed_origins || []).join(", ") || "None")}${fact("Fields", fields.length)}${fact("Actions", actions.map((action) => label(action.action_type)).join(", ") || "None")}${fact("Verified sources", sources.filter((source) => source.status === "active").length)}${fact("Success message", form.success_message)}</div><div class="communications-admin-chip-list">${fields.map((field) => `<span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>`).join("")}</div></article>`;
    }).join("") : empty("No website forms are connected to this workspace.");
    const form = data.forms[0] || {};
    const consent = form.active_consent_configuration || {};
    const websiteOptions = data.websites.map((website) => option(website.id, website.name, website.id === form.website_id)).join("");
    const formOptions = option("", "Create a new subscription form", !form.id)
        + data.forms.map((candidate) => option(candidate.id, candidate.name, candidate.id === form.id)).join("");
    const control = data.websites.length ? formShell("communications-subscription-form", `
    ${selectField("formId", "Form to configure", formOptions)}
    ${selectField("websiteId", "Connected website", websiteOptions)}
    ${field("name", "Form name", form.name || "Website signup", "text", "required maxlength=\"120\"")}
    ${selectField("status", "Form status", ["draft", "active", "paused", "archived"].map((value) => option(value, label(value), value === (form.status || "draft"))).join(""))}
    ${textareaField("successMessage", "Success message", form.success_message || "Thank you. Please check your inbox to confirm your subscription.", "required maxlength=\"500\"")}
    ${textareaField("allowedOrigins", "Allowed website origins (one per line)", (form.allowed_origins || []).join("\n") || data.websites.map((website) => safeUrl(website.live_url)).filter(Boolean).map((value) => new URL(value).origin).join("\n"), "required")}
    ${checkField("emailEnabled", "Collect email subscriptions", Boolean(consent.email) || !form.id)}
    ${checkField("smsEnabled", "Collect text-message subscriptions", Boolean(consent.sms))}
    ${field("emailVersion", "Email consent version", consent.email?.version || "email-v1", "text", "required")}
    ${field("emailCheckboxLabel", "Email checkbox label", consent.email?.checkbox_label || "Send me email updates", "text", "required")}
    ${textareaField("emailDisclosure", "Email consent disclosure", consent.email?.disclosure || "I agree to receive email updates and understand that I can unsubscribe at any time.", "required")}
    ${field("smsVersion", "Text consent version", consent.sms?.version || "sms-v1")}
    ${field("smsCheckboxLabel", "Text checkbox label", consent.sms?.checkbox_label || "Send me text updates")}
    ${textareaField("smsDisclosure", "Text consent disclosure", consent.sms?.disclosure || "I agree to receive recurring automated text messages. Message and data rates may apply. Reply STOP to opt out.")}
  `, form.id ? "Save form" : "Create form") : empty("Connect a website from Overview before creating a subscription form.");
    return `<div class="communications-admin-grid two-column">${card("Connected websites", "Website links established for this organization-owned workspace.", websites)}${card("Subscription forms", "Form definitions, standard subscriber actions, and signup sources.", forms)}${card("Form configuration", "Creates or updates a universal subscription form without changing the website's design.", control, "full-width")}</div>`;
}
function renderSubscribers(data) {
    const topicNames = new Map(data.topics.map((topic) => [topic.id, topic.name]));
    const topicsBySubscriber = new Map();
    data.subscriber_topics.forEach((choice) => {
        const current = topicsBySubscriber.get(choice.subscriber_id) || [];
        const topicName = topicNames.get(choice.topic_id);
        if (topicName)
            topicsBySubscriber.set(choice.subscriber_id, [...current, topicName]);
    });
    const rows = data.subscribers.length ? data.subscribers.map((subscriber) => `<tr><td><strong>${escapeHtml(subscriber.full_name || subscriber.email || subscriber.phone_e164 || "Subscriber")}</strong><small>${escapeHtml([subscriber.email, subscriber.phone_e164].filter(Boolean).join(" · "))}</small></td><td>${badge(subscriber.email_status, subscriber.email_status === "subscribed" ? "ready" : "neutral")}</td><td>${badge(subscriber.sms_status, subscriber.sms_status === "subscribed" ? "ready" : "neutral")}</td><td>${escapeHtml((topicsBySubscriber.get(subscriber.id) || []).join(", ") || "All updates")}</td><td>${escapeHtml(formatDate(subscriber.joined_at))}</td></tr>`).join("") : `<tr><td colspan="5">No subscribers have joined this workspace.</td></tr>`;
    return card("Subscriber directory", `${data.subscribers.length} subscriber records returned. Consent changes remain unavailable until secure mutation operations are introduced.`, `<div class="communications-admin-table-wrap"><table><thead><tr><th>Subscriber</th><th>Email</th><th>Text</th><th>Topics</th><th>Joined</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
function renderTopicsSignup(data) {
    const counts = new Map(data.topic_metrics.map((metric) => [metric.topic_id, metric.subscriber_count]));
    const topics = data.topics.length ? data.topics.map((topic) => `<article class="communications-admin-list-row"><div><strong>${escapeHtml(topic.name)}</strong><small>${escapeHtml(topic.description || topic.slug)}</small></div><div>${badge(topic.active ? "Active" : "Inactive", topic.active ? "ready" : "neutral")}<small>${escapeHtml(counts.get(topic.id) || 0)} subscribers</small></div></article>`).join("") : empty("No topics are configured.");
    const sources = data.signup_sources.length ? data.signup_sources.map((source) => `<article class="communications-admin-list-row"><div><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(label(source.source_type))} · ${escapeHtml(source.slug)}</small></div>${badge(source.status, source.status === "active" ? "ready" : "neutral")}</article>`).join("") : empty("No verified signup sources are configured.");
    const keywords = data.keywords.length ? data.keywords.map((keyword) => `<article class="communications-admin-list-row"><div><strong>${escapeHtml(keyword.keyword)}</strong><small>${escapeHtml(keyword.welcome_message || "No welcome message")}</small></div>${badge(keyword.active ? "Active" : "Inactive", keyword.active ? "ready" : "neutral")}</article>`).join("") : empty("No text-to-join keywords are configured.");
    const topic = data.topics[0] || {};
    const topicOptions = option("", "Create a new topic", !topic.id)
        + data.topics.map((candidate) => option(candidate.id, candidate.name, candidate.id === topic.id)).join("");
    const control = formShell("communications-topic-form", `
    ${selectField("topicId", "Topic to configure", topicOptions)}
    ${field("name", "Topic name", topic.name || "", "text", "required maxlength=\"120\"")}
    ${field("slug", "Topic slug", topic.slug || "", "text", "required pattern=\"[a-z0-9]+(?:-[a-z0-9]+)*\" maxlength=\"80\"")}
    ${field("sortOrder", "Display order", topic.sort_order ?? 100, "number", "required min=\"0\" max=\"10000\" step=\"1\"")}
    ${textareaField("description", "Description", topic.description || "", "maxlength=\"500\"")}
    ${checkField("active", "Topic is available to subscribers", topic.id ? Boolean(topic.active) : true)}
  `, topic.id ? "Save topic" : "Create topic");
    return `<div class="communications-admin-grid two-column">${card("Topics", "Subscriber preference categories and current counts.", topics)}${card("Signup sources", "Hosted, embedded, and QR attribution sources.", sources)}${card("Topic configuration", "Create or revise subscriber-facing preference categories.", control, "full-width")}${card("Keywords", "Text-to-join keywords remain read-only until Twilio operations exist.", keywords, "full-width")}</div>`;
}
function renderActivityUsage(data) {
    const metrics = data.metrics || {};
    const messages = data.message_events.length ? data.message_events.map((event) => `<tr><td>${escapeHtml(formatDate(event.occurred_at))}</td><td>${escapeHtml(label(event.channel))}</td><td>${escapeHtml(label(event.direction))}</td><td>${badge(event.status, event.status === "delivered" ? "ready" : "neutral")}</td><td>${escapeHtml(event.body_preview || "No preview")}</td><td>${escapeHtml(event.billable_units || 0)}</td></tr>`).join("") : `<tr><td colspan="6">No message events have been recorded.</td></tr>`;
    const queue = data.queue.length ? data.queue.map((item) => `<tr><td>${escapeHtml(formatDate(item.created_at))}</td><td>${badge(item.status, item.status === "completed" ? "ready" : item.status === "failed" ? "error" : "pending")}</td><td>${escapeHtml(item.attempts || 0)}</td><td>${escapeHtml(item.last_error || "None")}</td></tr>`).join("") : `<tr><td colspan="4">No form actions are queued.</td></tr>`;
    const audit = data.admin_audit.length ? data.admin_audit.map((event) => `<tr><td>${escapeHtml(formatDate(event.created_at))}</td><td>${escapeHtml(label(event.action))}</td><td>${escapeHtml(label(event.entity_type))}</td><td>${escapeHtml(event.actor_user_id || "System")}</td></tr>`).join("") : `<tr><td colspan="4">No administrative changes have been recorded.</td></tr>`;
    return `<section class="communications-admin-metrics">${fact("Consent events", Number(metrics.consent_events || data.consent_events.length))}${fact("Message events", Number(metrics.message_events || data.message_events.length))}${fact("Form submissions", data.submissions.length)}${fact("Queued actions", data.queue.length)}${fact("SMS segments", Number(metrics.sms_segments_current_month || 0))}${fact("Included segments", Number(data.workspace.included_sms_segments || 0))}</section><div class="communications-admin-grid">${card("Administrative audit", "Immutable records created by trusted Communications Admin operations.", `<div class="communications-admin-table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Record</th><th>Administrator</th></tr></thead><tbody>${audit}</tbody></table></div>`)}${card("Message activity", "Delivery and inbound/outbound event records. No composer or send controls are present.", `<div class="communications-admin-table-wrap"><table><thead><tr><th>Time</th><th>Channel</th><th>Direction</th><th>Status</th><th>Preview</th><th>Units</th></tr></thead><tbody>${messages}</tbody></table></div>`)}${card("Form action queue", "Read-only processing state for universal form actions.", `<div class="communications-admin-table-wrap"><table><thead><tr><th>Created</th><th>Status</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>${queue}</tbody></table></div>`)}</div>`;
}
function renderEmailReadiness(data) {
    const state = readiness(data, "email");
    const provider = emailProviderPayload;
    const channelStatus = data.channels.find((row) => row.channel === "email")?.status;
    const configured = Boolean(provider?.configured);
    const verified = provider?.providerStatus === "verified";
    const active = verified && channelStatus === "active" && data.workspace.status === "active";
    const records = provider?.records || [];
    const dnsRows = records.length ? records.map((record) => `<tr><td><strong>${escapeHtml(record.record || "DNS")}</strong><small>${escapeHtml(record.type || "")}</small></td><td><code>${escapeHtml(record.name || "")}</code></td><td><code>${escapeHtml(record.value || "")}</code>${record.priority === null || record.priority === undefined ? "" : `<small>Priority ${escapeHtml(record.priority)}</small>`}</td><td>${badge(record.status || "Not started", record.status === "verified" ? "ready" : "pending")}</td></tr>`).join("") : `<tr><td colspan="4">DNS records will appear after the domain is added to Resend.</td></tr>`;
    const domainSetup = !provider?.providerAvailable
        ? empty("The server-side Resend connection must be configured before a domain can be added. No credential is entered in this browser.")
        : !configured
            ? formShell("communications-email-domain-form", `
        ${field("domain", "Sending domain", "", "text", "required maxlength=\"253\" placeholder=\"updates.example.com\"")}
        ${selectField("region", "Sending region", [
                option("us-east-1", "United States — East", true),
                option("eu-west-1", "Europe — Ireland"),
                option("sa-east-1", "South America — São Paulo"),
                option("ap-northeast-1", "Asia Pacific — Tokyo"),
            ].join(""))}
        ${checkField("confirmDomain", "I understand this creates the domain in Resend and returns DNS records for me to install.", false)}
      `, "Add sending domain")
            : `<div class="communications-admin-facts-grid">${fact("Domain", provider?.domain)}${fact("Provider status", label(provider?.providerStatus))}${fact("Signed webhook", provider?.webhookAvailable ? "Ready" : "Needs server setup")}${fact("Region", provider?.region || "Provider default")}</div>
        <form class="communications-admin-form communications-admin-action-form" id="communications-email-domain-actions">
          <div class="communications-admin-form-footer"><p class="communications-admin-form-status" role="status" aria-live="polite">${verified && !provider?.webhookAvailable ? "The signed Resend webhook must be configured on the server before activation." : ""}</p><div class="communications-admin-button-row"><button class="portal-button portal-button-secondary" name="emailAction" value="refresh_domain" type="submit">Refresh status</button><button class="portal-button portal-button-secondary" name="emailAction" value="verify_domain" type="submit">Restart verification</button>${verified && provider?.webhookAvailable && !active ? '<button class="portal-button" name="emailAction" value="activate_email" type="submit">Activate email</button>' : ""}</div></div>
        </form>`;
    const subscribed = data.subscribers.filter((subscriber) => subscriber.email && subscriber.email_status === "subscribed");
    const subscriberOptions = option("", "Choose a consenting subscriber") + subscribed.map((subscriber) => option(subscriber.id, `${subscriber.full_name || "Subscriber"} — ${subscriber.email}`)).join("");
    const testControl = active
        ? (subscribed.length ? formShell("communications-email-test-form", `
      ${selectField("subscriberId", "Recipient", subscriberOptions)}
      ${field("fromLocalPart", "From address name", "updates", "text", "required maxlength=\"64\" aria-describedby=\"communications-from-domain\"")}
      <p class="communications-admin-field-note" id="communications-from-domain">Email will come from the name above at ${escapeHtml(provider?.domain)}.</p>
      ${field("subject", "Subject", "N3XRA Communications email test", "text", "required maxlength=\"300\"")}
      ${textareaField("message", "Message", "This is a test email sent through N3XRA Communications.", "required maxlength=\"10000\"")}
      ${checkField("confirmSend", "I understand this sends one real email to the selected subscriber.", false)}
    `, "Send test email") : empty("Complete the public signup form with an email address first. The test can only go to a subscriber with recorded email consent."))
        : empty("Verify the domain and activate the email channel before sending a test.");
    return `<section class="communications-admin-readiness-hero"><div><p class="portal-kicker">Email channel</p><h2>${escapeHtml(active ? "Ready" : state.label)}</h2><p>${escapeHtml(active ? `${provider?.domain} is verified and email sending is active.` : state.detail)}</p></div>${badge(active ? "Ready" : state.label, active ? "ready" : state.tone)}</section><div class="communications-admin-grid">${card("1. Connect a sending domain", "You provide the domain. N3XRA creates it in Resend and shows the exact DNS records; the API key always stays on the server.", domainSetup)}${configured ? card("2. Install and verify DNS records", "Copy each record into the domain's DNS provider, then restart verification and refresh until every required record is verified.", `<div class="communications-admin-table-wrap"><table class="communications-admin-dns-table"><thead><tr><th>Record</th><th>Name</th><th>Value</th><th>Status</th></tr></thead><tbody>${dnsRows}</tbody></table></div>`) : ""}${card(configured ? "3. Send a controlled test" : "2. Send a controlled test", "Only subscribers with recorded email consent can receive a test. Nothing sends until you choose a recipient and press the button.", testControl)}</div>`;
}
function renderTextingReadiness(data) {
    const state = readiness(data, "sms");
    const onboarding = data.carrier_onboarding;
    const application = onboarding?.application || {};
    const numbers = data.numbers.length ? data.numbers.map((number) => `<article class="communications-admin-detail-row"><header><div><strong>${escapeHtml(number.phone_e164)}</strong><small>${escapeHtml(label(number.provider))}</small></div>${badge(number.status, number.status === "active" ? "ready" : "pending")}</header><div class="communications-admin-facts-grid">${fact("Carrier registration", label(number.carrier_registration_status))}${fact("Texting activated", formatDate(number.texting_activated_at))}${fact("Updated", formatDate(number.updated_at))}</div></article>`).join("") : empty("No Twilio Communications number is assigned.");
    const onboardingBody = onboarding ? `
    <div class="communications-admin-facts-grid">
      ${fact("Status", label(onboarding.status))}
      ${fact("Submitted", formatDate(onboarding.submitted_at))}
      ${fact("Legal business", application.legal_business_name)}
      ${fact("Registration type", label(application.brand_type))}
      ${fact("EIN / registration", application.business_registration_number)}
      ${fact("Authorized representative", `${application.authorized_first_name || ""} ${application.authorized_last_name || ""}`.trim())}
      ${fact("Representative email", application.authorized_email)}
      ${fact("Use case", label(application.campaign_use_case))}
      ${fact("Estimated monthly messages", application.estimated_monthly_messages)}
      ${fact("Preferred area code", application.preferred_area_code)}
      ${fact("Privacy policy", application.privacy_policy_url)}
      ${fact("Terms", application.terms_url)}
    </div>
    <section><strong>Campaign description</strong><p>${escapeHtml(application.campaign_description || "Not provided")}</p></section>
    <section><strong>Opt-in workflow</strong><p>${escapeHtml(application.message_flow || "Not provided")}</p></section>
    <section><strong>Sample messages</strong><div class="communications-admin-list">${Array.isArray(application.message_samples) ? application.message_samples.map((message, index) => `<article class="communications-admin-list-row"><div><strong>Sample ${index + 1}</strong><small>${escapeHtml(message)}</small></div></article>`).join("") : empty("No sample messages were provided.")}</div></section>
    ${onboarding.review_notes ? `<section><strong>Review note</strong><p>${escapeHtml(onboarding.review_notes)}</p></section>` : ""}
  ` : empty("The client has not started the secure carrier onboarding form.");
    const onboardingTone = onboarding?.status === "submitted" ? "pending" : ["approved", "active"].includes(onboarding?.status) ? "ready" : "neutral";
    return `<section class="communications-admin-readiness-hero"><div><p class="portal-kicker">Text channel</p><h2>${escapeHtml(state.label)}</h2><p>${escapeHtml(state.detail)}</p></div>${badge(state.label, state.tone)}</section>${card("Carrier onboarding", "Private business identity, consent, and campaign details submitted by an authorized client administrator.", `<div class="communications-admin-readiness">${badge(onboarding?.status || "Not started", onboardingTone)}</div>${onboardingBody}`)}${card("Assigned numbers", "Provider credentials and activation actions are intentionally excluded.", numbers)}${card("Texting channel state", "Carrier registration and channel state are visible without operational controls.", `<div class="communications-admin-facts-grid">${fact("Channel status", label(data.channels.find((row) => row.channel === "sms")?.status))}${fact("Assigned numbers", data.numbers.length)}${fact("Keywords", data.keywords.length)}${fact("Support phone", data.workspace.support_phone)}</div>`)}`;
}
function renderPricingActivation(data) {
    const entitlement = data.entitlement;
    const control = formShell("communications-pricing-form", `
    ${field("includedSmsSegments", "Included SMS segments", data.workspace.included_sms_segments || 0, "number", "required min=\"0\" step=\"1\"")}
    ${field("smsOverageCents", "SMS overage (cents)", data.workspace.sms_overage_cents || 0, "number", "required min=\"0\" step=\"1\"")}
    ${field("mmsUnitCents", "MMS unit price (cents)", data.workspace.mms_unit_cents || 0, "number", "required min=\"0\" step=\"1\"")}
    ${selectField("entitlementStatus", "Entitlement status", ["trialing", "active", "paused", "canceled"].map((value) => option(value, label(value), value === (entitlement?.status || "trialing"))).join(""))}
    ${checkField("portalEnabled", "Enable the customer portal entitlement", Boolean(entitlement?.portal_enabled))}
  `, "Save pricing & access");
    return `<div class="communications-admin-grid two-column">${card("Product entitlement", "Organization access to the customer-facing Communications application.", `<div class="communications-admin-facts-grid">${fact("Status", label(entitlement?.status, "Not entitled"))}${fact("Portal enabled", entitlement ? (entitlement.portal_enabled ? "Yes" : "No") : "No")}${fact("Source", label(entitlement?.source))}${fact("Starts", formatDate(entitlement?.starts_at))}${fact("Ends", formatDate(entitlement?.ends_at))}${fact("Updated", formatDate(entitlement?.updated_at))}</div>`)}${card("Workspace activation", "Workspace and channel state are reported independently so unfinished provider setup is not mistaken for readiness.", `<div class="communications-admin-facts-grid">${fact("Workspace", label(data.workspace.status))}${fact("Email", readiness(data, "email").label)}${fact("Texting", readiness(data, "sms").label)}${fact("Organization account", label(data.organization?.account_status))}</div>`)}${card("Usage pricing", "Stored plan limits and unit prices. This does not bill customers or activate providers.", `<div class="communications-admin-facts-grid">${fact("Included SMS segments", Number(data.workspace.included_sms_segments || 0).toLocaleString())}${fact("SMS overage", `${formatMoney(data.workspace.sms_overage_cents)} per segment`)}${fact("MMS unit", `${formatMoney(data.workspace.mms_unit_cents)} per message`)}${fact("Current SMS segments", Number(data.metrics?.sms_segments_current_month || 0).toLocaleString())}</div>`, "full-width")}${card("Pricing & portal access", "Updates stored usage pricing and the Communications product entitlement only.", control, "full-width")}</div>`;
}
function renderRequests(payload) {
    if (!payload.requests.length)
        return card("Communications requests", "New service and number requests will appear here.", empty("No Communications requests have been submitted."));
    const rows = payload.requests.map((request) => `<article class="communications-admin-request"><header><div><p class="portal-kicker">${escapeHtml(formatDate(request.created_at))}</p><h2>${escapeHtml(request.organization_name)}</h2><p>${escapeHtml(request.website_url)}</p></div>${badge(request.status, request.status === "submitted" ? "pending" : request.status === "approved" ? "ready" : "neutral")}</header><div class="communications-admin-facts-grid">${fact("Contact", `${request.primary_contact_name} · ${request.primary_contact_email}`)}${fact("Requested channels", (request.requested_channels || []).map(label).join(", "))}${fact("Preferred area code", request.preferred_area_code)}${fact("Estimated subscribers", request.estimated_subscriber_count)}${fact("Monthly messages", request.estimated_monthly_message_volume)}${fact("Requested keyword", request.requested_keyword)}${fact("Topics", (request.requested_topics || []).join(", "))}${fact("Reviewed", formatDate(request.reviewed_at))}</div><section><strong>Intended use</strong><p>${escapeHtml(request.intended_use)}</p></section><section><strong>Example messages</strong><p>${escapeHtml(request.example_messages)}</p></section><footer><span>Read-only request review</span><span>No approval or provisioning controls are available in this release.</span></footer></article>`).join("");
    return `<div class="communications-admin-request-list">${rows}</div>`;
}
function renderWorkspaceSection(data) {
    switch (section) {
        case "overview": return renderOverview(data);
        case "websites-forms": return renderWebsitesForms(data);
        case "subscribers": return renderSubscribers(data);
        case "topics-signup": return renderTopicsSignup(data);
        case "activity-usage": return renderActivityUsage(data);
        case "email-readiness": return renderEmailReadiness(data);
        case "texting-readiness": return renderTextingReadiness(data);
        case "pricing-activation": return renderPricingActivation(data);
        case "requests": return "";
    }
}
function setLoading(message) {
    const content = root?.querySelector("#communications-admin-content");
    if (content)
        content.innerHTML = `<div class="communications-admin-loading"><span></span><p>${escapeHtml(message)}</p></div>`;
}
function showFatal(message) {
    if (statusLayer) {
        statusLayer.textContent = message;
        statusLayer.hidden = false;
    }
    document.body.classList.remove("portal-loading");
}
function control(form, name) {
    const element = form.elements.namedItem(name);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
        throw new Error(`Missing ${name} control.`);
    }
    return element;
}
function value(form, name) {
    return control(form, name).value.trim();
}
function checked(form, name) {
    const element = control(form, name);
    return element instanceof HTMLInputElement && element.checked;
}
function setValue(form, name, nextValue) {
    control(form, name).value = String(nextValue ?? "");
}
function setChecked(form, name, nextValue) {
    const element = control(form, name);
    if (element instanceof HTMLInputElement)
        element.checked = Boolean(nextValue);
}
function bindMutationForm(form, operation, serialize) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity())
            return;
        const status = form.querySelector(".communications-admin-form-status");
        const button = form.querySelector('button[type="submit"]');
        if (button)
            button.disabled = true;
        if (status) {
            status.className = "communications-admin-form-status";
            status.textContent = "Saving…";
        }
        try {
            const result = await mutate(operation, serialize());
            if (status) {
                status.classList.add("is-success");
                status.textContent = "Saved securely. Refreshing…";
            }
            indexPayload = await api("index");
            if (result.workspace_id) {
                selectedWorkspaceId = result.workspace_id;
                if (operation === "provision_workspace" && new URLSearchParams(window.location.search).get("new") === "1") {
                    window.history.replaceState({}, document.title, "/n3xra-admin/communications/");
                }
            }
            if (selectedWorkspaceId)
                sessionStorage.setItem(workspaceStorageKey(), selectedWorkspaceId);
            renderContext(indexPayload.workspaces);
            await loadCurrentSection();
        }
        catch (error) {
            if (status) {
                status.classList.add("is-error");
                status.textContent = error instanceof Error ? error.message : "That change could not be saved.";
            }
        }
        finally {
            if (button)
                button.disabled = false;
        }
    });
}
function bindWorkspaceForm() {
    const form = root?.querySelector("#communications-workspace-form");
    if (!form)
        return;
    const organizationSelect = control(form, "organizationId");
    const websiteSelect = control(form, "websiteId");
    organizationSelect.required = true;
    organizationSelect.addEventListener("change", () => {
        const choices = [option("", "No website link")].concat(indexPayload.websites
            .filter((website) => website.organization_id === organizationSelect.value)
            .map((website) => option(website.id, website.name)))
            .join("");
        websiteSelect.innerHTML = choices;
    });
    bindMutationForm(form, "provision_workspace", () => ({
        workspaceId: value(form, "workspaceId") || null,
        organizationId: value(form, "organizationId"),
        websiteId: value(form, "websiteId") || null,
        slug: value(form, "slug"),
        programName: value(form, "programName"),
        senderName: value(form, "senderName"),
        supportEmail: value(form, "supportEmail"),
        supportPhone: value(form, "supportPhone") || null,
        websiteUrl: value(form, "websiteUrl"),
        privacyPolicyUrl: value(form, "privacyPolicyUrl"),
        programTermsUrl: value(form, "programTermsUrl"),
        expectedMessageFrequency: value(form, "expectedMessageFrequency"),
        workspaceStatus: value(form, "workspaceStatus"),
        entitlementStatus: value(form, "entitlementStatus"),
        portalEnabled: checked(form, "portalEnabled"),
        includedSmsSegments: Number(value(form, "includedSmsSegments")),
        smsOverageCents: Number(value(form, "smsOverageCents")),
        mmsUnitCents: Number(value(form, "mmsUnitCents")),
    }));
}
function bindSubscriptionForm(data) {
    const form = root?.querySelector("#communications-subscription-form");
    if (!form)
        return;
    const selector = control(form, "formId");
    selector.addEventListener("change", () => {
        const selected = data.forms.find((candidate) => candidate.id === selector.value);
        const consent = selected?.active_consent_configuration || {};
        setValue(form, "websiteId", selected?.website_id || data.websites[0]?.id || "");
        setValue(form, "name", selected?.name || "Website signup");
        setValue(form, "status", selected?.status || "draft");
        setValue(form, "successMessage", selected?.success_message || "Thank you. Please check your inbox to confirm your subscription.");
        setValue(form, "allowedOrigins", (selected?.allowed_origins || []).join("\n"));
        setChecked(form, "emailEnabled", Boolean(consent.email) || !selected);
        setChecked(form, "smsEnabled", Boolean(consent.sms));
        setValue(form, "emailVersion", consent.email?.version || "email-v1");
        setValue(form, "emailCheckboxLabel", consent.email?.checkbox_label || "Send me email updates");
        setValue(form, "emailDisclosure", consent.email?.disclosure || "I agree to receive email updates and understand that I can unsubscribe at any time.");
        setValue(form, "smsVersion", consent.sms?.version || "sms-v1");
        setValue(form, "smsCheckboxLabel", consent.sms?.checkbox_label || "Send me text updates");
        setValue(form, "smsDisclosure", consent.sms?.disclosure || "I agree to receive recurring automated text messages. Message and data rates may apply. Reply STOP to opt out.");
    });
    bindMutationForm(form, "save_form", () => ({
        workspaceId: selectedWorkspaceId,
        formId: value(form, "formId") || null,
        websiteId: value(form, "websiteId"),
        name: value(form, "name"),
        status: value(form, "status"),
        successMessage: value(form, "successMessage"),
        allowedOrigins: value(form, "allowedOrigins").split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean),
        emailEnabled: checked(form, "emailEnabled"),
        smsEnabled: checked(form, "smsEnabled"),
        emailVersion: value(form, "emailVersion"),
        emailDisclosure: value(form, "emailDisclosure"),
        emailCheckboxLabel: value(form, "emailCheckboxLabel"),
        smsVersion: value(form, "smsVersion"),
        smsDisclosure: value(form, "smsDisclosure"),
        smsCheckboxLabel: value(form, "smsCheckboxLabel"),
    }));
}
function bindTopicForm(data) {
    const form = root?.querySelector("#communications-topic-form");
    if (!form)
        return;
    const selector = control(form, "topicId");
    selector.addEventListener("change", () => {
        const selected = data.topics.find((candidate) => candidate.id === selector.value);
        setValue(form, "name", selected?.name || "");
        setValue(form, "slug", selected?.slug || "");
        setValue(form, "sortOrder", selected?.sort_order ?? 100);
        setValue(form, "description", selected?.description || "");
        setChecked(form, "active", selected ? selected.active : true);
    });
    bindMutationForm(form, "save_topic", () => ({
        workspaceId: selectedWorkspaceId,
        topicId: value(form, "topicId") || null,
        name: value(form, "name"),
        slug: value(form, "slug"),
        sortOrder: Number(value(form, "sortOrder")),
        description: value(form, "description") || null,
        active: checked(form, "active"),
    }));
}
function bindPricingForm() {
    const form = root?.querySelector("#communications-pricing-form");
    if (!form)
        return;
    bindMutationForm(form, "update_pricing", () => ({
        workspaceId: selectedWorkspaceId,
        includedSmsSegments: Number(value(form, "includedSmsSegments")),
        smsOverageCents: Number(value(form, "smsOverageCents")),
        mmsUnitCents: Number(value(form, "mmsUnitCents")),
        entitlementStatus: value(form, "entitlementStatus"),
        portalEnabled: checked(form, "portalEnabled"),
    }));
}
function setEmailFormStatus(form, message, tone = "") {
    const status = form.querySelector(".communications-admin-form-status");
    if (!status)
        return;
    status.className = `communications-admin-form-status${tone ? ` is-${tone}` : ""}`;
    status.textContent = message;
}
function setEmailFormDisabled(form, disabled) {
    form.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
}
function bindEmailControls() {
    const domainForm = root?.querySelector("#communications-email-domain-form");
    domainForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!domainForm.reportValidity())
            return;
        if (!checked(domainForm, "confirmDomain")) {
            setEmailFormStatus(domainForm, "Confirm that you are ready to create this domain in Resend.", "error");
            return;
        }
        setEmailFormDisabled(domainForm, true);
        setEmailFormStatus(domainForm, "Creating the domain securely…");
        try {
            emailProviderPayload = await emailApi("create_domain", {
                domain: value(domainForm, "domain"),
                region: value(domainForm, "region"),
            });
            await loadCurrentSection();
        }
        catch (error) {
            setEmailFormStatus(domainForm, error instanceof Error ? error.message : "The domain could not be created.", "error");
            setEmailFormDisabled(domainForm, false);
        }
    });
    const actionForm = root?.querySelector("#communications-email-domain-actions");
    actionForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const operation = event.submitter instanceof HTMLButtonElement
            ? event.submitter.value
            : "refresh_domain";
        setEmailFormDisabled(actionForm, true);
        setEmailFormStatus(actionForm, operation === "activate_email" ? "Activating email…" : "Checking Resend…");
        try {
            emailProviderPayload = await emailApi(operation);
            await loadCurrentSection();
        }
        catch (error) {
            setEmailFormStatus(actionForm, error instanceof Error ? error.message : "The email status could not be updated.", "error");
            setEmailFormDisabled(actionForm, false);
        }
    });
    const testForm = root?.querySelector("#communications-email-test-form");
    testForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!testForm.reportValidity())
            return;
        if (!checked(testForm, "confirmSend")) {
            setEmailFormStatus(testForm, "Confirm that you are ready to send one real test email.", "error");
            return;
        }
        setEmailFormDisabled(testForm, true);
        setEmailFormStatus(testForm, "Sending one test email…");
        try {
            const result = await emailApi("send_test_email", {
                subscriberId: value(testForm, "subscriberId"),
                fromLocalPart: value(testForm, "fromLocalPart"),
                subject: value(testForm, "subject"),
                message: value(testForm, "message"),
            });
            setEmailFormStatus(testForm, result.sent ? "Test email accepted by Resend." : "This test was already processed; no duplicate was sent.", "success");
        }
        catch (error) {
            setEmailFormStatus(testForm, error instanceof Error ? error.message : "The test email could not be sent.", "error");
        }
        finally {
            setEmailFormDisabled(testForm, false);
        }
    });
}
function bindSectionControls(data) {
    bindWorkspaceForm();
    if (!data)
        return;
    bindSubscriptionForm(data);
    bindTopicForm(data);
    bindPricingForm();
    bindEmailControls();
}
async function loadCurrentSection() {
    setLoading(section === "requests" ? "Loading Communications requests…" : "Loading Communications workspace…");
    renderContext(indexPayload.workspaces);
    const content = root?.querySelector("#communications-admin-content");
    if (!content)
        return;
    if (section === "requests") {
        content.innerHTML = renderRequests(await api("requests"));
    }
    else if (!selectedWorkspaceId) {
        content.innerHTML = section === "overview"
            ? `<div class="communications-admin-grid">${renderWorkspaceForm()}</div>`
            : empty("Create a Communications workspace from Overview before using this section.");
        bindSectionControls();
    }
    else {
        const [data, provider] = await Promise.all([
            api("workspace", selectedWorkspaceId),
            section === "email-readiness" ? emailApi() : Promise.resolve(null),
        ]);
        emailProviderPayload = provider;
        content.innerHTML = renderWorkspaceSection(data);
        bindSectionControls(data);
    }
    if (statusLayer)
        statusLayer.hidden = true;
    document.body.classList.remove("portal-loading");
}
async function initialize() {
    if (!root)
        return;
    renderPagebar();
    adminContext = await getAdminSession();
    if (!adminContext.allowed)
        return;
    indexPayload = await api("index");
    selectedWorkspaceId = selectWorkspace(indexPayload.workspaces);
    if (selectedWorkspaceId)
        sessionStorage.setItem(workspaceStorageKey(), selectedWorkspaceId);
    renderContext(indexPayload.workspaces);
    await loadCurrentSection();
}
void initialize().catch((error) => {
    console.error("Communications Admin failed to load.", error);
    showFatal(error instanceof Error ? error.message : "Communications Admin could not be opened.");
});
