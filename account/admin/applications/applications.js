import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";
import { renderAdminNavigation } from "/account/admin/admin-navigation.js?v=24";
import { confirmAdminAction } from "/account/admin/admin-dialogs.js";

let supabase;
let applications = [];
let notes = [];
let selectedId = "";
let activeFilter = "active";
let applicantProducts = [];

const activeStatuses = new Set(["new", "reviewing", "contacted", "interviewing"]);
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const statusLabel = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

const roleLabels = {
  open_to_best_fit: "Open to the best fit",
  software_product: "Software and product development",
  websites_portals: "Website development and portals",
  design_brand: "Product design and brand",
  ai_automation: "AI and automation",
  business_development: "Business development",
  sales: "Sales",
  marketing_communications: "Marketing and communications",
  content_social: "Content and social media",
  partnerships: "Partnerships and referrals",
  client_success: "Client success",
  operations: "Operations and administration",
  project_delivery: "Project and delivery management",
  support: "Customer and technical support",
  finance: "Finance and bookkeeping",
  leadership_strategy: "Leadership and strategy",
  research: "Research and analysis",
  internship_learning: "Internship or apprenticeship",
  advisor: "External advisor",
  investor: "Investor",
  frontend_developer: "Frontend developer",
  software_developer: "Software developer",
  design: "Design",
  internship: "Internship",
  other: "A role not listed",
};
const participationLabels = {
  employment: "Hourly or salaried employment",
  contract_project: "Contract or project work",
  commission: "Commission or performance-based work",
  equity_ownership: "Ownership or equity conversation",
  investor: "Investment opportunity",
  advisor: "Advisory relationship",
  internship: "Internship or apprenticeship",
  open_to_discussion: "Open to discussing the right structure",
};
const roleLabel = (value) => roleLabels[value] || statusLabel(value) || "Open to the best fit";
const choiceLabels = (values, labels = roleLabels) => Array.isArray(values) && values.length
  ? values.map((value) => labels[value] || statusLabel(value)).join(", ")
  : "Not provided";

function responseSection(label, value) {
  const response = String(value || "").trim();
  if (!response) return "";
  return '<section class="message"><p>' + escapeHtml(label) + '</p><div>' + escapeHtml(response).replaceAll("\\n", "<br>") + "</div></section>";
}

function elements() {
  return {
    list: document.getElementById("application-list"),
    detail: document.getElementById("application-detail"),
    summary: document.getElementById("application-summary"),
    dialog: document.getElementById("application-dialog"),
    manualForm: document.getElementById("manual-application-form"),
    provisioningDialog: document.getElementById("application-provision-dialog"),
    provisioningForm: document.getElementById("application-provision-form"),
    emailPreviewDialog: document.getElementById("application-email-preview-dialog"),
  };
}

function safeLink(value, label) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : "";
  } catch {
    return "";
  }
}

function filteredApplications() {
  return applications.filter((application) => activeFilter === "all"
    || (activeFilter === "active" ? activeStatuses.has(application.status) : application.status === activeFilter));
}

function renderList() {
  const { list, summary } = elements();
  if (!list || !summary) return;
  const visible = filteredApplications();
  summary.textContent = `${visible.length} ${activeFilter === "all" ? "total" : "matching"} application${visible.length === 1 ? "" : "s"}`;
  list.innerHTML = visible.length ? visible.map((application) => `
    <button class="application-card${application.id === selectedId ? " selected" : ""}" data-id="${application.id}" type="button">
      <span class="status ${escapeHtml(application.status)}">${escapeHtml(statusLabel(application.status))}</span>
      <strong>${escapeHtml(application.full_name)}</strong>
      <small>${escapeHtml(roleLabel(application.role_interest))}</small>
      <time>${formatDate(application.created_at)}</time>
    </button>
  `).join("") : '<p class="empty">No applications here.</p>';
}

async function loadUploadedCv(application) {
  const target = document.getElementById("uploaded-cv");
  const { data, error } = await supabase.storage.from("careers-files").createSignedUrl(application.cv_storage_path, 600, { download: application.cv_filename || "resume" });
  if (!target) return;
  target.outerHTML = !error && data?.signedUrl
    ? `<a href="${escapeHtml(data.signedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(application.cv_filename || "Uploaded CV")}</a>`
    : "Uploaded CV unavailable";
}

function renderDetail() {
  const { detail } = elements();
  if (!detail) return;
  const application = applications.find((row) => row.id === selectedId);
  if (!application) {
    detail.innerHTML = '<div class="application-empty-detail"><p class="portal-kicker">Applicant profile</p><h2>Select an application</h2><p>Choose an applicant to review their account, files, source conversation, and private notes.</p></div>';
    return;
  }
  const applicationNotes = notes.filter((note) => note.application_id === application.id);
  const links = [
    safeLink(application.portfolio_url, "Portfolio"),
    safeLink(application.github_url, "GitHub"),
    safeLink(application.linkedin_url, "LinkedIn"),
    safeLink(application.cv_url, "CV / résumé"),
    application.cv_storage_path ? '<span id="uploaded-cv">Loading uploaded CV…</span>' : "",
    safeLink(application.source_url, "Original conversation"),
  ].filter(Boolean).join(" · ") || "Not provided";
  const applicantResponses = [
    responseSection("What their proposed role would own", application.role_vision),
    responseSection("What stands out about N3XRA", application.n3xra_interest),
    responseSection("Where they could create the clearest value", application.contribution_vision),
    responseSection("Additional context", application.message),
  ].filter(Boolean).join("") || '<section class="message"><p>Applicant perspective</p><div>Not provided</div></section>';
  const accountHref = application.account_user_id
    ? `/account/admin/accounts/?user=${encodeURIComponent(application.account_user_id)}&email=${encodeURIComponent(application.email)}`
    : "";

  detail.innerHTML = `
    <header class="detail-head"><div><span class="status ${escapeHtml(application.status)}">${escapeHtml(statusLabel(application.status))}</span><h2>${escapeHtml(application.full_name)}</h2><p>${escapeHtml(roleLabel(application.role_interest))} · Submitted ${formatDate(application.created_at)}</p></div><div class="application-detail-actions"><label>Status<select id="application-status">${["new", "reviewing", "contacted", "interviewing", "talent_pool", "declined", "hired"].map((status) => `<option value="${status}"${application.status === status ? " selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label>${application.account_user_id ? `<a class="portal-button" href="${escapeHtml(accountHref)}">Open account</a>` : '<button class="portal-button" id="provision-applicant" type="button">Create account &amp; access</button>'}<button class="portal-button portal-button-secondary account-danger-button" id="delete-application" type="button">Delete application</button></div></header>
    <section class="profile-grid"><div><span>Email</span><a href="mailto:${escapeHtml(application.email)}">${escapeHtml(application.email)}</a></div><div><span>Account</span>${application.account_user_id ? `<a href="${escapeHtml(accountHref)}">Connected · Review account</a>` : "<strong>No account connected</strong>"}</div><div><span>Proposed title</span><strong>${escapeHtml(application.proposed_title || "Not provided")}</strong></div><div><span>Primary direction</span><strong>${escapeHtml(roleLabel(application.role_interest))}</strong></div><div><span>Contribution areas</span><strong>${escapeHtml(choiceLabels(application.contribution_areas))}</strong></div><div><span>Relationship interests</span><strong>${escapeHtml(choiceLabels(application.participation_preferences, participationLabels))}</strong></div><div><span>Location / timezone</span><strong>${escapeHtml(application.location_timezone || "Not provided")}</strong></div><div><span>Current school / company</span><strong>${escapeHtml(application.current_school_company || "Not provided")}</strong></div><div><span>Experience level</span><strong>${escapeHtml(application.experience_level === "not_specified" ? "Not provided" : statusLabel(application.experience_level || "Not provided"))}</strong></div><div><span>Primary skills</span><strong>${escapeHtml(application.primary_skills || "Not provided")}</strong></div><div><span>How they heard about N3XRA</span><strong>${escapeHtml(application.referral_source || "Not provided")}</strong></div><div><span>Availability</span><strong>${escapeHtml(application.availability || "Not provided")}</strong></div><div><span>Work arrangement</span><strong>${escapeHtml(statusLabel(application.work_arrangement))}</strong></div><div><span>Information retention</span><strong>${application.information_retention_consent ? "Agreed" : "Not provided"}</strong></div><div><span>Links</span>${links}</div></section>
    ${applicantResponses}
    <section class="notes"><header><div><p>Private notes</p><h3>Conversation &amp; review history</h3></div></header><form id="note-form"><textarea name="body" rows="4" required placeholder="Add an internal note, paste a message, or record the next step."></textarea><input name="source_url" type="url" placeholder="Optional source link, e.g. Facebook conversation"><button>Add note</button></form><div class="note-timeline">${applicationNotes.length ? applicationNotes.map((note) => `<article><time>${formatDate(note.created_at)}</time><p>${escapeHtml(note.body).replaceAll("\n", "<br>")}</p>${safeLink(note.source_url, "Open source")}</article>`).join("") : '<p class="empty">No private notes yet.</p>'}</div></section>
  `;
  document.getElementById("application-status")?.addEventListener("change", async (event) => updateApplication(application.id, { status: event.target.value }));
  document.getElementById("provision-applicant")?.addEventListener("click", () => openApplicantProvisioning(application));
  document.getElementById("delete-application")?.addEventListener("click", () => deleteApplication(application));
  document.getElementById("note-form")?.addEventListener("submit", addNote);
  if (application.cv_storage_path) loadUploadedCv(application);
}

async function load() {
  const [applicationResult, noteResult] = await Promise.all([
    supabase.from("careers_applications").select("*").order("created_at", { ascending: false }),
    supabase.from("careers_application_notes").select("*").order("created_at", { ascending: false }),
  ]);
  if (applicationResult.error) throw applicationResult.error;
  if (noteResult.error) throw noteResult.error;
  applications = applicationResult.data || [];
  notes = noteResult.data || [];
  if (!applications.some((application) => application.id === selectedId)) selectedId = applications[0]?.id || "";
  renderList();
  renderDetail();
}

async function updateApplication(id, payload) {
  const { error } = await supabase.from("careers_applications").update(payload).eq("id", id);
  if (error) throw error;
  await load();
}

async function invokePlatformAdmin(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action, ...payload } });
  if (error || data?.error) throw new Error(error?.message || data?.error || "Admin request failed.");
  return data;
}

async function loadApplicantProducts() {
  if (applicantProducts.length) return applicantProducts;
  const data = await invokePlatformAdmin("list-career-applicant-products");
  applicantProducts = Array.isArray(data.products) ? data.products : [];
  return applicantProducts;
}

async function openApplicantProvisioning(application) {
  const { provisioningDialog } = elements();
  if (!provisioningDialog || application.account_user_id) return;
  document.getElementById("provision-applicant-name").textContent = application.full_name;
  document.getElementById("provision-applicant-email").textContent = application.email;
  const productList = document.getElementById("provision-product-list");
  const status = document.getElementById("application-provision-status");
  productList.innerHTML = '<p class="provision-loading">Loading available products…</p>';
  status.textContent = "";
  provisioningDialog.showModal();
  try {
    const products = await loadApplicantProducts();
    productList.innerHTML = products.length ? products.map((product) => `
      <label class="provision-product-option">
        <input type="checkbox" name="products" value="${escapeHtml(product.product_key)}">
        <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "Activate this product when the account is created.")}</small></span>
      </label>
    `).join("") : '<p class="provision-loading">No client products are currently available.</p>';
  } catch (error) {
    productList.innerHTML = '<p class="provision-loading">Products could not be loaded.</p>';
    status.textContent = error.message || "Unable to load products.";
  }
}

function selectedProvisioningProducts() {
  const { provisioningForm } = elements();
  return provisioningForm ? Array.from(new FormData(provisioningForm).getAll("products"), String) : [];
}

async function previewApplicantEmail() {
  const application = applications.find((row) => row.id === selectedId);
  if (!application || application.account_user_id) return;
  const products = selectedProvisioningProducts();
  const status = document.getElementById("application-provision-status");
  if (!products.length) {
    status.textContent = "Select at least one product to preview.";
    return;
  }
  const previewButton = document.getElementById("application-email-preview-open");
  previewButton.disabled = true;
  previewButton.textContent = "Preparing preview…";
  status.textContent = "";
  try {
    const data = await invokePlatformAdmin("preview-career-applicant-email", {
      applicationId: application.id,
      products,
    });
    document.getElementById("application-email-preview-recipient").textContent = data.recipient;
    document.getElementById("application-email-preview-subject").textContent = data.subject;
    document.getElementById("application-email-preview-frame").srcdoc = data.html;
    document.getElementById("application-email-preview-status").textContent = "No account has been created and no email has been sent.";
    elements().emailPreviewDialog?.showModal();
  } catch (error) {
    status.textContent = error.message || "Unable to prepare the email preview.";
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = "Preview email";
  }
}

async function provisionApplicant() {
  const application = applications.find((row) => row.id === selectedId);
  if (!application || application.account_user_id) return;
  const products = selectedProvisioningProducts();
  const status = document.getElementById("application-email-preview-status");
  const submit = document.getElementById("application-provision-submit");
  if (!products.length) {
    status.textContent = "Return to product selection and choose at least one product.";
    return;
  }
  submit.disabled = true;
  submit.textContent = "Creating account…";
  status.textContent = "Preparing the account and product access before sending the activation email…";
  try {
    const data = await invokePlatformAdmin("provision-career-applicant", {
      applicationId: application.id,
      products,
    });
    elements().emailPreviewDialog?.close();
    elements().provisioningDialog?.close();
    await load();
    const productNames = (data.products || []).map((product) => product.name).join(", ");
    const delivery = data.activationEmailSent
      ? " The password-setup email was sent."
      : data.activationEmailRequired
        ? ` The account and access are ready, but the email was not sent${data.activationEmailError ? `: ${data.activationEmailError}` : "."}`
        : " The existing account was connected without sending another activation email.";
    const summary = elements().summary;
    if (summary) summary.textContent = `${application.full_name}'s account is ready${productNames ? ` with ${productNames}` : ""}.${delivery}`;
  } catch (error) {
    status.textContent = error.message || "Unable to create this account.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Create account & send link";
  }
}

async function deleteApplication(application) {
  const confirmed = await confirmAdminAction(
    `Permanently delete ${application.full_name}'s application? Their private notes and any uploaded résumé will also be removed. This cannot be undone.`,
    { title: "Delete career application?", confirmLabel: "Delete application" },
  );
  if (!confirmed) return;

  const button = document.getElementById("delete-application");
  if (button) {
    button.disabled = true;
    button.textContent = "Deleting…";
  }

  try {
    await invokePlatformAdmin("delete-career-application", { applicationId: application.id });
    selectedId = "";
    await load();
    const { summary } = elements();
    if (summary) summary.textContent = `${application.full_name}'s application was deleted.`;
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Delete application";
    }
    const { summary } = elements();
    if (summary) summary.textContent = error.message || "Unable to delete this application.";
  }
}

async function addNote(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const { error } = await supabase.from("careers_application_notes").insert({ application_id: selectedId, body: String(formData.get("body") || "").trim(), source_url: String(formData.get("source_url") || "").trim() || null });
  if (error) throw error;
  event.currentTarget.reset();
  await load();
}

function bindInteractions() {
  const { list, dialog, manualForm, provisioningDialog, emailPreviewDialog } = elements();
  list?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    selectedId = card.dataset.id;
    renderList();
    renderDetail();
  });
  document.getElementById("application-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((candidate) => candidate.classList.toggle("selected", candidate === button));
    renderList();
  });
  document.getElementById("add-application")?.addEventListener("click", () => dialog?.showModal());
  document.getElementById("cancel-dialog")?.addEventListener("click", () => dialog?.close());
  document.getElementById("application-provision-close")?.addEventListener("click", () => provisioningDialog?.close());
  document.getElementById("application-provision-cancel")?.addEventListener("click", () => provisioningDialog?.close());
  document.getElementById("application-email-preview-open")?.addEventListener("click", previewApplicantEmail);
  document.getElementById("application-email-preview-close")?.addEventListener("click", () => emailPreviewDialog?.close());
  document.getElementById("application-email-preview-back")?.addEventListener("click", () => emailPreviewDialog?.close());
  document.getElementById("application-provision-submit")?.addEventListener("click", provisionApplicant);
  manualForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(manualForm).entries());
    Object.assign(payload, { work_arrangement: "flexible", status: "new" });
    const { data, error } = await supabase.from("careers_applications").insert(payload).select().single();
    if (error) throw error;
    selectedId = data.id;
    dialog?.close();
    manualForm.reset();
    await load();
  });
  document.getElementById("sign-out")?.addEventListener("click", () => supabase.auth.signOut({ scope: "local" }).then(() => location.assign("/account/")));
}

export async function startApplications(context = {}) {
  if (!hasConfig()) throw new Error("Supabase is not configured.");
  supabase = context.supabase || createBrowserSupabase();
  const session = context.session || await getSessionOrNull(supabase);
  if (!session) {
    location.replace("/account/?next=%2Faccount%2Fadmin%2Fapplications%2F");
    return;
  }
  if (!context.session && !await verifyPlatformAdmin(supabase, session.user)) throw new Error("You do not have application administration access.");
  applications = [];
  notes = [];
  selectedId = "";
  activeFilter = "active";
  renderAdminNavigation();
  bindInteractions();
  await load();
  document.body.classList.add("admin-ready");
}

if (!window.__n3xraAdminSoftNavigation) {
  startApplications().catch((error) => {
    const summary = document.getElementById("application-summary");
    if (summary) summary.textContent = error.message || "Unable to open applications.";
    document.body.classList.add("admin-ready");
  });
}
