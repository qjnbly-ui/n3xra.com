import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js";
import { projectContext, readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { confirmAdminAction } from "/account/admin/admin-dialogs.js";

const statusScreen = document.getElementById("portal-status");
const projectSelect = document.getElementById("admin-project-select");
const projectState = document.getElementById("admin-project-state");
const emptyState = document.getElementById("admin-project-empty");
const form = document.getElementById("project-admin-form");
const nameElement = document.getElementById("admin-project-name");
const metaElement = document.getElementById("admin-project-meta");
const progressValue = document.getElementById("admin-project-progress-value");
const progressBar = document.getElementById("admin-project-progress-bar");
const milestoneList = document.getElementById("admin-project-milestones");
const saveStatus = document.getElementById("admin-project-save-status");
const saveButton = document.getElementById("save-project-admin");
const refreshButton = document.getElementById("refresh-project-admin");
const actionStatus = document.getElementById("admin-project-action-status");
const completeButton = document.getElementById("complete-project-admin");
const closeButton = document.getElementById("close-project-admin");
const deleteButton = document.getElementById("delete-project-admin");
const deleteDialog = document.getElementById("delete-project-dialog");
const deleteForm = document.getElementById("delete-project-form");
const deleteProjectName = document.getElementById("delete-project-name");
const deleteConfirmation = document.getElementById("delete-project-confirmation");
const deleteStatus = document.getElementById("delete-project-status");
const cancelDeleteButton = document.getElementById("cancel-delete-project");
const confirmDeleteButton = document.getElementById("confirm-delete-project");
const provisioningState = document.getElementById("admin-project-provisioning-state");
const provisioningCopy = document.getElementById("admin-project-provisioning-copy");
const provisioningRepository = document.getElementById("admin-project-provisioning-repository");
const provisioningPreview = document.getElementById("admin-project-provisioning-preview");
const provisionButton = document.getElementById("provision-project-github");
const provisionVercelButton = document.getElementById("provision-project-vercel");
const provisioningStatus = document.getElementById("admin-project-provisioning-status");

let supabase;
let projects = [];
let milestones = [];
let onboardings = [];
let proposals = [];
let websites = [];
let provisioningRuns = [];
let selectedProject;
let currentUser;

function rememberProject() {
  if (selectedProject) writeWorkspaceContext("admin", currentUser.id, projectContext(selectedProject));
}

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

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function selectedMilestones() {
  return milestones
    .filter((milestone) => milestone.project_id === selectedProject?.id)
    .sort((a, b) => a.sequence_number - b.sequence_number);
}

function renderOptions() {
  projectSelect.innerHTML = projects.length
    ? projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)} · ${escapeHtml(formatLabel(project.status))}</option>`).join("")
    : '<option value="">No projects</option>';
  projectSelect.disabled = !projects.length;
}

function renderWebsiteOptions() {
  const select = document.getElementById("admin-project-website");
  select.innerHTML = '<option value="">Not connected yet</option>' + websites
    .map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`)
    .join("");
  select.value = selectedProject?.managed_website_id || "";
}

function renderMilestones() {
  milestoneList.innerHTML = selectedMilestones().map((milestone) => `
    <article class="portal-admin-milestone" data-milestone-id="${milestone.id}">
      <div class="portal-admin-milestone-title">
        <span>${milestone.sequence_number}</span>
        <div><h4>${escapeHtml(milestone.label)}</h4><p>${escapeHtml(milestone.client_description)}</p></div>
      </div>
      <div class="portal-admin-milestone-fields">
        <label>Status
          <select data-milestone-field="status">
            <option value="not_started" ${milestone.status === "not_started" ? "selected" : ""}>Not started</option>
            <option value="available" ${milestone.status === "available" ? "selected" : ""}>Available</option>
            <option value="in_progress" ${milestone.status === "in_progress" ? "selected" : ""}>In progress</option>
            <option value="blocked" ${milestone.status === "blocked" ? "selected" : ""}>Blocked</option>
            <option value="complete" ${milestone.status === "complete" ? "selected" : ""}>Complete</option>
            <option value="not_applicable" ${milestone.status === "not_applicable" ? "selected" : ""}>Not applicable</option>
          </select>
        </label>
        <label>Target date<input data-milestone-field="target_date" type="date" value="${escapeHtml(milestone.target_date || "")}"></label>
        <label class="portal-form-wide">Client note<textarea data-milestone-field="client_note" rows="2" placeholder="Optional client-facing update">${escapeHtml(milestone.client_note || "")}</textarea></label>
      </div>
    </article>
  `).join("");
}

function renderProjectControls() {
  const completed = selectedProject?.status === "completed";
  const closed = selectedProject?.status === "archived";
  completeButton.disabled = completed || closed;
  completeButton.textContent = completed ? "Project completed" : "Mark complete";
  closeButton.disabled = closed;
  closeButton.textContent = closed ? "Project closed" : "Close project";
}

function selectedProvisioning() {
  return provisioningRuns.find((run) => run.project_id === selectedProject?.id);
}

function provisioningLabel(status) {
  return ({
    not_started: "Not started",
    pending: "Waiting",
    github_creating: "Creating repository",
    github_ready: "Repository ready",
    failed: "Needs attention",
    vercel_creating: "Creating preview",
    vercel_ready: "Preview ready",
    vercel_failed: "Preview needs attention",
  })[status] || formatLabel(status);
}

function renderProvisioning() {
  const run = selectedProvisioning();
  const proposal = proposals.find((item) => item.id === selectedProject?.proposal_id);
  const onboarding = onboardings.find((item) => item.project_id === selectedProject?.id)
    || onboardings.find((item) => item.proposal_id === selectedProject?.proposal_id);
  const website = relation(selectedProject?.client_websites);
  const activeProject = selectedProject?.source === "proposal"
    && !["cancelled", "archived", "completed"].includes(selectedProject?.status);
  const prerequisites = [
    [Boolean(selectedProject?.managed_website_id), "connect a managed website"],
    [Boolean(website?.organization_id), "connect the client organization"],
    [proposal?.status === "approved", "approve the Proposal & Agreement"],
    [onboarding?.status === "approved", "approve onboarding"],
    [activeProject, "use an active new-website project"],
  ];
  const missing = prerequisites.filter(([ready]) => !ready).map(([, label]) => label);
  const status = run?.status || "not_started";
  const creating = status === "github_creating";
  const activeLease = creating && run?.lease_expires_at && new Date(run.lease_expires_at).getTime() > Date.now();
  const retryable = status === "failed" || (creating && !activeLease);
  const vercelCreating = status === "vercel_creating";
  const activeVercelLease = vercelCreating && run?.vercel_lease_expires_at
    && new Date(run.vercel_lease_expires_at).getTime() > Date.now();
  const vercelRetryable = status === "vercel_failed" || (vercelCreating && !activeVercelLease);
  provisioningState.innerHTML = `<span class="portal-badge portal-provisioning-${escapeHtml(status)}">${escapeHtml(provisioningLabel(status))}</span>`;
  provisioningCopy.textContent = creating && !activeLease
    ? "The prior attempt did not finish. It is safe to retry the same repository setup."
    : run?.client_message || (missing.length
      ? `Before provisioning: ${missing.join(", ")}.`
      : "All safeguards are satisfied. The private GitHub repository is ready to be created manually.");
  provisioningRepository.hidden = !run?.repository_full_name;
  provisioningRepository.textContent = run?.repository_full_name ? `Repository: ${run.repository_full_name}` : "";
  provisioningPreview.hidden = !run?.preview_url;
  provisioningPreview.href = run?.preview_url || "#";
  provisionButton.disabled = missing.length > 0
    || ["github_ready", "vercel_creating", "vercel_ready", "vercel_failed"].includes(status)
    || Boolean(activeLease);
  provisionButton.textContent = retryable
    ? "Retry GitHub provisioning"
    : status === "github_ready"
      ? "Repository ready"
      : status === "github_creating"
        ? "Creating repository…"
        : "Provision private GitHub repository";
  provisionVercelButton.disabled = !run?.repository_full_name
    || !["github_ready", "vercel_creating", "vercel_ready", "vercel_failed"].includes(status)
    || Boolean(activeVercelLease)
    || status === "vercel_ready";
  provisionVercelButton.textContent = vercelRetryable
    ? "Retry Vercel preview"
    : status === "vercel_ready"
      ? "Preview ready"
      : vercelCreating
        ? "Creating preview…"
        : "Create Vercel preview";
}

function renderWorkspace() {
  const hasProject = Boolean(selectedProject);
  emptyState.hidden = hasProject;
  form.hidden = !hasProject;
  if (!hasProject) return;

  const request = relation(selectedProject.website_service_requests);
  nameElement.textContent = selectedProject.name;
  metaElement.textContent = `${request?.business_name || selectedProject.name} · ${formatLabel(selectedProject.current_stage)}`;
  projectState.innerHTML = `<span class="portal-badge portal-project-status-${escapeHtml(selectedProject.status)}">${escapeHtml(formatLabel(selectedProject.status))}</span>`;
  progressValue.textContent = `${selectedProject.progress_percent}%`;
  progressBar.style.width = `${selectedProject.progress_percent}%`;
  document.getElementById("admin-project-status").value = selectedProject.status;
  document.getElementById("admin-project-start").value = selectedProject.target_start_date || "";
  document.getElementById("admin-project-launch").value = selectedProject.target_launch_date || "";
  document.getElementById("admin-project-summary").value = selectedProject.client_summary || "";
  document.getElementById("admin-project-next-step").value = selectedProject.admin_next_step || "";
  renderWebsiteOptions();
  renderMilestones();
  renderProjectControls();
  renderProvisioning();
}

async function invokeProjectAdmin(body) {
  const { data, error } = await supabase.functions.invoke("website-project-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Project action failed.");
  return data;
}

function setActionStatus(message = "", isError = false) {
  actionStatus.textContent = message;
  actionStatus.classList.toggle("is-error", isError);
}

async function completeProject() {
  if (!selectedProject) return;
  if (!await confirmAdminAction(`Mark ${selectedProject.name} complete? All applicable roadmap stages will be completed.`, { title: "Complete project", confirmLabel: "Mark complete" })) return;
  completeButton.disabled = true;
  setActionStatus("Completing project…");
  try {
    await invokeProjectAdmin({ action: "complete-website-project", projectId: selectedProject.id });
    await loadData(selectedProject.id);
    setActionStatus("Project marked complete.");
  } catch (error) {
    setActionStatus(error?.message || "Unable to complete this project.", true);
    completeButton.disabled = false;
  }
}

async function closeProject() {
  if (!selectedProject) return;
  if (!await confirmAdminAction(`Close ${selectedProject.name}? Its history will remain available.`, { title: "Close project", confirmLabel: "Close project" })) return;
  closeButton.disabled = true;
  setActionStatus("Closing project…");
  try {
    await invokeProjectAdmin({ action: "close-website-project", projectId: selectedProject.id });
    await loadData(selectedProject.id);
    setActionStatus("Project closed and archived.");
  } catch (error) {
    setActionStatus(error?.message || "Unable to close this project.", true);
    closeButton.disabled = false;
  }
}

function openDeleteDialog() {
  if (!selectedProject) return;
  deleteProjectName.textContent = selectedProject.name;
  deleteConfirmation.value = "";
  deleteStatus.textContent = "";
  deleteStatus.classList.remove("is-error");
  deleteDialog.showModal();
  deleteConfirmation.focus();
}

async function deleteProject(event) {
  event.preventDefault();
  if (!selectedProject) return;
  if (deleteConfirmation.value.trim() !== selectedProject.name) {
    deleteStatus.textContent = "Enter the project name exactly as shown.";
    deleteStatus.classList.add("is-error");
    return;
  }

  confirmDeleteButton.disabled = true;
  deleteStatus.textContent = "Deleting project…";
  deleteStatus.classList.remove("is-error");
  const deletedName = selectedProject.name;
  try {
    await invokeProjectAdmin({ action: "delete-website-project", projectId: selectedProject.id });
    writeWorkspaceContext("admin", currentUser.id, {
      projectId: null,
      proposalId: null,
      requestId: null,
      onboardingId: null,
    });
    selectedProject = undefined;
    deleteDialog.close();
    await loadData();
    setActionStatus(`${deletedName} was deleted. The managed website was not removed.`);
  } catch (error) {
    deleteStatus.textContent = error?.message || "Unable to delete this project.";
    deleteStatus.classList.add("is-error");
  } finally {
    confirmDeleteButton.disabled = false;
  }
}

async function loadData(preferredId) {
  const [projectResult, milestoneResult, onboardingResult, websiteResult, proposalResult, provisioningResult] = await Promise.all([
    supabase.from("website_projects")
      .select("*,website_service_requests(business_name,project_type),client_websites(id,name,live_url,status,organization_id,repository_full_name)")
      .order("created_at", { ascending: false }),
    supabase.from("website_project_milestones").select("*").order("sequence_number"),
    supabase.from("website_onboardings").select("id,project_id,proposal_id,status").order("created_at", { ascending: false }),
    supabase.from("client_websites").select("id,name,live_url,status").order("name"),
    supabase.from("website_proposals").select("id,project_id,request_id,title,status,created_at").order("created_at", { ascending: false }),
    supabase.from("website_provisioning_runs").select("id,project_id,website_id,stage,status,target_repository_name,repository_full_name,repository_url,attempt_count,lease_expires_at,vercel_project_name,vercel_project_url,preview_url,preview_state,vercel_attempt_count,vercel_lease_expires_at,client_message,updated_at"),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (milestoneResult.error) throw milestoneResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  if (websiteResult.error) throw websiteResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (provisioningResult.error) throw provisioningResult.error;
  const context = readWorkspaceContext("admin", currentUser.id);
  projects = (projectResult.data || []).filter((project) => !context.websiteId || project.managed_website_id === context.websiteId);
  milestones = milestoneResult.data || [];
  onboardings = onboardingResult.data || [];
  websites = websiteResult.data || [];
  proposals = proposalResult.data || [];
  provisioningRuns = provisioningResult.data || [];
  renderOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("project") || context.projectId;
  selectedProject = projects.find((project) => project.id === requested)
    || projects.find((project) => project.managed_website_id === context.websiteId)
    || (!context.websiteId ? projects[0] : undefined);
  if (selectedProject) projectSelect.value = selectedProject.id;
  else projectSelect.selectedIndex = -1;
  rememberProject();
  renderWorkspace();
}

async function provisionGitHubRepository() {
  if (!selectedProject || provisionButton.disabled) return;
  if (!await confirmAdminAction(
    `Create a private GitHub repository for ${selectedProject.name} from the standard N3XRA website template?`,
    { title: "Provision website workspace", confirmLabel: "Create private repository" },
  )) return;
  provisionButton.disabled = true;
  provisioningStatus.classList.remove("is-error");
  provisioningStatus.textContent = "Creating the private GitHub repository…";
  try {
    const result = await invokeProjectAdmin({ action: "provision-website-github", projectId: selectedProject.id });
    await loadData(selectedProject.id);
    provisioningStatus.textContent = result?.message || "Private GitHub repository ready.";
  } catch (error) {
    await loadData(selectedProject.id).catch(() => {});
    provisioningStatus.textContent = error?.message || "GitHub provisioning could not be completed.";
    provisioningStatus.classList.add("is-error");
  }
}

async function provisionVercelPreview() {
  if (!selectedProject || provisionVercelButton.disabled) return;
  if (!await confirmAdminAction(
    `Connect ${selectedProject.name} to Vercel and create a review-only preview deployment? No production domain will be attached.`,
    { title: "Create website preview", confirmLabel: "Create Vercel preview" },
  )) return;
  provisionVercelButton.disabled = true;
  provisioningStatus.classList.remove("is-error");
  provisioningStatus.textContent = "Creating the Vercel preview…";
  try {
    const result = await invokeProjectAdmin({ action: "provision-website-vercel", projectId: selectedProject.id });
    await loadData(selectedProject.id);
    provisioningStatus.textContent = result?.message || "Vercel preview ready.";
  } catch (error) {
    await loadData(selectedProject.id).catch(() => {});
    provisioningStatus.textContent = error?.message || "Vercel preview setup could not be completed.";
    provisioningStatus.classList.add("is-error");
  }
}

function milestoneUpdates() {
  return Array.from(milestoneList.querySelectorAll("[data-milestone-id]")).map((card) => ({
    id: card.dataset.milestoneId,
    status: card.querySelector('[data-milestone-field="status"]').value,
    target_date: card.querySelector('[data-milestone-field="target_date"]').value || null,
    client_note: card.querySelector('[data-milestone-field="client_note"]').value.trim() || null,
  }));
}

async function saveProject(event) {
  event.preventDefault();
  if (!selectedProject) return;
  saveButton.disabled = true;
  saveStatus.classList.remove("is-error");
  saveStatus.textContent = "Saving project workspace…";
  try {
    const projectResult = await supabase.from("website_projects").update({
      status: document.getElementById("admin-project-status").value,
      managed_website_id: document.getElementById("admin-project-website").value || null,
      target_start_date: document.getElementById("admin-project-start").value || null,
      target_launch_date: document.getElementById("admin-project-launch").value || null,
      client_summary: document.getElementById("admin-project-summary").value.trim() || null,
      admin_next_step: document.getElementById("admin-project-next-step").value.trim() || null,
    }).eq("id", selectedProject.id);
    if (projectResult.error) throw projectResult.error;

    for (const milestone of milestoneUpdates()) {
      const milestoneResult = await supabase.from("website_project_milestones").update({
        status: milestone.status,
        target_date: milestone.target_date,
        client_note: milestone.client_note,
      }).eq("id", milestone.id);
      if (milestoneResult.error) throw milestoneResult.error;
    }
    await loadData(selectedProject.id);
    saveStatus.textContent = "Project workspace saved.";
  } catch (error) {
    saveStatus.textContent = error?.message || "Unable to save the project workspace.";
    saveStatus.classList.add("is-error");
  } finally {
    saveButton.disabled = false;
  }
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;
  await loadData();
  projectSelect.addEventListener("change", () => {
    selectedProject = projects.find((project) => project.id === projectSelect.value);
    rememberProject();
    renderWorkspace();
  });
  form.addEventListener("submit", saveProject);
  completeButton.addEventListener("click", () => { void completeProject(); });
  closeButton.addEventListener("click", () => { void closeProject(); });
  provisionButton.addEventListener("click", () => { void provisionGitHubRepository(); });
  provisionVercelButton.addEventListener("click", () => { void provisionVercelPreview(); });
  deleteButton.addEventListener("click", openDeleteDialog);
  deleteForm.addEventListener("submit", deleteProject);
  cancelDeleteButton.addEventListener("click", () => deleteDialog.close());
  refreshButton.addEventListener("click", () => loadData(selectedProject?.id).catch((error) => {
    saveStatus.textContent = error?.message || "Unable to refresh projects.";
    saveStatus.classList.add("is-error");
  }));
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Project administration could not be opened.";
});
