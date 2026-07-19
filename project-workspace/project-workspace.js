import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { projectContext, readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const statusScreen = document.getElementById("portal-status");
const projectSelect = document.getElementById("project-workspace-select");
const emptyState = document.getElementById("project-workspace-empty");
const workspace = document.getElementById("project-workspace-content");
const title = document.getElementById("project-workspace-title");
const projectName = document.getElementById("project-name");
const summary = document.getElementById("project-summary");
const statusBadge = document.getElementById("project-status-badge");
const stageBadge = document.getElementById("project-stage-badge");
const progressValue = document.getElementById("project-progress-value");
const progressBar = document.getElementById("project-progress-bar");
const currentStage = document.getElementById("project-current-stage");
const startDate = document.getElementById("project-start-date");
const launchDate = document.getElementById("project-launch-date");
const actions = document.getElementById("project-actions");
const roadmap = document.getElementById("project-roadmap");
const nextStepTitle = document.getElementById("project-next-step-title");
const nextStep = document.getElementById("project-next-step");
const reference = document.getElementById("project-reference");

let supabase;
let projects = [];
let milestones = [];
let onboardings = [];
let selectedProject;
let userId;

function rememberProject() {
  if (selectedProject) writeWorkspaceContext("client", userId, projectContext(selectedProject));
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

function formatDate(value) {
  if (!value) return "To be scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function currentProjectMilestones() {
  return milestones
    .filter((milestone) => milestone.project_id === selectedProject?.id)
    .sort((a, b) => a.sequence_number - b.sequence_number);
}

function currentOnboarding() {
  return onboardings.find((onboarding) => onboarding.proposal_id === selectedProject?.proposal_id);
}

function currentMilestone() {
  return currentProjectMilestones().find((milestone) => milestone.stage === selectedProject?.current_stage)
    || currentProjectMilestones()[0];
}

function renderOptions() {
  projectSelect.innerHTML = projects.length
    ? projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)} · ${escapeHtml(formatLabel(project.status))}</option>`).join("")
    : '<option value="">No projects</option>';
  projectSelect.hidden = !projects.length;
}

function renderActions() {
  const proposal = relation(selectedProject.website_proposals);
  const onboarding = currentOnboarding();
  const website = relation(selectedProject.client_websites);
  actions.innerHTML = [
    proposal ? `<a class="portal-button portal-button-secondary" href="/proposals/?proposal=${encodeURIComponent(proposal.id)}">View proposal</a>` : "",
    onboarding ? `<a class="portal-button portal-button-secondary" href="/website-onboarding/?onboarding=${encodeURIComponent(onboarding.id)}">Open onboarding</a>` : "",
    website ? `<a class="portal-button" href="/client-portal/?website=${encodeURIComponent(website.id)}">Manage website</a>` : "",
  ].filter(Boolean).join("");
}

function renderRoadmap() {
  const onboarding = currentOnboarding();
  roadmap.innerHTML = currentProjectMilestones().map((milestone) => {
    const isCurrent = milestone.stage === selectedProject.current_stage;
    const onboardingAction = milestone.stage === "onboarding"
      ? onboarding
        ? `<a class="portal-link-button" href="/website-onboarding/?onboarding=${encodeURIComponent(onboarding.id)}">Open onboarding</a>`
        : '<span class="portal-stage-muted">N3XRA will open this step when it is ready.</span>'
      : "";
    return `
      <article class="portal-project-stage ${isCurrent ? "is-current" : ""}">
        <div class="portal-project-stage-number">${milestone.sequence_number}</div>
        <div class="portal-project-stage-body">
          <div class="portal-project-stage-head">
            <div><h4>${escapeHtml(milestone.label)}</h4><p>${escapeHtml(milestone.client_description)}</p></div>
            <span class="portal-badge portal-milestone-${escapeHtml(milestone.status)}">${escapeHtml(formatLabel(milestone.status))}</span>
          </div>
          ${milestone.client_note ? `<p class="portal-project-stage-note">${escapeHtml(milestone.client_note)}</p>` : ""}
          <div class="portal-project-stage-meta">
            ${milestone.target_date ? `<span>Target ${escapeHtml(formatDate(milestone.target_date))}</span>` : ""}
            ${milestone.completed_at ? `<span>Completed ${escapeHtml(new Date(milestone.completed_at).toLocaleDateString())}</span>` : ""}
            ${onboardingAction}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderReference() {
  const request = relation(selectedProject.website_service_requests);
  const proposal = relation(selectedProject.website_proposals);
  const website = relation(selectedProject.client_websites);
  reference.innerHTML = `
    <div><dt>Project type</dt><dd>${escapeHtml(formatLabel(request?.project_type || "website"))}</dd></div>
    <div><dt>Proposal</dt><dd>${escapeHtml(proposal?.title || "Approved proposal")}</dd></div>
    <div><dt>Website</dt><dd>${escapeHtml(website?.name || "Created at launch")}</dd></div>
  `;
}

function renderWorkspace() {
  const hasProject = Boolean(selectedProject);
  emptyState.hidden = hasProject;
  workspace.hidden = !hasProject;
  if (!hasProject) return;

  const milestone = currentMilestone();
  title.textContent = selectedProject.name;
  projectName.textContent = selectedProject.name;
  summary.textContent = selectedProject.client_summary || "Your approved website project is being prepared.";
  statusBadge.textContent = formatLabel(selectedProject.status);
  statusBadge.className = `portal-badge portal-project-status-${selectedProject.status}`;
  stageBadge.textContent = formatLabel(selectedProject.current_stage);
  progressValue.textContent = `${selectedProject.progress_percent}%`;
  progressBar.style.width = `${selectedProject.progress_percent}%`;
  currentStage.textContent = milestone?.label || formatLabel(selectedProject.current_stage);
  startDate.textContent = formatDate(selectedProject.target_start_date);
  launchDate.textContent = formatDate(selectedProject.target_launch_date);
  nextStepTitle.textContent = milestone?.label || "Project setup";
  nextStep.textContent = selectedProject.admin_next_step
    || milestone?.client_note
    || milestone?.client_description
    || "N3XRA will update this workspace as your project moves forward.";
  renderActions();
  renderRoadmap();
  renderReference();
}

async function loadData(preferredId) {
  const [projectResult, milestoneResult, onboardingResult] = await Promise.all([
    supabase.from("website_projects")
      .select("*,website_service_requests(business_name,project_type,primary_goal),website_proposals(id,title,status),client_websites(id,name,live_url,status)")
      .order("created_at", { ascending: false }),
    supabase.from("website_project_milestones").select("*").order("sequence_number"),
    supabase.from("website_onboardings").select("id,proposal_id,status").order("created_at", { ascending: false }),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (milestoneResult.error) throw milestoneResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  projects = projectResult.data || [];
  milestones = milestoneResult.data || [];
  onboardings = onboardingResult.data || [];
  renderOptions();
  const context = readWorkspaceContext("client", userId);
  const requested = preferredId || new URLSearchParams(window.location.search).get("project") || context.projectId;
  selectedProject = projects.find((project) => project.id === requested)
    || projects.find((project) => project.managed_website_id === context.websiteId)
    || (!context.websiteId ? projects[0] : undefined);
  if (selectedProject) projectSelect.value = selectedProject.id;
  else projectSelect.selectedIndex = -1;
  rememberProject();
  renderWorkspace();
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/account/?next=%2Fproject-workspace%2F");
    return;
  }
  userId = session.user.id;
  await loadData();
  projectSelect.addEventListener("change", () => {
    selectedProject = projects.find((project) => project.id === projectSelect.value);
    rememberProject();
    renderWorkspace();
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Your project workspace could not be opened.";
});
