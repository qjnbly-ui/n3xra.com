import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const statusScreen = document.getElementById("portal-status");
const list = document.getElementById("partner-application-list");
const stats = document.getElementById("partner-stats");
const searchInput = document.getElementById("partner-search");
const statusFilter = document.getElementById("partner-status-filter");
const refreshButton = document.getElementById("partner-refresh");
let supabase;
let applications = [];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function productsFor(application) {
  return Array.isArray(application.interested_products) ? application.interested_products.filter(Boolean) : [];
}

function renderStats() {
  const count = (status) => applications.filter((application) => application.status === status).length;
  stats.innerHTML = [
    ["New", count("submitted")],
    ["Reviewing", count("reviewing")],
    ["Approved", count("approved")],
    ["Total", applications.length],
  ].map(([label, value]) => `<div class="partner-admin-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function filteredApplications() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;
  return applications.filter((application) => {
    if (selectedStatus && application.status !== selectedStatus) return false;
    if (!query) return true;
    return [application.full_name, application.email, application.organization, application.audience_source]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function render() {
  const visible = filteredApplications();
  list.innerHTML = visible.length ? visible.map((application) => {
    const products = productsFor(application);
    const websiteUrl = safeExternalUrl(application.website);
    return `
      <details class="partner-admin-card">
        <summary>
          <div>
            <p class="portal-kicker">${escapeHtml(formatDate(application.created_at))}</p>
            <h3>${escapeHtml(application.full_name)}</h3>
            <p>${escapeHtml(application.email)}${application.organization ? ` · ${escapeHtml(application.organization)}` : ""}</p>
            <div class="partner-admin-badges">${products.map((product) => `<span class="partner-admin-badge">${escapeHtml(product)}</span>`).join("")}</div>
          </div>
          <span class="partner-admin-status">${escapeHtml(application.status)}</span>
        </summary>
        <div class="partner-admin-body">
          <div class="partner-admin-details">
            <dl class="partner-admin-facts">
              <div><dt>Email</dt><dd><a href="mailto:${escapeHtml(application.email)}">${escapeHtml(application.email)}</a></dd></div>
              <div><dt>Phone</dt><dd>${application.phone ? `<a href="tel:${escapeHtml(application.phone)}">${escapeHtml(application.phone)}</a>` : "Not provided"}</dd></div>
              <div><dt>Referral source</dt><dd>${escapeHtml(application.audience_source)}</dd></div>
              <div><dt>Payout country</dt><dd>${escapeHtml(application.payout_country || "Not provided")}</dd></div>
              <div><dt>Website or profile</dt><dd>${websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">Open link</a>` : "Not provided"}</dd></div>
              <div><dt>Last updated</dt><dd>${escapeHtml(formatDate(application.updated_at))}</dd></div>
            </dl>
            <div><p class="portal-kicker">How they would create opportunities</p><p class="partner-admin-plan">${escapeHtml(application.referral_plan)}</p></div>
          </div>
          <div class="partner-admin-controls">
            <label>Application status
              <select data-partner-status="${application.id}">
                ${["submitted", "reviewing", "approved", "waitlisted", "rejected"].map((status) => `<option value="${status}"${application.status === status ? " selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}
              </select>
            </label>
            <label>Private admin notes
              <textarea data-partner-notes="${application.id}" placeholder="Review notes, follow-up, or decision reason">${escapeHtml(application.notes || "")}</textarea>
            </label>
            <button class="portal-button" type="button" data-save-partner="${application.id}">Save review</button>
          </div>
        </div>
      </details>
    `;
  }).join("") : '<div class="portal-empty"><p>No partner applications match these filters.</p></div>';
}

async function loadApplications() {
  const { data, error } = await supabase
    .from("founding_partner_applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  applications = data || [];
  renderStats();
  render();
}

async function saveApplication(applicationId) {
  const status = list.querySelector(`[data-partner-status="${applicationId}"]`)?.value;
  const notes = list.querySelector(`[data-partner-notes="${applicationId}"]`)?.value.trim() || null;
  const existing = applications.find((application) => application.id === applicationId);
  const updates = { status, notes };
  if (status === "approved" && existing?.status !== "approved") updates.approved_at = new Date().toISOString();
  const { error } = await supabase
    .from("founding_partner_applications")
    .update(updates)
    .eq("id", applicationId);
  if (error) throw error;
  await loadApplications();
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) {
    window.location.replace("/account/?next=%2Fn3xra-admin%2Fpartners%2F");
    return;
  }
  if (!await verifyPlatformAdmin(supabase, user)) throw new Error("You do not have partner administration access.");

  await loadApplications();
  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    try {
      await loadApplications();
    } catch (error) {
      window.alert(error?.message || "Unable to refresh partner applications.");
    } finally {
      refreshButton.disabled = false;
    }
  });
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-partner]");
    if (!button) return;
    button.disabled = true;
    try {
      await saveApplication(button.dataset.savePartner);
    } catch (error) {
      window.alert(error?.message || "Unable to save this application.");
    } finally {
      button.disabled = false;
    }
  });

  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Partner applications could not be opened.";
});
