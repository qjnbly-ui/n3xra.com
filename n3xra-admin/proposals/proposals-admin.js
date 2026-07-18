import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

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
const previewLink = document.getElementById("preview-proposal");
const refreshButton = document.getElementById("refresh-proposals");

let supabase;
let currentUser;
let requests = [];
let proposals = [];
let versions = [];
let selectedRequest;
let selectedProposal;
let editingVersion;

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
  updateTotal();
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
    if (element.id === "send-proposal" || element.id === "save-proposal") element.disabled = !isDraft;
    else element.disabled = !isDraft;
  });
  newVersionButton.hidden = !selectedProposal || isDraft;
  previewLink.hidden = !selectedProposal?.current_version_id;
  if (selectedProposal) previewLink.href = `/proposals/?proposal=${encodeURIComponent(selectedProposal.id)}`;
}

function collectVersion() {
  updateTotal();
  const recurringCents = moneyToCents(document.getElementById(fieldIds.recurring_cents).value);
  const recurringInterval = document.getElementById(fieldIds.recurring_interval).value;
  if (recurringCents > 0 && !recurringInterval) throw new Error("Choose an interval for the recurring service.");
  if (recurringCents === 0 && recurringInterval) throw new Error("Enter a recurring amount or choose None.");

  const subtotalCents = moneyToCents(document.getElementById(fieldIds.subtotal_cents).value);
  const discountCents = moneyToCents(document.getElementById(fieldIds.discount_cents).value);
  const totalCents = Math.max(subtotalCents - discountCents, 0);
  const depositCents = moneyToCents(document.getElementById(fieldIds.deposit_cents).value);
  if (depositCents > totalCents) throw new Error("The deposit cannot exceed the project total.");

  return {
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
  };
}

async function loadData(preferredRequestId) {
  const [requestResult, proposalResult, versionResult] = await Promise.all([
    supabase.from("website_service_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposal_versions").select("*").order("version_number", { ascending: false }),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (versionResult.error) throw versionResult.error;
  requests = requestResult.data || [];
  proposals = proposalResult.data || [];
  versions = versionResult.data || [];
  renderRequestOptions();
  const requested = preferredRequestId || new URLSearchParams(window.location.search).get("request");
  selectedRequest = requests.find((request) => request.id === requested) || requests[0];
  if (selectedRequest) requestSelect.value = selectedRequest.id;
  selectedProposal = proposals.find((proposal) => proposal.request_id === selectedRequest?.id);
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
    const versionValues = collectVersion();
    const proposal = await ensureProposal();
    const title = document.getElementById(fieldIds.title).value.trim();
    const proposalUpdate = await supabase.from("website_proposals").update({ title }).eq("id", proposal.id);
    if (proposalUpdate.error) throw proposalUpdate.error;

    if (editingVersion?.status === "draft") {
      const { error } = await supabase.from("website_proposal_versions").update(versionValues).eq("id", editingVersion.id);
      if (error) throw error;
    } else {
      const versionNumber = Math.max(0, ...versions.filter((version) => version.proposal_id === proposal.id).map((version) => version.version_number)) + 1;
      const { error } = await supabase.from("website_proposal_versions").insert({
        proposal_id: proposal.id,
        version_number: versionNumber,
        status: "draft",
        created_by_user_id: currentUser.id,
        ...versionValues,
      });
      if (error) throw error;
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

async function sendProposal() {
  sendButton.disabled = true;
  setStatus("Publishing proposal…");
  try {
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
    setStatus("Proposal sent to the client.");
    await loadData(selectedRequest.id);
  } catch (error) {
    setStatus(error?.message || "Unable to send this proposal.", true);
  } finally {
    sendButton.disabled = false;
  }
}

async function createRevision() {
  if (!selectedProposal || !editingVersion) return;
  const nextNumber = Math.max(...versions.filter((version) => version.proposal_id === selectedProposal.id).map((version) => version.version_number)) + 1;
  const copy = { ...editingVersion };
  ["id", "created_at", "updated_at", "sent_at"].forEach((key) => delete copy[key]);
  const { error } = await supabase.from("website_proposal_versions").insert({
    ...copy,
    proposal_id: selectedProposal.id,
    version_number: nextNumber,
    status: "draft",
    created_by_user_id: currentUser.id,
  });
  if (error) throw error;
  await loadData(selectedRequest.id);
  setStatus(`Version ${nextNumber} is ready to edit.`);
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Fproposals%2F");
    return;
  }
  currentUser = userData.user;
  const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action: "get-platform-admin-access" } });
  if (error || data?.error || !data?.admin) throw new Error("You do not have proposal administration access.");

  await loadData();
  form.addEventListener("submit", saveDraft);
  sendButton.addEventListener("click", sendProposal);
  newVersionButton.addEventListener("click", () => createRevision().catch((error) => setStatus(error.message, true)));
  requestSelect.addEventListener("change", () => {
    selectedRequest = requests.find((request) => request.id === requestSelect.value);
    selectedProposal = proposals.find((proposal) => proposal.request_id === selectedRequest?.id);
    renderEditor();
  });
  refreshButton.addEventListener("click", () => loadData(selectedRequest?.id).catch((error) => setStatus(error.message, true)));
  document.getElementById(fieldIds.subtotal_cents).addEventListener("input", updateTotal);
  document.getElementById(fieldIds.discount_cents).addEventListener("input", updateTotal);
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Proposal administration could not be opened.";
});
