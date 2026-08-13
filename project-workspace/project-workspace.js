import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { projectContext, readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import {
  resolvePortalTenant,
  scopeRowsToPortalTenant,
  scopeWebsitesToPortalTenant,
} from "/client-portal/tenant-context.js";

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
const roadmap = document.getElementById("project-roadmap");
const nextStepTitle = document.getElementById("project-next-step-title");
const nextStep = document.getElementById("project-next-step");
const reference = document.getElementById("project-reference");
const emptyTitle = document.getElementById("project-workspace-empty-title");
const emptyCopy = document.getElementById("project-workspace-empty-copy");
const websiteLink = document.getElementById("project-workspace-website-link");

let supabase;
let projects = [];
let websites = [];
let milestones = [];
let onboardings = [];
let proposals = [];
let selectedProject;
let selectedWebsite;
let userId;

function rememberProject() {
  if (selectedProject) writeWorkspaceContext("client", userId, projectContext(selectedProject));
  else if (selectedWebsite) writeWorkspaceContext("client", userId, {
    websiteId: selectedWebsite.id,
    name: selectedWebsite.name,
    projectId: null,
    requestId: null,
    proposalId: null,
    onboardingId: null,
  });
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

function projectWebsiteId(project) {
  return project?.managed_website_id || relation(project?.client_websites)?.id;
}

function currentProjectMilestones() {
  return milestones
    .filter((milestone) => milestone.project_id === selectedProject?.id)
    .sort((a, b) => a.sequence_number - b.sequence_number);
}

function currentOnboarding() {
  return onboardings.find((onboarding) =>
    onboarding.project_id === selectedProject?.id
    || onboarding.proposal_id === selectedProject?.proposal_id
  );
}

function currentProposal() {
  return proposals.find((proposal) => proposal.project_id === selectedProject?.id)
    || proposals.find((proposal) => proposal.id === selectedProject?.proposal_id);
}

function currentMilestone() {
  return currentProjectMilestones().find((milestone) => milestone.stage === selectedProject?.current_stage)
    || currentProjectMilestones()[0];
}

function renderOptions() {
  projectSelect.innerHTML = websites.length
    ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("")
    : '<option value="">No websites</option>';
  projectSelect.hidden = !websites.length;
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
  const proposal = currentProposal();
  const website = relation(selectedProject.client_websites);
  reference.innerHTML = `
    <div><dt>Project type</dt><dd>${escapeHtml(formatLabel(request?.project_type || "website"))}</dd></div>
    <div><dt>Proposal</dt><dd>${escapeHtml(proposal?.title || "No proposal attached")}</dd></div>
    <div><dt>Website</dt><dd>${escapeHtml(website?.name || "Created at launch")}</dd></div>
  `;
}

function renderWorkspace() {
  const hasProject = Boolean(selectedProject);
  emptyState.hidden = hasProject;
  workspace.hidden = !hasProject;
  if (!hasProject) {
    title.textContent = "Progress";
    emptyTitle.textContent = selectedWebsite ? "No project timeline for this website" : "No website selected";
    emptyCopy.textContent = selectedWebsite
      ? "N3XRA has not opened a project workspace for this website yet."
      : "Choose a website from the portal overview first.";
    websiteLink.href = selectedWebsite ? `/client-portal/?website=${encodeURIComponent(selectedWebsite.id)}` : "/client-portal/";
    return;
  }

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
  renderRoadmap();
  renderReference();
}

async function loadData(preferredId) {
  const tenantResolution = await resolvePortalTenant(supabase);
  const [projectResult, websiteResult, milestoneResult, onboardingResult, proposalResult] = await Promise.all([
    supabase.from("website_projects")
      .select("*,website_service_requests(business_name,project_type,primary_goal),client_websites(id,name,live_url,status)")
      .order("created_at", { ascending: false }),
    supabase.from("client_websites").select("id,name,live_url,status").order("name"),
    supabase.from("website_project_milestones").select("*").order("sequence_number"),
    supabase.from("website_onboardings").select("id,project_id,proposal_id,status").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("id,project_id,request_id,title,status,created_at").order("created_at", { ascending: false }),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (websiteResult.error) throw websiteResult.error;
  if (milestoneResult.error) throw milestoneResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  if (proposalResult.error) throw proposalResult.error;
  projects = scopeRowsToPortalTenant(
    (projectResult.data || []).filter((project) => !["archived", "cancelled"].includes(project.status)),
    tenantResolution,
    projectWebsiteId,
  );
  websites = scopeWebsitesToPortalTenant(websiteResult.data || [], tenantResolution);
  const projectIds = new Set(projects.map((project) => project.id));
  milestones = (milestoneResult.data || []).filter((milestone) => tenantResolution.mode === "unbound" || projectIds.has(milestone.project_id));
  onboardings = (onboardingResult.data || []).filter((onboarding) => tenantResolution.mode === "unbound" || projectIds.has(onboarding.project_id));
  proposals = (proposalResult.data || []).filter((proposal) => tenantResolution.mode === "unbound" || projectIds.has(proposal.project_id));
  projectSelect.disabled = tenantResolution.mode !== "unbound" || !websites.length;
  renderOptions();
  const context = readWorkspaceContext("client", userId);
  const params = new URLSearchParams(window.location.search);
  const explicitWebsite = params.get("website");
  const requestedProject = preferredId || params.get("project") || context.projectId;
  const requestedWebsite = explicitWebsite || context.websiteId;
  selectedProject = explicitWebsite ? undefined : projects.find((project) => project.id === requestedProject);
  const projectWebsite = relation(selectedProject?.client_websites);
  selectedWebsite = websites.find((website) => website.id === (projectWebsite?.id || selectedProject?.managed_website_id || requestedWebsite))
    || (!requestedWebsite ? websites[0] : undefined);
  selectedProject = selectedProject
    || projects.find((project) => projectWebsiteId(project) === selectedWebsite?.id);
  if (selectedWebsite) projectSelect.value = selectedWebsite.id;
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
    selectedWebsite = websites.find((website) => website.id === projectSelect.value);
    selectedProject = projects.find((project) => projectWebsiteId(project) === selectedWebsite?.id);
    rememberProject();
    renderWorkspace();
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Your project workspace could not be opened.";
});
