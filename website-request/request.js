import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const form = document.getElementById("website-request-form");
const statusScreen = document.getElementById("portal-status");
const inlineStatus = document.getElementById("request-status");
const requestList = document.getElementById("request-list");
let supabase;
let session;

function value(id) {
  return document.getElementById(id).value.trim();
}

function escapeHtml(input = "") {
  return String(input).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function listValue(id) {
  return value(id).split(",").map((item) => item.trim()).filter(Boolean);
}

function setStatus(message = "", error = false) {
  inlineStatus.textContent = message;
  inlineStatus.classList.toggle("is-error", error);
}

function formatStatus(status) {
  return String(status || "").replaceAll("_", " ");
}

async function loadRequests() {
  const { data, error } = await supabase.from("website_service_requests")
    .select("id,business_name,project_type,status,created_at,primary_goal,website_proposals(id,status),website_projects(id,status)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  requestList.innerHTML = (data || []).length ? data.map((request) => {
    const proposal = Array.isArray(request.website_proposals) ? request.website_proposals[0] : request.website_proposals;
    const project = Array.isArray(request.website_projects) ? request.website_projects[0] : request.website_projects;
    return `
      <article class="portal-request-card">
        <div><p class="portal-kicker">${escapeHtml(formatStatus(request.project_type))}</p><h3>${escapeHtml(request.business_name)}</h3><p>${escapeHtml(request.primary_goal)}</p></div>
        <div class="portal-request-client-actions">
          <span class="portal-badge portal-status-${escapeHtml(request.status)}">${escapeHtml(formatStatus(request.status))}</span>
          <p>${new Date(request.created_at).toLocaleDateString()}</p>
          ${project ? `<a class="portal-button" href="/project-workspace/?project=${encodeURIComponent(project.id)}">Open project</a>` : ""}
          ${proposal ? `<a class="portal-button portal-button-secondary" href="/proposals/?proposal=${encodeURIComponent(proposal.id)}">Review proposal</a>` : ""}
        </div>
      </article>
    `;
  }).join("") : "";
}

async function submitRequest(event) {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  setStatus("Submitting your request…");
  try {
    const { error } = await supabase.from("website_service_requests").insert({
      user_id: session.user.id,
      contact_name: value("request-contact-name"),
      business_name: value("request-business-name"),
      contact_email: value("request-email"),
      contact_phone: value("request-phone") || null,
      project_type: value("request-project-type"),
      existing_website_url: value("request-existing-url") || null,
      primary_goal: value("request-goal"),
      audience: value("request-audience") || null,
      requested_pages: listValue("request-pages"),
      requested_features: listValue("request-features"),
      budget_range: value("request-budget") || null,
      target_launch_date: value("request-launch-date") || null,
      additional_notes: value("request-notes") || null,
      status: "submitted",
    });
    if (error) throw error;
    form.reset();
    document.getElementById("request-email").value = session.user.email || "";
    setStatus("Your website request was submitted.");
    await loadRequests();
  } catch (error) {
    setStatus(error?.message || "Unable to submit your request.", true);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  if (!hasConfig()) return;
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/account?next=%2Fwebsite-request%2F");
    return;
  }
  document.getElementById("request-email").value = session.user.email || "";
  form.addEventListener("submit", submitRequest);
  await loadRequests();
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Project intake could not be opened.";
});
