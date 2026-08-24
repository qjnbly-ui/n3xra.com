import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { resolvePortalTenant, scopeWebsitesToPortalTenant } from "./tenant-context.js";

interface WebsiteRow { id: string; name: string; organization_id: string | null }
interface SupportRequest {
  id: string;
  website_id: string | null;
  organization_id: string | null;
  topic: string;
  subject: string;
  message: string;
  status: string;
  origin: string;
  estimated_start_at: string | null;
  estimated_completion_at: string | null;
  created_at: string;
  updated_at: string;
  intake_mode: string;
  change_kind: string | null;
  change_scope: string | null;
  automation_status: string;
  assistant_summary: string | null;
}
interface ChangeAnalysis { title: string; summary: string; changeKind: string; changeScope: string; needsClarification: boolean; clarificationQuestion: string | null; requiresN3xraReview: true; canAutoApply: false }
interface SupportUpdate { id: string; request_id: string; message: string; author_type: string; created_at: string }
interface ChangeRun { id: string; request_id: string; attempt_number: number; state: string; branch_name: string; preview_url: string | null; error_message: string | null; created_at: string; preview_ready_at: string | null; merged_at: string | null }

const form = document.querySelector<HTMLFormElement>("#client-support-form");
const openButton = document.querySelector<HTMLButtonElement>("#client-support-new");
const closeButton = document.querySelector<HTMLButtonElement>("#client-support-close");
const submitButton = document.querySelector<HTMLButtonElement>("#client-support-submit");
const topicInput = document.querySelector<HTMLSelectElement>("#client-support-topic");
const scopeInput = document.querySelector<HTMLSelectElement>("#client-support-scope");
const websiteOption = document.querySelector<HTMLOptionElement>("#client-support-website-option");
const subjectInput = document.querySelector<HTMLInputElement>("#client-support-subject");
const messageInput = document.querySelector<HTMLTextAreaElement>("#client-support-message");
const formStatus = document.querySelector<HTMLElement>("#client-support-form-status");
const status = document.querySelector<HTMLElement>("#client-support-status");
const list = document.querySelector<HTMLElement>("#client-support-list");
const activeCount = document.querySelector<HTMLElement>("#client-support-active-count");
const pastCount = document.querySelector<HTMLElement>("#client-support-past-count");
const websiteSelect = document.querySelector<HTMLSelectElement>("#website-select");
const filterButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-client-support-filter]")];
const changeForm = document.querySelector<HTMLFormElement>("#client-change-assistant");
const changeRequest = document.querySelector<HTMLTextAreaElement>("#client-change-request");
const changeReview = document.querySelector<HTMLElement>("#client-change-review");
const changeTitle = document.querySelector<HTMLElement>("#client-change-title");
const changeKind = document.querySelector<HTMLElement>("#client-change-kind");
const changeScope = document.querySelector<HTMLElement>("#client-change-scope");
const changeSummary = document.querySelector<HTMLElement>("#client-change-summary");
const changeQuestion = document.querySelector<HTMLElement>("#client-change-question");
const changeStatus = document.querySelector<HTMLElement>("#client-change-status");
const changeAnalyze = document.querySelector<HTMLButtonElement>("#client-change-analyze");
const changeSubmit = document.querySelector<HTMLButtonElement>("#client-change-submit");
const changeEdit = document.querySelector<HTMLButtonElement>("#client-change-edit");
const exampleButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-change-example]")];

let supabase: any;
let session: any;
let websites: WebsiteRow[] = [];
let requests: SupportRequest[] = [];
let updates: SupportUpdate[] = [];
let changeRuns: ChangeRun[] = [];
let filter = "active";
let pendingAnalysis: ChangeAnalysis | null = null;

const escapeHtml = (value: unknown): string => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value: string): string => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const isPast = (request: SupportRequest): boolean => ["resolved", "closed"].includes(request.status);
const formatDate = (value: string): string => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function currentWebsite(): WebsiteRow | undefined {
  const selectedId = websiteSelect?.value || "";
  return websites.find((website) => website.id === selectedId) || websites[0];
}

function timingLabel(request: SupportRequest): string {
  if (["resolved", "closed"].includes(request.status)) return `Completed ${formatDate(request.updated_at)}`;
  if (!request.estimated_completion_at) return "Estimated timing pending";
  const remainingMs = new Date(request.estimated_completion_at).getTime() - Date.now();
  const days = Math.ceil(remainingMs / 86_400_000);
  if (days < 0) return `Estimate under review · ${formatDate(request.estimated_completion_at)}`;
  if (days === 0) return "Estimated completion today";
  return `About ${days} day${days === 1 ? "" : "s"} remaining`;
}

function render(): void {
  if (!list) return;
  const websiteId = currentWebsite()?.id;
  const organizationId = currentWebsite()?.organization_id || null;
  if (websiteOption) websiteOption.textContent = currentWebsite() ? `${currentWebsite()?.name} website` : "Selected website";
  const websiteRequests = requests.filter((request) => request.website_id === websiteId || (!request.website_id && (!request.organization_id || (organizationId && request.organization_id === organizationId))));
  const active = websiteRequests.filter((request) => !isPast(request));
  const past = websiteRequests.filter(isPast);
  if (activeCount) activeCount.textContent = String(active.length);
  if (pastCount) pastCount.textContent = String(past.length);
  const visible = filter === "past" ? past : active;
  list.innerHTML = visible.length ? visible.map((request) => {
    const requestUpdates = updates.filter((update) => update.request_id === request.id);
    const changeRun = changeRuns.find((run) => run.request_id === request.id);
    const previewStalled = Boolean(changeRun && ["queued", "coding"].includes(changeRun.state) && Date.now() - new Date(changeRun.created_at).getTime() > 35 * 60 * 1000);
    return `<article class="client-support-card is-${escapeHtml(request.status)}">
      <header class="client-support-card-head"><div><p class="portal-kicker">${escapeHtml(request.intake_mode === "ai_assisted" ? "AI-assisted website request" : label(request.topic))}</p><h3>${escapeHtml(request.subject)}</h3><p class="client-support-card-origin">${request.origin === "n3xra" ? "Started by N3XRA" : `Sent ${escapeHtml(formatDate(request.created_at))}`}</p></div><span class="client-support-state is-${escapeHtml(request.status)}">${escapeHtml(request.automation_status === "awaiting_review" ? "Awaiting review" : label(request.status))}</span></header>
      <p class="client-support-message">${escapeHtml(request.message)}</p>
      ${request.assistant_summary ? `<div class="client-support-assistant-summary"><strong>Organized summary</strong><p>${escapeHtml(request.assistant_summary)}</p></div>` : ""}
      ${changeRun ? `<div class="client-change-run"><strong>${escapeHtml(changeRun.state === "merged" ? "Approved and published" : changeRun.state === "preview_ready" || changeRun.state === "client_ready" ? "Your preview is ready" : changeRun.state === "failed" || previewStalled ? "Preview needs attention" : "Creating your private preview")}</strong><p>${escapeHtml(changeRun.state === "merged" ? "N3XRA approved this change and merged it into the website's main branch." : changeRun.state === "preview_ready" || changeRun.state === "client_ready" ? "Review the proposed change below. Nothing is live until N3XRA approves it." : changeRun.state === "failed" || previewStalled ? (changeRun.error_message || "The preview did not finish. N3XRA can safely retry it after review.") : "Codex is preparing an isolated branch. This may take a few minutes.")}</p>${changeRun.preview_url ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(changeRun.preview_url)}" target="_blank" rel="noopener noreferrer">Open private preview</a>` : ""}<small>Attempt ${escapeHtml(changeRun.attempt_number)} · ${escapeHtml(label(changeRun.state))}</small></div>` : ""}
      <div class="client-support-meta"><span><strong>Timing:</strong> ${escapeHtml(timingLabel(request))}</span>${request.estimated_start_at ? `<span><strong>Estimated start:</strong> ${escapeHtml(formatDate(request.estimated_start_at))}</span>` : ""}</div>
      ${requestUpdates.length ? `<div class="client-support-updates">${requestUpdates.map((update) => `<div class="client-support-update"><p>${escapeHtml(update.message)}</p><small>${update.author_type === "n3xra" ? "N3XRA update" : "Client update"} · ${escapeHtml(formatDate(update.created_at))}</small></div>`).join("")}</div>` : ""}
    </article>`;
  }).join("") : `<div class="client-support-empty"><strong>${filter === "past" ? "No completed work yet" : "No active requests"}</strong><p>${filter === "past" ? "Completed and closed items will stay available here." : "Send a request whenever you would like N3XRA to work on something."}</p></div>`;
}

async function loadRequests(): Promise<void> {
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
  if (error) throw error;
  requests = (data || []) as SupportRequest[];
  const requestIds = requests.map((request) => request.id);
  if (!requestIds.length) {
    updates = [];
    changeRuns = [];
  } else {
    const [updateResult, runResult] = await Promise.all([
      supabase.from("platform_support_request_updates").select("id,request_id,message,author_type,created_at").in("request_id", requestIds).eq("visible_to_client", true).order("created_at", { ascending: true }),
      supabase.from("website_change_runs").select("id,request_id,attempt_number,state,branch_name,preview_url,error_message,created_at,preview_ready_at,merged_at").in("request_id", requestIds).order("created_at", { ascending: false }),
    ]);
    if (updateResult.error) {
      console.error("Client-visible support updates could not be loaded.", updateResult.error);
      updates = [];
      if (status) status.textContent = "Requests loaded, but timeline updates are temporarily unavailable.";
    } else {
      updates = (updateResult.data || []) as SupportUpdate[];
    }
    if (runResult.error) {
      console.error("Website preview status could not be loaded.", runResult.error);
      changeRuns = [];
    } else {
      changeRuns = (runResult.data || []) as ChangeRun[];
    }
  }
  render();
}

async function changeApi(action: "analyze" | "submit"): Promise<any> {
  const website = currentWebsite();
  if (!website || !changeRequest) throw new Error("Choose a website before sending a change request.");
  const response = await fetch("/api/website-change-intake", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, websiteId: website.id, request: changeRequest.value.trim(), analysis: pendingAnalysis }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The website request could not be prepared.");
  return payload;
}

function renderAnalysis(analysis: ChangeAnalysis): void {
  pendingAnalysis = analysis;
  if (changeTitle) changeTitle.textContent = analysis.title;
  if (changeKind) changeKind.textContent = label(analysis.changeKind);
  if (changeScope) changeScope.textContent = analysis.changeScope === "code" ? "Code review" : analysis.changeScope === "content" ? "Content review" : "N3XRA review";
  if (changeSummary) changeSummary.textContent = analysis.summary;
  if (changeQuestion) {
    changeQuestion.hidden = !analysis.needsClarification;
    changeQuestion.textContent = analysis.clarificationQuestion ? `Before sending, consider adding: ${analysis.clarificationQuestion}` : "";
  }
  if (changeReview) changeReview.hidden = false;
  if (changeAnalyze) changeAnalyze.hidden = true;
  if (changeRequest) changeRequest.disabled = true;
}

async function analyzeChange(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!changeForm?.reportValidity() || !changeAnalyze) return;
  changeAnalyze.disabled = true;
  if (changeStatus) changeStatus.textContent = "Organizing your request…";
  try {
    const payload = await changeApi("analyze");
    renderAnalysis(payload.analysis as ChangeAnalysis);
    if (changeStatus) changeStatus.textContent = "Review the summary below before sending it.";
  } catch (error) {
    if (changeStatus) changeStatus.textContent = error instanceof Error ? error.message : "The request could not be prepared.";
  } finally {
    changeAnalyze.disabled = false;
  }
}

async function submitChange(): Promise<void> {
  if (!pendingAnalysis || !changeSubmit) return;
  changeSubmit.disabled = true;
  if (changeStatus) changeStatus.textContent = "Sending your request for review…";
  try {
    await changeApi("submit");
    pendingAnalysis = null;
    if (changeForm) changeForm.reset();
    if (changeReview) changeReview.hidden = true;
    if (changeAnalyze) changeAnalyze.hidden = false;
    if (changeRequest) changeRequest.disabled = false;
    if (changeStatus) changeStatus.textContent = "Your request was submitted. N3XRA will review it before starting a private AI preview.";
    await loadRequests();
  } catch (error) {
    if (changeStatus) changeStatus.textContent = error instanceof Error ? error.message : "The request could not be sent.";
  } finally {
    changeSubmit.disabled = false;
  }
}

async function submitRequest(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const website = currentWebsite();
  if (!website || !form?.reportValidity() || !topicInput || !subjectInput || !messageInput || !submitButton) return;
  submitButton.disabled = true;
  if (formStatus) formStatus.textContent = "Sending your request…";
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
    if (formStatus) formStatus.textContent = error.message || "Your request could not be sent.";
    return;
  }
  form.reset();
  form.hidden = true;
  if (formStatus) formStatus.textContent = "";
  if (status) status.textContent = "Your request was sent to N3XRA.";
  await loadRequests();
}

async function init(): Promise<void> {
  if (!form || !list || !hasConfig()) return;
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) return;
  const tenant = await resolvePortalTenant(supabase);
  const { data, error } = await supabase.from("client_websites").select("id,name,organization_id").order("name");
  if (error) throw error;
  websites = scopeWebsitesToPortalTenant(data || [], tenant) as WebsiteRow[];
  openButton?.addEventListener("click", () => { form.hidden = false; topicInput?.focus(); });
  closeButton?.addEventListener("click", () => { form.hidden = true; });
  form.addEventListener("submit", (event) => { void submitRequest(event); });
  changeForm?.addEventListener("submit", (event) => { void analyzeChange(event); });
  changeSubmit?.addEventListener("click", () => { void submitChange(); });
  changeEdit?.addEventListener("click", () => {
    pendingAnalysis = null;
    if (changeReview) changeReview.hidden = true;
    if (changeAnalyze) changeAnalyze.hidden = false;
    if (changeRequest) changeRequest.disabled = false;
    changeRequest?.focus();
  });
  exampleButtons.forEach((button) => button.addEventListener("click", () => {
    if (changeRequest) changeRequest.value = button.dataset.changeExample || "";
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

void init().catch((error: unknown) => {
  if (status) status.textContent = error instanceof Error ? error.message : "Requests and work could not be loaded.";
});
