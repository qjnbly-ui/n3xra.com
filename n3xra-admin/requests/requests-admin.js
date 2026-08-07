import { createBrowserSupabase, getConfig, hasConfig } from "/shared/lib/supabase-client.js";
import { adminDialog, confirmAdminAction } from "/account/admin/admin-dialogs.js?v=2";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const statusScreen = document.getElementById("portal-status");
const requestList = document.getElementById("admin-request-list");
const requestDetail = document.getElementById("admin-request-detail");
const requestSummary = document.getElementById("admin-request-summary");
const requestCounts = document.getElementById("admin-request-counts");
const requestFilters = document.getElementById("admin-request-filters");

const ACTIONABLE_STATUSES = new Set(["unsubmitted", "submitted", "reviewing", "needs_info"]);
const STATUS_LABELS = {
  unsubmitted: "Recovery needed",
  submitted: "New",
  reviewing: "In review",
  needs_info: "Waiting on client",
  qualified: "Qualified",
  proposal_drafting: "Proposal drafting",
  proposal_sent: "Proposal sent",
  approved: "Approved",
  proposal_approved: "Proposal approved",
  declined: "Declined",
  converted: "Converted",
  archived: "Archived",
};

let supabase;
let currentSession;
let currentUser;
let requests = [];
let allRequests = [];
let aiReviews = [];
let websites = [];
let websiteMembers = [];
let selectedRequestId = "";
let currentFilter = "open";
const LOAD_TIMEOUT_MS = 12000;

async function fetchRequestWorkspace() {
  return postPlatformAdmin("list-website-request-workspace");
}

async function postPlatformAdmin(action, payload = {}) {
  const config = getConfig();
  const accessToken = currentSession?.access_token;
  if (!config.supabaseUrl || !config.supabaseAnonKey || !accessToken) throw new Error("Your admin session is unavailable. Refresh the page and sign in again.");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/platform-admin`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error) throw new Error(data?.error || `The request workspace returned ${response.status}.`);
    return data || {};
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request queue took too long to respond. Check your connection and retry.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function withTimeout(task, label) {
  let timer;
  return Promise.race([
    Promise.resolve(task),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} took too long to respond.`)), LOAD_TIMEOUT_MS);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatLabel(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function planLabel(value = "") {
  return value === "starter_plus" ? "Starter+" : value === "advanced" ? "Advanced" : value === "starter" ? "Starter" : "Not specified";
}

function formatDate(value, options = {}) {
  if (!value) return "Not provided";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: options.dateOnly ? undefined : "short" }).format(new Date(value));
}

function listMarkup(values) {
  return Array.isArray(values) && values.length
    ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
    : "<p>None specified</p>";
}

function requestStatus(request) {
  return STATUS_LABELS[request.status] || formatLabel(request.status);
}

function membershipsForRequest(request) {
  return websiteMembers.filter((member) => member.user_id === request?.user_id && member.status === "active");
}

function organizationForRequest(request) {
  const memberships = membershipsForRequest(request);
  const context = currentUser ? readWorkspaceContext("admin", currentUser.id) : {};
  const membership = memberships.find((item) => item.website_id === context.websiteId) || memberships[0];
  return websites.find((website) => website.id === membership?.website_id);
}

function nextStep(request) {
  if (request.recoverable_review) return { title: "Recover this completed intake", copy: "The client finished the intake and verified their email, but the final submission handoff did not create a request. Recover it to continue normally.", action: "recover" };
  if (!organizationForRequest(request) && ["qualified", "converted"].includes(request.status)) return { title: "Attach an organization", copy: "Choose or create the organization workspace before preparing its proposal.", action: "organization" };
  if (request.proposal_id) return { title: "Continue the proposal", copy: "A proposal already exists for this request.", action: "proposal" };
  if (request.status === "submitted") return { title: "Start the review", copy: "Read the scope, contact the client if needed, and record your decision.", action: "review" };
  if (request.status === "reviewing") return { title: "Make a qualification decision", copy: "Request missing information or qualify the request for a proposal.", action: "decision" };
  if (request.status === "needs_info") return { title: "Wait for the client’s reply", copy: "When the missing details arrive, resume review or qualify the request.", action: "waiting" };
  if (request.status === "qualified") return { title: "Create the proposal", copy: "The scope is qualified and ready for pricing and terms.", action: "proposal" };
  if (request.status === "declined") return { title: "Close out the request", copy: "Keep the record for reference or archive it from the active queue.", action: "closed" };
  return { title: "Review this request", copy: "Choose the appropriate next action below.", action: "decision" };
}

function filteredRequests() {
  return currentFilter === "open" ? requests.filter((request) => ACTIONABLE_STATUSES.has(request.status)) : requests;
}

function renderCounts() {
  const newCount = requests.filter((request) => request.status === "submitted").length;
  const actionCount = requests.filter((request) => ACTIONABLE_STATUSES.has(request.status)).length;
  requestCounts.innerHTML = `<span><strong>${newCount}</strong> new</span><span><strong>${actionCount}</strong> need action</span><span><strong>${requests.length}</strong> active</span>`;
  requestSummary.textContent = actionCount
    ? `${actionCount} request${actionCount === 1 ? "" : "s"} need your attention. Select one to process it.`
    : "Nothing needs action right now. You can review all active requests.";
}

function renderQueue() {
  const visible = filteredRequests();
  if (!visible.some((request) => request.id === selectedRequestId)) selectedRequestId = visible[0]?.id || "";
  requestList.innerHTML = visible.length ? visible.map((request) => `
    <button class="website-request-queue-item${request.id === selectedRequestId ? " is-current" : ""}" type="button" data-select-request="${request.id}">
      <span class="website-request-queue-top"><strong>${escapeHtml(request.business_name)}</strong><span class="website-request-status status-${escapeHtml(request.status)}">${escapeHtml(requestStatus(request))}</span></span>
      <span>${escapeHtml(request.contact_name)} · ${escapeHtml(formatLabel(request.project_type))}</span>
      <small>${escapeHtml(formatDate(request.created_at))}</small>
    </button>
  `).join("") : '<div class="website-request-queue-empty"><strong>Queue clear</strong><p>No requests match this view.</p></div>';
}

function contactMailto(request, needsInfo = false) {
  const subject = needsInfo ? `A few details for your ${request.business_name} website request` : `Your ${request.business_name} website request`;
  const body = needsInfo
    ? `Hi ${request.contact_name.split(/\s+/)[0]},\n\nThank you for your website request. I’m reviewing it now and need a few additional details before I can prepare the next step.\n\n`
    : `Hi ${request.contact_name.split(/\s+/)[0]},\n\nThank you for sending your website request. I’m reviewing the details and will follow up with the next step.\n\n`;
  return `mailto:${encodeURIComponent(request.contact_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function detailField(label, value, { link = "" } = {}) {
  const content = link && value ? `<a href="${escapeHtml(link)}">${escapeHtml(value)}</a>` : escapeHtml(value || "Not provided");
  return `<div class="website-request-field"><span>${escapeHtml(label)}</span><strong>${content}</strong></div>`;
}

function renderDetail() {
  const request = requests.find((item) => item.id === selectedRequestId);
  if (!request) {
    requestDetail.innerHTML = '<div class="website-request-detail-empty"><p class="portal-kicker">Intake desk</p><h2>Select a request</h2><p>Choose a submitted request from the queue to review and process it.</p></div>';
    return;
  }
  const step = nextStep(request);
  const linkedReview = aiReviews.find((review) => review.id === request.ai_review_id);
  const organization = organizationForRequest(request);
  const reviewResult = linkedReview?.review_snapshot || {};
  const isRecoverable = Boolean(request.recoverable_review);
  const proposalHref = `/n3xra-admin/proposals/?request=${encodeURIComponent(request.id)}`;
  requestDetail.innerHTML = `
    <header class="website-request-detail-head">
      <div><p class="portal-kicker">${escapeHtml(formatLabel(request.project_type))} · received ${escapeHtml(formatDate(request.created_at))}</p><h2>${escapeHtml(request.business_name)}</h2><p>${escapeHtml(request.primary_goal)}</p></div>
      <span class="website-request-status status-${escapeHtml(request.status)}">${escapeHtml(requestStatus(request))}</span>
    </header>
    <section class="website-request-next-step">
      <div><p class="portal-kicker">Next step</p><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.copy)}</p></div>
      <div class="website-request-primary-actions">
        ${step.action === "review" ? `<button class="portal-button" type="button" data-request-action="review">Start review</button>` : ""}
        ${step.action === "recover" ? `<button class="portal-button" type="button" data-request-action="recover">Recover into request queue</button>` : ""}
        ${["decision", "waiting"].includes(step.action) ? `<button class="portal-button" type="button" data-request-action="qualified">Qualify request</button>` : ""}
        ${step.action === "organization" ? '<button class="portal-button" type="button" data-request-action="attach">Attach organization</button>' : ""}
        ${step.action === "proposal" ? `<a class="portal-button" href="${proposalHref}" data-open-request-proposal>${request.proposal_id ? "Open proposal" : "Create proposal"}</a>` : ""}
      </div>
    </section>
    ${!isRecoverable ? `<section class="website-request-section website-request-organization">
      <div class="website-request-section-head"><div><p class="portal-kicker">Organization workspace</p><h3>${organization ? escapeHtml(organization.name) : "Not connected"}</h3><p>${organization ? "This request will remain scoped to this organization across Website Admin." : "Connect this client before moving the request into proposals, projects, files, or billing."}</p></div>${organization ? '<span class="website-request-status status-qualified">Connected</span>' : '<span class="website-request-status status-needs_info">Required</span>'}</div>
      <div class="website-request-organization-controls">
        <label>Organization<select data-request-organization="${request.id}">${websites.map((website) => `<option value="${website.id}"${website.id === organization?.id ? " selected" : ""}>${escapeHtml(website.name)}</option>`).join("")}</select></label>
        <button class="portal-button portal-button-secondary" type="button" data-request-action="attach">${organization ? "Use selected organization" : "Attach to selected"}</button>
        ${organization ? '<button class="portal-button portal-button-secondary" type="button" data-request-action="open-organization">Open organization overview</button>' : `<button class="portal-link-button" type="button" data-request-action="create-organization">Create “${escapeHtml(request.business_name)}”</button>`}
      </div>
    </section>` : ""}
    <div class="website-request-detail-grid">
      <section class="website-request-section">
        <div class="website-request-section-head"><div><p class="portal-kicker">Contact</p><h3>${escapeHtml(request.contact_name)}</h3></div><div><a class="portal-button portal-button-secondary" href="${contactMailto(request)}">Email</a>${request.contact_phone ? `<a class="portal-button portal-button-secondary" href="tel:${escapeHtml(request.contact_phone)}">Call</a>` : ""}</div></div>
        <div class="website-request-fields">${detailField("Email", request.contact_email, { link: `mailto:${request.contact_email}` })}${detailField("Phone", request.contact_phone, { link: request.contact_phone ? `tel:${request.contact_phone}` : "" })}${detailField("Existing website", request.existing_website_url, { link: request.existing_website_url || "" })}</div>
      </section>
      <section class="website-request-section">
        <div class="website-request-section-head"><div><p class="portal-kicker">Commercial fit</p><h3>Plan and timing</h3></div></div>
        <div class="website-request-fields">${detailField("Service plan", planLabel(request.service_plan))}${detailField("Budget", formatLabel(request.budget_range || "Not specified"))}${detailField("Target launch", request.target_launch_date ? formatDate(`${request.target_launch_date}T12:00:00`, { dateOnly: true }) : "Not specified")}${detailField("Referral", request.referral_code || "None")}</div>
      </section>
    </div>
    <section class="website-request-section">
      <div class="website-request-section-head"><div><p class="portal-kicker">Requested scope</p><h3>What they are asking for</h3></div></div>
      <div class="website-request-scope"><div><strong>Audience</strong><p>${escapeHtml(request.audience || "Not specified")}</p></div><div><strong>Pages</strong>${listMarkup(request.requested_pages)}</div><div><strong>Features</strong>${listMarkup(request.requested_features)}</div><div><strong>Additional notes</strong><p>${escapeHtml(request.additional_notes || "None")}</p></div></div>
      ${request.service_plan_reason ? `<div class="website-request-plan-note"><strong>Plan fit</strong><p>${escapeHtml(request.service_plan_reason)}</p></div>` : ""}
    </section>
    ${linkedReview ? `<details class="website-request-ai-summary"><summary>View pre-submission AI review</summary><div><p>${escapeHtml(reviewResult.message || "No AI confirmation saved.")}</p></div></details>` : ""}
    ${isRecoverable ? `<section class="website-request-decision"><div><p class="portal-kicker">Completed intake</p><h3>Ready to recover</h3><p>Recovering creates the missing submitted request and preserves this intake’s original date and AI review.</p></div><div class="website-request-decision-actions"><button class="portal-button" type="button" data-request-action="recover">Recover into request queue</button><a class="portal-button portal-button-secondary" href="${contactMailto(request)}">Email ${escapeHtml(request.contact_name.split(/\s+/)[0] || "client")}</a><button class="portal-link-button is-danger" type="button" data-request-action="delete-review">Delete permanently</button></div></section>` : `<section class="website-request-decision">
      <div><p class="portal-kicker">Admin record</p><h3>Decision and private notes</h3><p>Save context here so another administrator can understand what happened.</p></div>
      <label>Status<select data-request-status="${request.id}">${["submitted", "reviewing", "needs_info", "qualified", "declined", "converted"].map((status) => `<option value="${status}"${request.status === status ? " selected" : ""}>${escapeHtml(STATUS_LABELS[status] || formatLabel(status))}</option>`).join("")}</select></label>
      <label>Private notes<textarea rows="5" data-request-notes="${request.id}" placeholder="Call notes, missing details, fit assessment, or follow-up…">${escapeHtml(request.admin_notes || "")}</textarea></label>
      <div class="website-request-decision-actions">
        <button class="portal-button" type="button" data-request-action="save">Save review</button>
        <a class="portal-button portal-button-secondary" href="${contactMailto(request, true)}" data-needs-info-email>Request information</a>
        ${organization ? (!request.proposal_id ? `<a class="portal-button portal-button-secondary" href="${proposalHref}" data-open-request-proposal>Create proposal</a>` : `<a class="portal-button portal-button-secondary" href="${proposalHref}" data-open-request-proposal>Open proposal</a>`) : '<button class="portal-button portal-button-secondary" type="button" data-request-action="attach">Attach organization before proposal</button>'}
        <button class="portal-button portal-button-secondary" type="button" data-request-action="archive">Archive</button>
        ${!request.proposal_id ? `<button class="portal-link-button is-danger" type="button" data-request-action="delete">Delete permanently</button>` : ""}
      </div>
      <p class="portal-inline-status" id="admin-request-action-status" role="status"></p>
    </section>`}
  `;
}

function render() {
  renderCounts();
  renderQueue();
  renderDetail();
}

async function loadRequests() {
  requestSummary.textContent = "Loading submitted requests…";
  const workspace = await fetchRequestWorkspace();
  const proposals = new Map((workspace.proposals || []).map((proposal) => [proposal.request_id, proposal.id]));
  aiReviews = workspace.aiReviews || [];
  const submittedRequests = (workspace.requests || []).map((request) => ({ ...request, proposal_id: proposals.get(request.id) || "" }));
  const linkedReviewIds = new Set(submittedRequests.map((request) => request.ai_review_id).filter(Boolean));
  const recoverableRequests = aiReviews.filter((review) => !linkedReviewIds.has(review.id)).map((review) => {
    const project = review.project_snapshot || {};
    return {
      id: `review:${review.id}`,
      review_id: review.id,
      recoverable_review: true,
      ai_review_id: review.id,
      user_id: review.user_id || null,
      contact_name: project.contactName || "Unknown contact",
      business_name: project.businessName || "Incomplete website intake",
      contact_email: review.contact_email || project.email || "",
      contact_phone: project.phone || null,
      project_type: project.projectType || "new_website",
      existing_website_url: project.existingWebsiteUrl || null,
      primary_goal: project.primaryGoal || "No project goal was saved.",
      audience: project.primaryAudience || null,
      requested_pages: project.requestedPages || [],
      requested_features: project.requestedFeatures || [],
      service_plan: project.servicePlan || null,
      service_plan_reason: project.servicePlanReason || null,
      budget_range: project.budgetRange || null,
      target_launch_date: project.preferredLaunchDate || null,
      referral_code: project.referralCode || null,
      additional_notes: project.additionalNotes || null,
      status: "unsubmitted",
      created_at: review.created_at,
    };
  }).filter((request) => request.contact_email && request.business_name !== "Incomplete website intake");
  allRequests = [...submittedRequests, ...recoverableRequests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  websites = workspace.websites || [];
  websiteMembers = workspace.websiteMembers || [];
  requests = allRequests.filter((request) => request.status !== "archived");
  if (currentFilter === "open" && requests.length && !requests.some((request) => ACTIONABLE_STATUSES.has(request.status))) currentFilter = "all";
  const requestedId = new URLSearchParams(window.location.search).get("request");
  const requested = requests.find((request) => request.id === requestedId);
  if (!selectedRequestId && requested) {
    selectedRequestId = requested.id;
    if (!ACTIONABLE_STATUSES.has(requested.status)) currentFilter = "all";
  }
  requestFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("is-current", item.dataset.requestFilter === currentFilter));
  render();
}

async function updateRequest(requestId, values) {
  const payload = { ...values, reviewed_by_user_id: currentUser.id, reviewed_at: new Date().toISOString() };
  const { error } = await supabase.from("website_service_requests").update(payload).eq("id", requestId);
  if (error) throw error;
  await loadRequests();
}

async function markRequestNotificationRead(requestId) {
  if (!requestId) return;
  await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() })
    .eq("source_table", "website_service_requests")
    .eq("source_id", requestId)
    .is("read_at", null);
}

function rememberOrganization(website, request) {
  if (!website || !currentUser) return;
  writeWorkspaceContext("admin", currentUser.id, {
    websiteId: website.id,
    name: website.name,
    requestId: request?.id || null,
    proposalId: request?.proposal_id || null,
    projectId: null,
    onboardingId: null,
  });
}

async function attachRequestOrganization(request, websiteId) {
  const website = websites.find((item) => item.id === websiteId);
  if (!website) throw new Error("Select an organization first.");
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "assign-website-member", websiteId: website.id, email: request.contact_email, role: "owner" },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Unable to attach this organization.");
  rememberOrganization(website, request);
  await loadRequests();
}

function organizationSlug(request) {
  const base = String(request.business_name || "website")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "website";
  return `${base}-${request.id.slice(0, 6)}`;
}

async function createRequestOrganization(request) {
  const { data: website, error } = await supabase.from("client_websites").insert({
    name: request.business_name,
    slug: organizationSlug(request),
    live_url: request.existing_website_url || null,
    status: "draft",
  }).select("id,name,status,live_url").single();
  if (error) throw error;
  websites.push(website);
  await attachRequestOrganization(request, website.id);
}

async function saveRequest(requestId) {
  await updateRequest(requestId, {
    status: requestDetail.querySelector(`[data-request-status="${requestId}"]`)?.value,
    admin_notes: requestDetail.querySelector(`[data-request-notes="${requestId}"]`)?.value.trim() || null,
  });
}

async function deleteRequest(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request || request.proposal_id) throw new Error("Requests with proposal history cannot be deleted. Archive this request instead.");
  if (!await confirmAdminAction(`Permanently delete the request for “${request.business_name}”? This cannot be undone.`, { title: "Delete website request", confirmLabel: "Delete permanently" })) return;
  const { error } = await supabase.from("website_service_requests").delete().eq("id", requestId);
  if (error) throw error;
  selectedRequestId = "";
  await loadRequests();
}

async function runAction(action) {
  const request = requests.find((item) => item.id === selectedRequestId);
  if (!request) return;
  if (action === "delete-review") {
    if (!request.recoverable_review || !request.review_id) throw new Error("Only unrecovered intake drafts can be deleted here.");
    if (!await confirmAdminAction(`Permanently delete the saved intake for “${request.business_name}”? This cannot be undone.`, { title: "Delete saved intake", confirmLabel: "Delete permanently" })) return;
    await postPlatformAdmin("delete-website-request-review", { reviewId: request.review_id });
    selectedRequestId = "";
    const url = new URL(window.location.href);
    url.searchParams.delete("request");
    window.history.replaceState({}, "", url);
    await loadRequests();
  } else if (action === "recover") {
    const result = await postPlatformAdmin("recover-website-request-review", { reviewId: request.review_id });
    selectedRequestId = result.request?.id || "";
    await loadRequests();
  }
  else if (action === "save") await saveRequest(request.id);
  else if (action === "review") await updateRequest(request.id, { status: "reviewing" });
  else if (action === "qualified") await updateRequest(request.id, { status: "qualified" });
  else if (action === "attach") {
    const websiteId = requestDetail.querySelector(`[data-request-organization="${request.id}"]`)?.value;
    await attachRequestOrganization(request, websiteId);
  } else if (action === "create-organization") {
    if (await confirmAdminAction(`Create an organization workspace for “${request.business_name}” and attach ${request.contact_email} as its owner?`, { title: "Create organization workspace", confirmLabel: "Create workspace" })) await createRequestOrganization(request);
  } else if (action === "open-organization") {
    const websiteId = requestDetail.querySelector(`[data-request-organization="${request.id}"]`)?.value;
    const website = websites.find((item) => item.id === websiteId) || organizationForRequest(request);
    rememberOrganization(website, request);
    window.location.href = "/n3xra-admin/websites/";
  }
  else if (action === "archive") {
    if (await confirmAdminAction(`Archive the request for “${request.business_name}”?`, { title: "Archive request", confirmLabel: "Archive" })) await updateRequest(request.id, { status: "archived" });
  } else if (action === "delete") await deleteRequest(request.id);
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  statusScreen.textContent = "Checking your admin session…";
  const { data } = await withTimeout(supabase.auth.getSession(), "Your admin session");
  currentSession = data?.session || null;
  currentUser = currentSession?.user;
  if (!currentUser) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Frequests%2F");
    return;
  }
  statusScreen.textContent = "Verifying request administration access…";
  statusScreen.textContent = "Opening website requests…";
  await loadRequests();

  requestFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-request-filter]");
    if (!button) return;
    currentFilter = button.dataset.requestFilter;
    requestFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("is-current", item === button));
    renderQueue();
    renderDetail();
  });
  requestList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-request]");
    if (!button) return;
    selectedRequestId = button.dataset.selectRequest;
    const url = new URL(window.location.href);
    url.searchParams.set("request", selectedRequestId);
    window.history.replaceState({}, "", url);
    renderQueue();
    renderDetail();
    const selectedRequest = requests.find((request) => request.id === selectedRequestId);
    if (!selectedRequest?.recoverable_review) markRequestNotificationRead(selectedRequestId);
  });
  requestDetail.addEventListener("click", async (event) => {
    const proposalLink = event.target.closest("[data-open-request-proposal]");
    if (proposalLink) {
      const request = requests.find((item) => item.id === selectedRequestId);
      const website = organizationForRequest(request);
      rememberOrganization(website, request);
      return;
    }
    const infoEmail = event.target.closest("[data-needs-info-email]");
    if (infoEmail) {
      event.preventDefault();
      const emailHref = infoEmail.href;
      const request = requests.find((item) => item.id === selectedRequestId);
      try {
        if (request && request.status !== "needs_info") await updateRequest(request.id, { status: "needs_info" });
        window.location.href = emailHref;
      } catch (error) {
        await adminDialog({ title: "Request update failed", message: error?.message || "Unable to update this request.", confirmLabel: "Close" });
      }
      return;
    }
    const button = event.target.closest("[data-request-action]");
    if (!button) return;
    button.disabled = true;
    try {
      await runAction(button.dataset.requestAction);
    } catch (error) {
      await adminDialog({ title: "Request update failed", message: error?.message || "Unable to update this request.", confirmLabel: "Close" });
    } finally {
      button.disabled = false;
    }
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
  void withTimeout(markRequestNotificationRead(selectedRequestId), "Notification update").catch((error) => console.warn("Request notification could not be updated", error));
}

function showLoadFailure(error) {
  const message = error?.message || "Website requests could not be opened.";
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = false;
  statusScreen.classList.add("is-error");
  statusScreen.textContent = message;
  requestSummary.textContent = "The request queue could not be loaded.";
  requestCounts.replaceChildren();
  requestList.innerHTML = '<div class="website-request-queue-empty"><strong>Unable to load requests</strong><p>Retry the connection to the request queue.</p><button class="portal-button portal-button-secondary" type="button" data-retry-requests>Retry</button></div>';
  requestDetail.innerHTML = `<div class="website-request-detail-empty"><p class="portal-kicker">Request queue unavailable</p><h2>We could not open this workspace</h2><p>${escapeHtml(message)}</p></div>`;
  requestList.querySelector("[data-retry-requests]")?.addEventListener("click", () => window.location.reload());
}

init().catch(showLoadFailure);
