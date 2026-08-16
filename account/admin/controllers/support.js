let supportRequests = [];
let supportUpdates = [];
let supportWebsites = [];
let supportOrganizations = [];
let supportAccounts = [];
let invoke;
let escapeHtml;
let formatDate;
let setStatus;

function supportLabel(request) {
  return `${request.subject} — ${request.requester_name} (${request.status})`;
}

function supportInitials(request) {
  return String(request?.requester_name || request?.requester_email || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function supportStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
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
    const searchable = [item.subject, item.requester_name, item.requester_email, item.organization_name, item.topic, item.message, item.status, item.priority].join(" ").toLowerCase();
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
}

async function loadSupport() {
  setStatus("Loading support requests…");
  const data = await invoke("list-support-requests");
  supportRequests = data.requests || [];
  supportUpdates = data.updates || [];
  supportWebsites = data.websites || [];
  supportOrganizations = data.organizations || [];
  supportAccounts = data.accounts || [];
  const workAccountSelect = document.getElementById("support-work-account");
  if (workAccountSelect) workAccountSelect.innerHTML = supportAccounts.length
    ? `<option value="">Choose a client account</option>${supportAccounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.full_name || account.email || "Unnamed account")}${account.full_name && account.email ? ` — ${escapeHtml(account.email)}` : ""}</option>`).join("")}`
    : '<option value="">No client accounts available</option>';
  const workContextSelect = document.getElementById("support-work-context");
  if (workContextSelect) workContextSelect.innerHTML = `<option value="">General N3XRA account</option><optgroup label="Organizations">${supportOrganizations.map((organization) => `<option value="organization:${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join("")}</optgroup><optgroup label="Websites">${supportWebsites.map((website) => `<option value="website:${escapeHtml(website.id)}">${escapeHtml(website.name)}</option>`).join("")}</optgroup>`;
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
  setStatus(`${supportRequests.length} support request${supportRequests.length === 1 ? "" : "s"} loaded.`, "success");
}

export async function startSupport(context = {}) {
  ({ invoke, escapeHtml, formatDate, setStatus } = context);
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
}
