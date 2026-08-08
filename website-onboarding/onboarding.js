import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const BUCKET = "website-onboarding-private";
const sections = ["business", "brand", "content", "technical", "legal", "files", "review"];
const requiredAnswerPaths = [
  "business.legalName",
  "business.publicName",
  "business.contactName",
  "business.contactEmail",
  "business.description",
  "content.pages",
  "content.offerings",
  "content.primaryCta",
];

const statusScreen = document.getElementById("portal-status");
const onboardingSelect = document.getElementById("onboarding-select");
const emptyState = document.getElementById("onboarding-empty");
const workspace = document.getElementById("onboarding-workspace");
const form = document.getElementById("onboarding-form");
const title = document.getElementById("onboarding-title");
const projectName = document.getElementById("onboarding-project-name");
const statusBadge = document.getElementById("onboarding-status-badge");
const reviewNote = document.getElementById("onboarding-review-note");
const progressLabel = document.getElementById("onboarding-progress-label");
const progressBar = document.getElementById("onboarding-progress-bar");
const saveState = document.getElementById("onboarding-save-state");
const previousButton = document.getElementById("onboarding-previous");
const nextButton = document.getElementById("onboarding-next");
const saveButton = document.getElementById("onboarding-save");
const uploadButton = document.getElementById("onboarding-upload-button");
const uploadStatus = document.getElementById("onboarding-upload-status");
const fileList = document.getElementById("onboarding-file-list");
const submitButton = document.getElementById("onboarding-submit-button");
const submitStatus = document.getElementById("onboarding-submit-status");
const reviewChecklist = document.getElementById("onboarding-review-checklist");

let supabase;
let session;
let onboardings = [];
let responses = [];
let files = [];
let projects = [];
let websites = [];
let selectedOnboarding;
let selectedWebsite;
let selectedResponse;
let activeSection = "business";
let dirty = false;

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

function safeFilename(value = "file") {
  const parts = String(value).split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = parts.join(".").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file";
  return `${stem}${extension}`;
}

function getNested(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function setNested(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((object, key) => {
    object[key] ||= {};
    return object[key];
  }, target);
  parent[last] = value;
}

function collectAnswers() {
  const answers = structuredClone(selectedResponse?.answers || {});
  form.querySelectorAll("[data-answer]").forEach((input) => {
    setNested(answers, input.dataset.answer, input.value.trim());
  });
  return answers;
}

function completionFor(answers) {
  const complete = requiredAnswerPaths.filter((path) => String(getNested(answers, path) || "").trim()).length;
  return Math.round((complete / requiredAnswerPaths.length) * 100);
}

function isEditable() {
  return Boolean(selectedOnboarding && ["not_started", "in_progress", "needs_changes"].includes(selectedOnboarding.status) && selectedResponse?.status === "draft");
}

function renderOptions() {
  onboardingSelect.innerHTML = websites.length
    ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("")
    : '<option value="">No websites</option>';
  onboardingSelect.hidden = !websites.length;
}

function fillAnswers() {
  const answers = selectedResponse?.answers || {};
  form.querySelectorAll("[data-answer]").forEach((input) => {
    input.value = getNested(answers, input.dataset.answer) || "";
  });
  if (!getNested(answers, "business.contactEmail")) {
    document.getElementById("onboarding-contact-email").value = session.user.email || "";
  }
}

function renderProgress(answers = collectAnswers()) {
  const completion = completionFor(answers);
  progressLabel.textContent = `${completion}% complete`;
  progressBar.style.width = `${completion}%`;
  progressBar.parentElement.setAttribute("aria-label", `${completion}% complete`);
  sections.forEach((section) => {
    const button = document.querySelector(`[data-section="${section}"]`);
    if (!button) return;
    let sectionCompletion = 0;
    if (["business", "brand", "content", "technical", "legal"].includes(section)) {
      const controls = Array.from(form.querySelectorAll(`[data-answer^="${section}."]`));
      const filled = controls.filter((control) => control.value.trim()).length;
      sectionCompletion = controls.length ? Math.round((filled / controls.length) * 100) : 0;
    } else if (section === "files") {
      sectionCompletion = files.some((file) => file.onboarding_id === selectedOnboarding?.id) ? 100 : 0;
    } else if (section === "review") {
      sectionCompletion = completion === 100 ? 100 : completion;
    }
    button.classList.toggle("is-complete", sectionCompletion === 100);
    button.title = `${formatLabel(section)}: ${sectionCompletion}% complete`;
  });
  return completion;
}

function renderReview() {
  const answers = collectAnswers();
  reviewChecklist.innerHTML = sections.slice(0, 5).map((section) => {
    const sectionInputs = Array.from(form.querySelectorAll(`[data-answer^="${section}."]`));
    const filled = sectionInputs.filter((input) => input.value.trim()).length;
    const complete = sectionInputs.length ? Math.round((filled / sectionInputs.length) * 100) : 0;
    const stateClass = complete === 100 ? "is-complete" : "is-incomplete";
    return `<div class="portal-review-item"><span>${escapeHtml(formatLabel(section))}</span><strong class="${stateClass}">${complete}%</strong></div>`;
  }).join("") + `<div class="portal-review-item"><span>Project files</span><strong>${files.filter((file) => file.onboarding_id === selectedOnboarding?.id).length}</strong></div>`;
}

function showSection(section) {
  activeSection = sections.includes(section) ? section : "business";
  document.querySelectorAll("[data-onboarding-section]").forEach((panel) => {
    const active = panel.dataset.onboardingSection === activeSection;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === activeSection);
  });
  const index = sections.indexOf(activeSection);
  previousButton.hidden = index === 0;
  nextButton.hidden = index === sections.length - 1;
  if (activeSection === "review") renderReview();
  const activePanel = form.querySelector(`[data-onboarding-section="${activeSection}"]`);
  if (window.matchMedia("(max-width: 800px)").matches) {
    window.scrollTo({ top: Math.max(0, form.getBoundingClientRect().top + window.scrollY - 120), behavior: "smooth" });
  } else if (activePanel) {
    activePanel.scrollTop = 0;
  }
}

function setFormEditable(editable) {
  form.querySelectorAll("input, textarea, select, button").forEach((control) => {
    if (control.closest(".portal-step-nav")) return;
    control.disabled = !editable;
  });
  document.querySelectorAll("[data-section]").forEach((button) => { button.disabled = false; });
  previousButton.disabled = false;
  nextButton.disabled = !editable;
  form.querySelectorAll("[data-file-download]").forEach((button) => { button.disabled = false; });
}

function renderWorkspace() {
  const hasOnboarding = Boolean(selectedOnboarding && selectedResponse);
  emptyState.hidden = hasOnboarding;
  workspace.hidden = !hasOnboarding;
  if (!hasOnboarding) return;

  title.textContent = selectedOnboarding.website_service_requests?.business_name || selectedWebsite?.name || "Project onboarding";
  projectName.textContent = selectedOnboarding.website_service_requests?.business_name || selectedWebsite?.name || "Website project";
  statusBadge.textContent = formatLabel(selectedOnboarding.status);
  statusBadge.className = `portal-badge portal-status-${selectedOnboarding.status}`;
  reviewNote.textContent = selectedOnboarding.status === "needs_changes"
    ? selectedOnboarding.admin_notes || "N3XRA requested updates before onboarding can be approved."
    : selectedOnboarding.admin_notes || "";
  reviewNote.hidden = !reviewNote.textContent;
  fillAnswers();
  renderProgress();
  renderFiles();
  setFormEditable(isEditable());
  saveState.textContent = selectedResponse.updated_at ? `Saved ${new Date(selectedResponse.updated_at).toLocaleString()}` : "Not saved";
  showSection(selectedResponse.last_section || "business");
}

async function loadData(preferredId) {
  const [onboardingResult, responseResult, fileResult, projectResult, websiteResult] = await Promise.all([
    supabase.from("website_onboardings").select("*,website_service_requests(business_name,project_type),website_proposals(title,status)").order("created_at", { ascending: false }),
    supabase.from("website_onboarding_responses").select("*"),
    supabase.from("website_onboarding_files").select("*").order("created_at", { ascending: false }),
    supabase.from("website_projects").select("id,proposal_id,request_id,managed_website_id").order("created_at", { ascending: false }),
    supabase.from("client_websites").select("id,name,status").order("name"),
  ]);
  if (onboardingResult.error) throw onboardingResult.error;
  if (responseResult.error) throw responseResult.error;
  if (fileResult.error) throw fileResult.error;
  if (projectResult.error) throw projectResult.error;
  if (websiteResult.error) throw websiteResult.error;
  onboardings = onboardingResult.data || [];
  responses = responseResult.data || [];
  files = fileResult.data || [];
  projects = projectResult.data || [];
  websites = websiteResult.data || [];
  renderOptions();
  const context = readWorkspaceContext("client", session.user.id);
  const explicitOnboarding = preferredId || new URLSearchParams(window.location.search).get("onboarding");
  selectedOnboarding = onboardings.find((onboarding) => onboarding.id === (explicitOnboarding || context.onboardingId));
  const onboardingProject = projects.find((project) => project.id === selectedOnboarding?.project_id)
    || projects.find((project) => project.proposal_id === selectedOnboarding?.proposal_id);
  selectedWebsite = websites.find((website) => website.id === (onboardingProject?.managed_website_id || context.websiteId))
    || (!context.websiteId && !explicitOnboarding ? websites[0] : undefined);
  const relatedProject = projects.find((project) => project.managed_website_id === selectedWebsite?.id);
  selectedOnboarding = selectedOnboarding
    || onboardings.find((onboarding) =>
      onboarding.project_id === relatedProject?.id
      || onboarding.proposal_id === relatedProject?.proposal_id
      || onboarding.request_id === relatedProject?.request_id
    );
  selectedResponse = responses.find((response) => response.onboarding_id === selectedOnboarding?.id);
  if (selectedWebsite) onboardingSelect.value = selectedWebsite.id;
  else onboardingSelect.selectedIndex = -1;
  if (selectedWebsite) writeWorkspaceContext("client", session.user.id, selectedOnboarding ? {
    websiteId: selectedWebsite.id,
    name: selectedWebsite.name,
    projectId: relatedProject?.id || onboardingProject?.id,
    onboardingId: selectedOnboarding.id,
    proposalId: selectedOnboarding.proposal_id,
    requestId: selectedOnboarding.request_id,
  } : {
    websiteId: selectedWebsite.id,
    name: selectedWebsite.name,
    projectId: null,
    onboardingId: null,
    proposalId: null,
    requestId: null,
  });
  dirty = false;
  renderWorkspace();
}

async function saveProgress({ quiet = false } = {}) {
  if (!isEditable()) return false;
  const answers = collectAnswers();
  const completion = completionFor(answers);
  saveButton.disabled = true;
  nextButton.disabled = true;
  if (!quiet) saveState.textContent = "Saving…";
  try {
    const { data, error } = await supabase.from("website_onboarding_responses").update({
      answers,
      completion_percent: completion,
      last_section: activeSection,
    }).eq("onboarding_id", selectedOnboarding.id).select().single();
    if (error) throw error;
    selectedResponse = data;
    responses = responses.map((response) => response.onboarding_id === data.onboarding_id ? data : response);
    selectedOnboarding.status = selectedOnboarding.status === "not_started" || selectedOnboarding.status === "needs_changes" ? "in_progress" : selectedOnboarding.status;
    statusBadge.textContent = formatLabel(selectedOnboarding.status);
    statusBadge.className = `portal-badge portal-status-${selectedOnboarding.status}`;
    dirty = false;
    renderProgress(answers);
    saveState.textContent = `Saved ${new Date(data.updated_at).toLocaleTimeString()}`;
    return true;
  } catch (error) {
    saveState.textContent = error?.message || "Unable to save.";
    return false;
  } finally {
    saveButton.disabled = false;
    nextButton.disabled = false;
  }
}

async function uploadFiles() {
  if (!isEditable()) return;
  const input = document.getElementById("onboarding-file-input");
  const selectedFiles = Array.from(input.files || []);
  if (!selectedFiles.length) {
    uploadStatus.textContent = "Choose at least one file.";
    uploadStatus.classList.add("is-error");
    return;
  }
  uploadButton.disabled = true;
  uploadStatus.classList.remove("is-error");
  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      uploadStatus.textContent = `Uploading ${index + 1} of ${selectedFiles.length}…`;
      const storagePath = `${selectedOnboarding.id}/${session.user.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: recordError } = await supabase.from("website_onboarding_files").insert({
        onboarding_id: selectedOnboarding.id,
        uploaded_by_user_id: session.user.id,
        category: document.getElementById("onboarding-file-category").value,
        storage_bucket: BUCKET,
        storage_path: storagePath,
        original_filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        note: document.getElementById("onboarding-file-note").value.trim() || null,
      });
      if (recordError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw recordError;
      }
    }
    input.value = "";
    document.getElementById("onboarding-file-note").value = "";
    uploadStatus.textContent = "Files uploaded.";
    await loadData(selectedOnboarding.id);
    showSection("files");
  } catch (error) {
    uploadStatus.textContent = error?.message || "Unable to upload these files.";
    uploadStatus.classList.add("is-error");
  } finally {
    uploadButton.disabled = false;
  }
}

function renderFiles() {
  const onboardingFiles = files.filter((file) => file.onboarding_id === selectedOnboarding?.id);
  fileList.innerHTML = onboardingFiles.length ? onboardingFiles.map((file) => `
    <article class="portal-file-row">
      <div><span class="portal-pill">${escapeHtml(file.category)}</span><strong>${escapeHtml(file.original_filename)}</strong><p>${file.note ? escapeHtml(file.note) : "No note"} · ${new Date(file.created_at).toLocaleDateString()}</p></div>
      <div class="portal-card-actions">
        <button class="portal-link-button" type="button" data-file-download="${file.id}">Download</button>
        ${isEditable() && file.uploaded_by_user_id === session.user.id ? `<button class="portal-link-button is-danger" type="button" data-file-delete="${file.id}">Remove</button>` : ""}
      </div>
    </article>
  `).join("") : '<div class="portal-empty portal-empty-compact"><p>No project files uploaded yet.</p></div>';
}

async function handleFileAction(event) {
  const downloadButton = event.target.closest("[data-file-download]");
  const deleteButton = event.target.closest("[data-file-delete]");
  const fileId = downloadButton?.dataset.fileDownload || deleteButton?.dataset.fileDelete;
  if (!fileId) return;
  const file = files.find((item) => item.id === fileId);
  if (!file) return;

  if (downloadButton) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, 600, { download: file.original_filename });
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener");
  }
  if (deleteButton) {
    deleteButton.disabled = true;
    const storageResult = await supabase.storage.from(BUCKET).remove([file.storage_path]);
    if (storageResult.error) throw storageResult.error;
    const { error } = await supabase.from("website_onboarding_files").delete().eq("id", file.id);
    if (error) throw error;
    await loadData(selectedOnboarding.id);
    showSection("files");
  }
}

async function submitOnboarding() {
  if (!isEditable()) return;
  const answers = collectAnswers();
  const missing = requiredAnswerPaths.filter((path) => !String(getNested(answers, path) || "").trim());
  if (missing.length) {
    submitStatus.textContent = `Complete the required business and content fields first (${missing.length} remaining).`;
    submitStatus.classList.add("is-error");
    return;
  }
  if (!document.getElementById("onboarding-submit-confirm").checked) {
    submitStatus.textContent = "Confirm that the onboarding information is ready.";
    submitStatus.classList.add("is-error");
    return;
  }
  submitButton.disabled = true;
  submitStatus.classList.remove("is-error");
  submitStatus.textContent = "Submitting onboarding…";
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from("website_onboarding_responses").update({
      answers,
      completion_percent: 100,
      last_section: "review",
      status: "submitted",
      submitted_at: now,
    }).eq("onboarding_id", selectedOnboarding.id);
    if (error) throw error;
    submitStatus.textContent = "Onboarding submitted for review.";
    await loadData(selectedOnboarding.id);
  } catch (error) {
    submitStatus.textContent = error?.message || "Unable to submit onboarding.";
    submitStatus.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
  }
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/account/?next=%2Fwebsite-onboarding%2F");
    return;
  }
  await loadData();
  document.getElementById("onboarding-step-nav").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-section]");
    if (!button) return;
    if (dirty) await saveProgress({ quiet: true });
    showSection(button.dataset.section);
  });
  form.addEventListener("input", () => {
    dirty = true;
    saveState.textContent = "Unsaved changes";
    renderProgress();
  });
  previousButton.addEventListener("click", async () => {
    if (dirty) await saveProgress({ quiet: true });
    showSection(sections[Math.max(0, sections.indexOf(activeSection) - 1)]);
  });
  nextButton.addEventListener("click", async () => {
    const saved = await saveProgress();
    if (saved) showSection(sections[Math.min(sections.length - 1, sections.indexOf(activeSection) + 1)]);
  });
  saveButton.addEventListener("click", () => saveProgress());
  uploadButton.addEventListener("click", uploadFiles);
  fileList.addEventListener("click", (event) => handleFileAction(event).catch((error) => {
    uploadStatus.textContent = error?.message || "Unable to complete that file action.";
    uploadStatus.classList.add("is-error");
  }));
  submitButton.addEventListener("click", submitOnboarding);
  onboardingSelect.addEventListener("change", async () => {
    if (dirty) await saveProgress({ quiet: true });
    selectedWebsite = websites.find((website) => website.id === onboardingSelect.value);
    const project = projects.find((item) => item.managed_website_id === selectedWebsite?.id);
    selectedOnboarding = onboardings.find((onboarding) =>
      onboarding.project_id === project?.id
      || onboarding.proposal_id === project?.proposal_id
      || onboarding.request_id === project?.request_id
    );
    writeWorkspaceContext("client", session.user.id, selectedOnboarding ? {
      websiteId: selectedWebsite.id,
      name: selectedWebsite.name,
      projectId: project?.id,
      onboardingId: selectedOnboarding.id,
      proposalId: selectedOnboarding.proposal_id,
      requestId: selectedOnboarding.request_id,
    } : {
      websiteId: selectedWebsite.id,
      name: selectedWebsite.name,
      projectId: null,
      onboardingId: null,
      proposalId: null,
      requestId: null,
    });
    selectedResponse = responses.find((response) => response.onboarding_id === selectedOnboarding?.id);
    dirty = false;
    renderWorkspace();
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Website onboarding could not be opened.";
});
