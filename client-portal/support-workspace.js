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
const changeForm = document.querySelector("#client-change-assistant");
const changeRequest = document.querySelector("#client-change-request");
const changeReview = document.querySelector("#client-change-review");
const changeTitle = document.querySelector("#client-change-title");
const changeKind = document.querySelector("#client-change-kind");
const changeScope = document.querySelector("#client-change-scope");
const changeSummary = document.querySelector("#client-change-summary");
const changeQuestion = document.querySelector("#client-change-question");
const changeStatus = document.querySelector("#client-change-status");
const changeAnalyze = document.querySelector("#client-change-analyze");
const changeSubmit = document.querySelector("#client-change-submit");
const changeEdit = document.querySelector("#client-change-edit");
const exampleButtons = [...document.querySelectorAll("[data-change-example]")];
let supabase;
let session;
let websites = [];
let requests = [];
let updates = [];
let changeRuns = [];
let filter = "active";
let pendingAnalysis = null;
let progressPollTimer;
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const isPast = (request) => ["resolved", "closed"].includes(request.status);
const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const formatDateTime = (value) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function clientRunPresentation(run) {
    const stage = run.progress_stage || run.state || "queued";
    const presentations = {
        queued: ["Queued securely", "N3XRA accepted the request and queued the isolated GitHub workflow.", 0],
        codex_running: ["Codex is working", run.preview_mode === "n3xra_live" ? "The work continues securely in GitHub's isolated workspace without creating a remote branch or Vercel preview." : "The work continues securely in GitHub on a separate preview branch.", 1],
        validating: ["Checking the changes", "Codex finished editing. N3XRA is validating the changed files before creating the preview.", 2],
        deploying: ["Building your preview", run.preview_mode === "n3xra_live" ? "N3XRA is preparing the reusable live preview without creating a Vercel preview deployment." : "The separate GitHub branch is ready and Vercel is building the private preview.", 3],
        preview_ready: ["Your preview is ready", "Review the proposed change below. Nothing is live until N3XRA approves it.", 4],
        failed: ["Preview temporarily paused", "N3XRA has been notified and can safely retry it. Your live website was not changed, and you do not need to resubmit the request.", -1],
        merged: ["Approved and merged", "N3XRA approved the change and merged it into the website's main branch. Production has not been confirmed yet.", 5],
        production_deploying: ["Your update is building", "The approved change is on the main branch and Vercel is building the live website now.", 5],
        published: ["Your update is live", "Vercel finished the production deployment successfully. The approved change is now live.", 6],
        production_failed: ["Production needs attention", "The approved change reached main, but Vercel did not confirm a successful production deployment. N3XRA has been notified.", 5],
    };
    const [title, fallback, activeStep] = presentations[stage] || ["Preparing your preview", "The isolated preview workflow is in progress.", 0];
    return { title, message: run.progress_message && !["failed", "production_failed"].includes(stage) ? run.progress_message : fallback, stage, activeStep };
}
function renderProgressSteps(activeStep, failed, previewMode = "vercel") {
    const steps = ["Queued", "Codex editing", "Checking", previewMode === "n3xra_live" ? "Live preview" : "Vercel preview", "Review ready", "Production"];
    return `<ol class="client-change-progress" aria-label="Preview progress">${steps.map((step, index) => `<li class="${failed && index === Math.max(0, activeStep) ? "is-failed" : index < activeStep ? "is-complete" : index === activeStep ? "is-current" : ""}"><span>${index + 1}</span><small>${escapeHtml(step)}</small></li>`).join("")}</ol>`;
}
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
        const changeRun = changeRuns.find((run) => run.request_id === request.id);
        const previewStalled = Boolean(changeRun && ["queued", "coding"].includes(changeRun.state) && Date.now() - new Date(changeRun.created_at).getTime() > 35 * 60 * 1000);
        const runPresentation = changeRun ? clientRunPresentation(changeRun) : null;
        const requestStateLabel = request.automation_status === "awaiting_review" ? "Awaiting review" : ["failed", "production_failed"].includes(changeRun?.progress_stage || changeRun?.state || "") ? "N3XRA attention" : changeRun && (["queued", "coding"].includes(changeRun.state) || changeRun.progress_stage === "production_deploying") ? label(runPresentation?.stage || "in progress") : label(request.status);
        return `<article class="client-support-card is-${escapeHtml(request.status)}">
      <header class="client-support-card-head"><div><p class="portal-kicker">${escapeHtml(request.intake_mode === "ai_assisted" ? "AI-assisted website request" : label(request.topic))}</p><h3>${escapeHtml(request.subject)}</h3><p class="client-support-card-origin">${request.origin === "n3xra" ? "Started by N3XRA" : `Sent ${escapeHtml(formatDate(request.created_at))}`}</p></div><span class="client-support-state is-${escapeHtml(request.status)}">${escapeHtml(requestStateLabel)}</span></header>
      <p class="client-support-message">${escapeHtml(request.message)}</p>
      ${request.assistant_summary ? `<div class="client-support-assistant-summary"><strong>Organized summary</strong><p>${escapeHtml(request.assistant_summary)}</p></div>` : ""}
      ${changeRun ? `<div class="client-change-run"><strong>${escapeHtml(previewStalled ? "Preview is taking longer than expected" : runPresentation?.title)}</strong><p>${escapeHtml(previewStalled ? "N3XRA can see the recorded workflow stage and will review it. Your live website has not changed." : runPresentation?.message)}</p>${renderProgressSteps(runPresentation?.activeStep ?? 0, ["failed", "production_failed"].includes(changeRun.progress_stage || changeRun.state), changeRun.preview_mode)}<div class="client-change-run-meta"><span><strong>Preview method:</strong> ${escapeHtml(changeRun.preview_mode === "n3xra_live" ? "N3XRA Live Preview" : "Vercel Preview")}</span>${changeRun.preview_mode === "vercel" ? `<span><strong>Separate branch:</strong> ${escapeHtml(changeRun.branch_name)}</span>` : ""}<span><strong>Last update:</strong> ${escapeHtml(formatDateTime(changeRun.progress_updated_at || changeRun.updated_at || changeRun.created_at))}</span></div>${changeRun.preview_url && ["preview_ready", "client_ready"].includes(changeRun.state) ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(changeRun.preview_url)}" target="_blank" rel="noopener noreferrer">Open private preview</a>` : ""}${changeRun.production_deployment_url ? `<a class="portal-button" href="${escapeHtml(changeRun.production_deployment_url)}" target="_blank" rel="noopener noreferrer">Open production deployment</a>` : ""}${["queued", "coding"].includes(changeRun.state) || changeRun.progress_stage === "production_deploying" ? "<small>You can refresh, close, or leave this page without interrupting the work.</small>" : ""}</div>` : ""}
      <div class="client-support-meta"><span><strong>Timing:</strong> ${escapeHtml(timingLabel(request))}</span>${request.estimated_start_at ? `<span><strong>Estimated start:</strong> ${escapeHtml(formatDate(request.estimated_start_at))}</span>` : ""}</div>
      ${requestUpdates.length ? `<div class="client-support-updates">${requestUpdates.map((update) => `<div class="client-support-update"><p>${escapeHtml(update.message)}</p><small>${update.author_type === "n3xra" ? "N3XRA update" : "Client update"} · ${escapeHtml(formatDate(update.created_at))}</small></div>`).join("")}</div>` : ""}
    </article>`;
    }).join("") : `<div class="client-support-empty"><strong>${filter === "past" ? "No completed work yet" : "No active requests"}</strong><p>${filter === "past" ? "Completed and closed items will stay available here." : "Send a request whenever you would like N3XRA to work on something."}</p></div>`;
}
async function loadRequests() {
    if (!websites.length) {
        requests = [];
        updates = [];
        changeRuns = [];
        render();
        return;
    }
    const { data, error } = await supabase.from("platform_support_requests")
        .select("id,website_id,organization_id,topic,subject,message,status,origin,estimated_start_at,estimated_completion_at,created_at,updated_at,intake_mode,change_kind,change_scope,automation_status,assistant_summary")
        .eq("client_visible", true)
        .order("updated_at", { ascending: false });
    if (error)
        throw error;
    requests = (data || []);
    const requestIds = requests.map((request) => request.id);
    if (!requestIds.length) {
        updates = [];
        changeRuns = [];
    }
    else {
        const [updateResult, runResult] = await Promise.all([
            supabase.from("platform_support_request_updates").select("id,request_id,message,author_type,created_at").in("request_id", requestIds).eq("visible_to_client", true).order("created_at", { ascending: true }),
            supabase.from("website_change_runs").select("id,request_id,attempt_number,state,branch_name,target_repository,progress_stage,progress_message,progress_updated_at,preview_url,preview_mode,preview_expires_at,production_deployment_url,production_ready_at,error_message,created_at,updated_at,preview_ready_at,merged_at").in("request_id", requestIds).order("created_at", { ascending: false }),
        ]);
        if (updateResult.error) {
            console.error("Client-visible support updates could not be loaded.", updateResult.error);
            updates = [];
            if (status)
                status.textContent = "Requests loaded, but timeline updates are temporarily unavailable.";
        }
        else {
            updates = (updateResult.data || []);
        }
        if (runResult.error) {
            console.error("Website preview status could not be loaded.", runResult.error);
            changeRuns = [];
        }
        else {
            changeRuns = (runResult.data || []);
        }
    }
    render();
}
async function changeApi(action) {
    const website = currentWebsite();
    if (!website || !changeRequest)
        throw new Error("Choose a website before sending a change request.");
    const response = await fetch("/api/website-change-intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, websiteId: website.id, request: changeRequest.value.trim(), analysis: pendingAnalysis }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(payload.error || "The website request could not be prepared.");
    return payload;
}
function renderAnalysis(analysis) {
    pendingAnalysis = analysis;
    if (changeTitle)
        changeTitle.textContent = analysis.title;
    if (changeKind)
        changeKind.textContent = label(analysis.changeKind);
    if (changeScope)
        changeScope.textContent = analysis.changeScope === "code" ? "Code review" : analysis.changeScope === "content" ? "Content review" : "N3XRA review";
    if (changeSummary)
        changeSummary.textContent = analysis.summary;
    if (changeQuestion) {
        changeQuestion.hidden = !analysis.needsClarification;
        changeQuestion.textContent = analysis.clarificationQuestion ? `Before sending, consider adding: ${analysis.clarificationQuestion}` : "";
    }
    if (changeReview)
        changeReview.hidden = false;
    if (changeAnalyze)
        changeAnalyze.hidden = true;
    if (changeRequest)
        changeRequest.disabled = true;
}
async function analyzeChange(event) {
    event.preventDefault();
    if (!changeForm?.reportValidity() || !changeAnalyze)
        return;
    changeAnalyze.disabled = true;
    if (changeStatus)
        changeStatus.textContent = "Organizing your request…";
    try {
        const payload = await changeApi("analyze");
        renderAnalysis(payload.analysis);
        if (changeStatus)
            changeStatus.textContent = "Review the summary below before sending it.";
    }
    catch (error) {
        if (changeStatus)
            changeStatus.textContent = error instanceof Error ? error.message : "The request could not be prepared.";
    }
    finally {
        changeAnalyze.disabled = false;
    }
}
async function submitChange() {
    if (!pendingAnalysis || !changeSubmit)
        return;
    changeSubmit.disabled = true;
    if (changeStatus)
        changeStatus.textContent = "Sending your request for review…";
    try {
        await changeApi("submit");
        pendingAnalysis = null;
        if (changeForm)
            changeForm.reset();
        if (changeReview)
            changeReview.hidden = true;
        if (changeAnalyze)
            changeAnalyze.hidden = false;
        if (changeRequest)
            changeRequest.disabled = false;
        if (changeStatus)
            changeStatus.textContent = "Your request was submitted. N3XRA will review it before starting a private AI preview.";
        await loadRequests();
    }
    catch (error) {
        if (changeStatus)
            changeStatus.textContent = error instanceof Error ? error.message : "The request could not be sent.";
    }
    finally {
        changeSubmit.disabled = false;
    }
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
    window.clearInterval(progressPollTimer);
    progressPollTimer = window.setInterval(() => {
        const hasActiveRun = changeRuns.some((run) => ["queued", "coding", "merge_queued"].includes(run.state));
        if (hasActiveRun && document.visibilityState === "visible")
            void loadRequests();
    }, 8000);
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
    changeForm?.addEventListener("submit", (event) => { void analyzeChange(event); });
    changeSubmit?.addEventListener("click", () => { void submitChange(); });
    changeEdit?.addEventListener("click", () => {
        pendingAnalysis = null;
        if (changeReview)
            changeReview.hidden = true;
        if (changeAnalyze)
            changeAnalyze.hidden = false;
        if (changeRequest)
            changeRequest.disabled = false;
        changeRequest?.focus();
    });
    exampleButtons.forEach((button) => button.addEventListener("click", () => {
        if (changeRequest)
            changeRequest.value = button.dataset.changeExample || "";
        changeRequest?.focus();
    }));
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
