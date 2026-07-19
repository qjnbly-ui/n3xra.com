import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const view = document.body.dataset.adminView || "";
const setupPanel = document.getElementById("setup-panel");
const adminPanel = document.getElementById("admin-panel");
const signOutButton = document.getElementById("admin-sign-out");
const statusEl = document.getElementById("admin-status");
let supabase = null;
let session = null;
let accounts = [];
let billing = [];
let supportRequests = [];

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function setStatus(message = "", tone = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action, ...payload } });
  if (error || data?.error) throw new Error(error?.message || data?.error || "Admin request failed.");
  return data;
}

function accountLabel(account) {
  return `${account.name || account.email} — ${account.email}`;
}

function renderAccountOptions(filter = "") {
  const select = document.getElementById("account-select");
  if (!select) return;
  const query = filter.trim().toLowerCase();
  const filtered = accounts.filter((account) => !query || accountLabel(account).toLowerCase().includes(query));
  const current = select.value;
  select.innerHTML = filtered.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(accountLabel(account))}</option>`).join("");
  if (filtered.some((account) => account.id === current)) select.value = current;
  renderSelectedAccount();
}

function renderSelectedAccount() {
  const select = document.getElementById("account-select");
  const detail = document.getElementById("account-detail");
  if (!select || !detail) return;
  const account = accounts.find((item) => item.id === select.value);
  if (!account) {
    detail.innerHTML = '<div class="account-admin-section">No account selected.</div>';
    return;
  }
  const access = Array.isArray(account.access) ? account.access : [];
  detail.innerHTML = `
    <div class="account-admin-detail-head">
      <div><p class="portal-kicker">Selected account</p><h3>${escapeHtml(account.name || account.email)}</h3><p>${escapeHtml(account.email)}</p></div>
      <button class="portal-button portal-button-secondary" id="account-reset-password" type="button">Send password reset</button>
    </div>
    <div class="account-admin-facts">
      <div class="account-admin-fact"><span>Created</span><strong>${escapeHtml(formatDate(account.createdAt))}</strong></div>
      <div class="account-admin-fact"><span>Last sign in</span><strong>${escapeHtml(formatDate(account.lastSignInAt))}</strong></div>
      <div class="account-admin-fact"><span>Email</span><strong>${account.emailConfirmedAt ? "Confirmed" : "Not confirmed"}</strong></div>
    </div>
    <div class="account-admin-card-grid">
      ${access.length ? access.map((item) => `<article class="account-access-card"><span>${escapeHtml(item.productLabel)}</span><h4>${escapeHtml(item.organization || item.plan || "Product account")}</h4><p>${escapeHtml(item.role || "account")} · ${escapeHtml(item.status || "active")}</p></article>`).join("") : '<article class="account-access-card"><h4>No product access found</h4><p>This identity has no mapped product memberships.</p></article>'}
    </div>
  `;
  document.getElementById("account-reset-password")?.addEventListener("click", async () => {
    setStatus("Sending password reset…");
    try {
      await invoke("reset-password", { email: account.email });
      setStatus(`Password reset sent to ${account.email}.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

async function loadAccounts() {
  setStatus("Loading accounts…");
  const data = await invoke("list-platform-accounts");
  accounts = data.accounts || [];
  renderAccountOptions();
  setStatus(`${accounts.length} account${accounts.length === 1 ? "" : "s"} loaded.`, "success");
}

function renderBilling() {
  const table = document.getElementById("billing-list");
  if (!table) return;
  const query = String(document.getElementById("billing-filter")?.value || "").trim().toLowerCase();
  const product = document.getElementById("billing-product")?.value || "all";
  const rows = billing.filter((item) => (product === "all" || item.product === product) && (!query || [item.account, item.email, item.plan, item.status].join(" ").toLowerCase().includes(query)));
  table.innerHTML = rows.length ? rows.map((item) => `
    <tr><td><strong>${escapeHtml(item.account)}</strong><br><small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.productLabel)}</td><td>${escapeHtml(item.plan || "—")}</td><td>${escapeHtml(item.status || "—")}</td><td>${escapeHtml(item.usage || "—")}</td><td>${escapeHtml(formatDate(item.periodEnd))}</td><td>${item.subscriptionId ? "Connected" : "Not connected"}</td></tr>
  `).join("") : '<tr><td colspan="7">No billing accounts match this view.</td></tr>';
}

async function loadBilling() {
  setStatus("Loading billing accounts…");
  const data = await invoke("list-platform-billing");
  billing = data.billing || [];
  renderBilling();
  setStatus(`${billing.length} billing account${billing.length === 1 ? "" : "s"} loaded.`, "success");
}

function supportLabel(request) {
  return `${request.subject} — ${request.requester_name} (${request.status})`;
}

function renderSupportOptions() {
  const select = document.getElementById("support-select");
  if (!select) return;
  const status = document.getElementById("support-filter")?.value || "open";
  const filtered = supportRequests.filter((item) => status === "all" || (status === "open" ? !["resolved", "closed"].includes(item.status) : item.status === status));
  const current = select.value;
  select.innerHTML = filtered.map((request) => `<option value="${escapeHtml(request.id)}">${escapeHtml(supportLabel(request))}</option>`).join("");
  if (filtered.some((request) => request.id === current)) select.value = current;
  renderSelectedSupport();
}

function renderSelectedSupport() {
  const select = document.getElementById("support-select");
  const detail = document.getElementById("support-detail");
  if (!select || !detail) return;
  const request = supportRequests.find((item) => item.id === select.value);
  if (!request) {
    detail.innerHTML = '<div class="account-admin-section">No support requests in this view.</div>';
    return;
  }
  detail.innerHTML = `
    <div class="account-admin-detail-head"><div><p class="portal-kicker">${escapeHtml(request.topic)}</p><h3>${escapeHtml(request.subject)}</h3><p>${escapeHtml(request.requester_name)} · ${escapeHtml(request.requester_email)} · ${escapeHtml(formatDate(request.created_at))}</p></div><a class="portal-button portal-button-secondary" href="mailto:${escapeHtml(request.requester_email)}">Reply by email</a></div>
    <div class="support-message">${escapeHtml(request.message)}</div>
    <form class="account-admin-form" id="support-update-form">
      <div class="account-admin-form-row">
        <label class="account-admin-field"><span>Status</span><select id="support-status">${["new","in_progress","waiting","resolved","closed"].map((value) => `<option value="${value}"${request.status === value ? " selected" : ""}>${value.replaceAll("_"," ")}</option>`).join("")}</select></label>
        <label class="account-admin-field"><span>Priority</span><select id="support-priority">${["low","normal","high","urgent"].map((value) => `<option value="${value}"${request.priority === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>
      </div>
      <label class="account-admin-field"><span>Internal notes</span><textarea id="support-notes" rows="6">${escapeHtml(request.internal_notes || "")}</textarea></label>
      <div class="account-admin-actions"><button class="portal-button" type="submit">Save request</button></div>
    </form>
  `;
  document.getElementById("support-update-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Saving support request…");
    try {
      const data = await invoke("update-support-request", {
        requestId: request.id,
        status: document.getElementById("support-status").value,
        priority: document.getElementById("support-priority").value,
        internalNotes: document.getElementById("support-notes").value,
      });
      supportRequests = supportRequests.map((item) => item.id === request.id ? { ...item, ...data.request } : item);
      renderSupportOptions();
      setStatus("Support request updated.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

async function loadSupport() {
  setStatus("Loading support requests…");
  const data = await invoke("list-support-requests");
  supportRequests = data.requests || [];
  renderSupportOptions();
  setStatus(`${supportRequests.length} support request${supportRequests.length === 1 ? "" : "s"} loaded.`, "success");
}

async function init() {
  if (!hasConfig()) {
    setupPanel?.classList.remove("hidden");
    return;
  }
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  if (!isPlatformAdminEmail(session.user.email)) {
    try { await invoke("get-platform-admin-access"); } catch { window.location.replace("/account"); return; }
  }
  adminPanel?.classList.remove("hidden");
  signOutButton?.addEventListener("click", async () => {
    await supabase.auth.signOut({ scope: "local" });
    window.location.replace("/account");
  });
  if (view === "accounts") {
    document.getElementById("account-search")?.addEventListener("input", (event) => renderAccountOptions(event.target.value));
    document.getElementById("account-select")?.addEventListener("change", renderSelectedAccount);
    await loadAccounts();
  } else if (view === "billing") {
    document.getElementById("billing-filter")?.addEventListener("input", renderBilling);
    document.getElementById("billing-product")?.addEventListener("change", renderBilling);
    await loadBilling();
  } else if (view === "support") {
    document.getElementById("support-filter")?.addEventListener("change", renderSupportOptions);
    document.getElementById("support-select")?.addEventListener("change", renderSelectedSupport);
    await loadSupport();
  }
}

init().catch((error) => setStatus(error.message || "Unable to load admin app.", "error"));
