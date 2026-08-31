import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=3";

const statusScreen = document.getElementById("portal-status");
const list = document.getElementById("partner-application-list");
const stats = document.getElementById("partner-stats");
const searchInput = document.getElementById("partner-search");
const programFilter = document.getElementById("partner-program-filter");
const statusFilter = document.getElementById("partner-status-filter");
const refreshButton = document.getElementById("partner-refresh");
const deleteDialog = document.getElementById("partner-delete-dialog");
const deleteMessage = document.getElementById("partner-delete-message");
const deleteCancel = document.getElementById("partner-delete-cancel");
const deleteConfirm = document.getElementById("partner-delete-confirm");
const deleteImpact = document.getElementById("partner-delete-impact");
const deleteImpactSummary = document.getElementById("partner-delete-impact-summary");
const deleteAcknowledge = document.getElementById("partner-delete-acknowledge");
let supabase;
let applications = [];
let resolveDeleteConfirmation = null;
let accessToken = "";
const partnerEmailWorkflow = new Map();

const PARTNER_PROGRAMS = [
  "Website Referral Program",
  "N3XRA Software Commission Programs",
  "Future N3XRA Opportunities",
];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";
}

function money(cents, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents || 0) / 100);
}

function title(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const selectedProgram = programFilter.value;
  const selectedStatus = statusFilter.value;
  return applications.filter((application) => {
    if (selectedStatus && application.status !== selectedStatus) return false;
    if (selectedProgram) {
      const products = productsFor(application).join(" ").toLowerCase();
      if (!products.includes(selectedProgram)) return false;
    }
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
              <div><dt>Referral code</dt><dd>${escapeHtml(application.referral_code || "Not created")}</dd></div>
              <div><dt>Last updated</dt><dd>${escapeHtml(formatDate(application.updated_at))}</dd></div>
            </dl>
            <div><p class="portal-kicker">How they would create opportunities</p><p class="partner-admin-plan">${escapeHtml(application.referral_plan)}</p></div>
            <section class="partner-admin-activity" aria-label="Partner activity">
              <div><p class="portal-kicker">Partner account</p><h4>Referrals and commissions</h4><p>Inspect the activity and balance visible in this partner’s portal.</p></div>
              <div class="partner-admin-account-actions">
                <button class="portal-button portal-button-secondary" type="button" data-load-partner-activity="${application.id}">Load activity</button>
                <button class="portal-button portal-button-secondary" type="button" data-edit-partner-terms="${application.id}">Edit commission &amp; contract</button>
                <button class="portal-button portal-button-secondary" type="button" data-manage-partner-email="${application.id}">Manage email process</button>
                ${application.status === "approved" ? `<a class="portal-button" href="/client-portal/partners/?admin_preview=${encodeURIComponent(application.id)}">Preview account view</a>` : ""}
              </div>
              <div data-partner-terms-editor="${application.id}"></div>
              <div data-partner-email-editor="${application.id}"></div>
              <div data-partner-activity="${application.id}"></div>
            </section>
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
            <label>Referral code
              <input data-partner-code="${application.id}" maxlength="24" minlength="4" pattern="[A-Za-z0-9-]{4,24}" value="${escapeHtml(application.referral_code || "")}" placeholder="PARTNER-CODE">
              <small>Full administrators can replace a partner’s permanent code. Existing attributed activity remains attached to the partner.</small>
            </label>
            <fieldset class="partner-admin-programs">
              <legend>Approved partner programs</legend>
              ${PARTNER_PROGRAMS.map((program) => `<label><input type="checkbox" data-partner-program="${application.id}" value="${escapeHtml(program)}"${products.includes(program) ? " checked" : ""}> <span>${escapeHtml(program)}</span></label>`).join("")}
            </fieldset>
            <div class="partner-admin-actions">
              <button class="portal-button" type="button" data-save-partner="${application.id}">Save review</button>
              <button class="portal-button portal-button-danger" type="button" data-delete-partner="${application.id}">Delete permanently</button>
            </div>
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
  const codeInput = list.querySelector(`[data-partner-code="${applicationId}"]`);
  if (codeInput?.value && !codeInput.reportValidity()) return;
  const referralCode = String(codeInput?.value || "").trim().toUpperCase() || null;
  const interestedProducts = [...list.querySelectorAll(`[data-partner-program="${applicationId}"]:checked`)].map((input) => input.value);
  const existing = applications.find((application) => application.id === applicationId);
  const updates = { status, notes, referral_code: referralCode, interested_products: interestedProducts };
  if (status === "approved" && existing?.status !== "approved") updates.approved_at = new Date().toISOString();
  const { error } = await supabase
    .from("founding_partner_applications")
    .update(updates)
    .eq("id", applicationId);
  if (error) throw error;
  await loadApplications();
}

function activityRows(items, type) {
  if (!items.length) return `<p class="partner-admin-activity-empty">No ${type === "referral" ? "referrals" : "commission entries"} recorded.</p>`;
  return `<div class="partner-admin-activity-list">${items.map((item) => type === "referral" ? `
    <article><div><strong>${escapeHtml(item.referred_name)}</strong><small>${escapeHtml(item.referred_email || title(item.program))} · ${escapeHtml(formatDate(item.created_at))}</small></div><span>${escapeHtml(title(item.status))}</span></article>
  ` : `
    <article><div><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(formatDate(item.earned_at || item.created_at))} · ${escapeHtml(title(item.status))}</small></div><span>${money(item.amount_cents, item.currency)}</span></article>
  `).join("")}</div>`;
}

async function loadPartnerActivity(applicationId, button) {
  const target = list.querySelector(`[data-partner-activity="${applicationId}"]`);
  if (!target) return;
  button.disabled = true;
  target.innerHTML = '<p class="partner-admin-activity-empty">Loading partner activity…</p>';
  try {
    const response = await fetch(`/api/partner-admin-usage?id=${encodeURIComponent(applicationId)}&details=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load partner activity.");
    const activity = result.activity || { balances: {}, referrals: [], commissions: [] };
    target.innerHTML = `
      <div class="partner-admin-balance-grid">
        <div><span>Pending</span><strong>${money(activity.balances.pending_cents, activity.balances.currency)}</strong></div>
        <div><span>Available</span><strong>${money(activity.balances.available_cents, activity.balances.currency)}</strong></div>
        <div><span>Paid</span><strong>${money(activity.balances.paid_cents, activity.balances.currency)}</strong></div>
      </div>
      <div class="partner-admin-activity-columns">
        <section><h5>Referrals</h5>${activityRows(activity.referrals || [], "referral")}</section>
        <section><h5>Commissions</h5>${activityRows(activity.commissions || [], "commission")}</section>
      </div>`;
    button.textContent = "Refresh activity";
  } catch (error) {
    target.innerHTML = `<p class="partner-admin-activity-error">${escapeHtml(error?.message || "Unable to load partner activity.")}</p>`;
  } finally {
    button.disabled = false;
  }
}

function termsEditor(applicationId, terms = {}) {
  const commissionType = terms.commission_type || "custom";
  const percentage = terms.commission_rate_bps == null ? "" : Number(terms.commission_rate_bps) / 100;
  const fixedAmount = terms.commission_amount_cents == null ? "" : (Number(terms.commission_amount_cents) / 100).toFixed(2);
  return `
    <form class="partner-admin-terms-form" data-partner-terms-form="${applicationId}">
      <div class="partner-admin-terms-heading"><div><h5>Commission &amp; custom agreement</h5><p>Saving creates revision ${Number(terms.revision || 0) + 1}. Prior values remain in the audit history.</p></div><span>${terms.revision ? `Current revision ${terms.revision}` : "Not configured"}</span></div>
      <div class="partner-admin-terms-fields">
        <label>Status<select name="status"><option value="draft"${terms.status !== "active" ? " selected" : ""}>Draft — admin only</option><option value="active"${terms.status === "active" ? " selected" : ""}>Active — visible to partner</option></select></label>
        <label>Commission type<select name="commission_type" data-commission-type><option value="percentage"${commissionType === "percentage" ? " selected" : ""}>Percentage</option><option value="fixed"${commissionType === "fixed" ? " selected" : ""}>Fixed amount</option><option value="custom"${commissionType === "custom" ? " selected" : ""}>Custom terms</option></select></label>
        <label data-rate-field="percentage"${commissionType === "percentage" ? "" : " hidden"}>Commission percentage<input name="commission_percentage" type="number" min="0" max="100" step="0.01" value="${escapeHtml(percentage)}" placeholder="10.00"${commissionType === "percentage" ? " required" : ""}></label>
        <label data-rate-field="fixed"${commissionType === "fixed" ? "" : " hidden"}>Fixed commission (USD)<input name="commission_fixed" type="number" min="0" step="0.01" value="${escapeHtml(fixedAmount)}" placeholder="100.00"${commissionType === "fixed" ? " required" : ""}></label>
        <label class="partner-admin-terms-wide">Commission description<textarea name="commission_description" maxlength="2000" placeholder="Explain qualifying events, timing, and payout conditions.">${escapeHtml(terms.commission_description || "")}</textarea></label>
        <label class="partner-admin-terms-wide">Contract title<input name="contract_title" maxlength="240" value="${escapeHtml(terms.contract_title || "N3XRA Partner Agreement")}"></label>
        <label>Effective date<input name="effective_at" type="date" value="${escapeHtml(terms.effective_at || "")}"></label>
        <label>Expiration date<input name="expires_at" type="date" value="${escapeHtml(terms.expires_at || "")}"></label>
        <label class="partner-admin-terms-wide">Custom contract<textarea name="contract_body" maxlength="50000" rows="12" placeholder="Enter the complete partner-specific agreement terms.">${escapeHtml(terms.contract_body || "")}</textarea></label>
      </div>
      <div class="partner-admin-terms-footer"><p data-partner-terms-status role="status"></p><button class="portal-button" type="button" data-save-partner-terms="${applicationId}">Save new revision</button></div>
    </form>`;
}

function syncTermsRateFields(form) {
  const selected = form.querySelector("[data-commission-type]")?.value;
  form.querySelectorAll("[data-rate-field]").forEach((field) => {
    const active = field.dataset.rateField === selected;
    field.hidden = !active;
    const input = field.querySelector("input");
    if (input) input.required = active;
  });
}

async function editPartnerTerms(applicationId, button) {
  const target = list.querySelector(`[data-partner-terms-editor="${applicationId}"]`);
  if (!target) return;
  button.disabled = true;
  target.innerHTML = '<p class="partner-admin-activity-empty">Loading commission and contract terms…</p>';
  try {
    const response = await fetch(`/api/partner-admin-terms?id=${encodeURIComponent(applicationId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load partner terms.");
    target.innerHTML = termsEditor(applicationId, result.terms || {});
    button.textContent = "Reload commission & contract";
  } catch (error) {
    target.innerHTML = `<p class="partner-admin-activity-error">${escapeHtml(error?.message || "Unable to load partner terms.")}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function savePartnerTerms(applicationId, button) {
  const form = list.querySelector(`[data-partner-terms-form="${applicationId}"]`);
  if (!form || !form.reportValidity()) return;
  const values = new FormData(form);
  const commissionType = String(values.get("commission_type") || "custom");
  const percentage = Number(values.get("commission_percentage"));
  const fixed = Number(values.get("commission_fixed"));
  const payload = {
    partner_application_id: applicationId,
    status: values.get("status"),
    commission_type: commissionType,
    commission_rate_bps: commissionType === "percentage" ? Math.round(percentage * 100) : null,
    commission_amount_cents: commissionType === "fixed" ? Math.round(fixed * 100) : null,
    currency: "USD",
    commission_description: values.get("commission_description"),
    contract_title: values.get("contract_title"),
    contract_body: values.get("contract_body"),
    effective_at: values.get("effective_at"),
    expires_at: values.get("expires_at"),
  };
  const status = form.querySelector("[data-partner-terms-status]");
  button.disabled = true;
  status.textContent = "Saving a new audited revision…";
  try {
    const response = await fetch(`/api/partner-admin-terms?id=${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save partner terms.");
    form.parentElement.innerHTML = termsEditor(applicationId, result.terms || {});
    form.parentElement.querySelector("[data-partner-terms-status]").textContent = result.terms?.status === "active" ? "Saved. These terms are now visible in the partner portal." : "Draft saved. These terms remain hidden from the partner.";
  } catch (error) {
    status.textContent = error?.message || "Unable to save partner terms.";
    button.disabled = false;
  }
}

function recommendedEmailStage(data) {
  const sentStages = new Set((data.history || []).filter((item) => item.status === "sent").map((item) => item.stage));
  if (!sentStages.has("approval")) return "approval";
  if (data.terms_status === "active" && !sentStages.has("contract_ready")) return "contract_ready";
  if (!sentStages.has("portal_ready")) return "portal_ready";
  return "follow_up";
}

function emailHistoryRows(history = []) {
  if (!history.length) return '<p class="partner-admin-activity-empty">No partner workflow emails have been sent yet.</p>';
  return `<div class="partner-email-history-list">${history.map((item) => `<article><div><strong>${escapeHtml(title(item.stage))}</strong><small>${escapeHtml(item.subject)} · ${escapeHtml(formatDate(item.sent_at || item.created_at))}</small>${item.error_message ? `<em>${escapeHtml(item.error_message)}</em>` : ""}</div><span data-email-status="${escapeHtml(item.status)}">${escapeHtml(title(item.status))}</span></article>`).join("")}</div>`;
}

function emailComposer(applicationId, data, selectedStage = recommendedEmailStage(data)) {
  const template = data.templates?.[selectedStage] || data.templates?.approval;
  const contractBlocked = selectedStage === "contract_ready" && data.terms_status !== "active";
  return `
    <section class="partner-email-workflow" data-partner-email-workflow="${applicationId}">
      <div class="partner-admin-terms-heading"><div><h5>Partner email process</h5><p>Customize, preview, and explicitly send each step. Messages are never sent just because a status changes.</p></div><span>${data.history?.filter((item) => item.status === "sent").length || 0} sent</span></div>
      <div class="partner-email-stage-strip" aria-label="Partner email stages">${Object.entries(data.templates || {}).map(([key, value]) => `<button type="button" data-email-stage="${escapeHtml(key)}"${key === selectedStage ? ' class="is-current"' : ""}>${escapeHtml(value.label)}</button>`).join("")}</div>
      <form class="partner-email-composer" data-partner-email-form="${applicationId}" data-email-stage-current="${escapeHtml(selectedStage)}">
        <div class="partner-email-recipient"><span>To</span><strong>${escapeHtml(data.recipient)}</strong></div>
        <label>Subject<input name="subject" maxlength="240" value="${escapeHtml(template?.subject || "")}" required></label>
        <label>Message<textarea name="body_text" maxlength="20000" rows="12" required>${escapeHtml(template?.body || "")}</textarea></label>
        ${contractBlocked ? '<p class="partner-email-blocked">Activate this partner’s contract before sending the Contract Ready stage. You can still customize and preview it now.</p>' : ""}
        <div class="partner-email-composer-actions"><p data-partner-email-status role="status"></p><button class="portal-button portal-button-secondary" type="button" data-preview-partner-email="${applicationId}">Preview email</button><button class="portal-button" type="button" data-send-partner-email="${applicationId}"${contractBlocked || data.application_status !== "approved" ? " disabled" : ""}>Send to partner</button></div>
      </form>
      <div class="partner-email-preview" data-partner-email-preview hidden></div>
      <div class="partner-email-history"><h6>Delivery history</h6>${emailHistoryRows(data.history || [])}</div>
    </section>`;
}

async function loadPartnerEmail(applicationId, button, selectedStage = "") {
  const target = list.querySelector(`[data-partner-email-editor="${applicationId}"]`);
  if (!target) return;
  button.disabled = true;
  target.innerHTML = '<p class="partner-admin-activity-empty">Loading partner email process…</p>';
  try {
    const response = await fetch(`/api/partner-admin-email?id=${encodeURIComponent(applicationId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load partner email process.");
    partnerEmailWorkflow.set(applicationId, result);
    target.innerHTML = emailComposer(applicationId, result, selectedStage || recommendedEmailStage(result));
    button.textContent = "Reload email process";
  } catch (error) {
    target.innerHTML = `<p class="partner-admin-activity-error">${escapeHtml(error?.message || "Unable to load partner email process.")}</p>`;
  } finally {
    button.disabled = false;
  }
}

function switchPartnerEmailStage(applicationId, stage) {
  const data = partnerEmailWorkflow.get(applicationId);
  const target = list.querySelector(`[data-partner-email-editor="${applicationId}"]`);
  if (data && target && data.templates?.[stage]) target.innerHTML = emailComposer(applicationId, data, stage);
}

function previewPartnerEmail(applicationId) {
  const form = list.querySelector(`[data-partner-email-form="${applicationId}"]`);
  if (!form || !form.reportValidity()) return;
  const values = new FormData(form);
  const preview = form.closest("[data-partner-email-workflow]").querySelector("[data-partner-email-preview]");
  preview.hidden = false;
  preview.innerHTML = `<div><p>N3XRA Partner Programs</p><h5>${escapeHtml(values.get("subject"))}</h5></div><article>${escapeHtml(values.get("body_text")).replaceAll("\n", "<br>")}</article>`;
}

async function sendPartnerEmail(applicationId, button) {
  const form = list.querySelector(`[data-partner-email-form="${applicationId}"]`);
  const data = partnerEmailWorkflow.get(applicationId);
  if (!form || !data || !form.reportValidity()) return;
  const values = new FormData(form);
  if (!window.confirm(`Send “${values.get("subject")}” to ${data.recipient}?`)) return;
  const status = form.querySelector("[data-partner-email-status]");
  const deliveryKey = form.dataset.deliveryKey || crypto.randomUUID();
  form.dataset.deliveryKey = deliveryKey;
  button.disabled = true;
  status.textContent = "Sending partner email…";
  try {
    const response = await fetch(`/api/partner-admin-email?id=${encodeURIComponent(applicationId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ partner_application_id: applicationId, stage: form.dataset.emailStageCurrent, subject: values.get("subject"), body_text: values.get("body_text"), idempotency_key: deliveryKey }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send partner email.");
    status.textContent = result.already_sent ? "This exact delivery was already sent; no duplicate was created." : `Email sent to ${data.recipient}.`;
    form.dataset.deliveryKey = "";
    const reload = list.querySelector(`[data-manage-partner-email="${applicationId}"]`);
    if (reload) await loadPartnerEmail(applicationId, reload);
  } catch (error) {
    status.textContent = error?.message || "Unable to send partner email.";
    button.disabled = false;
  }
}

function usageSummary(usage = {}) {
  const items = [
    [usage.referrals, "referral", "referrals"],
    [usage.commissions, "commission entry", "commission entries"],
    [usage.website_requests, "website request", "website requests"],
    [usage.accounts, "attributed account", "attributed accounts"],
  ].filter(([count]) => Number(count) > 0);
  return items.map(([count, singular, plural]) => `${count} ${Number(count) === 1 ? singular : plural}`).join(", ");
}

async function inspectApplicationUsage(applicationId) {
  const response = await fetch(`/api/partner-admin-usage?id=${encodeURIComponent(applicationId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "Unable to verify whether this partner has associated activity.");
  return result;
}

function confirmApplicationDeletion(application, usageResult) {
  if (!deleteDialog || !deleteMessage) return Promise.resolve(false);
  deleteMessage.textContent = `You’re about to permanently delete ${application.full_name}’s partner application. This cannot be undone. Sent email delivery records are retained as an immutable audit history.`;
  if (deleteImpact) deleteImpact.hidden = !usageResult.used;
  if (deleteImpactSummary) deleteImpactSummary.textContent = usageResult.used ? `Associated records: ${usageSummary(usageResult.usage)}.` : "";
  if (deleteAcknowledge) deleteAcknowledge.checked = false;
  if (deleteConfirm) deleteConfirm.disabled = Boolean(usageResult.used);
  deleteDialog.showModal();
  deleteCancel?.focus();
  return new Promise((resolve) => {
    resolveDeleteConfirmation = resolve;
  });
}

function finishDeleteConfirmation(confirmed) {
  deleteDialog?.close();
  resolveDeleteConfirmation?.(confirmed);
  resolveDeleteConfirmation = null;
}

async function deleteApplication(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("This partner application could not be found.");

  const usageResult = await inspectApplicationUsage(applicationId);
  const confirmed = await confirmApplicationDeletion(application, usageResult);
  if (!confirmed) return;

  const { data, error } = await supabase
    .from("founding_partner_applications")
    .delete()
    .eq("id", applicationId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The application was not deleted. Refresh the page and verify your admin access.");
  await loadApplications();
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  accessToken = context.session?.access_token || "";

  await loadApplications();
  deleteCancel?.addEventListener("click", () => finishDeleteConfirmation(false));
  deleteConfirm?.addEventListener("click", () => finishDeleteConfirmation(true));
  deleteAcknowledge?.addEventListener("change", () => {
    if (deleteConfirm) deleteConfirm.disabled = !deleteAcknowledge.checked;
  });
  deleteDialog?.addEventListener("cancel", (event) => event.preventDefault());
  const requestedProgram = new URLSearchParams(window.location.search).get("program");
  if (["website", "software", "future"].includes(requestedProgram)) {
    programFilter.value = requestedProgram;
    render();
  }
  searchInput.addEventListener("input", render);
  programFilter.addEventListener("change", render);
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
    const button = event.target.closest("[data-save-partner], [data-delete-partner], [data-load-partner-activity], [data-edit-partner-terms], [data-save-partner-terms], [data-manage-partner-email], [data-email-stage], [data-preview-partner-email], [data-send-partner-email]");
    if (!button) return;
    if (button.dataset.loadPartnerActivity) {
      await loadPartnerActivity(button.dataset.loadPartnerActivity, button);
      return;
    }
    if (button.dataset.editPartnerTerms) {
      await editPartnerTerms(button.dataset.editPartnerTerms, button);
      return;
    }
    if (button.dataset.savePartnerTerms) {
      await savePartnerTerms(button.dataset.savePartnerTerms, button);
      return;
    }
    if (button.dataset.managePartnerEmail) {
      await loadPartnerEmail(button.dataset.managePartnerEmail, button);
      return;
    }
    if (button.dataset.emailStage) {
      const workflow = button.closest("[data-partner-email-workflow]");
      switchPartnerEmailStage(workflow.dataset.partnerEmailWorkflow, button.dataset.emailStage);
      return;
    }
    if (button.dataset.previewPartnerEmail) {
      previewPartnerEmail(button.dataset.previewPartnerEmail);
      return;
    }
    if (button.dataset.sendPartnerEmail) {
      await sendPartnerEmail(button.dataset.sendPartnerEmail, button);
      return;
    }
    button.disabled = true;
    try {
      if (button.dataset.savePartner) await saveApplication(button.dataset.savePartner);
      else if (button.dataset.deletePartner) await deleteApplication(button.dataset.deletePartner);
    } catch (error) {
      window.alert(error?.message || "Unable to update this application.");
    } finally {
      button.disabled = false;
    }
  });
  list.addEventListener("change", (event) => {
    const select = event.target.closest("[data-commission-type]");
    if (select) syncTermsRateFields(select.closest("form"));
  });
  list.addEventListener("input", (event) => {
    const form = event.target.closest("[data-partner-email-form]");
    if (form) form.dataset.deliveryKey = "";
  });

  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Partner applications could not be opened.";
});
