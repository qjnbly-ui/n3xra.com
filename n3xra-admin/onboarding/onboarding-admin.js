import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=3";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const BUCKET = "website-onboarding-private";
const sectionLabels = {
  business: "Business details",
  brand: "Brand and design",
  content: "Pages and content",
  technical: "Domain and integrations",
  legal: "Legal and accessibility",
  launch: "Launch",
};

const statusScreen = document.getElementById("portal-status");
const proposalQueue = document.getElementById("approved-proposal-queue");
const proposalList = document.getElementById("approved-proposal-list");
const onboardingSelect = document.getElementById("admin-onboarding-select");
const onboardingState = document.getElementById("admin-onboarding-state");
const emptyState = document.getElementById("admin-onboarding-empty");
const workspace = document.getElementById("admin-onboarding-workspace");
const nameElement = document.getElementById("admin-onboarding-name");
const metaElement = document.getElementById("admin-onboarding-meta");
const progressElement = document.getElementById("admin-onboarding-progress");
const progressBar = document.getElementById("admin-onboarding-progress-bar");
const updatedElement = document.getElementById("admin-onboarding-updated");
const answersElement = document.getElementById("admin-onboarding-answers");
const filesElement = document.getElementById("admin-onboarding-files");
const notesInput = document.getElementById("admin-onboarding-notes");
const reviewStatus = document.getElementById("admin-onboarding-review-status");
const refreshButton = document.getElementById("refresh-onboarding-admin");

let supabase;
let currentUser;
let onboardingCandidates = [];
let proposals = [];
let onboardings = [];
let responses = [];
let files = [];
let selectedOnboarding;
let selectedResponse;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(value = "") {
  return String(value).replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => escapeHtml(item)).join(", ");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${escapeHtml(formatLabel(key))}: ${escapeHtml(item)}`).join("<br>");
  return escapeHtml(value || "Not provided");
}

function renderProposalQueue() {
  proposalQueue.hidden = !onboardingCandidates.length;
  proposalList.innerHTML = onboardingCandidates.length ? onboardingCandidates.map((request) => {
    const proposal = proposals.find((item) => item.request_id === request.id);
    const onboarding = onboardings.find((item) => item.request_id === request.id)
      || onboardings.find((item) => item.proposal_id && item.proposal_id === proposal?.id);
    return `
      <article class="portal-request-card">
        <div><p class="portal-kicker">${proposal ? "Proposal in progress" : "Accepted request"}</p><h3>${escapeHtml(request.business_name || proposal?.title || "Website project")}</h3><p>${escapeHtml(formatLabel(request.project_type || request.status))}</p></div>
        <div class="portal-request-client-actions">
          ${onboarding
            ? `<span class="portal-badge portal-status-${escapeHtml(onboarding.status)}">${escapeHtml(formatLabel(onboarding.status))}</span><button class="portal-button portal-button-secondary" type="button" data-open-onboarding="${onboarding.id}">Review onboarding</button>`
            : `<button class="portal-button" type="button" data-unlock-request="${request.id}">Give onboarding access</button>`}
        </div>
      </article>
    `;
  }).join("") : '<div class="portal-empty portal-empty-compact"><p>No accepted requests are waiting for onboarding.</p></div>';
}

function renderOptions() {
  onboardingSelect.innerHTML = onboardings.length
    ? onboardings.map((onboarding) => `<option value="${onboarding.id}">${escapeHtml(onboarding.website_service_requests?.business_name || onboarding.website_projects?.name || "Website project")} · ${escapeHtml(formatLabel(onboarding.status))}</option>`).join("")
    : '<option value="">No onboarding projects</option>';
  onboardingSelect.disabled = !onboardings.length;
}

function renderAnswers() {
  const answers = selectedResponse?.answers || {};
  answersElement.innerHTML = Object.keys(sectionLabels).map((section) => {
    const sectionAnswers = answers[section] || {};
    const rows = Object.entries(sectionAnswers);
    return `
      <section class="portal-answer-section">
        <h4>${escapeHtml(sectionLabels[section])}</h4>
        ${rows.length ? `<dl>${rows.map(([key, value]) => `<div><dt>${escapeHtml(formatLabel(key))}</dt><dd>${formatAnswer(value)}</dd></div>`).join("")}</dl>` : "<p>No answers provided in this section.</p>"}
      </section>
    `;
  }).join("");
}

function renderFiles() {
  const onboardingFiles = files.filter((file) => file.onboarding_id === selectedOnboarding?.id);
  filesElement.innerHTML = onboardingFiles.length ? onboardingFiles.map((file) => `
    <article class="portal-file-row">
      <div><span class="portal-pill">${escapeHtml(file.category)}</span><strong>${escapeHtml(file.original_filename)}</strong><p>${escapeHtml(file.note || "No note")}</p></div>
      <button class="portal-link-button" type="button" data-admin-file="${file.id}">Download</button>
    </article>
  `).join("") : '<div class="portal-empty portal-empty-compact"><p>No files uploaded.</p></div>';
}

function renderWorkspace() {
  emptyState.hidden = Boolean(selectedOnboarding);
  workspace.hidden = !selectedOnboarding;
  if (!selectedOnboarding) return;
  const businessName = selectedOnboarding.website_service_requests?.business_name || selectedOnboarding.website_projects?.name || "Website project";
  nameElement.textContent = businessName;
  metaElement.textContent = `${selectedOnboarding.website_proposals?.title || "Intake before agreement"} · ${formatLabel(selectedOnboarding.status)}`;
  onboardingState.innerHTML = `<span class="portal-badge portal-status-${escapeHtml(selectedOnboarding.status)}">${escapeHtml(formatLabel(selectedOnboarding.status))}</span>`;
  const completion = Number(selectedResponse?.completion_percent || 0);
  progressElement.textContent = `${completion}% complete`;
  progressBar.style.width = `${completion}%`;
  updatedElement.textContent = selectedResponse?.updated_at ? `Updated ${new Date(selectedResponse.updated_at).toLocaleString()}` : "";
  notesInput.value = selectedOnboarding.admin_notes || "";
  const canReview = selectedOnboarding.status === "submitted";
  document.querySelectorAll("[data-review-status]").forEach((button) => { button.disabled = !canReview; });
  reviewStatus.textContent = canReview ? "" : selectedOnboarding.status === "approved" ? "Onboarding approved." : "Review actions become available after client submission.";
  renderAnswers();
  renderFiles();
}

async function loadData(preferredId) {
  const [requestResult, proposalResult, onboardingResult, responseResult, fileResult, projectResult, memberResult] = await Promise.all([
    supabase.from("website_service_requests").select("id,user_id,business_name,project_type,status,created_at").in("status", ["qualified", "proposal_drafting", "proposal_sent", "proposal_changes_requested", "proposal_approved"]).order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("id,request_id,project_id,client_user_id,title,status").order("created_at", { ascending: false }),
    supabase.from("website_onboardings").select("*,website_service_requests(business_name,project_type),website_proposals(title,status),website_projects(name,managed_website_id)").order("created_at", { ascending: false }),
    supabase.from("website_onboarding_responses").select("*"),
    supabase.from("website_onboarding_files").select("*").order("created_at", { ascending: false }),
    supabase.from("website_projects").select("id,managed_website_id,client_user_id"),
    supabase.from("website_members").select("website_id,user_id,status"),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  if (responseResult.error) throw responseResult.error;
  if (fileResult.error) throw fileResult.error;
  if (projectResult.error) throw projectResult.error;
  if (memberResult.error) throw memberResult.error;
  const context = readWorkspaceContext("admin", currentUser.id);
  const organizationUsers = new Set((memberResult.data || []).filter((member) => member.status === "active" && (!context.websiteId || member.website_id === context.websiteId)).map((member) => member.user_id));
  onboardings = (onboardingResult.data || []).filter((onboarding) => !context.websiteId
    || onboarding.website_projects?.managed_website_id === context.websiteId
    || organizationUsers.has(onboarding.client_user_id));
  proposals = proposalResult.data || [];
  onboardingCandidates = (requestResult.data || []).filter((request) => !context.websiteId || organizationUsers.has(request.user_id));
  responses = responseResult.data || [];
  files = fileResult.data || [];
  renderProposalQueue();
  renderOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("onboarding") || context.onboardingId;
  selectedOnboarding = onboardings.find((onboarding) => onboarding.id === requested)
    || onboardings.find((onboarding) =>
      onboarding.project_id === context.projectId
      || onboarding.proposal_id === context.proposalId
      || onboarding.request_id === context.requestId
    )
    || (!context.websiteId && !context.projectId ? onboardings[0] : undefined);
  selectedResponse = responses.find((response) => response.onboarding_id === selectedOnboarding?.id);
  if (selectedOnboarding) onboardingSelect.value = selectedOnboarding.id;
  else onboardingSelect.selectedIndex = -1;
  if (selectedOnboarding) writeWorkspaceContext("admin", currentUser.id, {
    onboardingId: selectedOnboarding.id,
    projectId: selectedOnboarding.project_id,
    websiteId: selectedOnboarding.website_projects?.managed_website_id,
    proposalId: selectedOnboarding.proposal_id,
    requestId: selectedOnboarding.request_id,
  });
  renderWorkspace();
}

async function unlockOnboarding(requestId) {
  const request = onboardingCandidates.find((item) => item.id === requestId);
  if (!request) throw new Error("The accepted request is no longer available.");
  const proposal = proposals.find((item) => item.request_id === request.id);
  const { data, error } = await supabase.from("website_onboardings").insert({
    project_id: proposal?.project_id || null,
    request_id: request.id,
    proposal_id: proposal?.id || null,
    client_user_id: request.user_id,
    status: "not_started",
    unlocked_by_user_id: currentUser.id,
  }).select().single();
  if (error) throw error;
  await loadData(data.id);
}

async function reviewOnboarding(status, button) {
  if (!selectedOnboarding || !selectedResponse) return;
  if (status === "needs_changes" && !notesInput.value.trim()) {
    reviewStatus.textContent = "Add clear notes before requesting changes.";
    reviewStatus.classList.add("is-error");
    return;
  }
  button.disabled = true;
  reviewStatus.classList.remove("is-error");
  reviewStatus.textContent = "Saving review…";
  try {
    if (status === "needs_changes") {
      const responseResult = await supabase.from("website_onboarding_responses").update({ status: "draft", submitted_at: null }).eq("onboarding_id", selectedOnboarding.id);
      if (responseResult.error) throw responseResult.error;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("website_onboardings").update({
      status,
      admin_notes: notesInput.value.trim() || null,
      reviewed_by_user_id: currentUser.id,
      reviewed_at: now,
    }).eq("id", selectedOnboarding.id);
    if (error) throw error;
    await loadData(selectedOnboarding.id);
    reviewStatus.textContent = status === "approved" ? "Onboarding approved." : "Changes returned to the client.";
  } catch (error) {
    reviewStatus.textContent = error?.message || "Unable to save this review.";
    reviewStatus.classList.add("is-error");
  } finally {
    button.disabled = false;
  }
}

async function downloadFile(fileId) {
  const file = files.find((item) => item.id === fileId);
  if (!file) return;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, 600, { download: file.original_filename });
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener");
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;
  await loadData();

  proposalList.addEventListener("click", (event) => {
    const unlock = event.target.closest("[data-unlock-request]");
    const open = event.target.closest("[data-open-onboarding]");
    if (unlock) {
      unlock.disabled = true;
      unlockOnboarding(unlock.dataset.unlockRequest).catch((error) => {
        unlock.disabled = false;
        proposalList.insertAdjacentHTML("afterbegin", `<p class="portal-inline-status is-error">${escapeHtml(error.message)}</p>`);
      });
    }
    if (open) loadData(open.dataset.openOnboarding).catch((error) => { reviewStatus.textContent = error.message; });
  });
  onboardingSelect.addEventListener("change", () => {
    selectedOnboarding = onboardings.find((onboarding) => onboarding.id === onboardingSelect.value);
    if (selectedOnboarding) writeWorkspaceContext("admin", currentUser.id, {
      onboardingId: selectedOnboarding.id,
      projectId: selectedOnboarding.project_id,
      websiteId: selectedOnboarding.website_projects?.managed_website_id,
      proposalId: selectedOnboarding.proposal_id,
      requestId: selectedOnboarding.request_id,
    });
    selectedResponse = responses.find((response) => response.onboarding_id === selectedOnboarding?.id);
    renderWorkspace();
  });
  document.querySelector(".portal-review-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-status]");
    if (button) reviewOnboarding(button.dataset.reviewStatus, button);
  });
  filesElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-file]");
    if (button) downloadFile(button.dataset.adminFile).catch((error) => { reviewStatus.textContent = error.message; });
  });
  refreshButton.addEventListener("click", () => loadData(selectedOnboarding?.id).catch((error) => { reviewStatus.textContent = error.message; }));
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Onboarding administration could not be opened.";
});
