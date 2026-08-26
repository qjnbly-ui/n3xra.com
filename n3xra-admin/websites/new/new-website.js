import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=4";
import { writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { confirmAdminAction } from "/account/admin/admin-dialogs.js";

const form = document.getElementById("new-website-form");
const statusScreen = document.getElementById("portal-status");
const formStatus = document.getElementById("form-status");
const saveButton = document.getElementById("save-website");
const nameInput = document.getElementById("website-name");
const slugInput = document.getElementById("website-slug");
const portalSlugInput = document.getElementById("portal-slug");
const portalPreview = document.getElementById("portal-preview");
const websiteStatus = document.getElementById("website-status");
const organizationInput = document.getElementById("organization-id");
const liveUrlInput = document.getElementById("live-url");
const repositoryInput = document.getElementById("repository");
const githubButton = document.getElementById("provision-github");
const vercelButton = document.getElementById("provision-vercel");
const openProjectLink = document.getElementById("open-project");
const optionalClientWorkLink = document.getElementById("optional-client-work");
const buildStatus = document.getElementById("build-status");
const requestedWebsiteId = new URLSearchParams(window.location.search).get("website") || "";

let supabase;
let currentUser;
let editingWebsite;
let currentProject;
let provisioningRun;

function slugify(value = "") {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function setStatus(message = "", isError = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle("is-error", isError);
}

function updatePortalPreview() {
  const portalSlug = slugify(portalSlugInput.value);
  portalPreview.textContent = portalSlug
    ? `Portal: ${portalSlug}.portal.n3xra.com`
    : "Portal: —.portal.n3xra.com";
}

function normalizeRepository(value = "") {
  const repository = String(value).trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!repository) return null;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error("Enter the GitHub repository as owner/repository, or leave it blank for N3XRA provisioning.");
  }
  return repository;
}

function websiteValues() {
  const name = nameInput.value.trim();
  const slug = slugify(slugInput.value);
  const portalSlug = slugify(portalSlugInput.value);
  if (!name) throw new Error("Enter the website name.");
  if (!slug) throw new Error("Enter a valid website slug.");
  if (!portalSlug) throw new Error("Enter a valid customer portal slug.");
  return {
    name,
    slug,
    portal_slug: portalSlug,
    status: websiteStatus.value,
    organization_id: organizationInput.value || null,
    live_url: liveUrlInput.value.trim() || null,
    repository_full_name: normalizeRepository(repositoryInput.value),
  };
}

function friendlyError(error) {
  const message = String(error?.message || "Unable to save this website.");
  if (error?.code === "23505" && message.includes("portal_slug")) return "That customer portal address is already in use.";
  if (error?.code === "23505" && message.includes("slug")) return "That website slug is already in use.";
  return message;
}

function renderOrganizationOptions(organizations) {
  organizationInput.replaceChildren(new Option("Connect later", ""));
  organizations.forEach((organization) => {
    const suffix = organization.account_status && organization.account_status !== "active" ? ` — ${organization.account_status}` : "";
    organizationInput.add(new Option(`${organization.name}${suffix}`, organization.id));
  });
}

function renderEditingWebsite(website) {
  editingWebsite = website;
  document.title = `N3XRA | Edit ${website.name}`;
  document.getElementById("page-title").textContent = "Edit website";
  document.getElementById("workspace-title").textContent = `Edit ${website.name}`;
  saveButton.textContent = "Save website";
  nameInput.value = website.name || "";
  slugInput.value = website.slug || "";
  portalSlugInput.value = website.portal_slug || website.slug || "";
  websiteStatus.value = website.status || "draft";
  organizationInput.value = website.organization_id || "";
  liveUrlInput.value = website.live_url || "";
  repositoryInput.value = website.repository_full_name || "";
  slugInput.dataset.edited = "true";
  portalSlugInput.dataset.edited = "true";
  updatePortalPreview();
}

async function invokeProjectAdmin(body) {
  const { data, error } = await supabase.functions.invoke("website-project-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Website project setup failed.");
  return data;
}

function provisioningStatus() {
  return String(provisioningRun?.status || "not_started");
}

function setBuildStatus(message, isError = false) {
  buildStatus.textContent = message;
  buildStatus.classList.toggle("is-error", isError);
}

function renderBuildWorkflow() {
  const status = provisioningStatus();
  const githubReady = ["github_ready", "vercel_creating", "vercel_ready", "vercel_failed"].includes(status);
  const vercelReady = status === "vercel_ready";
  const stageState = {
    website: Boolean(editingWebsite),
    project: Boolean(currentProject),
    github: githubReady,
    vercel: vercelReady,
  };
  const firstIncomplete = Object.keys(stageState).find((key) => !stageState[key]);
  document.querySelectorAll("[data-build-stage]").forEach((item) => {
    const key = item.dataset.buildStage;
    item.classList.toggle("is-complete", stageState[key]);
    item.classList.toggle("is-current", key === firstIncomplete);
  });

  const existingRepository = Boolean(editingWebsite?.repository_full_name) && !provisioningRun;
  githubButton.disabled = !currentProject || githubReady || status === "github_creating" || existingRepository;
  githubButton.textContent = status === "github_creating"
    ? "Creating GitHub repository…"
    : status === "failed"
      ? "Retry GitHub provisioning"
      : githubReady
        ? "GitHub repository ready"
        : "Create private GitHub repository";
  vercelButton.disabled = !currentProject || !githubReady || vercelReady || status === "vercel_creating";
  vercelButton.textContent = status === "vercel_creating"
    ? "Creating Vercel preview…"
    : status === "vercel_failed"
      ? "Retry Vercel preview"
      : vercelReady
        ? "Vercel preview ready"
        : "Create Vercel preview";

  openProjectLink.hidden = !currentProject;
  optionalClientWorkLink.hidden = !editingWebsite;
  if (currentProject) openProjectLink.href = `/n3xra-admin/projects/?project=${encodeURIComponent(currentProject.id)}`;
  if (editingWebsite) optionalClientWorkLink.href = `/n3xra-admin/websites/?website=${encodeURIComponent(editingWebsite.id)}`;

  if (!editingWebsite) setBuildStatus("Create the website to begin.");
  else if (!currentProject) setBuildStatus("Save the website to prepare its build workspace.");
  else if (existingRepository) setBuildStatus("An existing repository is recorded. Connect it through Services & Ownership before creating a Vercel preview.");
  else if (vercelReady) setBuildStatus(`Vercel preview ready: ${provisioningRun.preview_url}`);
  else if (githubReady) setBuildStatus("The private repository is ready. Create the Vercel preview when you’re ready.");
  else setBuildStatus("The build workspace is ready. Create the private GitHub repository next.");
}

async function loadBuildState(websiteId) {
  const [projectResult, provisioningResult] = await Promise.all([
    supabase.from("website_projects").select("*").eq("managed_website_id", websiteId).maybeSingle(),
    supabase.from("website_provisioning_runs").select("*").eq("website_id", websiteId).maybeSingle(),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (provisioningResult.error) throw provisioningResult.error;
  currentProject = projectResult.data || null;
  provisioningRun = provisioningResult.data || null;
  renderBuildWorkflow();
}

async function ensureBuildProject(website) {
  const result = await invokeProjectAdmin({
    action: "create-direct-website-project",
    websiteId: website.id,
    name: website.name,
  });
  currentProject = result.project;
  await loadBuildState(website.id);
}

async function loadPageData() {
  const organizationQuery = supabase.from("organizations").select("id,name,account_status").order("name");
  const websiteQuery = requestedWebsiteId
    ? supabase.from("client_websites").select("id,name,slug,portal_slug,status,organization_id,live_url,repository_full_name").eq("id", requestedWebsiteId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [organizationResult, websiteResult] = await Promise.all([organizationQuery, websiteQuery]);
  if (organizationResult.error) throw organizationResult.error;
  if (websiteResult.error) throw websiteResult.error;
  renderOrganizationOptions(organizationResult.data || []);
  if (requestedWebsiteId && !websiteResult.data) throw new Error("The selected website could not be found.");
  if (websiteResult.data) {
    renderEditingWebsite(websiteResult.data);
    await loadBuildState(websiteResult.data.id);
  } else {
    renderBuildWorkflow();
  }
}

async function saveWebsite(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  setStatus(editingWebsite ? "Saving website…" : "Creating draft website…");
  try {
    const values = websiteValues();
    const query = editingWebsite
      ? supabase.from("client_websites").update(values).eq("id", editingWebsite.id).select("*").single()
      : supabase.from("client_websites").insert({ ...values, created_by_user_id: currentUser.id }).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    renderEditingWebsite(data);
    writeWorkspaceContext("admin", currentUser.id, { websiteId: data.id, name: data.name });
    window.history.replaceState({}, document.title, `/n3xra-admin/websites/new/?website=${encodeURIComponent(data.id)}`);
    setStatus("Website saved. Preparing its build workspace…");
    await ensureBuildProject(data);
    setStatus("Website and build workspace ready.");
    saveButton.textContent = "Save website";
    saveButton.disabled = false;
  } catch (error) {
    setStatus(friendlyError(error), true);
    saveButton.disabled = false;
  }
}

async function provisionGitHub() {
  if (!currentProject || githubButton.disabled) return;
  if (!await confirmAdminAction(
    `Create a private GitHub repository for ${editingWebsite.name} from the standard N3XRA website template?`,
    { title: "Create private repository", confirmLabel: "Create repository" },
  )) return;
  githubButton.disabled = true;
  setBuildStatus("Creating the private GitHub repository…");
  try {
    const result = await invokeProjectAdmin({ action: "provision-website-github", projectId: currentProject.id });
    await loadBuildState(editingWebsite.id);
    setBuildStatus(result.message || "Private GitHub repository ready.");
  } catch (error) {
    await loadBuildState(editingWebsite.id).catch(() => {});
    setBuildStatus(error?.message || "GitHub provisioning failed.", true);
  }
}

async function provisionVercel() {
  if (!currentProject || vercelButton.disabled) return;
  if (!await confirmAdminAction(
    `Connect ${editingWebsite.name} to Vercel and create its review-only preview deployment?`,
    { title: "Create Vercel preview", confirmLabel: "Create preview" },
  )) return;
  vercelButton.disabled = true;
  setBuildStatus("Creating the Vercel project and preview…");
  try {
    const result = await invokeProjectAdmin({ action: "provision-website-vercel", projectId: currentProject.id });
    await loadBuildState(editingWebsite.id);
    setBuildStatus(result.message || "Vercel preview ready.");
  } catch (error) {
    await loadBuildState(editingWebsite.id).catch(() => {});
    setBuildStatus(error?.message || "Vercel preview setup failed.", true);
  }
}

function bindEvents() {
  nameInput.addEventListener("input", () => {
    const generated = slugify(nameInput.value);
    if (!slugInput.dataset.edited) slugInput.value = generated;
    if (!portalSlugInput.dataset.edited) portalSlugInput.value = generated;
    updatePortalPreview();
  });
  slugInput.addEventListener("input", () => {
    slugInput.value = slugify(slugInput.value);
    slugInput.dataset.edited = slugInput.value ? "true" : "";
  });
  portalSlugInput.addEventListener("input", () => {
    portalSlugInput.value = slugify(portalSlugInput.value);
    portalSlugInput.dataset.edited = portalSlugInput.value ? "true" : "";
    updatePortalPreview();
  });
  repositoryInput.addEventListener("blur", () => {
    try {
      repositoryInput.value = normalizeRepository(repositoryInput.value) || "";
      repositoryInput.setCustomValidity("");
    } catch (error) {
      repositoryInput.setCustomValidity(error.message);
    }
  });
  githubButton.addEventListener("click", provisionGitHub);
  vercelButton.addEventListener("click", provisionVercel);
  form.addEventListener("submit", saveWebsite);
}

async function init() {
  if (!hasConfig()) throw new Error("Website administration is not connected yet.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;
  bindEvents();
  await loadPageData();
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
  nameInput.focus();
}

init().catch((error) => {
  document.body.classList.add("portal-denied");
  statusScreen.textContent = error?.message || "Website setup could not be opened.";
});
