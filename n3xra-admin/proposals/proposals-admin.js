import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const statusScreen = document.getElementById("portal-status");
const requestSelect = document.getElementById("proposal-request-select");
const requestSummary = document.getElementById("proposal-request-summary");
const proposalState = document.getElementById("proposal-state");
const emptyState = document.getElementById("proposal-empty");
const form = document.getElementById("proposal-form");
const formStatus = document.getElementById("proposal-form-status");
const versionLabel = document.getElementById("proposal-version-label");
const newVersionButton = document.getElementById("new-proposal-version");
const sendButton = document.getElementById("send-proposal");
const previewEmailButton = document.getElementById("preview-proposal-email");
const emailDialog = document.getElementById("proposal-email-dialog");
const lineItemsContainer = document.getElementById("proposal-line-items");
const addLineItemButton = document.getElementById("add-proposal-line-item");
const previewLink = document.getElementById("preview-proposal");
const refreshButton = document.getElementById("refresh-proposals");

let supabase;
let currentUser;
let requests = [];
let proposals = [];
let versions = [];
let lineItems = [];
let selectedRequest;
let selectedProposal;
let editingVersion;

const itemCategories = {
  website_build: "Website build",
  domain: "Domain registration or renewal",
  hosting: "Hosting",
  maintenance: "Maintenance and support",
  email: "Business email",
  ssl_cdn: "SSL or CDN",
  content: "Content or copywriting",
  ecommerce: "E-commerce or payments",
  integration: "Third-party integration",
  other: "Other service",
};

const fieldIds = {
  title: "proposal-title",
  introduction: "proposal-introduction",
  project_objective: "proposal-objective",
  scope_summary: "proposal-scope",
  deliverables: "proposal-deliverables",
  exclusions: "proposal-exclusions",
  revision_policy: "proposal-revisions",
  timeline: "proposal-timeline",
  estimated_start_date: "proposal-start-date",
  estimated_completion_date: "proposal-completion-date",
  valid_until: "proposal-valid-until",
  subtotal_cents: "proposal-subtotal",
  discount_cents: "proposal-discount",
  total_cents: "proposal-total",
  deposit_cents: "proposal-deposit",
  recurring_cents: "proposal-recurring",
  recurring_interval: "proposal-recurring-interval",
  payment_schedule: "proposal-payment-schedule",
  terms: "proposal-terms",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(value = "") {
  return String(value).replaceAll("_", " ");
}

function moneyToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function centsToMoney(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function setStatus(message = "", isError = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle("is-error", isError);
}

function updateTotal() {
  const total = Math.max(moneyToCents(document.getElementById(fieldIds.subtotal_cents).value) - moneyToCents(document.getElementById(fieldIds.discount_cents).value), 0);
  document.getElementById(fieldIds.total_cents).value = centsToMoney(total);
}

function newLineItem(overrides = {}) {
  return {
    category: "website_build",
    name: "Website design and development",
    description: "",
    billing_type: "one_time",
    quantity: 1,
    unit_amount_cents: 0,
    recurring_interval: null,
    ...overrides,
  };
}

function editingLineItems(version = editingVersion) {
  const stored = version ? lineItems.filter((item) => item.version_id === version.id) : [];
  if (stored.length) return stored.map((item) => ({ ...item }));
  if (!version) return [newLineItem()];
  const legacy = [];
  if (version.subtotal_cents) legacy.push(newLineItem({ unit_amount_cents: version.subtotal_cents }));
  if (version.recurring_cents) legacy.push(newLineItem({
    category: "maintenance",
    name: "Managed website service",
    billing_type: "recurring",
    unit_amount_cents: version.recurring_cents,
    recurring_interval: version.recurring_interval || "monthly",
  }));
  return legacy.length ? legacy : [newLineItem()];
}

function lineItemMarkup(item = newLineItem()) {
  return `
    <div class="proposal-line-item">
      <label>Service type<select data-line-field="category">${Object.entries(itemCategories).map(([value, label]) => `<option value="${value}"${item.category === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="proposal-line-name">Name<input data-line-field="name" maxlength="160" required value="${escapeHtml(item.name)}"></label>
      <label>Billing<select data-line-field="billing_type"><option value="one_time"${item.billing_type === "one_time" ? " selected" : ""}>One time</option><option value="recurring"${item.billing_type === "recurring" ? " selected" : ""}>Recurring</option></select></label>
      <label>Quantity<input data-line-field="quantity" type="number" min="0.01" step="0.01" value="${Number(item.quantity || 1)}"></label>
      <label>Unit price ($)<input data-line-field="unit_amount" type="number" min="0" step="0.01" value="${centsToMoney(item.unit_amount_cents)}"></label>
      <label data-interval-wrap${item.billing_type === "recurring" ? "" : " hidden"}>Interval<select data-line-field="recurring_interval"><option value="monthly"${item.recurring_interval === "monthly" ? " selected" : ""}>Monthly</option><option value="quarterly"${item.recurring_interval === "quarterly" ? " selected" : ""}>Quarterly</option><option value="yearly"${item.recurring_interval === "yearly" ? " selected" : ""}>Yearly</option></select></label>
      <label class="proposal-line-description">Billing note or description<input data-line-field="description" maxlength="500" value="${escapeHtml(item.description || "")}" placeholder="Optional detail shown to the client"></label>
      <button class="portal-button portal-button-secondary proposal-line-remove" type="button" data-remove-line>Remove</button>
    </div>
  `;
}

function renderLineItems(version) {
  lineItemsContainer.innerHTML = editingLineItems(version).map(lineItemMarkup).join("");
  updateInvestmentTotals();
}

function collectLineItems() {
  return Array.from(lineItemsContainer.querySelectorAll(".proposal-line-item")).map((row, index) => {
    const value = (field) => row.querySelector(`[data-line-field="${field}"]`)?.value;
    const billingType = value("billing_type");
    const name = value("name")?.trim();
    if (!name) throw new Error("Give each investment item a name.");
    const quantity = Number(value("quantity"));
    const unitAmountCents = moneyToCents(value("unit_amount"));
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for ${name}.`);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 0) throw new Error(`Enter a valid price for ${name}.`);
    return {
      category: value("category"),
      name,
      description: value("description")?.trim() || null,
      billing_type: billingType,
      quantity,
      unit_amount_cents: unitAmountCents,
      recurring_interval: billingType === "recurring" ? value("recurring_interval") : null,
      sort_order: index,
    };
  });
}

function updateInvestmentTotals() {
  let items = [];
  try { items = collectLineItems(); } catch { return; }
  const subtotal = items.filter((item) => item.billing_type === "one_time")
    .reduce((sum, item) => sum + Math.round(item.quantity * item.unit_amount_cents), 0);
  document.getElementById(fieldIds.subtotal_cents).value = centsToMoney(subtotal);
  const recurring = items.filter((item) => item.billing_type === "recurring");
  const intervals = [...new Set(recurring.map((item) => item.recurring_interval))];
  document.getElementById(fieldIds.recurring_cents).value = intervals.length === 1
    ? centsToMoney(recurring.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_amount_cents), 0))
    : "0";
  document.getElementById(fieldIds.recurring_interval).value = intervals.length === 1 ? intervals[0] : "";
  updateTotal();
}

function renderRequestOptions() {
  requestSelect.innerHTML = requests.length
    ? requests.map((request) => `<option value="${request.id}">${escapeHtml(request.business_name)} · ${escapeHtml(formatLabel(request.status))}</option>`).join("")
    : '<option value="">No website requests</option>';
}

function renderRequestSummary() {
  if (!selectedRequest) {
    requestSummary.hidden = true;
    return;
  }
  requestSummary.hidden = false;
  requestSummary.innerHTML = `
    <div>
      <p class="portal-kicker">${escapeHtml(formatLabel(selectedRequest.project_type))}</p>
      <h3>${escapeHtml(selectedRequest.business_name)}</h3>
      <p>${escapeHtml(selectedRequest.contact_name)} · ${escapeHtml(selectedRequest.contact_email)}</p>
    </div>
    <dl>
      <div><dt>Goal</dt><dd>${escapeHtml(selectedRequest.primary_goal)}</dd></div>
      <div><dt>Pages</dt><dd>${(selectedRequest.requested_pages || []).map(escapeHtml).join(", ") || "Not specified"}</dd></div>
      <div><dt>Features</dt><dd>${(selectedRequest.requested_features || []).map(escapeHtml).join(", ") || "Not specified"}</dd></div>
      <div><dt>Budget</dt><dd>${escapeHtml(formatLabel(selectedRequest.budget_range || "Not specified"))}</dd></div>
    </dl>
  `;
}

function defaultVersion() {
  return {
    version_number: 1,
    status: "draft",
    introduction: "",
    project_objective: selectedRequest?.primary_goal || "",
    scope_summary: "",
    deliverables: selectedRequest?.requested_pages || [],
    exclusions: [],
    timeline: selectedRequest?.target_launch_date ? `Target completion: ${selectedRequest.target_launch_date}` : "",
    estimated_start_date: "",
    estimated_completion_date: selectedRequest?.target_launch_date || "",
    subtotal_cents: 0,
    discount_cents: 0,
    total_cents: 0,
    deposit_cents: 0,
    recurring_cents: 0,
    recurring_interval: "",
    payment_schedule: "",
    revision_policy: "The project includes the revisions specifically listed in the final contract. Work outside the approved scope will be quoted separately.",
    terms: "This proposal describes the intended project scope and pricing. Final work begins after the related contract is signed and the required deposit is paid.",
    valid_until: "",
  };
}

function fillForm(version) {
  const values = version || defaultVersion();
  Object.entries(fieldIds).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (key === "title") input.value = selectedProposal?.title || `${selectedRequest?.business_name || "Website"} Website Proposal`;
    else if (["deliverables", "exclusions"].includes(key)) input.value = (values[key] || []).join("\n");
    else if (key.endsWith("_cents")) input.value = centsToMoney(values[key]);
    else input.value = values[key] || "";
  });
  renderLineItems(version);
}

function renderEditor() {
  renderRequestSummary();
  emptyState.hidden = Boolean(selectedRequest);
  form.hidden = !selectedRequest;
  if (!selectedRequest) return;

  const proposalVersions = selectedProposal ? versions.filter((version) => version.proposal_id === selectedProposal.id) : [];
  const latestVersion = proposalVersions.sort((a, b) => b.version_number - a.version_number)[0];
  editingVersion = latestVersion?.status === "draft" ? latestVersion : latestVersion || null;
  fillForm(editingVersion);

  const status = selectedProposal?.status || "not started";
  proposalState.innerHTML = `<span class="portal-badge portal-status-${escapeHtml(status)}">${escapeHtml(formatLabel(status))}</span>`;
  versionLabel.textContent = editingVersion ? `Version ${editingVersion.version_number} · ${formatLabel(editingVersion.status)}` : "New proposal";

  const isDraft = !editingVersion || editingVersion.status === "draft";
  Array.from(form.elements).forEach((element) => {
    if (element === newVersionButton || element === previewLink) return;
    if (element.id === "send-proposal") element.disabled = false;
    else if (element.id === "preview-proposal-email") element.disabled = !isDraft;
    else if (element.id === "save-proposal") element.disabled = !isDraft;
    else element.disabled = !isDraft;
  });
  sendButton.textContent = isDraft ? "Send to client" : "Resend email";
  newVersionButton.hidden = !selectedProposal || isDraft;
  previewLink.hidden = !selectedProposal?.current_version_id;
  if (selectedProposal) previewLink.href = `/proposals/?proposal=${encodeURIComponent(selectedProposal.id)}`;
}

function collectVersion() {
  const items = collectLineItems();
  if (!items.length) throw new Error("Add at least one investment item.");
  updateInvestmentTotals();
  const recurringCents = moneyToCents(document.getElementById(fieldIds.recurring_cents).value);
  const recurringInterval = document.getElementById(fieldIds.recurring_interval).value || null;

  const subtotalCents = moneyToCents(document.getElementById(fieldIds.subtotal_cents).value);
  const discountCents = moneyToCents(document.getElementById(fieldIds.discount_cents).value);
  const totalCents = Math.max(subtotalCents - discountCents, 0);
  const depositCents = moneyToCents(document.getElementById(fieldIds.deposit_cents).value);
  if (depositCents > totalCents) throw new Error("The deposit cannot exceed the project total.");

  return {
    lineItems: items,
    version: {
    introduction: document.getElementById(fieldIds.introduction).value.trim() || null,
    project_objective: document.getElementById(fieldIds.project_objective).value.trim(),
    scope_summary: document.getElementById(fieldIds.scope_summary).value.trim(),
    deliverables: lines(document.getElementById(fieldIds.deliverables).value),
    exclusions: lines(document.getElementById(fieldIds.exclusions).value),
    revision_policy: document.getElementById(fieldIds.revision_policy).value.trim() || null,
    timeline: document.getElementById(fieldIds.timeline).value.trim(),
    estimated_start_date: document.getElementById(fieldIds.estimated_start_date).value || null,
    estimated_completion_date: document.getElementById(fieldIds.estimated_completion_date).value || null,
    valid_until: document.getElementById(fieldIds.valid_until).value || null,
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    total_cents: totalCents,
    deposit_cents: depositCents,
    recurring_cents: recurringCents,
    recurring_interval: recurringCents ? recurringInterval : null,
    payment_schedule: document.getElementById(fieldIds.payment_schedule).value.trim() || null,
    terms: document.getElementById(fieldIds.terms).value.trim(),
    },
  };
}

async function loadData(preferredRequestId) {
  const [requestResult, proposalResult, versionResult, lineItemResult] = await Promise.all([
    supabase.from("website_service_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposal_versions").select("*").order("version_number", { ascending: false }),
    supabase.from("website_proposal_line_items").select("*").order("sort_order"),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (versionResult.error) throw versionResult.error;
  if (lineItemResult.error) throw lineItemResult.error;
  requests = requestResult.data || [];
  proposals = proposalResult.data || [];
  versions = versionResult.data || [];
  lineItems = lineItemResult.data || [];
  renderRequestOptions();
  const context = readWorkspaceContext("admin", currentUser.id);
  const params = new URLSearchParams(window.location.search);
  const explicitProposal = proposals.find((proposal) => proposal.id === params.get("proposal"));
  const requested = preferredRequestId || explicitProposal?.request_id || params.get("request") || context.requestId;
  selectedRequest = requests.find((request) => request.id === requested)
    || (!context.websiteId && !context.projectId ? requests[0] : undefined);
  if (selectedRequest) requestSelect.value = selectedRequest.id;
  else requestSelect.selectedIndex = -1;
  selectedProposal = proposals.find((proposal) => proposal.request_id === selectedRequest?.id);
  if (selectedRequest) writeWorkspaceContext("admin", currentUser.id, {
    requestId: selectedRequest.id,
    proposalId: selectedProposal?.id,
    projectId: selectedProposal?.project_id || context.projectId,
    name: selectedRequest.business_name,
  });
  renderEditor();
}

async function ensureProposal() {
  if (selectedProposal) return selectedProposal;
  const title = document.getElementById(fieldIds.title).value.trim();
  const { data, error } = await supabase.from("website_proposals").insert({
    request_id: selectedRequest.id,
    client_user_id: selectedRequest.user_id,
    title,
    status: "draft",
    created_by_user_id: currentUser.id,
  }).select().single();
  if (error) throw error;
  selectedProposal = data;
  proposals.push(data);
  return data;
}

async function saveDraft(event, rethrow = false) {
  event?.preventDefault();
  const saveButton = document.getElementById("save-proposal");
  saveButton.disabled = true;
  setStatus("Saving draft…");
  try {
    const collected = collectVersion();
    const versionValues = collected.version;
    const proposal = await ensureProposal();
    const title = document.getElementById(fieldIds.title).value.trim();
    const proposalUpdate = await supabase.from("website_proposals").update({ title }).eq("id", proposal.id);
    if (proposalUpdate.error) throw proposalUpdate.error;

    if (editingVersion?.status === "draft") {
      const { error } = await supabase.from("website_proposal_versions").update(versionValues).eq("id", editingVersion.id);
      if (error) throw error;
      const deleteResult = await supabase.from("website_proposal_line_items").delete().eq("version_id", editingVersion.id);
      if (deleteResult.error) throw deleteResult.error;
      const insertResult = await supabase.from("website_proposal_line_items").insert(collected.lineItems.map((item) => ({ ...item, version_id: editingVersion.id })));
      if (insertResult.error) throw insertResult.error;
    } else {
      const versionNumber = Math.max(0, ...versions.filter((version) => version.proposal_id === proposal.id).map((version) => version.version_number)) + 1;
      const { data: createdVersion, error } = await supabase.from("website_proposal_versions").insert({
        proposal_id: proposal.id,
        version_number: versionNumber,
        status: "draft",
        created_by_user_id: currentUser.id,
        ...versionValues,
      }).select().single();
      if (error) throw error;
      const insertResult = await supabase.from("website_proposal_line_items").insert(collected.lineItems.map((item) => ({ ...item, version_id: createdVersion.id })));
      if (insertResult.error) throw insertResult.error;
    }
    await supabase.from("website_service_requests").update({ status: "proposal_drafting" }).eq("id", selectedRequest.id);
    setStatus("Draft saved.");
    await loadData(selectedRequest.id);
  } catch (error) {
    setStatus(error?.message || "Unable to save this proposal.", true);
    if (rethrow) throw error;
  } finally {
    saveButton.disabled = false;
  }
}

function formatMoney(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function emailPreviewMarkup() {
  const collected = collectVersion();
  const title = document.getElementById(fieldIds.title).value.trim();
  const oneTime = collected.lineItems.filter((item) => item.billing_type === "one_time");
  const recurring = collected.lineItems.filter((item) => item.billing_type === "recurring");
  const rows = (items) => items.map((item) => `
    <div class="proposal-email-item"><span>${escapeHtml(item.name)}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span><strong>${formatMoney(Math.round(item.quantity * item.unit_amount_cents))}${item.billing_type === "recurring" ? ` / ${escapeHtml(item.recurring_interval)}` : ""}</strong></div>
  `).join("");
  document.getElementById("proposal-email-meta").textContent = `To: ${selectedRequest.contact_name} · ${selectedRequest.contact_email}`;
  return `
    <div class="proposal-email-card">
      <div class="proposal-email-hero"><p>N3XRA · Website proposal</p><h2>Your proposal is ready.</h2></div>
      <div class="proposal-email-body">
        <p>Hi ${escapeHtml(selectedRequest.contact_name.split(/\s+/)[0] || selectedRequest.contact_name)},</p>
        <p>We’ve put together the proposal for <strong>${escapeHtml(title)}</strong>. It includes the project scope, schedule, investment, and terms for you to review in your secure dashboard.</p>
        <div class="proposal-email-summary"><strong>Project at a glance</strong><p>${escapeHtml(collected.version.project_objective)}</p><p><strong>Timeline:</strong> ${escapeHtml(collected.version.timeline)}</p></div>
        ${oneTime.length ? `<h3>Project investment</h3>${rows(oneTime)}${collected.version.discount_cents ? `<div class="proposal-email-item"><span>Discount</span><strong>−${formatMoney(collected.version.discount_cents)}</strong></div>` : ""}<div class="proposal-email-item is-total"><span>Total</span><strong>${formatMoney(collected.version.total_cents)}</strong></div>` : ""}
        ${recurring.length ? `<h3>Ongoing services</h3>${rows(recurring)}` : ""}
        <div class="proposal-email-notice"><strong>This is a proposal, not a bill.</strong><br>No payment is due from this email. After you approve the proposal, the applicable contract and billing steps will be prepared separately.</div>
        <p>When you’re ready, open your dashboard to read the complete proposal and respond.</p>
        <a class="proposal-email-cta" href="https://www.n3xra.com/account">Review proposal in your dashboard</a>
        <p class="proposal-email-signoff">We’re excited about the opportunity to help bring this project to life.<br><strong>N3XRA</strong></p>
      </div>
    </div>
  `;
}

function openEmailPreview() {
  document.getElementById("proposal-email-preview").innerHTML = emailPreviewMarkup();
  emailDialog.showModal();
}

async function emailProposal(proposalId, versionId) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again before sending.");
  const response = await fetch("/api/send-website-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ proposalId, versionId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The proposal was published, but the email could not be sent.");
  return result;
}

async function sendProposal() {
  sendButton.disabled = true;
  setStatus("Publishing proposal…");
  let proposalPublished = false;
  try {
    if (editingVersion?.status === "sent" && selectedProposal?.current_version_id === editingVersion.id) {
      setStatus("Sending proposal email…");
      await emailProposal(selectedProposal.id, editingVersion.id);
      setStatus(`Proposal email sent to ${selectedRequest.contact_email}.`);
      emailDialog.close();
      await loadData(selectedRequest.id);
      return;
    }
    await saveDraft(null, true);
    const proposal = proposals.find((item) => item.request_id === selectedRequest.id);
    const draft = versions.find((version) => version.proposal_id === proposal?.id && version.status === "draft");
    if (!proposal || !draft) throw new Error("Save the proposal draft before sending it.");

    const priorSent = versions.filter((version) => version.proposal_id === proposal.id && version.status === "sent");
    for (const version of priorSent) {
      const { error } = await supabase.from("website_proposal_versions").update({ status: "superseded" }).eq("id", version.id);
      if (error) throw error;
    }

    const now = new Date().toISOString();
    const versionResult = await supabase.from("website_proposal_versions").update({ status: "sent", sent_at: now }).eq("id", draft.id);
    if (versionResult.error) throw versionResult.error;
    const proposalResult = await supabase.from("website_proposals").update({
      status: "sent",
      current_version_id: draft.id,
      sent_at: now,
      decided_at: null,
    }).eq("id", proposal.id);
    if (proposalResult.error) throw proposalResult.error;
    const requestResult = await supabase.from("website_service_requests").update({ status: "proposal_sent" }).eq("id", selectedRequest.id);
    if (requestResult.error) throw requestResult.error;
    proposalPublished = true;
    setStatus("Proposal published. Sending client email…");
    await emailProposal(proposal.id, draft.id);
    setStatus(`Proposal published and emailed to ${selectedRequest.contact_email}.`);
    emailDialog.close();
    await loadData(selectedRequest.id);
  } catch (error) {
    setStatus(error?.message || "Unable to send this proposal.", true);
    if (proposalPublished) await loadData(selectedRequest.id);
  } finally {
    sendButton.disabled = false;
  }
}

async function createRevision() {
  if (!selectedProposal || !editingVersion) return;
  const nextNumber = Math.max(...versions.filter((version) => version.proposal_id === selectedProposal.id).map((version) => version.version_number)) + 1;
  const copy = { ...editingVersion };
  ["id", "created_at", "updated_at", "sent_at"].forEach((key) => delete copy[key]);
  const { data: createdVersion, error } = await supabase.from("website_proposal_versions").insert({
    ...copy,
    proposal_id: selectedProposal.id,
    version_number: nextNumber,
    status: "draft",
    created_by_user_id: currentUser.id,
  }).select().single();
  if (error) throw error;
  const sourceItems = lineItems.filter((item) => item.version_id === editingVersion.id).map((item, index) => ({
    version_id: createdVersion.id,
    category: item.category,
    name: item.name,
    description: item.description,
    billing_type: item.billing_type,
    quantity: item.quantity,
    unit_amount_cents: item.unit_amount_cents,
    recurring_interval: item.recurring_interval,
    sort_order: index,
  }));
  if (sourceItems.length) {
    const itemResult = await supabase.from("website_proposal_line_items").insert(sourceItems);
    if (itemResult.error) throw itemResult.error;
  }
  await loadData(selectedRequest.id);
  setStatus(`Version ${nextNumber} is ready to edit.`);
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.user) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Fproposals%2F");
    return;
  }
  currentUser = sessionData.session.user;
  if (!await verifyPlatformAdmin(supabase, currentUser)) throw new Error("You do not have proposal administration access.");

  await loadData();
  form.addEventListener("submit", saveDraft);
  sendButton.addEventListener("click", sendProposal);
  previewEmailButton.addEventListener("click", () => {
    try { openEmailPreview(); } catch (error) { setStatus(error.message, true); }
  });
  document.getElementById("send-proposal-from-preview").addEventListener("click", sendProposal);
  document.getElementById("close-proposal-email").addEventListener("click", () => emailDialog.close());
  document.getElementById("close-proposal-email-bottom").addEventListener("click", () => emailDialog.close());
  addLineItemButton.addEventListener("click", () => {
    lineItemsContainer.insertAdjacentHTML("beforeend", lineItemMarkup(newLineItem({ category: "other", name: "" })));
    updateInvestmentTotals();
  });
  lineItemsContainer.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-line]");
    if (!remove) return;
    remove.closest(".proposal-line-item")?.remove();
    updateInvestmentTotals();
  });
  lineItemsContainer.addEventListener("input", updateInvestmentTotals);
  lineItemsContainer.addEventListener("change", (event) => {
    const row = event.target.closest(".proposal-line-item");
    if (event.target.matches('[data-line-field="billing_type"]')) {
      row.querySelector("[data-interval-wrap]").hidden = event.target.value !== "recurring";
    }
    updateInvestmentTotals();
  });
  newVersionButton.addEventListener("click", () => createRevision().catch((error) => setStatus(error.message, true)));
  requestSelect.addEventListener("change", () => {
    selectedRequest = requests.find((request) => request.id === requestSelect.value);
    selectedProposal = proposals.find((proposal) => proposal.request_id === selectedRequest?.id);
    if (selectedRequest) writeWorkspaceContext("admin", currentUser.id, {
      requestId: selectedRequest.id,
      proposalId: selectedProposal?.id,
      projectId: selectedProposal?.project_id || null,
      name: selectedRequest.business_name,
    });
    renderEditor();
  });
  refreshButton.addEventListener("click", () => loadData(selectedRequest?.id).catch((error) => setStatus(error.message, true)));
  document.getElementById(fieldIds.discount_cents).addEventListener("input", updateTotal);
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Proposal administration could not be opened.";
});
