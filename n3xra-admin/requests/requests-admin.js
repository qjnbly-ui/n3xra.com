import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const statusScreen = document.getElementById("portal-status");
const requestList = document.getElementById("admin-request-list");
const aiReviewList = document.getElementById("admin-ai-review-list");
let supabase;
let currentUser;
let requests = [];
let aiReviews = [];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function label(value = "") {
  return String(value).replaceAll("_", " ");
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
}

function renderAiReviews() {
  aiReviewList.innerHTML = aiReviews.length ? aiReviews.map((review) => {
    const project = review.project_snapshot || {};
    const result = review.review_snapshot || {};
    const observations = Array.isArray(result.observations) ? result.observations : [];
    const questions = Array.isArray(result.questions) ? result.questions : [];
    return `
      <details class="portal-request-card portal-request-admin-card">
        <summary>
          <div><p class="portal-kicker">${escapeHtml(formatDate(review.created_at))}</p><h3>${escapeHtml(project.businessName || "Unsubmitted review")}</h3><p>${escapeHtml(project.contactName || "Unknown contact")} · ${escapeHtml(review.contact_email || project.email || "No email")}</p></div>
          <span class="portal-badge">${review.request_id ? "Submitted request" : "Review only"}</span>
        </summary>
        <div>
          <p><strong>AI confirmation</strong></p><p>${escapeHtml(result.message || "No confirmation saved.")}</p>
          <p><strong>Observations</strong></p>${observations.length ? `<ul>${observations.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>: ${escapeHtml(item.body)}</li>`).join("")}</ul>` : "<p>None</p>"}
          <p><strong>Follow-up questions</strong></p>${questions.length ? `<ul>${questions.map((item) => `<li>${escapeHtml(item.question)} <small>${escapeHtml(item.reason || "")}</small></li>`).join("")}</ul>` : "<p>None needed</p>"}
          <p><strong>Form snapshot</strong></p><pre>${escapeHtml(JSON.stringify(project, null, 2))}</pre>
          <p class="portal-kicker">${escapeHtml(review.model)}</p>
        </div>
      </details>
    `;
  }).join("") : '<div class="portal-empty"><p>No AI reviews have been recorded yet.</p></div>';
}

function render() {
  requestList.innerHTML = requests.length ? requests.map((request) => `
    <article class="portal-request-card portal-request-admin-card">
      <div>
        <p class="portal-kicker">${escapeHtml(label(request.project_type))}</p>
        <h3>${escapeHtml(request.business_name)}</h3>
        <p><strong>${escapeHtml(request.contact_name)}</strong> · ${escapeHtml(request.contact_email)}</p>
        <p>${escapeHtml(request.primary_goal)}</p>
      </div>
      <div class="portal-request-controls">
        <select data-request-status="${request.id}" aria-label="Request status">
          ${["submitted", "reviewing", "needs_info", "qualified", "declined", "converted", "archived"].map((status) => `<option value="${status}"${request.status === status ? " selected" : ""}>${label(status)}</option>`).join("")}
        </select>
        <textarea rows="3" data-request-notes="${request.id}" placeholder="Private admin notes">${escapeHtml(request.admin_notes || "")}</textarea>
        <a class="portal-button" href="/n3xra-admin/proposals/?request=${encodeURIComponent(request.id)}">${request.proposal_id ? "Open proposal" : "Create proposal"}</a>
        <button class="portal-button portal-button-secondary" type="button" data-save-request="${request.id}">Save review</button>
        ${request.status !== "archived" ? `<button class="portal-button portal-button-secondary" type="button" data-archive-request="${request.id}">Archive request</button>` : ""}
        ${!request.proposal_id ? `<button class="portal-link-button is-danger" type="button" data-delete-request="${request.id}">Delete permanently</button>` : '<p class="portal-control-note">This request has proposal history and can be archived, but not deleted.</p>'}
      </div>
    </article>
  `).join("") : '<div class="portal-empty"><p>No website requests have been submitted.</p></div>';
}

async function loadRequests() {
  const [requestResult, proposalResult, reviewResult] = await Promise.all([
    supabase.from("website_service_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("id,request_id"),
    supabase.from("website_request_ai_reviews").select("*").order("created_at", { ascending: false }).limit(250),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  if (reviewResult.error) throw reviewResult.error;
  const proposals = new Map((proposalResult.data || []).map((proposal) => [proposal.request_id, proposal.id]));
  requests = (requestResult.data || []).map((request) => ({ ...request, proposal_id: proposals.get(request.id) || "" }));
  const requestByReview = new Map(requests.filter((request) => request.ai_review_id).map((request) => [request.ai_review_id, request.id]));
  aiReviews = (reviewResult.data || []).map((review) => ({ ...review, request_id: requestByReview.get(review.id) || "" }));
  render();
  renderAiReviews();
}

async function saveRequest(requestId) {
  const { error } = await supabase.from("website_service_requests").update({
    status: requestList.querySelector(`[data-request-status="${requestId}"]`)?.value,
    admin_notes: requestList.querySelector(`[data-request-notes="${requestId}"]`)?.value.trim() || null,
    reviewed_by_user_id: currentUser.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);
  if (error) throw error;
  await loadRequests();
}

async function archiveRequest(requestId) {
  const { error } = await supabase.from("website_service_requests").update({
    status: "archived",
    reviewed_by_user_id: currentUser.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);
  if (error) throw error;
  await loadRequests();
}

async function deleteRequest(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request || request.proposal_id) throw new Error("Requests with proposal history cannot be deleted. Archive this request instead.");
  const confirmed = window.confirm(`Permanently delete the request for “${request.business_name}”? This cannot be undone.`);
  if (!confirmed) return;
  const { error } = await supabase.from("website_service_requests").delete().eq("id", requestId);
  if (error) throw error;
  await loadRequests();
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user;
  if (!currentUser) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Frequests%2F");
    return;
  }
  if (!await verifyPlatformAdmin(supabase, currentUser)) throw new Error("You do not have request administration access.");
  await loadRequests();
  requestList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-request], [data-archive-request], [data-delete-request]");
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.saveRequest) await saveRequest(button.dataset.saveRequest);
      else if (button.dataset.archiveRequest) await archiveRequest(button.dataset.archiveRequest);
      else if (button.dataset.deleteRequest) await deleteRequest(button.dataset.deleteRequest);
    } catch (error) {
      window.alert(error?.message || "Unable to update this request.");
    } finally {
      button.disabled = false;
    }
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => { statusScreen.textContent = error?.message || "Website requests could not be opened."; });
