import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

const statusScreen = document.getElementById("portal-status");
const projectSelect = document.getElementById("admin-project-select");
const projectState = document.getElementById("admin-project-state");
const emptyState = document.getElementById("admin-project-empty");
const form = document.getElementById("project-admin-form");
const nameElement = document.getElementById("admin-project-name");
const metaElement = document.getElementById("admin-project-meta");
const linksElement = document.getElementById("admin-project-links");
const progressValue = document.getElementById("admin-project-progress-value");
const progressBar = document.getElementById("admin-project-progress-bar");
const milestoneList = document.getElementById("admin-project-milestones");
const saveStatus = document.getElementById("admin-project-save-status");
const saveButton = document.getElementById("save-project-admin");
const refreshButton = document.getElementById("refresh-project-admin");

let supabase;
let projects = [];
let milestones = [];
let onboardings = [];
let websites = [];
let selectedProject;

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

function selectedOnboarding() {
  return onboardings.find((onboarding) => onboarding.proposal_id === selectedProject?.proposal_id);
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

function renderLinks() {
  const proposal = relation(selectedProject.website_proposals);
  const onboarding = selectedOnboarding();
  const website = relation(selectedProject.client_websites);
  linksElement.innerHTML = [
    `<a class="portal-button portal-button-secondary" href="/project-workspace/?project=${encodeURIComponent(selectedProject.id)}">Client view</a>`,
    proposal ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/proposals/?request=${encodeURIComponent(selectedProject.request_id)}">Proposal</a>` : "",
    onboarding ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/onboarding/?onboarding=${encodeURIComponent(onboarding.id)}">Onboarding</a>` : "",
    website ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/websites/?website=${encodeURIComponent(website.id)}">Website</a>` : "",
  ].filter(Boolean).join("");
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
  renderLinks();
}

async function loadData(preferredId) {
  const [projectResult, milestoneResult, onboardingResult, websiteResult] = await Promise.all([
    supabase.from("website_projects")
      .select("*,website_service_requests(business_name,project_type),website_proposals(id,title,status),client_websites(id,name,live_url,status)")
      .order("created_at", { ascending: false }),
    supabase.from("website_project_milestones").select("*").order("sequence_number"),
    supabase.from("website_onboardings").select("id,proposal_id,status").order("created_at", { ascending: false }),
    supabase.from("client_websites").select("id,name,live_url,status").order("name"),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (milestoneResult.error) throw milestoneResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  if (websiteResult.error) throw websiteResult.error;
  projects = projectResult.data || [];
  milestones = milestoneResult.data || [];
  onboardings = onboardingResult.data || [];
  websites = websiteResult.data || [];
  renderOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("project");
  selectedProject = projects.find((project) => project.id === requested) || projects[0];
  if (selectedProject) projectSelect.value = selectedProject.id;
  renderWorkspace();
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
  supabase = createBrowserSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Fprojects%2F");
    return;
  }
  const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action: "get-platform-admin-access" } });
  if (error || data?.error || !data?.admin) throw new Error("You do not have project administration access.");
  await loadData();
  projectSelect.addEventListener("change", () => {
    selectedProject = projects.find((project) => project.id === projectSelect.value);
    renderWorkspace();
  });
  form.addEventListener("submit", saveProject);
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
