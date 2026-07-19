import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const statusScreen = document.getElementById("portal-status");
const requestList = document.getElementById("admin-request-list");
let supabase;
let currentUser;
let requests = [];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function label(value = "") {
  return String(value).replaceAll("_", " ");
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
      </div>
    </article>
  `).join("") : '<div class="portal-empty"><p>No website requests have been submitted.</p></div>';
}

async function loadRequests() {
  const [requestResult, proposalResult] = await Promise.all([
    supabase.from("website_service_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposals").select("id,request_id"),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (proposalResult.error) throw proposalResult.error;
  const proposals = new Map((proposalResult.data || []).map((proposal) => [proposal.request_id, proposal.id]));
  requests = (requestResult.data || []).map((request) => ({ ...request, proposal_id: proposals.get(request.id) || "" }));
  render();
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
    const button = event.target.closest("[data-save-request]");
    if (!button) return;
    button.disabled = true;
    try { await saveRequest(button.dataset.saveRequest); } finally { button.disabled = false; }
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => { statusScreen.textContent = error?.message || "Website requests could not be opened."; });
