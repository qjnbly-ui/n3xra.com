let supportRequests = [];
let supportUpdates = [];
let supportWebsites = [];
let supportOrganizations = [];
let supportAccounts = [];
let supportOrganizationMemberships = [];
let supportWebsiteMemberships = [];
let supportProductEntitlements = [];
let supportChangeRuns = [];
let invoke;
let invokeWebsiteAutomation;
let escapeHtml;
let formatDate;
let setStatus;
let confirmAdminAction;
let supportPollTimer;

const SUPPORT_TOPIC_OPTIONS = [
  ["general-support", "General support"],
  ["account-access", "Account or access"],
  ["billing", "Billing"],
  ["communications", "Communications", "communications"],
  ["records", "Records", "records"],
  ["website-change", "Website", "website"],
  ["analytics", "Analytics", "website"],
  ["new-feature", "New feature or idea"],
  ["technical-support", "Technical support"],
  ["other", "Other"],
];

function selectedClientTargets() {
  const userId = document.getElementById("support-work-account")?.value || "";
  const organizationIds = new Set([
    ...supportOrganizations.filter((organization) => organization.owner_user_id === userId).map((organization) => organization.id),
    ...supportOrganizationMemberships.filter((membership) => membership.user_id === userId).map((membership) => membership.organization_id),
  ]);
  const websiteIds = new Set(supportWebsiteMemberships
    .filter((membership) => membership.user_id === userId && membership.status === "active")
    .map((membership) => membership.website_id));
  const organizations = supportOrganizations.filter((organization) => organizationIds.has(organization.id));
  const websites = supportWebsites.filter((website) => websiteIds.has(website.id));
  const entitlements = supportProductEntitlements.filter((entitlement) => organizationIds.has(entitlement.organization_id)
    && entitlement.portal_enabled
    && ["active", "trialing"].includes(entitlement.status));
  return { userId, organizations, websites, entitlements };
}

function renderSupportWorkTargets() {
  const topicSelect = document.getElementById("support-work-topic");
  const contextSelect = document.getElementById("support-work-context");
  if (!topicSelect || !contextSelect) return;
  const { userId, organizations, websites, entitlements } = selectedClientTargets();
  const entitledProducts = new Set(entitlements.map((entitlement) => entitlement.product_key));
  const priorTopic = topicSelect.value || "general-support";
  const topicOptions = SUPPORT_TOPIC_OPTIONS.filter(([, , requirement]) => !requirement
    || (requirement === "website" ? websites.length > 0 : entitledProducts.has(requirement)));
  topicSelect.innerHTML = topicOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  topicSelect.value = topicOptions.some(([value]) => value === priorTopic) ? priorTopic : "general-support";

  const topic = topicSelect.value;
  const productKey = ["communications", "records"].includes(topic) ? topic : "";
  const websiteRequired = ["website-change", "analytics"].includes(topic);
  let eligibleOrganizations = organizations;
  let eligibleWebsites = websites;
  if (productKey) {
    const entitledOrganizationIds = new Set(entitlements
      .filter((entitlement) => entitlement.product_key === productKey)
      .map((entitlement) => entitlement.organization_id));
    eligibleOrganizations = organizations.filter((organization) => entitledOrganizationIds.has(organization.id));
    eligibleWebsites = [];
  } else if (websiteRequired) {
    eligibleOrganizations = [];
  }

  const priorContext = contextSelect.value;
  const placeholder = !userId
    ? "Choose a client account first"
    : websiteRequired
      ? "Choose one of this client’s websites"
      : productKey
        ? `Choose an organization subscribed to ${productKey === "records" ? "Records" : "Communications"}`
        : "General N3XRA account";
  const organizationOptions = eligibleOrganizations.length
    ? `<optgroup label="Organizations">${eligibleOrganizations.map((organization) => `<option value="organization:${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join("")}</optgroup>`
    : "";
  const websiteOptions = eligibleWebsites.length
    ? `<optgroup label="Websites">${eligibleWebsites.map((website) => `<option value="website:${escapeHtml(website.id)}">${escapeHtml(website.name)}</option>`).join("")}</optgroup>`
    : "";
  contextSelect.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${organizationOptions}${websiteOptions}`;
  contextSelect.disabled = !userId;
  contextSelect.required = websiteRequired || Boolean(productKey);
  if ([...contextSelect.options].some((option) => option.value === priorContext)) contextSelect.value = priorContext;
}

function supportLabel(request) {
  return `${request.subject} — ${request.requester_name} (${request.status})`;
}

function supportInitials(request) {
  return String(request?.requester_name || request?.requester_email || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function supportStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function changeRunPresentation(run) {
  const stage = run?.progress_stage || run?.state || "queued";
  const presentations = {
    queued: ["Queued in GitHub", "The request was accepted and is waiting for the isolated GitHub workflow to begin."],
    codex_running: ["Codex is working", "Codex is reviewing the connected website and editing only the isolated request branch."],
    validating: ["Checking Codex’s changes", "Codex finished editing. N3XRA is validating the changed files before the branch is pushed."],
    deploying: run?.preview_mode === "n3xra_live"
      ? ["N3XRA is building the live preview", "The isolated workspace is ready and N3XRA is preparing the reusable preview link without a Vercel preview deployment."]
      : ["Vercel is building the preview", "The isolated GitHub branch is ready and Vercel is preparing its private preview."],
    preview_ready: ["Private preview ready", "The preview is ready for review. Nothing reaches the main branch until an N3XRA administrator approves it."],
    failed: ["Preview workflow paused", "The automated workflow stopped before a review link was ready. The live website was not changed."],
    merged: ["Approved and merged", "The reviewed branch was merged into main. Production deployment has not been confirmed yet."],
    production_deploying: ["Vercel is building production", "The approved change is on the main branch and Vercel is building the live website now."],
    published: ["Update is live", "Vercel finished the production deployment successfully. The approved change is now live."],
    production_failed: ["Production needs attention", "The approved change reached main, but Vercel did not confirm a successful production deployment."],
    abandoned: ["Preview abandoned", "The client closed this request. The private preview link was revoked and the live website was not changed."],
  };
  const [title, fallback] = presentations[stage] || ["Preview status", "The isolated preview workflow is being tracked."];
  return { stage, title, message: run?.progress_message || fallback };
}

function githubRunLinks(run) {
  const repository = /^[^/\s]+\/[^/\s]+$/.test(String(run?.target_repository || "")) ? run.target_repository : "";
  const branchUrl = repository && run?.branch_name ? `https://github.com/${repository}/tree/${encodeURIComponent(run.branch_name)}` : "";
  const workflowUrl = /^https:\/\/github[.]com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(String(run?.workflow_url || "")) ? run.workflow_url : "";
  return { repository, branchUrl, workflowUrl };
}

function datetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
}

function isoValue(value) {
  return value ? new Date(value).toISOString() : "";
}

function renderSupportOptions() {
  const select = document.getElementById("support-select");
  if (!select) return;
  const status = document.getElementById("support-filter")?.value || "open";
  const priority = document.getElementById("support-priority-filter")?.value || "all";
  const query = String(document.getElementById("support-search")?.value || "").trim().toLowerCase();
  const filtered = supportRequests.filter((item) => {
    const statusMatch = status === "all" || (status === "open" ? !["resolved", "closed"].includes(item.status) : item.status === status);
    const priorityMatch = priority === "all" || item.priority === priority;
    const searchable = [item.subject, item.requester_name, item.requester_email, item.organization_name, item.topic, item.message, item.status, item.priority, item.change_kind, item.automation_status, item.assistant_summary].join(" ").toLowerCase();
    return statusMatch && priorityMatch && (!query || searchable.includes(query));
  });
  const current = select.value;
  select.innerHTML = filtered.map((request) => `<option value="${escapeHtml(request.id)}">${escapeHtml(supportLabel(request))}</option>`).join("");
  if (filtered.some((request) => request.id === current)) select.value = current;
  const list = document.getElementById("support-list");
  if (list) {
    list.innerHTML = filtered.length ? filtered.map((request) => `
      <button class="support-request-item${request.id === select.value ? " is-selected" : ""}" type="button" data-support-request-id="${escapeHtml(request.id)}">
        <span class="support-request-avatar">${escapeHtml(supportInitials(request))}</span>
        <span class="support-request-copy"><strong>${escapeHtml(request.subject || "Support request")}</strong><small>${escapeHtml(request.requester_name || request.requester_email || "Unknown requester")} · ${escapeHtml(formatDate(request.created_at))}</small></span>
        <span class="support-priority-mark is-${escapeHtml(request.priority || "normal")}" title="${escapeHtml(request.priority || "normal")} priority"></span>
      </button>
    `).join("") : '<div class="support-empty-list"><strong>No support cases here</strong><p>New requests matching this view will appear in the queue.</p></div>';
  }
  const count = document.getElementById("support-count");
  if (count) count.textContent = `${filtered.length} of ${supportRequests.length}`;
  const openCount = supportRequests.filter((item) => !["resolved", "closed"].includes(item.status)).length;
  const newCount = supportRequests.filter((item) => item.status === "new").length;
  const urgentCount = supportRequests.filter((item) => item.priority === "urgent" && !["resolved", "closed"].includes(item.status)).length;
  const summary = document.getElementById("support-summary");
  if (summary) summary.innerHTML = `<span><strong>${openCount}</strong> open</span><span><strong>${newCount}</strong> new</span><span class="${urgentCount ? "has-urgent" : ""}"><strong>${urgentCount}</strong> urgent</span>`;
  renderSelectedSupport();
}

function renderSelectedSupport() {
  const select = document.getElementById("support-select");
  const detail = document.getElementById("support-detail");
  if (!select || !detail) return;
  const request = supportRequests.find((item) => item.id === select.value);
  if (!request) {
    detail.innerHTML = '<div class="support-empty-detail"><p class="portal-kicker">Support operations</p><h2>No case selected</h2><p>Select a support request from the queue to review the message, account context, and internal handling notes.</p></div>';
    return;
  }
  const accountParams = new URLSearchParams({ email: request.requester_email || "" });
  if (request.requester_user_id) accountParams.set("user", request.requester_user_id);
  const mailSubject = encodeURIComponent(`Re: ${request.subject || "N3XRA support request"}`);
  const clientUpdates = supportUpdates.filter((update) => update.request_id === request.id && update.visible_to_client);
  const changeRun = supportChangeRuns.find((run) => run.request_id === request.id);
  const requestWebsite = supportWebsites.find((website) => website.id === request.website_id);
  const runPresentation = changeRun ? changeRunPresentation(changeRun) : null;
  const runLinks = changeRun ? githubRunLinks(changeRun) : { repository: "", branchUrl: "", workflowUrl: "" };
  const assistantSummary = String(request.assistant_summary || "").trim();
  const requestMessage = String(request.message || "").trim();
  const showAssistantSummary = assistantSummary && assistantSummary.toLocaleLowerCase() !== requestMessage.toLocaleLowerCase();
  const runIsActive = Boolean(changeRun && ["queued", "coding"].includes(changeRun.state));
  const runIsReviewable = Boolean(changeRun && ["preview_ready", "client_ready"].includes(changeRun.state));
  const runCanMerge = Boolean(changeRun && (changeRun.preview_mode !== "n3xra_live" ? runIsReviewable : changeRun.state === "client_ready"));
  detail.innerHTML = `
    <header class="support-detail-head">
      <div class="support-request-identity"><span class="support-request-avatar is-large" aria-hidden="true">${escapeHtml(supportInitials(request))}</span><div><p class="portal-kicker">${escapeHtml(request.topic || "Support request")}</p><h2>${escapeHtml(request.subject || "Support request")}</h2><p>${escapeHtml(request.requester_name || "Unknown requester")} · ${escapeHtml(request.requester_email || "No email")}</p><span class="support-case-state is-${escapeHtml(request.status || "new")}">${escapeHtml(supportStatusLabel(request.status))}</span></div></div>
      <div class="support-detail-actions"><a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Account oversight</a>${request.origin === "n3xra" ? "" : `<a class="portal-button" href="mailto:${escapeHtml(request.requester_email || "")}?subject=${mailSubject}">Reply by email</a>`}</div>
    </header>
    <div class="support-detail-facts">
      <div><span>Status</span><strong>${escapeHtml(supportStatusLabel(request.status))}</strong></div>
      <div><span>Priority</span><strong>${escapeHtml(request.priority || "normal")}</strong></div>
      <div><span>Received</span><strong>${escapeHtml(formatDate(request.created_at))}</strong></div>
      <div><span>Last updated</span><strong>${escapeHtml(formatDate(request.updated_at))}</strong></div>
      <div><span>Estimated completion</span><strong>${escapeHtml(formatDate(request.estimated_completion_at))}</strong></div>
    </div>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Customer message</p><h3>Request details</h3></div></div>
      <div class="support-message">${escapeHtml(request.message || "No message was provided.")}</div>
    </section>
    ${request.intake_mode === "ai_assisted" ? `<section class="support-detail-section support-change-section">
      <div class="support-run-head">
        <div><p class="portal-kicker">Website Change Assistant</p><h3>${escapeHtml(runPresentation?.title || (requestWebsite?.live_preview_enabled ? "Preparing Fast Preview" : "Organized for review"))}</h3><p>${escapeHtml(runPresentation?.message || (requestWebsite?.live_preview_enabled ? "Fast Preview normally starts as soon as the client submits. If it has not started, you can safely retry it here." : "No code has been changed yet. Review the request before starting a Vercel preview."))}</p></div>
        <span class="support-run-status is-${escapeHtml(runPresentation?.stage || "awaiting_review")}">${escapeHtml(supportStatusLabel(runPresentation?.stage || "awaiting review"))}</span>
      </div>
      ${changeRun?.preview_url && runIsReviewable ? `<div class="support-review-panel"><div><strong>${runCanMerge ? "Review the submitted change" : "Client editing session is open"}</strong><span>${runCanMerge ? "Open the private preview first. The live website will not change until you approve it." : "The client can keep refining this Fast Preview. Final approval becomes available after they submit the version to N3XRA."}</span></div><div class="support-review-actions"><a class="portal-button portal-button-secondary" href="${escapeHtml(changeRun.preview_url)}" target="_blank" rel="noopener noreferrer">Open private preview</a>${runCanMerge ? `<button class="portal-button" id="support-approve-merge" type="button">Approve and merge to main</button>` : ""}</div></div>` : ""}
      ${!changeRun ? `<div class="support-preview-method"><div class="support-preview-method-head"><div><strong>${requestWebsite?.live_preview_enabled ? "Fast Preview did not start" : "Choose the preview method"}</strong><span>${requestWebsite?.live_preview_enabled ? "The client request was saved. Retry Fast Preview here, or use the Vercel fallback." : "Vercel Preview waits for an administrator before Codex begins."}</span></div></div><div class="support-preview-method-options" role="radiogroup" aria-label="Preview method"><label class="support-preview-option${requestWebsite?.live_preview_enabled ? "" : " is-disabled"}"><input type="radio" name="support-preview-mode" value="n3xra_live"${requestWebsite?.live_preview_enabled ? " checked" : " disabled"}><span><strong>Fast Live Preview <small>Beta</small></strong><em>Normally starts automatically when the client submits. It creates an expiring N3XRA link without a Vercel preview deployment, and the GitHub commit waits for your approval.</em>${requestWebsite?.live_preview_enabled ? "" : "<b>Not enabled for this website</b>"}</span></label><label class="support-preview-option"><input type="radio" name="support-preview-mode" value="vercel"${requestWebsite?.live_preview_enabled ? "" : " checked"}><span><strong>Vercel Preview</strong><em>Uses the existing private branch and production-style Vercel preview workflow.</em></span></label></div><div class="support-review-panel"><div><strong>Start the selected preview</strong><span>Nothing will be merged into main or published without a later approval.</span></div><button class="portal-button" id="support-start-preview" type="button">${requestWebsite?.live_preview_enabled ? "Start preview" : "Approve &amp; Start AI Preview"}</button></div></div>` : ""}
      ${showAssistantSummary ? `<div class="support-run-summary"><span>Organized summary</span><p>${escapeHtml(assistantSummary)}</p></div>` : ""}
      <div class="support-run-meta"><span><small>Change</small><strong>${escapeHtml(supportStatusLabel(request.change_kind || "other"))}</strong></span><span><small>Area</small><strong>${escapeHtml(supportStatusLabel(request.change_scope || "unknown"))}</strong></span>${changeRun ? `<span><small>Updated</small><strong>${escapeHtml(formatDate(changeRun.progress_updated_at || changeRun.updated_at || changeRun.created_at))}</strong></span>` : ""}</div>
      ${runIsActive ? `<p class="support-run-note">Progress will update automatically. You can refresh, close, or leave this page without interrupting the work.</p>` : ""}
      ${changeRun?.error_message ? `<div class="support-run-error">${escapeHtml(changeRun.error_message)}</div>` : ""}
      ${changeRun && ["failed", "changes_requested"].includes(changeRun.state) && Number(changeRun.attempt_number || 0) < 3 ? `<div class="support-review-panel is-retry"><div><strong>The preview needs another run</strong><span>The live website was not changed. Review the recorded error before retrying.</span></div><button class="portal-button" id="support-start-preview" type="button">Retry AI Preview</button></div>` : ""}
      ${changeRun ? `<details class="support-technical-details"><summary>Technical details</summary><div class="support-context-rows"><div><span>Preview method</span><strong>${escapeHtml(changeRun.preview_mode === "n3xra_live" ? "N3XRA Live Preview" : "Vercel Preview")}</strong></div><div><span>Repository</span><strong class="support-identifier">${escapeHtml(runLinks.repository || "Resolving connected repository")}</strong></div>${changeRun.preview_mode === "vercel" ? `<div><span>Private branch</span><strong class="support-identifier">${runLinks.branchUrl ? `<a href="${escapeHtml(runLinks.branchUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(changeRun.branch_name)}</a>` : escapeHtml(changeRun.branch_name)}</strong></div>` : `<div><span>GitHub commit</span><strong>Created only after approval</strong></div>`}<div><span>Automation state</span><strong>${escapeHtml(supportStatusLabel(request.automation_status || "awaiting_review"))}</strong></div><div><span>Automation run</span><strong>${escapeHtml(changeRun.attempt_number)} of 3</strong></div><div><span>Started</span><strong>${escapeHtml(formatDate(changeRun.created_at))}</strong></div></div>${runLinks.workflowUrl ? `<a class="support-workflow-link" href="${escapeHtml(runLinks.workflowUrl)}" target="_blank" rel="noopener noreferrer">View GitHub workflow</a>` : ""}</details>` : ""}
    </section>` : ""}
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Case context</p><h3>Requester and source</h3></div></div>
      <div class="support-context-rows">
        <div><span>Organization</span><strong>${escapeHtml(request.organization_name || "Not provided")}</strong></div>
        <div><span>Topic</span><strong>${escapeHtml(request.topic || "General support")}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(request.origin === "n3xra" ? "Started by N3XRA" : request.source || "Platform support")}</strong></div>
        <div><span>Client visibility</span><strong>${request.client_visible ? "Visible in client portal" : "Private support case"}</strong></div>
        <div><span>Case ID</span><strong class="support-identifier">${escapeHtml(request.id)}</strong></div>
        ${request.resolved_at ? `<div><span>Resolved</span><strong>${escapeHtml(formatDate(request.resolved_at))}</strong></div>` : ""}
      </div>
    </section>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Client timeline</p><h3>Visible updates</h3><p>These notes appear with the request in the client portal. Internal notes remain private.</p></div></div>
      <div class="support-client-update-list">${clientUpdates.length ? clientUpdates.map((update) => `<div class="support-client-update"><p>${escapeHtml(update.message)}</p><small>${escapeHtml(formatDate(update.created_at))}</small></div>`).join("") : "<p>No client-visible updates yet.</p>"}</div>
    </section>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Case management</p><h3>Status and internal notes</h3><p>These notes remain inside the admin workspace and are not included in the customer email.</p></div></div>
      <form class="support-case-form" id="support-update-form">
        <div class="support-control-grid">
          <label class="account-admin-field"><span>Status</span><select id="support-status">${["new","in_progress","waiting","resolved","closed"].map((value) => `<option value="${value}"${(request.status || "new") === value ? " selected" : ""}>${supportStatusLabel(value)}</option>`).join("")}</select></label>
          <label class="account-admin-field"><span>Priority</span><select id="support-priority">${["low","normal","high","urgent"].map((value) => `<option value="${value}"${(request.priority || "normal") === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>
          <label class="account-admin-field"><span>Estimated start</span><input id="support-estimated-start" type="datetime-local" value="${escapeHtml(datetimeLocalValue(request.estimated_start_at))}"></label>
          <label class="account-admin-field"><span>Estimated completion</span><input id="support-estimated-completion" type="datetime-local" value="${escapeHtml(datetimeLocalValue(request.estimated_completion_at))}"></label>
        </div>
        <label class="account-admin-field"><span>New client-visible update</span><textarea id="support-client-note" rows="4" placeholder="Tell the client what changed, what you are doing, or what happens next"></textarea></label>
        <label class="account-admin-field"><span>Internal notes</span><textarea id="support-notes" rows="7" placeholder="Add investigation notes, decisions, or follow-up context">${escapeHtml(request.internal_notes || "")}</textarea></label>
        <div class="support-form-actions"><span>Saving updates this case immediately.</span><button class="portal-button" type="submit">Save case</button></div>
      </form>
    </section>
  `;
  document.getElementById("support-update-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Saving support request…");
    try {
      const data = await invoke("update-support-request", {
        requestId: request.id,
        status: document.getElementById("support-status").value,
        priority: document.getElementById("support-priority").value,
        estimatedStartAt: isoValue(document.getElementById("support-estimated-start").value),
        estimatedCompletionAt: isoValue(document.getElementById("support-estimated-completion").value),
        clientNote: document.getElementById("support-client-note").value,
        internalNotes: document.getElementById("support-notes").value,
      });
      supportRequests = supportRequests.map((item) => item.id === request.id ? { ...item, ...data.request } : item);
      if (data.clientUpdate) supportUpdates.push(data.clientUpdate);
      renderSupportOptions();
      setStatus("Support request updated.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  document.getElementById("support-approve-merge")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const confirmed = await confirmAdminAction(changeRun.preview_mode === "n3xra_live" ? "This will create one GitHub commit from the exact reviewed N3XRA preview and add it to the website's main branch. Vercel may then publish it through the website's normal production settings." : "This will merge the exact reviewed preview branch into the website's main branch. Vercel may then publish it through the website's normal production settings.", { title: "Approve website change", confirmLabel: "Approve and merge" });
    if (!confirmed) return;
    button.disabled = true;
    setStatus("Merging the reviewed website change…");
    try {
      await invokeWebsiteAutomation("approve-merge", { runId: changeRun.id });
      await loadSupport();
      setStatus("The reviewed website change was merged into main. Vercel is building production now.", "success");
    } catch (error) {
      button.disabled = false;
      setStatus(error.message, "error");
    }
  });
  document.getElementById("support-start-preview")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const previewMode = document.querySelector('input[name="support-preview-mode"]:checked')?.value || changeRun?.preview_mode || "vercel";
    const confirmed = await confirmAdminAction(previewMode === "n3xra_live" ? "This authorizes Codex to prepare an expiring N3XRA-hosted live preview from the existing website. It will not create a Vercel preview deployment or write to the website repository until a later approval." : "This authorizes Codex to work on an isolated branch and create a private Vercel preview. Nothing will be merged into main or published without a later approval.", { title: "Start AI website preview", confirmLabel: "Approve and start" });
    if (!confirmed) return;
    button.disabled = true;
    setStatus("Starting the isolated AI preview…");
    try {
      await invokeWebsiteAutomation("start-preview", { requestId: request.id, previewMode });
      await loadSupport();
      setStatus(previewMode === "n3xra_live" ? "The N3XRA live preview is queued. No Vercel preview deployment will be created." : "The private Vercel preview request is queued in GitHub. Progress will update automatically.", "success");
    } catch (error) {
      button.disabled = false;
      setStatus(error.message, "error");
    }
  });
}

async function loadSupport({ silent = false } = {}) {
  if (!silent) setStatus("Loading support requests…");
  const data = await invoke("list-support-requests");
  supportRequests = data.requests || [];
  supportUpdates = data.updates || [];
  supportWebsites = data.websites || [];
  supportOrganizations = data.organizations || [];
  supportAccounts = data.accounts || [];
  supportOrganizationMemberships = data.organizationMemberships || [];
  supportWebsiteMemberships = data.websiteMemberships || [];
  supportProductEntitlements = data.productEntitlements || [];
  supportChangeRuns = data.changeRuns || [];
  const workAccountSelect = document.getElementById("support-work-account");
  if (workAccountSelect) workAccountSelect.innerHTML = supportAccounts.length
    ? `<option value="">Choose a client account</option>${supportAccounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.full_name || account.email || "Unnamed account")}${account.full_name && account.email ? ` — ${escapeHtml(account.email)}` : ""}</option>`).join("")}`
    : '<option value="">No client accounts available</option>';
  renderSupportWorkTargets();
  const params = new URLSearchParams(window.location.search);
  const requestedEmail = String(params.get("email") || "").trim().toLowerCase();
  const requestedUser = String(params.get("user") || "").trim();
  if (requestedEmail || requestedUser) {
    const filter = document.getElementById("support-filter");
    if (filter) filter.value = "all";
  }
  renderSupportOptions();
  if (requestedEmail || requestedUser) {
    const request = supportRequests.find((item) => (requestedEmail && String(item.requester_email || "").trim().toLowerCase() === requestedEmail) || (requestedUser && String(item.requester_user_id || "") === requestedUser));
    const select = document.getElementById("support-select");
    if (request && select) {
      select.value = request.id;
      renderSupportOptions();
    }
  }
  if (!silent) setStatus(`${supportRequests.length} support request${supportRequests.length === 1 ? "" : "s"} loaded.`, "success");
}

export async function startSupport(context = {}) {
  ({ invoke, invokeWebsiteAutomation, escapeHtml, formatDate, setStatus, confirmAdminAction } = context);
  document.getElementById("support-search")?.addEventListener("input", renderSupportOptions);
  document.getElementById("support-filter")?.addEventListener("change", renderSupportOptions);
  document.getElementById("support-priority-filter")?.addEventListener("change", renderSupportOptions);
  document.getElementById("support-select")?.addEventListener("change", renderSelectedSupport);
  document.getElementById("support-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-support-request-id]");
    if (!button) return;
    const select = document.getElementById("support-select");
    if (select) select.value = button.dataset.supportRequestId || "";
    renderSupportOptions();
  });
  const workDialog = document.getElementById("support-work-dialog");
  const workForm = document.getElementById("support-work-form");
  const closeWorkDialog = () => workDialog?.close();
  document.getElementById("support-new-work")?.addEventListener("click", () => workDialog?.showModal());
  document.getElementById("support-work-close")?.addEventListener("click", closeWorkDialog);
  document.getElementById("support-work-cancel")?.addEventListener("click", closeWorkDialog);
  document.getElementById("support-work-account")?.addEventListener("change", renderSupportWorkTargets);
  document.getElementById("support-work-topic")?.addEventListener("change", renderSupportWorkTargets);
  workForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const modalStatus = document.getElementById("support-work-status");
    if (modalStatus) modalStatus.textContent = "Creating client-visible work…";
    try {
      const [contextType, contextId] = String(document.getElementById("support-work-context").value || "").split(":");
      await invoke("create-support-work", {
        requesterUserId: document.getElementById("support-work-account").value,
        organizationId: contextType === "organization" ? contextId : "",
        websiteId: contextType === "website" ? contextId : "",
        topic: document.getElementById("support-work-topic").value,
        subject: document.getElementById("support-work-subject").value,
        message: document.getElementById("support-work-message").value,
        estimatedStartAt: isoValue(document.getElementById("support-work-start").value),
        estimatedCompletionAt: isoValue(document.getElementById("support-work-completion").value),
        clientNote: document.getElementById("support-work-note").value,
      });
      workForm.reset();
      if (modalStatus) modalStatus.textContent = "";
      closeWorkDialog();
      await loadSupport();
      setStatus("Client-visible work created.", "success");
    } catch (error) {
      if (modalStatus) modalStatus.textContent = error.message;
    }
  });
  await loadSupport();
  clearInterval(supportPollTimer);
  supportPollTimer = window.setInterval(() => {
    const activeRun = supportChangeRuns.some((run) => ["queued", "coding", "merge_queued"].includes(run.state));
    if (activeRun && document.visibilityState === "visible") void loadSupport({ silent: true });
  }, 8000);
}
