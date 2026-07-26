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
let platformAdminInviteUrl = "";
let codebaseHistory = [];

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

function deriveStripeState(item) {
  const hasCustomer = Boolean(item?.customerId);
  const hasSubscription = Boolean(item?.subscriptionId);
  const status = String(item?.status || "").trim().toLowerCase();

  if (hasCustomer && hasSubscription) return "Customer + subscription";
  if (hasCustomer) return "Customer only";

  if (["trialing", "trial", "active"].includes(status)) return "Internal access only";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status)) return "Needs Stripe attention";
  if (["canceled", "cancelled"].includes(status)) return "Canceled";

  return "No Stripe record";
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
    <tr><td><strong>${escapeHtml(item.account)}</strong><br><small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.productLabel)}</td><td>${escapeHtml(item.plan || "—")}</td><td>${escapeHtml(item.status || "—")}</td><td>${escapeHtml(item.usage || "—")}</td><td>${escapeHtml(formatDate(item.periodEnd))}</td><td>${escapeHtml(deriveStripeState(item))}</td></tr>
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

function formatAdminDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function platformAdminRow({ title, meta, action = "", actionLabel = "", id = "" }) {
  return `
    <article class="platform-admin-row">
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(meta)}</p></div>
      ${action && actionLabel && id
        ? `<button class="portal-button portal-button-secondary" type="button" data-platform-admin-action="${escapeHtml(action)}" data-platform-admin-id="${escapeHtml(id)}">${escapeHtml(actionLabel)}</button>`
        : ""}
    </article>
  `;
}

function renderPlatformAdmins(data = {}) {
  const adminList = document.getElementById("platform-admin-list");
  const inviteList = document.getElementById("platform-admin-invite-list");
  if (!adminList || !inviteList) return;

  const admins = Array.isArray(data.admins) ? data.admins : [];
  const invites = Array.isArray(data.invites) ? data.invites : [];
  adminList.innerHTML = admins.length
    ? admins.map((admin) => {
      const role = String(admin.role || "admin");
      const status = String(admin.status || "active");
      return platformAdminRow({
        title: String(admin.email || "Unknown admin"),
        meta: `${role === "owner" ? "Master owner" : "Platform admin"} · ${status}`,
        action: role !== "owner" && status === "active" ? "revoke-admin" : "",
        actionLabel: role !== "owner" && status === "active" ? "Revoke" : "",
        id: String(admin.user_id || ""),
      });
    }).join("")
    : '<p class="platform-admin-empty">No platform admins found.</p>';

  inviteList.innerHTML = invites.length
    ? invites.map((invite) => {
      const status = String(invite.status || "pending");
      return platformAdminRow({
        title: String(invite.email || "Unknown invite"),
        meta: `${status} · expires ${formatAdminDate(invite.expires_at)}`,
        action: status === "pending" ? "revoke-invite" : "",
        actionLabel: status === "pending" ? "Revoke" : "",
        id: String(invite.id || ""),
      });
    }).join("")
    : '<p class="platform-admin-empty">No admin invites yet.</p>';
}

async function loadPlatformAdmins() {
  setStatus("Loading platform admins…");
  try {
    const data = await invoke("list-platform-admins");
    renderPlatformAdmins(data);
    setStatus(`${(data.admins || []).length} platform administrator${(data.admins || []).length === 1 ? "" : "s"} loaded.`, "success");
  } catch (error) {
    document.querySelector(".platform-admin-section")?.classList.add("hidden");
    setStatus(error.message || "Owner admin access is required.", "error");
  }
}

async function createPlatformAdminInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const emailInput = document.getElementById("platform-admin-invite-email");
  const email = String(emailInput?.value || "").trim().toLowerCase();
  if (!email) {
    setStatus("Enter an admin email first.", "error");
    return;
  }

  setStatus("Creating admin invite…");
  try {
    const data = await invoke("create-platform-admin-invite", { email });
    platformAdminInviteUrl = String(data.inviteUrl || "");
    const inviteLink = document.getElementById("platform-admin-invite-link");
    const inviteUrl = document.getElementById("platform-admin-invite-url");
    if (inviteUrl) inviteUrl.textContent = platformAdminInviteUrl;
    inviteLink?.classList.toggle("hidden", !platformAdminInviteUrl);
    form.reset();
    await loadPlatformAdmins();
    setStatus("Admin invite created. Send the secure link to the new administrator.", "success");
  } catch (error) {
    setStatus(error.message || "Unable to create the admin invite.", "error");
  }
}

async function copyPlatformAdminInvite() {
  if (!platformAdminInviteUrl) return;
  try {
    await navigator.clipboard.writeText(platformAdminInviteUrl);
    setStatus("Admin invite link copied.", "success");
  } catch {
    setStatus("Copy failed. Select and copy the displayed invite link.", "error");
  }
}

async function handlePlatformAdminAction(event) {
  const button = event.target.closest("button[data-platform-admin-action]");
  if (!button) return;
  const action = button.dataset.platformAdminAction || "";
  const id = button.dataset.platformAdminId || "";
  if (!id) return;

  button.disabled = true;
  try {
    if (action === "revoke-admin") {
      setStatus("Revoking platform administrator…");
      await invoke("revoke-platform-admin", { userId: id });
      await loadPlatformAdmins();
      setStatus("Platform administrator access revoked.", "success");
    } else if (action === "revoke-invite") {
      setStatus("Revoking admin invite…");
      await invoke("revoke-platform-admin-invite", { inviteId: id });
      await loadPlatformAdmins();
      setStatus("Admin invite revoked.", "success");
    }
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to update platform administrator access.", "error");
  }
}

async function codebaseRequest(path = "", options = {}) {
  const response = await fetch(`/api/codebase-ai${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || "Codebase AI request failed."));
  return data;
}

function renderCodebaseIndex(index = {}) {
  const element = document.getElementById("codebase-ai-index-status");
  if (!element) return;
  const generated = index.generatedAt ? formatDate(index.generatedAt) : "not generated";
  element.textContent = `${Number(index.fileCount || 0).toLocaleString()} indexed files · ${Number(index.chunkCount || 0).toLocaleString()} searchable sections · ${generated}`;
}

function renderSafeMarkdown(value) {
  const inline = (text) => escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const output = [];
  let listType = "";

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s*(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        output.push("<ol>");
      }
      output.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    const bullet = line.match(/^[*-]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        output.push("<ul>");
      }
      output.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return output.join("");
}

function renderCodebaseAnswer(data = {}) {
  const answer = document.getElementById("codebase-ai-answer");
  const text = document.getElementById("codebase-ai-answer-text");
  const sources = document.getElementById("codebase-ai-sources");
  const sourceList = document.getElementById("codebase-ai-source-list");
  if (!answer || !text || !sources || !sourceList) return;
  text.innerHTML = renderSafeMarkdown(data.answer || "");
  const list = Array.isArray(data.sources) ? data.sources : [];
  sourceList.innerHTML = list.map((source) => `<li>${escapeHtml(source)}</li>`).join("");
  sources.classList.toggle("hidden", !list.length);
  answer.classList.remove("hidden");
  renderCodebaseIndex(data.index || {});
}

async function askCodebase(event) {
  event.preventDefault();
  const input = document.getElementById("codebase-ai-question");
  const submit = document.getElementById("codebase-ai-submit");
  const question = String(input?.value || "").trim();
  if (!question) return;
  submit.disabled = true;
  setStatus("Searching the private codebase and preparing an answer…");
  try {
    const data = await codebaseRequest("", {
      method: "POST",
      body: JSON.stringify({ question, history: codebaseHistory }),
    });
    renderCodebaseAnswer(data);
    codebaseHistory = [...codebaseHistory, { role: "user", content: question }, { role: "assistant", content: data.answer }].slice(-8);
    setStatus("Answer grounded in the current private code index.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function loadCodebaseAi() {
  document.getElementById("codebase-ai-form")?.addEventListener("submit", askCodebase);
  const data = await codebaseRequest("", { method: "GET" });
  renderCodebaseIndex(data.index || {});
  setStatus("Private codebase index ready.", "success");
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
  } else if (view === "platform-admins") {
    document.getElementById("platform-admin-invite-form")?.addEventListener("submit", createPlatformAdminInvite);
    document.getElementById("platform-admin-refresh")?.addEventListener("click", loadPlatformAdmins);
    document.getElementById("platform-admin-copy-invite")?.addEventListener("click", copyPlatformAdminInvite);
    document.getElementById("platform-admin-list")?.addEventListener("click", handlePlatformAdminAction);
    document.getElementById("platform-admin-invite-list")?.addEventListener("click", handlePlatformAdminAction);
    await loadPlatformAdmins();
  } else if (view === "codebase-ai") {
    await loadCodebaseAi();
  }
}

init().catch((error) => setStatus(error.message || "Unable to load admin app.", "error"));
