import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";
import { renderAdminNavigation } from "/account/admin/admin-navigation.js?v=15";

let supabase;
let applications = [];
let notes = [];
let selectedId = "";
let activeFilter = "active";

const activeStatuses = new Set(["new", "reviewing", "contacted", "interviewing"]);
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const statusLabel = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

function elements() {
  return {
    list: document.getElementById("application-list"),
    detail: document.getElementById("application-detail"),
    summary: document.getElementById("application-summary"),
    dialog: document.getElementById("application-dialog"),
    manualForm: document.getElementById("manual-application-form"),
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
      <small>${escapeHtml(application.role_interest.replaceAll("_", " "))}</small>
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

  detail.innerHTML = `
    <header class="detail-head"><div><span class="status ${escapeHtml(application.status)}">${escapeHtml(statusLabel(application.status))}</span><h2>${escapeHtml(application.full_name)}</h2><p>${escapeHtml(application.role_interest.replaceAll("_", " "))} · Submitted ${formatDate(application.created_at)}</p></div><label>Status<select id="application-status">${["new", "reviewing", "contacted", "interviewing", "talent_pool", "declined", "hired"].map((status) => `<option value="${status}"${application.status === status ? " selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label></header>
    <section class="profile-grid"><div><span>Email</span><a href="mailto:${escapeHtml(application.email)}">${escapeHtml(application.email)}</a></div><div><span>Account</span><strong>${application.account_user_id ? "Connected" : "No account connected"}</strong></div><div><span>Location / timezone</span><strong>${escapeHtml(application.location_timezone || "Not provided")}</strong></div><div><span>Current school / company</span><strong>${escapeHtml(application.current_school_company || "Not provided")}</strong></div><div><span>Experience level</span><strong>${escapeHtml(statusLabel(application.experience_level || "Not provided"))}</strong></div><div><span>Primary skills</span><strong>${escapeHtml(application.primary_skills || "Not provided")}</strong></div><div><span>How they heard about N3XRA</span><strong>${escapeHtml(application.referral_source || "Not provided")}</strong></div><div><span>Availability</span><strong>${escapeHtml(application.availability || "Not provided")}</strong></div><div><span>Work arrangement</span><strong>${escapeHtml(statusLabel(application.work_arrangement))}</strong></div><div><span>Information retention</span><strong>${application.information_retention_consent ? "Agreed" : "Not provided"}</strong></div><div><span>Links</span>${links}</div></section>
    <section class="message"><p>Application message</p><div>${escapeHtml(application.message).replaceAll("\n", "<br>")}</div></section>
    <section class="notes"><header><div><p>Private notes</p><h3>Conversation &amp; review history</h3></div></header><form id="note-form"><textarea name="body" rows="4" required placeholder="Add an internal note, paste a message, or record the next step."></textarea><input name="source_url" type="url" placeholder="Optional source link, e.g. Facebook conversation"><button>Add note</button></form><div class="note-timeline">${applicationNotes.length ? applicationNotes.map((note) => `<article><time>${formatDate(note.created_at)}</time><p>${escapeHtml(note.body).replaceAll("\n", "<br>")}</p>${safeLink(note.source_url, "Open source")}</article>`).join("") : '<p class="empty">No private notes yet.</p>'}</div></section>
  `;
  document.getElementById("application-status")?.addEventListener("change", async (event) => updateApplication(application.id, { status: event.target.value }));
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

async function addNote(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const { error } = await supabase.from("careers_application_notes").insert({ application_id: selectedId, body: String(formData.get("body") || "").trim(), source_url: String(formData.get("source_url") || "").trim() || null });
  if (error) throw error;
  event.currentTarget.reset();
  await load();
}

function bindInteractions() {
  const { list, dialog, manualForm } = elements();
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
