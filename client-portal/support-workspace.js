import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { resolvePortalTenant, scopeWebsitesToPortalTenant } from "./tenant-context.js";
const form = document.querySelector("#client-support-form");
const openButton = document.querySelector("#client-support-new");
const closeButton = document.querySelector("#client-support-close");
const submitButton = document.querySelector("#client-support-submit");
const topicInput = document.querySelector("#client-support-topic");
const scopeInput = document.querySelector("#client-support-scope");
const websiteOption = document.querySelector("#client-support-website-option");
const subjectInput = document.querySelector("#client-support-subject");
const messageInput = document.querySelector("#client-support-message");
const formStatus = document.querySelector("#client-support-form-status");
const status = document.querySelector("#client-support-status");
const list = document.querySelector("#client-support-list");
const activeCount = document.querySelector("#client-support-active-count");
const pastCount = document.querySelector("#client-support-past-count");
const websiteSelect = document.querySelector("#website-select");
const filterButtons = [...document.querySelectorAll("[data-client-support-filter]")];
let supabase;
let session;
let websites = [];
let requests = [];
let updates = [];
let filter = "active";
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const isPast = (request) => ["resolved", "closed"].includes(request.status);
const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
function currentWebsite() {
    const selectedId = websiteSelect?.value || "";
    return websites.find((website) => website.id === selectedId) || websites[0];
}
function timingLabel(request) {
    if (["resolved", "closed"].includes(request.status))
        return `Completed ${formatDate(request.updated_at)}`;
    if (!request.estimated_completion_at)
        return "Estimated timing pending";
    const remainingMs = new Date(request.estimated_completion_at).getTime() - Date.now();
    const days = Math.ceil(remainingMs / 86_400_000);
    if (days < 0)
        return `Estimate under review · ${formatDate(request.estimated_completion_at)}`;
    if (days === 0)
        return "Estimated completion today";
    return `About ${days} day${days === 1 ? "" : "s"} remaining`;
}
function render() {
    if (!list)
        return;
    const websiteId = currentWebsite()?.id;
    const organizationId = currentWebsite()?.organization_id || null;
    if (websiteOption)
        websiteOption.textContent = currentWebsite() ? `${currentWebsite()?.name} website` : "Selected website";
    const websiteRequests = requests.filter((request) => request.website_id === websiteId || (!request.website_id && (!request.organization_id || (organizationId && request.organization_id === organizationId))));
    const active = websiteRequests.filter((request) => !isPast(request));
    const past = websiteRequests.filter(isPast);
    if (activeCount)
        activeCount.textContent = String(active.length);
    if (pastCount)
        pastCount.textContent = String(past.length);
    const visible = filter === "past" ? past : active;
    list.innerHTML = visible.length ? visible.map((request) => {
        const requestUpdates = updates.filter((update) => update.request_id === request.id);
        return `<article class="client-support-card is-${escapeHtml(request.status)}">
      <header class="client-support-card-head"><div><p class="portal-kicker">${escapeHtml(label(request.topic))}</p><h3>${escapeHtml(request.subject)}</h3><p class="client-support-card-origin">${request.origin === "n3xra" ? "Started by N3XRA" : `Sent ${escapeHtml(formatDate(request.created_at))}`}</p></div><span class="client-support-state is-${escapeHtml(request.status)}">${escapeHtml(label(request.status))}</span></header>
      <p class="client-support-message">${escapeHtml(request.message)}</p>
      <div class="client-support-meta"><span><strong>Timing:</strong> ${escapeHtml(timingLabel(request))}</span>${request.estimated_start_at ? `<span><strong>Estimated start:</strong> ${escapeHtml(formatDate(request.estimated_start_at))}</span>` : ""}</div>
      ${requestUpdates.length ? `<div class="client-support-updates">${requestUpdates.map((update) => `<div class="client-support-update"><p>${escapeHtml(update.message)}</p><small>${update.author_type === "n3xra" ? "N3XRA update" : "Client update"} · ${escapeHtml(formatDate(update.created_at))}</small></div>`).join("")}</div>` : ""}
    </article>`;
    }).join("") : `<div class="client-support-empty"><strong>${filter === "past" ? "No completed work yet" : "No active requests"}</strong><p>${filter === "past" ? "Completed and closed items will stay available here." : "Send a request whenever you would like N3XRA to work on something."}</p></div>`;
}
async function loadRequests() {
    if (!websites.length) {
        requests = [];
        updates = [];
        render();
        return;
    }
    const { data, error } = await supabase.from("platform_support_requests")
        .select("id,website_id,organization_id,topic,subject,message,status,origin,estimated_start_at,estimated_completion_at,created_at,updated_at")
        .eq("client_visible", true)
        .order("updated_at", { ascending: false });
    if (error)
        throw error;
    requests = (data || []);
    const requestIds = requests.map((request) => request.id);
    if (!requestIds.length) {
        updates = [];
    }
    else {
        const updateResult = await supabase.from("platform_support_request_updates")
            .select("id,request_id,message,author_type,created_at")
            .in("request_id", requestIds)
            .eq("visible_to_client", true)
            .order("created_at", { ascending: true });
        if (updateResult.error)
            throw updateResult.error;
        updates = (updateResult.data || []);
    }
    render();
}
async function submitRequest(event) {
    event.preventDefault();
    const website = currentWebsite();
    if (!website || !form?.reportValidity() || !topicInput || !subjectInput || !messageInput || !submitButton)
        return;
    submitButton.disabled = true;
    if (formStatus)
        formStatus.textContent = "Sending your request…";
    const email = String(session.user.email || "").trim().toLowerCase();
    const requesterName = String(session.user.user_metadata?.full_name || email || "Client").trim();
    const { error } = await supabase.from("platform_support_requests").insert({
        requester_user_id: session.user.id,
        requester_name: requesterName,
        requester_email: email,
        organization_name: website.name,
        organization_id: website.organization_id,
        website_id: scopeInput?.value === "website" ? website.id : null,
        topic: topicInput.value,
        subject: subjectInput.value.trim(),
        message: messageInput.value.trim(),
        source: "client_portal",
        origin: "client",
        client_visible: true,
    });
    submitButton.disabled = false;
    if (error) {
        if (formStatus)
            formStatus.textContent = error.message || "Your request could not be sent.";
        return;
    }
    form.reset();
    form.hidden = true;
    if (formStatus)
        formStatus.textContent = "";
    if (status)
        status.textContent = "Your request was sent to N3XRA.";
    await loadRequests();
}
async function init() {
    if (!form || !list || !hasConfig())
        return;
    supabase = createBrowserSupabase();
    session = await getSessionOrNull(supabase);
    if (!session?.user)
        return;
    const tenant = await resolvePortalTenant(supabase);
    const { data, error } = await supabase.from("client_websites").select("id,name,organization_id").order("name");
    if (error)
        throw error;
    websites = scopeWebsitesToPortalTenant(data || [], tenant);
    openButton?.addEventListener("click", () => { form.hidden = false; topicInput?.focus(); });
    closeButton?.addEventListener("click", () => { form.hidden = true; });
    form.addEventListener("submit", (event) => { void submitRequest(event); });
    websiteSelect?.addEventListener("change", render);
    filterButtons.forEach((button) => button.addEventListener("click", () => {
        filter = button.dataset.clientSupportFilter || "active";
        filterButtons.forEach((item) => {
            const current = item === button;
            item.classList.toggle("is-current", current);
            item.setAttribute("aria-selected", String(current));
        });
        render();
    }));
    await loadRequests();
}
void init().catch((error) => {
    if (status)
        status.textContent = error instanceof Error ? error.message : "Requests and work could not be loaded.";
});
