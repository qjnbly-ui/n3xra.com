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
function workspaceStorageKey() {
    return `n3xra-communications-admin-workspace:${adminContext.user?.id || "admin"}`;
}
function selectWorkspace(workspaces) {
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
    const workspaceOptions = workspaces.length
        ? workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}"${workspace.id === selectedWorkspaceId ? " selected" : ""}>${escapeHtml(workspace.organization?.name || workspace.sender_name)} — ${escapeHtml(workspace.program_name)}</option>`).join("")
        : '<option value="">No Communications workspaces</option>';
    const navigation = (group) => sections.filter((item) => item.group === group).map((item) => `<a class="${item.key === section ? "is-current" : ""}" href="${item.href}">${escapeHtml(item.label)}</a>`).join("");
    panel.innerHTML = `
    <div class="communications-admin-context-head">
      <p class="portal-kicker">Organization workspace</p>
      <label>Working with<select id="communications-workspace-select"${workspaces.length ? "" : " disabled"}>${workspaceOptions}</select></label>
    </div>
    ${current ? `<section class="communications-admin-context-card"><span>${escapeHtml(label(current.status))}</span><strong>${escapeHtml(current.organization?.name || current.sender_name)}</strong><small>${escapeHtml(current.program_name)}</small></section>` : ""}
    <nav class="communications-admin-context-nav" aria-label="Selected Communications workspace sections">
      <p>Workspace</p>${navigation("workspace")}
      <p>Readiness & activation</p>${navigation("readiness")}
    </nav>
    <div class="communications-admin-context-footer"><span>${indexPayload.request_summary.submitted} submitted request${indexPayload.request_summary.submitted === 1 ? "" : "s"}</span><a class="${section === "requests" ? "is-current" : ""}" href="/n3xra-admin/communications/requests/">Open requests</a></div>
  `;
    panel.querySelector("#communications-workspace-select")?.addEventListener("change", (event) => {
        const value = event.currentTarget.value;
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
    pagebar.innerHTML = `<div><p class="portal-kicker">Communications Admin</p><h1>${escapeHtml(details.title)}</h1><p>${escapeHtml(details.description)}</p></div><div class="communications-admin-page-actions">${badge("Read-only release", "pending")}<button class="portal-button portal-button-secondary" id="communications-admin-refresh" type="button">Refresh</button></div>`;
    pagebar.querySelector("#communications-admin-refresh")?.addEventListener("click", () => void loadCurrentSection());
}
function renderOverview(data) {
    const metrics = data.metrics || {};
    const email = readiness(data, "email");
    const sms = readiness(data, "sms");
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
    ${card("Workspace identity", "The public program identity and support details currently stored for this workspace.", `<div class="communications-admin-facts-grid">${fact("Sender", data.workspace.sender_name)}${fact("Program", data.workspace.program_name)}${fact("Website", data.workspace.website_url)}${fact("Support email", data.workspace.support_email)}${fact("Message frequency", data.workspace.expected_message_frequency)}${fact("Updated", formatDate(data.workspace.updated_at))}</div>`)}
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
    return `<div class="communications-admin-grid two-column">${card("Connected websites", "Website links established for this organization-owned workspace.", websites)}${card("Subscription forms", "Definitions and processing actions are displayed without editable controls.", forms)}</div>`;
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
    return `<div class="communications-admin-grid two-column">${card("Topics", "Subscriber preference categories and current counts.", topics)}${card("Signup sources", "Hosted, embedded, and QR attribution sources.", sources)}${card("Keywords", "Text-to-join keywords remain read-only until Twilio operations exist.", keywords, "full-width")}</div>`;
}
function renderActivityUsage(data) {
    const metrics = data.metrics || {};
    const messages = data.message_events.length ? data.message_events.map((event) => `<tr><td>${escapeHtml(formatDate(event.occurred_at))}</td><td>${escapeHtml(label(event.channel))}</td><td>${escapeHtml(label(event.direction))}</td><td>${badge(event.status, event.status === "delivered" ? "ready" : "neutral")}</td><td>${escapeHtml(event.body_preview || "No preview")}</td><td>${escapeHtml(event.billable_units || 0)}</td></tr>`).join("") : `<tr><td colspan="6">No message events have been recorded.</td></tr>`;
    const queue = data.queue.length ? data.queue.map((item) => `<tr><td>${escapeHtml(formatDate(item.created_at))}</td><td>${badge(item.status, item.status === "completed" ? "ready" : item.status === "failed" ? "error" : "pending")}</td><td>${escapeHtml(item.attempts || 0)}</td><td>${escapeHtml(item.last_error || "None")}</td></tr>`).join("") : `<tr><td colspan="4">No form actions are queued.</td></tr>`;
    return `<section class="communications-admin-metrics">${fact("Consent events", Number(metrics.consent_events || data.consent_events.length))}${fact("Message events", Number(metrics.message_events || data.message_events.length))}${fact("Form submissions", data.submissions.length)}${fact("Queued actions", data.queue.length)}${fact("SMS segments", Number(metrics.sms_segments_current_month || 0))}${fact("Included segments", Number(data.workspace.included_sms_segments || 0))}</section><div class="communications-admin-grid">${card("Message activity", "Delivery and inbound/outbound event records. No composer or send controls are present.", `<div class="communications-admin-table-wrap"><table><thead><tr><th>Time</th><th>Channel</th><th>Direction</th><th>Status</th><th>Preview</th><th>Units</th></tr></thead><tbody>${messages}</tbody></table></div>`)}${card("Form action queue", "Read-only processing state for universal form actions.", `<div class="communications-admin-table-wrap"><table><thead><tr><th>Created</th><th>Status</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>${queue}</tbody></table></div>`)}</div>`;
}
function renderEmailReadiness(data) {
    const state = readiness(data, "email");
    const domains = data.sending_domains.length ? data.sending_domains.map((domain) => `<article class="communications-admin-list-row"><div><strong>${escapeHtml(domain.domain)}</strong><small>${escapeHtml(label(domain.provider))} · Updated ${escapeHtml(formatDate(domain.updated_at))}</small></div>${badge(domain.status, domain.status === "verified" ? "ready" : "pending")}</article>`).join("") : empty("No Resend sending domain has been configured.");
    return `<section class="communications-admin-readiness-hero"><div><p class="portal-kicker">Email channel</p><h2>${escapeHtml(state.label)}</h2><p>${escapeHtml(state.detail)}</p></div>${badge(state.label, state.tone)}</section>${card("Sending domains", "Provider identifiers and credentials are intentionally excluded. Verification and activation controls will arrive with trusted server-side adapters.", domains)}${card("Email channel state", "The channel can be inspected but cannot be activated from this release.", `<div class="communications-admin-facts-grid">${fact("Channel status", label(data.channels.find((row) => row.channel === "email")?.status))}${fact("Domains", data.sending_domains.length)}${fact("Sender name", data.workspace.sender_name)}${fact("Support email", data.workspace.support_email)}</div>`)}`;
}
function renderTextingReadiness(data) {
    const state = readiness(data, "sms");
    const numbers = data.numbers.length ? data.numbers.map((number) => `<article class="communications-admin-detail-row"><header><div><strong>${escapeHtml(number.phone_e164)}</strong><small>${escapeHtml(label(number.provider))}</small></div>${badge(number.status, number.status === "active" ? "ready" : "pending")}</header><div class="communications-admin-facts-grid">${fact("Carrier registration", label(number.carrier_registration_status))}${fact("Texting activated", formatDate(number.texting_activated_at))}${fact("Updated", formatDate(number.updated_at))}</div></article>`).join("") : empty("No Twilio Communications number is assigned.");
    return `<section class="communications-admin-readiness-hero"><div><p class="portal-kicker">Text channel</p><h2>${escapeHtml(state.label)}</h2><p>${escapeHtml(state.detail)}</p></div>${badge(state.label, state.tone)}</section>${card("Assigned numbers", "Provider credentials and activation actions are intentionally excluded.", numbers)}${card("Texting channel state", "Carrier registration and channel state are visible without operational controls.", `<div class="communications-admin-facts-grid">${fact("Channel status", label(data.channels.find((row) => row.channel === "sms")?.status))}${fact("Assigned numbers", data.numbers.length)}${fact("Keywords", data.keywords.length)}${fact("Support phone", data.workspace.support_phone)}</div>`)}`;
}
function renderPricingActivation(data) {
    const entitlement = data.entitlement;
    return `<div class="communications-admin-grid two-column">${card("Product entitlement", "Organization access to the customer-facing Communications application.", `<div class="communications-admin-facts-grid">${fact("Status", label(entitlement?.status, "Not entitled"))}${fact("Portal enabled", entitlement ? (entitlement.portal_enabled ? "Yes" : "No") : "No")}${fact("Source", label(entitlement?.source))}${fact("Starts", formatDate(entitlement?.starts_at))}${fact("Ends", formatDate(entitlement?.ends_at))}${fact("Updated", formatDate(entitlement?.updated_at))}</div>`)}${card("Workspace activation", "Workspace and channel state are reported independently so unfinished provider setup is not mistaken for readiness.", `<div class="communications-admin-facts-grid">${fact("Workspace", label(data.workspace.status))}${fact("Email", readiness(data, "email").label)}${fact("Texting", readiness(data, "sms").label)}${fact("Organization account", label(data.organization?.account_status))}</div>`)}${card("Usage pricing", "Stored plan limits and unit prices. This release does not change billing or activate providers.", `<div class="communications-admin-facts-grid">${fact("Included SMS segments", Number(data.workspace.included_sms_segments || 0).toLocaleString())}${fact("SMS overage", `${formatMoney(data.workspace.sms_overage_cents)} per segment`)}${fact("MMS unit", `${formatMoney(data.workspace.mms_unit_cents)} per message`)}${fact("Current SMS segments", Number(data.metrics?.sms_segments_current_month || 0).toLocaleString())}</div>`, "full-width")}</div>`;
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
        content.innerHTML = empty("No Communications workspaces exist yet.");
    }
    else {
        content.innerHTML = renderWorkspaceSection(await api("workspace", selectedWorkspaceId));
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
