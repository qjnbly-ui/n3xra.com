import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const statusScreen = document.getElementById("portal-status");
const requestSelect = document.getElementById("proposal-request-select");
const requestSummary = document.getElementById("proposal-request-summary");
const proposalState = document.getElementById("proposal-state");
const emptyState = document.getElementById("proposal-empty");
const form = document.getElementById("proposal-form");
const formStatus = document.getElementById("proposal-form-status");
const versionLabel = document.getElementById("proposal-version-label");
const newVersionButton = document.getElementById("new-proposal-version");
const deleteVersionButton = document.getElementById("delete-proposal-version");
const deleteVersionDialog = document.getElementById("delete-proposal-version-dialog");
const confirmDeleteVersionButton = document.getElementById("confirm-delete-proposal-version");
const sendButton = document.getElementById("send-proposal");
const previewEmailButton = document.getElementById("preview-proposal-email");
const emailDialog = document.getElementById("proposal-email-dialog");
const lineItemsContainer = document.getElementById("proposal-line-items");
const addLineItemButton = document.getElementById("add-proposal-line-item");
const addStarterPlanButton = document.getElementById("add-starter-plan");
const addStarterPlusPlanButton = document.getElementById("add-starter-plus-plan");
const addAdvancedPlanButton = document.getElementById("add-advanced-plan");
const previewLink = document.getElementById("preview-proposal");
const refreshButton = document.getElementById("refresh-proposals");
const referralDiscountWrap = document.getElementById("proposal-referral-discount-wrap");
const referralDiscountToggle = document.getElementById("proposal-referral-discount");
const referralDiscountHelp = document.getElementById("proposal-referral-discount-help");
const prepareBillingButton = document.getElementById("prepare-proposal-billing");
const copilotPanel = document.getElementById("proposal-copilot");
const copilotInstruction = document.getElementById("proposal-ai-instruction");
const copilotGenerateButton = document.getElementById("generate-proposal-ai");
const copilotRefreshButton = document.getElementById("refresh-proposal-ai");
const copilotReview = document.getElementById("proposal-ai-review");
const copilotHistory = document.getElementById("proposal-ai-history");
const copilotStatus = document.getElementById("proposal-ai-status");
const copilotGlobalResult = document.getElementById("proposal-ai-global-result");

let supabase;
let currentUser;
let requests = [];
let proposals = [];
let versions = [];
let lineItems = [];
let billingSnapshots = [];
let selectedRequest;
let selectedProposal;
let editingVersion;
let copilotLoadSequence = 0;

const copilotSections = ["overview", "scope", "schedule", "investment", "terms"];

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
  recurring_start_policy: "proposal-recurring-start-policy",
  complimentary_months: "proposal-complimentary-months",
  review_notice_days: "proposal-review-notice-days",
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

function planLabel(value = "") {
  return value === "starter_plus" ? "Starter+" : value === "advanced" ? "Advanced" : value === "starter" ? "Starter" : "Not specified";
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

function setCopilotStatus(message = "", isError = false) {
  copilotStatus.textContent = message;
  copilotStatus.classList.toggle("is-error", isError);
}

function sectionCompletion(section) {
  const values = (keys) => keys.map((key) => String(document.getElementById(fieldIds[key])?.value || "").trim());
  let required = [];
  if (section === "overview") required = values(["title", "project_objective"]);
  else if (section === "scope") required = values(["scope_summary", "deliverables", "exclusions"]);
  else if (section === "schedule") required = values(["timeline"]);
  else if (section === "terms") required = values(["revision_policy", "terms"]);
  else if (section === "investment") {
    const rows = Array.from(lineItemsContainer.querySelectorAll(".proposal-line-item"));
    required = rows.flatMap((row) => [
      row.querySelector('[data-line-field="name"]')?.value.trim() || "",
      Number(row.querySelector('[data-line-field="unit_amount"]')?.value || 0) > 0 ? "priced" : "",
    ]);
  }
  const populated = required.filter(Boolean).length;
  if (!populated) return "fill";
  if (populated < required.length) return "complete";
  return "improve";
}

function updateCopilotSectionActions() {
  document.querySelectorAll("[data-ai-section]").forEach((button) => {
    const state = sectionCompletion(button.dataset.aiSection);
    const label = state === "fill" ? "Fill with AI" : state === "complete" ? "Complete with AI" : "Improve with AI";
    const output = button.querySelector("[data-ai-action-label]");
    if (output && !button.disabled) output.textContent = label;
  });
}

function setCopilotButtonBusy(section, busy) {
  const buttons = [copilotGenerateButton, ...document.querySelectorAll("[data-ai-section]")];
  buttons.forEach((button) => {
    button.disabled = busy;
  });
  const activeButton = section
    ? document.querySelector(`[data-ai-section="${section}"]`)
    : copilotGenerateButton;
  if (activeButton === copilotGenerateButton) {
    activeButton.textContent = busy ? "Drafting proposal…" : "Create a safe first draft";
  } else {
    const output = activeButton?.querySelector("[data-ai-action-label]");
    if (output && busy) output.textContent = "Drafting…";
  }
  if (!busy) {
    copilotGenerateButton.textContent = "Create a safe first draft";
    updateCopilotSectionActions();
  }
}

function syncCopilotOpenState() {
  form.classList.toggle("is-copilot-open", copilotPanel.open);
  const summaryAction = copilotPanel.querySelector(".proposal-copilot-summary-action");
  if (summaryAction) summaryAction.textContent = copilotPanel.open ? "Assistant on" : "Open assistant";
}

function updateTotal() {
  const oneTimeTotal = Math.max(moneyToCents(document.getElementById(fieldIds.subtotal_cents).value) - moneyToCents(document.getElementById(fieldIds.discount_cents).value), 0);
  const recurringTotal = moneyToCents(document.getElementById(fieldIds.recurring_cents).value);
  const reviewRequired = document.getElementById(fieldIds.recurring_start_policy).value === "review_required";
  document.getElementById(fieldIds.total_cents).value = centsToMoney(oneTimeTotal);
  document.getElementById("proposal-checkout-total").value = centsToMoney(oneTimeTotal + (reviewRequired ? 0 : recurringTotal));
  renderBillingArrangement(recurringTotal);
}

function renderBillingArrangement(recurringTotal = moneyToCents(document.getElementById(fieldIds.recurring_cents).value)) {
  const policy = document.getElementById(fieldIds.recurring_start_policy).value;
  const monthsWrap = document.getElementById("proposal-complimentary-months-wrap");
  const noticeWrap = document.getElementById("proposal-review-notice-days-wrap");
  const summary = document.getElementById("proposal-billing-arrangement");
  const hasRecurring = recurringTotal > 0;
  const reviewRequired = hasRecurring && policy === "review_required";
  monthsWrap.hidden = !reviewRequired;
  noticeWrap.hidden = !reviewRequired;
  summary.hidden = !reviewRequired;
  if (!reviewRequired) return;
  const months = Math.max(1, Number(document.getElementById(fieldIds.complimentary_months).value || 12));
  const noticeDays = Math.max(1, Number(document.getElementById(fieldIds.review_notice_days).value || 45));
  const interval = document.getElementById(fieldIds.recurring_interval).value || "billing period";
  const intervalLabel = interval === "yearly" ? "year" : interval === "monthly" ? "month" : interval === "quarterly" ? "quarter" : interval;
  summary.innerHTML = `<strong>Free-period arrangement</strong><span>The approved service price is ${formatMoney(recurringTotal)} per ${escapeHtml(intervalLabel)}. The first ${months} months are provided at no charge, so recurring service due now is $0. N3XRA will review the plan with the client ${noticeDays} days before the free period ends. No paid subscription or invoice starts without written approval.</span>`;
}

function websiteBuildSubtotal(items = []) {
  return items
    .filter((item) => item.billing_type === "one_time" && item.category === "website_build")
    .reduce((sum, item) => sum + Math.round(item.quantity * item.unit_amount_cents), 0);
}

function isFounderOffer(request = selectedRequest) {
  return String(request?.offer_code || "").toUpperCase() === "FREEBUILD";
}

function configureReferralDiscount({ apply = false } = {}) {
  const code = String(selectedRequest?.referral_code || "").trim();
  referralDiscountWrap.hidden = !code;
  const founderOffer = isFounderOffer();
  referralDiscountToggle.checked = Boolean(code && apply && !founderOffer);
  referralDiscountToggle.disabled = founderOffer;
  referralDiscountHelp.textContent = code
    ? founderOffer
      ? "Founding offer verified: the one-time website build fee is waived. Service plans, domains, and third-party services remain billable."
      : `Verified code ${code}: applies 10% off one-time website-build line items. The partner earns $100 only if the client purchases one year of service.`
    : "";
  document.getElementById(fieldIds.discount_cents).readOnly = Boolean(founderOffer || (code && apply));
}

function updateReferralDiscount(items = []) {
  const discountInput = document.getElementById(fieldIds.discount_cents);
  if (isFounderOffer()) {
    discountInput.readOnly = true;
    discountInput.value = centsToMoney(websiteBuildSubtotal(items));
    return;
  }
  if (!selectedRequest?.referral_code || !referralDiscountToggle.checked) {
    discountInput.readOnly = false;
    return;
  }
  discountInput.readOnly = true;
  const buildSubtotal = websiteBuildSubtotal(items);
  discountInput.value = centsToMoney(Math.round(buildSubtotal * (isFounderOffer() ? 1 : 0.1)));
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

function servicePlanItem(plan) {
  if (plan === "advanced") {
    return newLineItem({
      category: "maintenance",
      name: "Advanced website service",
      description: "Service for an advanced website with payments, accounts, portals, memberships, scheduling, uploads, automation, integrations, or comparable custom functionality. Final recurring service is adjusted to match the approved system scope and support requirements.",
      billing_type: "recurring",
      unit_amount_cents: 5000,
      recurring_interval: "monthly",
    });
  }
  if (plan === "starter_plus") {
    return newLineItem({
      category: "maintenance",
      name: "Founding Client Starter+ website service",
      description: "Managed hosting, SSL and routine security maintenance, backups, monitoring, priority handling, and up to 30 non-rollover minutes of routine edits monthly. Additional eligible edits are $52.50/hour. New pages, custom features, integrations, redesigns, and urgent after-hours work are quoted separately.",
      billing_type: "recurring",
      unit_amount_cents: 4000,
      recurring_interval: "monthly",
    });
  }
  return newLineItem({
    category: "maintenance",
    name: "Founding Client Starter website service",
    description: "Managed hosting, SSL and routine security maintenance, backups, monitoring, and normal-business-hours support. Website edits are billed at $75/hour.",
    billing_type: "recurring",
    unit_amount_cents: 2500,
    recurring_interval: "monthly",
  });
}

function advancedBuildItem() {
  return newLineItem({
    category: "website_build",
    name: "Advanced website design and development",
    description: "Starting investment for an advanced website. Adjust this line to match the approved pages, payments, accounts, portals, memberships, scheduling, uploads, automation, integrations, and other custom functionality.",
    billing_type: "one_time",
    unit_amount_cents: 50000,
    recurring_interval: null,
  });
}

function applyServicePlanIntervalPrice(row) {
  const name = row.querySelector('[data-line-field="name"]')?.value.trim();
  const interval = row.querySelector('[data-line-field="recurring_interval"]')?.value;
  const unitAmount = row.querySelector('[data-line-field="unit_amount"]');
  if (!unitAmount || !["monthly", "yearly"].includes(interval)) return;
  if (name === "Founding Client Starter website service") {
    unitAmount.value = interval === "yearly" ? "270.00" : "25.00";
  } else if (name === "Founding Client Starter+ website service") {
    unitAmount.value = interval === "yearly" ? "432.00" : "40.00";
  } else if (name === "Advanced website service") {
    unitAmount.value = interval === "yearly" ? "540.00" : "50.00";
  }
}

function editingLineItems(version = editingVersion) {
  const stored = version ? lineItems.filter((item) => item.version_id === version.id) : [];
  if (stored.length) return stored.map((item) => ({ ...item }));
  if (!version) {
    const items = [newLineItem()];
    if (["starter", "starter_plus", "advanced"].includes(selectedRequest?.service_plan)) {
      items.push(servicePlanItem(selectedRequest.service_plan));
    }
    return items;
  }
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
    <div class="proposal-line-item" data-line-item-id="${escapeHtml(item.id || "")}">
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
  const service = recurring.find((item) => item.name === "Founding Client Starter website service");
  const schedule = document.getElementById(fieldIds.payment_schedule);
  if (service && editingVersion?.status === "draft" && /(Website Service:\s*)[^,\n]+(?=,)/i.test(schedule.value)) {
    const frequency = service.recurring_interval === "yearly" ? "year" : service.recurring_interval;
    schedule.value = schedule.value.replace(/(Website Service:\s*)[^,\n]+(?=,)/i, (_match, prefix) => `${prefix}$${centsToMoney(service.unit_amount_cents)}/${frequency}`);
  }
  updateReferralDiscount(items);
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
      <div><dt>Service plan</dt><dd>${escapeHtml(planLabel(selectedRequest.service_plan))}${selectedRequest.service_plan_auto_applied ? " (Advanced applied automatically)" : ""}</dd></div>
      ${selectedRequest.service_plan_reason ? `<div><dt>Plan fit</dt><dd>${escapeHtml(selectedRequest.service_plan_reason)}</dd></div>` : ""}
      <div><dt>Budget</dt><dd>${escapeHtml(formatLabel(selectedRequest.budget_range || "Not specified"))}</dd></div>
      <div><dt>Referral code</dt><dd>${escapeHtml(selectedRequest.referral_code || "None")}</dd></div>
      ${isFounderOffer(selectedRequest) ? '<div><dt>Offer</dt><dd>Founding offer — $250 build fee waived</dd></div>' : ""}
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
    recurring_start_policy: "immediate",
    complimentary_months: 0,
    review_notice_days: 45,
    payment_schedule: "",
    revision_policy: "Work includes the deliverables and revisions stated in this agreement. Material additions or work outside the approved scope require written approval and may be quoted separately.",
    terms: "Approval of this Proposal & Agreement authorizes N3XRA to perform the described work and prepare billing according to the accepted investment and payment schedule. Work begins after any required initial payment and client materials are received.\n\nAny Founding Client service rate shown remains available while the qualifying service stays continuously active. If service is canceled, future service may be offered under the pricing and terms available at that time.\n\nIncluded monthly edit time applies only to routine content, image, and minor layout changes, expires at the end of each month, and does not roll over. New pages, redesigns, custom features, integrations, and urgent after-hours work are quoted separately. Priority handling does not guarantee an immediate response at every hour. Domains and third-party services are billed separately when applicable.",
    valid_until: "",
  };
}

function fillForm(version) {
  const values = version || defaultVersion();
  Object.entries(fieldIds).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (key === "title") input.value = selectedProposal?.title || `${selectedRequest?.business_name || "Website"} Proposal & Agreement`;
    else if (key === "introduction") input.value = "";
    else if (key === "project_objective") input.value = [values.introduction, values.project_objective].filter((value) => String(value || "").trim()).join("\n\n");
    else if (["deliverables", "exclusions"].includes(key)) input.value = (values[key] || []).join("\n");
    else if (key.endsWith("_cents")) input.value = centsToMoney(values[key]);
    else input.value = values[key] || "";
  });
  configureReferralDiscount({ apply: Boolean(!version && selectedRequest?.referral_code) });
  renderLineItems(version);
  document.getElementById(fieldIds.recurring_start_policy).dispatchEvent(new Event("change", { bubbles: true }));
}

function renderEditor() {
  clearProposalAiInlineReview();
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
  const isApproved = !isDraft && selectedProposal?.status === "approved";
  Array.from(form.elements).forEach((element) => {
    if (element === newVersionButton || element === deleteVersionButton || element === previewLink || element === prepareBillingButton || element.matches("[data-ai-section]") || element.closest("#proposal-copilot")) return;
    if (element.id === "send-proposal") element.disabled = false;
    else if (element.id === "preview-proposal-email") element.disabled = !isDraft;
    else if (element.id === "save-proposal") element.disabled = !isDraft;
    else element.disabled = !isDraft;
  });
  // The draft lock pass above enables normal form controls again. Re-apply
  // the founder-offer lock after it so the waiver cannot be toggled off.
  configureReferralDiscount({ apply: Boolean(!editingVersion && selectedRequest?.referral_code) });
  updateInvestmentTotals();
  sendButton.textContent = isDraft ? "Send for approval" : "Resend agreement";
  newVersionButton.hidden = !selectedProposal || isDraft;
  newVersionButton.textContent = isApproved ? "Create billing revision" : "Create revision";
  deleteVersionButton.hidden = !editingVersion?.id || editingVersion.status !== "draft";
  previewLink.hidden = !selectedProposal?.current_version_id;
  if (selectedProposal) previewLink.href = `/proposals/?proposal=${encodeURIComponent(selectedProposal.id)}`;
  const billingSnapshot = billingSnapshots.find((snapshot) => snapshot.proposal_id === selectedProposal?.id);
  prepareBillingButton.hidden = !selectedProposal;
  prepareBillingButton.dataset.projectId = billingSnapshot?.project_id || "";
  if (billingSnapshot) {
    prepareBillingButton.disabled = false;
    prepareBillingButton.textContent = "Open billing";
  } else if (isApproved) {
    const hasBillableAmount = Number(editingVersion?.total_cents || 0) > 0 || Number(editingVersion?.recurring_cents || 0) > 0;
    prepareBillingButton.disabled = !hasBillableAmount;
    prepareBillingButton.textContent = hasBillableAmount ? "Prepare billing" : "Create revision to add billing";
  } else if (isDraft && selectedProposal?.status === "approved") {
    prepareBillingButton.disabled = true;
    prepareBillingButton.textContent = "Send revision before billing";
  } else {
    prepareBillingButton.disabled = true;
    prepareBillingButton.textContent = selectedProposal?.status === "sent"
      ? "Billing available after client approval"
      : "Accept agreement before billing";
  }
  copilotPanel.hidden = false;
  updateCopilotSectionActions();
  syncCopilotOpenState();
  if (!selectedProposal || !editingVersion) {
    copilotReview.hidden = true;
    copilotGlobalResult.append(copilotReview);
    copilotHistory.innerHTML = "<p>No Proposal Copilot runs yet.</p>";
  } else {
    loadCopilotWorkspace().catch((error) => setCopilotStatus(error.message, true));
  }
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
    introduction: null,
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
    recurring_start_policy: recurringCents ? document.getElementById(fieldIds.recurring_start_policy).value : "immediate",
    complimentary_months: document.getElementById(fieldIds.recurring_start_policy).value === "review_required"
      ? Math.max(1, Number(document.getElementById(fieldIds.complimentary_months).value || 12))
      : 0,
    review_notice_days: Math.max(1, Number(document.getElementById(fieldIds.review_notice_days).value || 45)),
    payment_schedule: document.getElementById(fieldIds.payment_schedule).value.trim() || null,
    terms: document.getElementById(fieldIds.terms).value.trim(),
    },
  };
}

async function loadData(preferredRequestId) {
  const [requestResult, proposalResult, versionResult, lineItemResult, billingResult, projectResult, memberResult] = await Promise.all([
    supabase.from("website_service_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposal_versions").select("*").order("version_number", { ascending: false }),
    supabase.from("website_proposal_line_items").select("*").order("sort_order"),
    supabase.from("website_billing_snapshots").select("id,proposal_id,project_id,status"),
    supabase.from("website_projects").select("id,request_id,proposal_id,managed_website_id,client_user_id"),
    supabase.from("website_members").select("website_id,user_id,status"),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (versionResult.error) throw versionResult.error;
  if (lineItemResult.error) throw lineItemResult.error;
  if (billingResult.error) throw billingResult.error;
  if (projectResult.error) throw projectResult.error;
  if (memberResult.error) throw memberResult.error;
  const context = readWorkspaceContext("admin", currentUser.id);
  const organizationProjects = context.websiteId
    ? (projectResult.data || []).filter((project) => project.managed_website_id === context.websiteId)
    : (projectResult.data || []);
  const organizationProjectIds = new Set(organizationProjects.map((project) => project.id));
  const organizationRequestIds = new Set(organizationProjects.map((project) => project.request_id).filter(Boolean));
  const organizationClientIds = new Set([
    ...organizationProjects.map((project) => project.client_user_id).filter(Boolean),
    ...(memberResult.data || []).filter((member) => member.website_id === context.websiteId && member.status === "active").map((member) => member.user_id),
  ]);
  proposals = (proposalResult.data || []).filter((proposal) => !context.websiteId || organizationProjectIds.has(proposal.project_id) || organizationRequestIds.has(proposal.request_id) || organizationClientIds.has(proposal.client_user_id));
  proposals.forEach((proposal) => organizationRequestIds.add(proposal.request_id));
  requests = (requestResult.data || []).filter((request) => !context.websiteId || organizationRequestIds.has(request.id) || organizationClientIds.has(request.user_id));
  versions = versionResult.data || [];
  lineItems = lineItemResult.data || [];
  billingSnapshots = billingResult.data || [];
  renderRequestOptions();
  const params = new URLSearchParams(window.location.search);
  const explicitProposal = proposals.find((proposal) => proposal.id === params.get("proposal"));
  const contextualProposal = explicitProposal
    || proposals.find((proposal) => proposal.id === context.proposalId)
    || proposals.find((proposal) => proposal.project_id && proposal.project_id === context.projectId)
    || (proposals.length === 1 ? proposals[0] : undefined);
  const requested = preferredRequestId
    || explicitProposal?.request_id
    || params.get("request")
    || context.requestId
    || contextualProposal?.request_id;
  selectedRequest = requests.find((request) => request.id === requested)
    || requests.find((request) => request.id === contextualProposal?.request_id)
    || (requests.length === 1 ? requests[0] : undefined)
    || (!context.websiteId && !context.projectId ? requests[0] : undefined);
  if (selectedRequest) requestSelect.value = selectedRequest.id;
  else requestSelect.selectedIndex = -1;
  selectedProposal = contextualProposal?.request_id === selectedRequest?.id
    ? contextualProposal
    : proposals.find((proposal) => proposal.request_id === selectedRequest?.id);
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
    setStatus(error?.message || "Unable to save this agreement.", true);
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
  const reviewRequired = collected.version.recurring_start_policy === "review_required";
  const rows = (items) => items.map((item) => `
    <div class="proposal-email-item"><span>${escapeHtml(item.name)}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span><strong>${formatMoney(Math.round(item.quantity * item.unit_amount_cents))}${item.billing_type === "recurring" ? ` / ${escapeHtml(item.recurring_interval)}` : ""}</strong></div>
  `).join("");
  document.getElementById("proposal-email-meta").textContent = `To: ${selectedRequest.contact_name} · ${selectedRequest.contact_email}`;
  return `
    <div class="proposal-email-card">
      <div class="proposal-email-hero"><p>N3XRA · Proposal &amp; Agreement</p><h2>Your agreement is ready to review.</h2></div>
      <div class="proposal-email-body">
        <p>Hi ${escapeHtml(selectedRequest.contact_name.split(/\s+/)[0] || selectedRequest.contact_name)},</p>
        <p>We’ve prepared the Proposal &amp; Agreement for <strong>${escapeHtml(title)}</strong>. It includes the project scope, schedule, investment, payment plan, and terms for you to review in your secure dashboard.</p>
        <div class="proposal-email-summary"><strong>Project at a glance</strong><p>${escapeHtml(collected.version.project_objective)}</p><p><strong>Timeline:</strong> ${escapeHtml(collected.version.timeline)}</p></div>
        ${oneTime.length ? `<h3>Project investment</h3>${rows(oneTime)}${collected.version.discount_cents ? `<div class="proposal-email-item"><span>Discount</span><strong>−${formatMoney(collected.version.discount_cents)}</strong></div>` : ""}<div class="proposal-email-item is-total"><span>Total</span><strong>${formatMoney(collected.version.total_cents)}</strong></div>` : ""}
        ${recurring.length ? `<h3>Ongoing services</h3>${rows(recurring)}${reviewRequired ? `<div class="proposal-email-notice"><strong>First ${collected.version.complimentary_months} months: $0.</strong><br>The approved prices are shown above for reference. N3XRA will review paid service ${collected.version.review_notice_days} days before the free period ends. No paid subscription or invoice begins without written approval.</div>` : ""}` : ""}
        <div class="proposal-email-notice"><strong>No payment is collected from this email.</strong><br>Approving the agreement records your acceptance of this version. N3XRA then prepares billing from the approved investment and payment schedule.</div>
        <p>When you’re ready, open your dashboard to read the complete agreement and respond.</p>
        <a class="proposal-email-cta" href="https://www.n3xra.com/account">Review agreement in your dashboard</a>
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
  if (!response.ok) throw new Error(result.error || "The agreement was published, but the email could not be sent.");
  return result;
}

async function sendProposal() {
  sendButton.disabled = true;
  setStatus("Publishing agreement…");
  let proposalPublished = false;
  try {
    if (editingVersion?.status === "sent" && selectedProposal?.current_version_id === editingVersion.id) {
      setStatus("Sending agreement email…");
      await emailProposal(selectedProposal.id, editingVersion.id);
      setStatus(`Proposal email sent to ${selectedRequest.contact_email}.`);
      emailDialog.close();
      await loadData(selectedRequest.id);
      return;
    }
    await saveDraft(null, true);
    const proposal = proposals.find((item) => item.request_id === selectedRequest.id);
    const draft = versions.find((version) => version.proposal_id === proposal?.id && version.status === "draft");
    if (!proposal || !draft) throw new Error("Save the agreement draft before sending it.");

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
    setStatus(error?.message || "Unable to send this agreement.", true);
    if (proposalPublished) await loadData(selectedRequest.id);
  } finally {
    sendButton.disabled = false;
  }
}

async function createRevision() {
  if (!selectedProposal || !editingVersion) return;
  const { data, error } = await supabase.rpc("create_website_proposal_draft_revision", {
    target_version_id: editingVersion.id,
  });
  if (error) throw error;
  await loadData(selectedRequest.id);
  setStatus(`Version ${data?.version_number || ""} is ready to edit.`.replace("  ", " "));
}

async function proposalAiRequest(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again before using Proposal Copilot.");
  const response = await fetch("/api/website-proposal-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Proposal Copilot is unavailable.");
  return result;
}

function historySummary(run) {
  const date = new Date(run.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const instruction = String(run.instruction_preview || run.instruction || "").trim();
  const model = String(run.model || "").startsWith("groq:")
    ? `Groq · ${String(run.model).slice(5).replace(/^openai\//, "").replaceAll("-", " ").toUpperCase()}`
    : `OpenAI · ${String(run.model || "unknown").replaceAll("-", " ").toUpperCase()}`;
  const outcome = run.status === "applied"
    ? `${run.accepted_count} accepted · ${run.rejected_count} rejected`
    : run.status === "failed" ? "Failed" : `${run.suggestion_count} suggestions`;
  return `<div><p><strong>${escapeHtml(date)}</strong> · ${escapeHtml(formatLabel(run.status))}</p><small>${escapeHtml(instruction.slice(0, 110))}${instruction.length > 110 ? "…" : ""} · ${escapeHtml(outcome)} · ${escapeHtml(model)}</small></div>`;
}

function renderCopilotHistory(runs = []) {
  copilotHistory.innerHTML = runs.length ? runs.map((run) => `
    <article class="proposal-ai-history-row">
      ${historySummary(run)}
      <div class="proposal-ai-history-actions">
        <button class="portal-button portal-button-secondary" data-ai-run-detail="${escapeHtml(run.id)}" type="button">View details</button>
        ${run.status !== "applied" || Number(run.accepted_count || 0) === 0
          ? `<button class="portal-button portal-button-danger" data-ai-run-remove="${escapeHtml(run.id)}" type="button">Remove</button>`
          : ""}
      </div>
    </article>
  `).join("") : "<p>No Proposal Copilot runs yet.</p>";
}

function valueText(operation, value = operation.proposed) {
  if (operation.target?.kind === "line_item" && operation.operation === "remove") {
    return `Remove ${operation.original?.name || "this billing item"}`;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && operation.target?.kind === "line_item") {
    const interval = value.billing_type === "recurring" ? ` / ${value.recurring_interval}` : " one time";
    return [
      value.name,
      `${value.quantity} × $${centsToMoney(value.unit_amount_cents)}${interval}`,
      value.description,
    ].filter(Boolean).join("\n");
  }
  if (["discount_cents", "deposit_cents", "unit_amount_cents"].includes(operation.field) && Number.isFinite(Number(value))) {
    return `$${centsToMoney(value)}`;
  }
  if (Array.isArray(value)) return value.join("\n");
  if (value === null || value === undefined || value === "") return "Clear this field";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function reviewIds(run) {
  return {
    accepted: new Set(run.review_result?.accepted_operation_ids || []),
    rejected: new Set(run.review_result?.rejected_operation_ids || []),
  };
}

function runTargetSection(run) {
  const instructionSource = (run.source_manifest || []).find((item) => item.source_type === "admin_instruction");
  const targets = instructionSource?.target_sections || [];
  return targets.length === 1 && copilotSections.includes(targets[0]) ? targets[0] : null;
}

function placeCopilotReview(section = null) {
  const destination = section
    ? document.querySelector(`[data-ai-result-slot="${section}"]`)
    : copilotGlobalResult;
  (destination || copilotGlobalResult).append(copilotReview);
  if (!destination || !section) {
    copilotPanel.open = true;
    syncCopilotOpenState();
  }
}

function clearProposalAiInlineReview() {
  document.querySelectorAll(".proposal-ai-inline-host").forEach((host) => host.remove());
  form?.removeAttribute("data-ai-review-run");
}

function operationSectionName(operation) {
  if (operation.target?.kind === "proposal" || ["introduction", "project_objective"].includes(operation.field)) return "overview";
  if (["scope_summary", "deliverables", "exclusions"].includes(operation.field)) return "scope";
  if (["timeline", "estimated_start_date", "estimated_completion_date", "valid_until"].includes(operation.field)) return "schedule";
  if (operation.target?.kind === "line_item" || ["discount_cents", "deposit_cents", "payment_schedule"].includes(operation.field)) return "investment";
  return "terms";
}

function operationAnchor(operation) {
  if (["proposal", "version"].includes(operation.target?.kind)) {
    const input = document.getElementById(fieldIds[operation.field]);
    if (input) return { element: input.closest("label") || input, after: true };
  }
  if (operation.target?.kind === "line_item") {
    if (operation.operation === "add") return { element: lineItemsContainer, after: false };
    const row = Array.from(lineItemsContainer.querySelectorAll(".proposal-line-item"))
      .find((item) => item.dataset.lineItemId === operation.target.id);
    if (row) {
      if (operation.field === "item" || operation.operation === "remove") return { element: row, after: true };
      const lineField = operation.field === "unit_amount_cents" ? "unit_amount" : operation.field;
      const input = row.querySelector(`[data-line-field="${lineField}"]`);
      return { element: input?.closest("label") || row, after: Boolean(input) };
    }
  }
  return { element: document.querySelector(`[data-ai-result-slot="${operationSectionName(operation)}"]`) || copilotGlobalResult, after: false };
}

function operationReviewMarkup(operation, run, reviewed, readonly) {
  const accepted = reviewed.accepted.has(operation.id);
  const rejected = reviewed.rejected.has(operation.id);
  const warning = operation.server_validation?.warning
    || (operation.server_validation?.supported === false
      ? operation.server_validation?.reason || "This value was inferred rather than directly matched to a source."
      : "");
  const title = operation.target?.kind === "line_item"
    ? operation.operation === "add" ? "Add billing item" : operation.operation === "remove" ? "Remove billing item" : "Update billing item"
    : `AI suggestion for ${formatLabel(operation.field)}`;
  return `<article class="proposal-ai-operation proposal-ai-inline-operation" data-ai-operation="${escapeHtml(operation.id)}" data-ai-review-run="${escapeHtml(run.id)}">
    <div class="proposal-ai-operation-head"><div><h5>${escapeHtml(title)}</h5><p>${escapeHtml(operation.rationale || "Suggested update")}</p></div><span class="proposal-ai-risk${operation.risk === "protected" ? " is-protected" : ""}">${operation.risk === "protected" ? "Review carefully" : "AI draft"}</span></div>
    <div class="proposal-ai-value proposal-ai-proposed-value"><strong>AI suggests</strong><pre>${escapeHtml(valueText(operation))}</pre></div>
    ${warning ? `<p class="proposal-ai-review-note"><strong>Check before approving:</strong> ${escapeHtml(warning)}</p>` : ""}
    <div class="proposal-ai-decision"><label><input type="radio" name="proposal-ai-${escapeHtml(run.id)}-${escapeHtml(operation.id)}" value="accept"${accepted ? " checked" : ""}${readonly ? " disabled" : ""}> Approve</label><label><input type="radio" name="proposal-ai-${escapeHtml(run.id)}-${escapeHtml(operation.id)}" value="reject"${rejected ? " checked" : ""}${readonly ? " disabled" : ""}> Deny</label></div>
  </article>`;
}

function mountOperationReview(operation, run, reviewed, readonly) {
  const host = document.createElement("div");
  host.className = "proposal-ai-inline-host";
  host.dataset.aiReviewRun = run.id;
  host.innerHTML = operationReviewMarkup(operation, run, reviewed, readonly);
  const anchor = operationAnchor(operation);
  if (anchor.after) anchor.element.insertAdjacentElement("afterend", host);
  else anchor.element.append(host);
}

function firstOperationReview(runId) {
  return Array.from(form.querySelectorAll(".proposal-ai-inline-host"))
    .find((host) => host.dataset.aiReviewRun === runId);
}

function renderCopilotRun(run, preferredSection = null) {
  const operations = run.change_set?.operations || [];
  const reviewed = reviewIds(run);
  const readonly = run.status !== "ready";
  const section = preferredSection || runTargetSection(run);
  clearProposalAiInlineReview();
  form.dataset.aiReviewRun = run.id;
  placeCopilotReview(section);
  copilotReview.hidden = false;
  copilotReview.dataset.runId = run.id;
  if (!operations.length) form.removeAttribute("data-ai-review-run");
  copilotReview.innerHTML = `
    <p class="proposal-ai-summary"><strong>${operations.length ? `${operations.length} proposal suggestion${operations.length === 1 ? "" : "s"} ready for review.` : "No safe changes were suggested."}</strong> ${escapeHtml(run.change_set?.summary || (operations.length ? "Approve or deny every change before applying it." : "Add more specific guidance or complete the missing business terms yourself."))}</p>
    ${run.error ? `<p class="proposal-ai-rejection">${escapeHtml(run.error)}</p>` : ""}
    ${operations.length ? `<div class="proposal-ai-review-list">${operations.map((operation) => operationReviewMarkup(operation, run, reviewed, readonly)).join("")}</div>` : ""}
    ${run.status === "ready" && operations.length ? `<div class="portal-form-actions proposal-copilot-actions"><button class="portal-button" id="apply-proposal-ai" type="button" disabled>Apply reviewed changes</button><p class="portal-inline-status">Choose Approve or Deny for every suggestion.</p></div>` : ""}
  `;
  updateCopilotApplyState();
}

function collectCopilotReview() {
  const accepted = [];
  const rejected = [];
  const runId = form.dataset.aiReviewRun;
  const cards = Array.from(form.querySelectorAll("[data-ai-operation]"))
    .filter((card) => card.dataset.aiReviewRun === runId);
  for (const card of cards) {
    const choice = card.querySelector('input[type="radio"]:checked')?.value;
    if (choice === "accept") accepted.push(card.dataset.aiOperation);
    else if (choice === "reject") rejected.push(card.dataset.aiOperation);
  }
  return { accepted, rejected, complete: accepted.length + rejected.length === cards.length };
}

function updateCopilotApplyState() {
  const button = document.getElementById("apply-proposal-ai");
  if (!button) return;
  const review = collectCopilotReview();
  button.disabled = !review.complete;
  button.textContent = review.complete && review.accepted.length === 0
    ? "Finish review"
    : `Apply ${review.accepted.length} AI change${review.accepted.length === 1 ? "" : "s"}`;
  const note = button.nextElementSibling;
  if (note) note.textContent = review.complete ? `${review.accepted.length} approved · ${review.rejected.length} denied` : "Choose Approve or Deny beside every affected field.";
}

async function loadCopilotWorkspace() {
  if (!selectedProposal?.id || !editingVersion?.id) {
    return;
  }
  const sequence = ++copilotLoadSequence;
  setCopilotStatus("Loading Proposal Copilot…");
  const result = await proposalAiRequest({ action: "history", proposal_id: selectedProposal.id });
  if (sequence !== copilotLoadSequence || result.runs?.[0]?.proposal_id && result.runs[0].proposal_id !== selectedProposal.id) return;
  renderCopilotHistory(result.runs);
  setCopilotStatus("");
}

async function ensureCopilotBaseline() {
  if (selectedProposal?.id && editingVersion?.id) return false;
  setCopilotStatus("Saving a starter proposal so AI can use an auditable baseline…");
  await saveDraft(null, true);
  if (!selectedProposal?.id || !editingVersion?.id) throw new Error("The starter proposal could not be saved.");
  return true;
}

function generatedCopilotInstruction(targetSections) {
  const adminStatement = copilotInstruction.value.trim();
  const fieldGuidance = {
    overview: "Overview means the proposal title and project_objective (the client-facing Project Summary). Do not answer with scope_summary.",
    scope: "Scope means scope_summary, deliverables, and exclusions.",
    schedule: "Schedule means timeline and proposal dates, but leave them unchanged unless an authoritative source states the exact commitment.",
    investment: "Investment means billing items, discounts, deposits, and payment schedule, but leave them unchanged unless an authoritative source states the exact value.",
    terms: "Terms means revision_policy and terms, but leave them unchanged unless an authoritative source states the exact contractual language.",
  };
  const sectionText = targetSections.length === 1
    ? `${sectionCompletion(targetSections[0])} the ${targetSections[0]} section`
    : "draft all proposal sections";
  return [
    adminStatement || "Use the included authoritative project information to prepare this proposal.",
    `Task: ${sectionText} using the saved proposal, website request, approved onboarding, current project information, and approved asset list.`,
    ...targetSections.map((section) => fieldGuidance[section]),
    "Write concise, client-ready language and preserve accurate existing content. Never infer pricing, billing values, dates, deposits, promises, revision limits, support hours, payment terms, or contractual language. Leave an unknown protected field unchanged.",
  ].join("\n\n");
}

async function generateCopilotSuggestions(section = null) {
  const targetSections = section ? [section] : [...copilotSections];
  if (section && !copilotSections.includes(section)) throw new Error("Choose a supported proposal section.");
  setCopilotButtonBusy(section, true);
  setCopilotStatus(section ? `Preparing the ${formatLabel(section)} section…` : "Preparing the proposal…");
  try {
    const createdBaseline = await ensureCopilotBaseline();
    if (!createdBaseline && editingVersion.status === "draft") await saveDraft(null, true);
    await loadCopilotWorkspace();
    const instruction = generatedCopilotInstruction(targetSections);
    setCopilotStatus(section ? `Drafting the ${formatLabel(section)} section from your statement and project information…` : "Drafting the full proposal from your statement and project information…");
    const result = await proposalAiRequest({
      action: "generate", proposal_id: selectedProposal.id, instruction,
      target_sections: targetSections,
    });
    renderCopilotRun(result.run, section);
    setCopilotStatus(`Review ${result.run.suggestion_count} AI suggestion${result.run.suggestion_count === 1 ? "" : "s"}, then apply the changes you want.`);
    await loadCopilotWorkspace();
    (firstOperationReview(result.run.id) || copilotReview).scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    setCopilotButtonBusy(section, false);
  }
}

async function loadCopilotRun(runId) {
  setCopilotStatus("Loading run details…");
  const result = await proposalAiRequest({ action: "detail", proposal_id: selectedProposal.id, run_id: runId });
  renderCopilotRun(result.run, runTargetSection(result.run));
  setCopilotStatus("");
  (firstOperationReview(result.run.id) || copilotReview).scrollIntoView({ behavior: "smooth", block: "center" });
}

async function removeCopilotRun(runId) {
  if (!window.confirm("Remove this failed or unused AI attempt?")) return;
  setCopilotStatus("Removing AI attempt…");
  await proposalAiRequest({ action: "remove", proposal_id: selectedProposal.id, run_id: runId });
  if (copilotReview.dataset.runId === runId) {
    clearProposalAiInlineReview();
    copilotReview.hidden = true;
    copilotReview.removeAttribute("data-run-id");
    copilotGlobalResult.append(copilotReview);
  }
  await loadCopilotWorkspace();
  setCopilotStatus("AI attempt removed.");
}

async function applyCopilotRun() {
  const button = document.getElementById("apply-proposal-ai");
  const review = collectCopilotReview();
  if (!review.complete) return;
  button.disabled = true;
  setCopilotStatus("Applying accepted changes in one transaction…");
  try {
    const result = await proposalAiRequest({
      action: "apply", proposal_id: selectedProposal.id, run_id: copilotReview.dataset.runId,
      accepted_operation_ids: review.accepted, rejected_operation_ids: review.rejected,
    });
    await loadData(selectedRequest.id);
    copilotReview.hidden = true;
    copilotGlobalResult.append(copilotReview);
    updateCopilotSectionActions();
    setCopilotStatus(`Applied ${result.result?.accepted_count || 0} change${result.result?.accepted_count === 1 ? "" : "s"} to draft version ${result.result?.version_number || ""}.`);
  } catch (error) {
    button.disabled = false;
    throw error;
  }
}

async function deleteDraftVersion() {
  if (!editingVersion?.id || editingVersion.status !== "draft") return;
  confirmDeleteVersionButton.disabled = true;
  setStatus(`Deleting version ${editingVersion.version_number}…`);
  try {
    const { data, error } = await supabase.rpc("delete_website_proposal_draft_version", {
      target_version_id: editingVersion.id,
    });
    if (error) throw error;
    deleteVersionDialog.close();
    await loadData(selectedRequest.id);
    setStatus(`Draft version ${data?.version_number || ""} deleted.`.replace("  ", " "));
  } catch (error) {
    setStatus(error?.message || "Unable to delete this draft version.", true);
  } finally {
    confirmDeleteVersionButton.disabled = false;
  }
}

async function prepareBilling() {
  if (!selectedProposal) return;
  const existingSnapshot = billingSnapshots.find((snapshot) => snapshot.proposal_id === selectedProposal.id);
  if (existingSnapshot) {
    window.location.href = `/n3xra-admin/billing/?project=${encodeURIComponent(existingSnapshot.project_id)}`;
    return;
  }
  if (selectedProposal.status !== "approved") return;
  prepareBillingButton.disabled = true;
  setStatus("Preparing an immutable billing snapshot…");
  try {
    const { data, error } = await supabase.functions.invoke("prepare-billing", {
      body: { proposal_id: selectedProposal.id },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    window.location.href = `/n3xra-admin/billing/?project=${encodeURIComponent(data.snapshot.project_id)}`;
  } catch (error) {
    let message = error?.message || "Unable to prepare billing.";
    try {
      const details = await error?.context?.json?.();
      if (details?.error) message = details.error;
    } catch {
      // Keep the normal error message when the response body is unavailable.
    }
    setStatus(message, true);
  } finally {
    prepareBillingButton.disabled = false;
  }
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;

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
  addStarterPlanButton.addEventListener("click", () => {
    lineItemsContainer.insertAdjacentHTML("beforeend", lineItemMarkup(servicePlanItem("starter")));
    updateInvestmentTotals();
  });
  addStarterPlusPlanButton.addEventListener("click", () => {
    lineItemsContainer.insertAdjacentHTML("beforeend", lineItemMarkup(servicePlanItem("starter_plus")));
    updateInvestmentTotals();
  });
  addAdvancedPlanButton.addEventListener("click", () => {
    lineItemsContainer.insertAdjacentHTML("beforeend", lineItemMarkup(advancedBuildItem()));
    lineItemsContainer.insertAdjacentHTML("beforeend", lineItemMarkup(servicePlanItem("advanced")));
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
    if (event.target.matches('[data-line-field="recurring_interval"]')) applyServicePlanIntervalPrice(row);
    updateInvestmentTotals();
  });
  newVersionButton.addEventListener("click", () => createRevision().catch((error) => setStatus(error.message, true)));
  deleteVersionButton.addEventListener("click", () => deleteVersionDialog.showModal());
  confirmDeleteVersionButton.addEventListener("click", deleteDraftVersion);
  document.querySelectorAll("[data-close-delete-version]").forEach((button) => {
    button.addEventListener("click", () => deleteVersionDialog.close());
  });
  prepareBillingButton.addEventListener("click", prepareBilling);
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
  copilotPanel.addEventListener("toggle", () => {
    syncCopilotOpenState();
    if (copilotPanel.open && selectedProposal?.id && editingVersion?.id) {
      loadCopilotWorkspace().catch((error) => setCopilotStatus(error.message, true));
    }
  });
  copilotGenerateButton.addEventListener("click", () => generateCopilotSuggestions().catch((error) => {
    copilotPanel.open = true;
    setCopilotStatus(error.message, true);
  }));
  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ai-section]");
    if (!button) return;
    generateCopilotSuggestions(button.dataset.aiSection).catch((error) => {
      copilotPanel.open = true;
      setCopilotStatus(error.message, true);
    });
  });
  form.addEventListener("input", updateCopilotSectionActions);
  form.addEventListener("change", (event) => {
    updateCopilotSectionActions();
    if (event.target.closest("[data-ai-operation]")) updateCopilotApplyState();
  });
  copilotRefreshButton.addEventListener("click", () => loadCopilotWorkspace().catch((error) => setCopilotStatus(error.message, true)));
  copilotHistory.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-ai-run-detail]");
    if (detailButton) loadCopilotRun(detailButton.dataset.aiRunDetail).catch((error) => setCopilotStatus(error.message, true));
    const removeButton = event.target.closest("[data-ai-run-remove]");
    if (removeButton) removeCopilotRun(removeButton.dataset.aiRunRemove).catch((error) => setCopilotStatus(error.message, true));
  });
  copilotReview.addEventListener("click", (event) => {
    if (event.target.closest("#apply-proposal-ai")) applyCopilotRun().catch((error) => setCopilotStatus(error.message, true));
  });
  document.getElementById(fieldIds.discount_cents).addEventListener("input", updateTotal);
  document.getElementById(fieldIds.recurring_start_policy).addEventListener("change", updateTotal);
  document.getElementById(fieldIds.complimentary_months).addEventListener("input", updateTotal);
  document.getElementById(fieldIds.review_notice_days).addEventListener("input", updateTotal);
  referralDiscountToggle.addEventListener("change", () => {
    if (!referralDiscountToggle.checked) document.getElementById(fieldIds.discount_cents).value = "0.00";
    updateInvestmentTotals();
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Proposal administration could not be opened.";
});
