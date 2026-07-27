import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";
import { arrangeAdminWorkspace } from "/account/admin/admin-navigation.js?v=4";

let view = "";
let setupPanel = null;
let adminPanel = null;
let signOutButton = null;
let statusEl = null;
let supabase = null;
let session = null;
let accounts = [];
let billing = [];
let supportRequests = [];
let platformAdminInviteUrl = "";
let codebaseHistory = [];

function bindAdminDom() {
  view = document.body.dataset.adminView || "";
  setupPanel = document.getElementById("setup-panel");
  adminPanel = document.getElementById("admin-panel");
  signOutButton = document.getElementById("admin-sign-out");
  statusEl = document.getElementById("admin-status");
}

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

async function renderSelectedAccount() {
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

  try {
    const { data: loan, error } = await supabase
      .from("loan_accounts")
      .select("id,borrower_name,lender_name,original_balance,planned_monthly_payment,status")
      .eq("user_id", account.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!loan || document.getElementById("account-select")?.value !== account.id) return;
    const grid = detail.querySelector(".account-admin-card-grid");
    grid?.insertAdjacentHTML("beforeend", `
      <article class="account-access-card">
        <span>Loan Tracker</span>
        <h4>${escapeHtml(loan.lender_name || "Loan account")}</h4>
        <p>${Number(loan.original_balance).toLocaleString("en-US", { style: "currency", currency: "USD" })} original · ${Number(loan.planned_monthly_payment).toLocaleString("en-US", { style: "currency", currency: "USD" })}/month</p>
        <a class="portal-button portal-button-secondary" href="/account/loan-tracker/?user=${encodeURIComponent(account.id)}">Open Loan Tracker</a>
      </article>
    `);
  } catch (error) {
    setStatus(error.message || "Unable to load Loan Tracker access.", "error");
  }
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
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const output = [];
  let listType = "";
  let codeLines = null;

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^```/.test(line)) {
      if (codeLines) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(rawLine.replace(/^\s{0,4}/, ""));
      continue;
    }

    if (!line) {
      closeList();
      continue;
    }

    if (/^\|.*\|$/.test(line)) {
      closeList();
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean);
      if (!cells.length || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      const [label, ...details] = cells;
      output.push(`<p><strong>${inline(label)}</strong>${details.length ? ` — ${details.map(inline).join(" · ")}` : ""}</p>`);
      continue;
    }

    if (/^(---+|___+|\*\*\*+)$/.test(line)) {
      closeList();
      output.push("<hr>");
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
  if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
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

async function analyticsRequest(days, force = false) {
  const params = new URLSearchParams({ days: String(days) });
  if (force) params.set("refresh", "1");
  const response = await fetch(`/api/vercel-analytics?${params}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.error || "Analytics could not be loaded."));
    error.code = String(data?.code || "");
    error.missing = Array.isArray(data?.missing) ? data.missing : [];
    throw error;
  }
  return data;
}

function formatAnalyticsNumber(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits });
}

function analyticsLabel(value, fallback = "Unknown") {
  const label = String(value || "").trim();
  if (!label || label.toLowerCase() === "null") return fallback;
  return label.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderAnalyticsList(id, rows, key, metric = "pageviews", fallback = "No data recorded", available = true) {
  const container = document.getElementById(id);
  if (!container) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    container.innerHTML = `<p class="analytics-empty${available ? "" : " is-unavailable"}">${escapeHtml(available ? fallback : "Temporarily unavailable")}</p>`;
    return;
  }
  const maximum = Math.max(...list.map((row) => Number(row?.[metric] || 0)), 1);
  container.innerHTML = list.map((row) => {
    const value = Number(row?.[metric] || 0);
    const rawLabel = row?.[key];
    const label = key === "requestPath"
      ? String(rawLabel || "/")
      : analyticsLabel(rawLabel, key === "referrerHostname" ? "Direct / none" : "Unknown");
    const width = Math.max(4, Math.round((value / maximum) * 100));
    return `
      <div class="analytics-list-row">
        <div><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><strong>${formatAnalyticsNumber(value)}</strong></div>
        <div class="analytics-list-bar"><i style="width:${width}%"></i></div>
      </div>
    `;
  }).join("");
}

function renderAnalyticsChart(rows) {
  const chart = document.getElementById("analytics-chart");
  if (!chart) return;
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) {
    chart.innerHTML = '<p class="analytics-empty">No traffic was recorded in this timeframe.</p>';
    return;
  }

  const width = 1000;
  const height = 230;
  const left = 18;
  const right = 982;
  const top = 20;
  const bottom = 190;
  const maximum = Math.max(...data.map((row) => Number(row?.pageviews || 0)), 1);
  const points = data.map((row, index) => {
    const x = data.length === 1 ? width / 2 : left + ((right - left) * index) / (data.length - 1);
    const y = bottom - ((bottom - top) * Number(row?.pageviews || 0)) / maximum;
    return { x, y, value: Number(row?.pageviews || 0), timestamp: row?.timestamp };
  });
  const pointString = points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaString = `${left},${bottom} ${pointString} ${right},${bottom}`;
  const firstDate = formatDate(points[0]?.timestamp).split(",")[0];
  const lastDate = formatDate(points.at(-1)?.timestamp).split(",")[0];

  chart.setAttribute("aria-label", `Daily page views from ${firstDate} through ${lastDate}. Peak ${formatAnalyticsNumber(maximum)} page views.`);
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${left}" y1="${top}" x2="${right}" y2="${top}" class="analytics-chart-grid"></line>
      <line x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" class="analytics-chart-grid"></line>
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="analytics-chart-grid"></line>
      <polygon points="${areaString}" class="analytics-chart-area"></polygon>
      <polyline points="${pointString}" class="analytics-chart-line"></polyline>
    </svg>
    <div class="analytics-chart-scale"><span>${escapeHtml(firstDate)}</span><strong>Peak ${formatAnalyticsNumber(maximum)}</strong><span>${escapeHtml(lastDate)}</span></div>
  `;
}

function renderAnalyticsConfiguration(error) {
  const configuration = document.getElementById("analytics-configuration");
  const dashboard = document.getElementById("analytics-dashboard");
  const missing = document.getElementById("analytics-missing-config");
  if (!configuration || !dashboard || !missing) return;
  missing.innerHTML = (error.missing || []).map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("");
  configuration.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function renderAnalytics(data = {}) {
  document.getElementById("analytics-configuration")?.classList.add("hidden");
  document.getElementById("analytics-dashboard")?.classList.remove("hidden");
  const totals = data.totals || {};
  document.getElementById("analytics-visitors").textContent = formatAnalyticsNumber(totals.visitors);
  document.getElementById("analytics-pageviews").textContent = formatAnalyticsNumber(totals.pageviews);
  document.getElementById("analytics-pages-per-visitor").textContent = formatAnalyticsNumber(totals.pagesPerVisitor, 2);
  document.getElementById("analytics-events").textContent = formatAnalyticsNumber(totals.events);
  const updated = document.getElementById("analytics-updated");
  if (updated) {
    updated.textContent = `${data.period?.label || "Current range"} · Updated ${formatDate(data.generatedAt)}${data.cached ? " · cached" : ""}`;
  }
  renderAnalyticsChart(data.trend);
  const availability = data.availability || {};
  renderAnalyticsList("analytics-pages", data.breakdowns?.pages, "requestPath", "visitors", "No data recorded", availability.pages !== "unavailable");
  renderAnalyticsList("analytics-referrers", data.breakdowns?.referrers, "referrerHostname", "visitors", "No data recorded", availability.referrers !== "unavailable");
  renderAnalyticsList("analytics-countries", data.breakdowns?.countries, "country", "visitors", "No data recorded", availability.countries !== "unavailable");
  renderAnalyticsList("analytics-devices", data.breakdowns?.devices, "deviceType", "visitors", "No data recorded", availability.devices !== "unavailable");
  renderAnalyticsList("analytics-event-list", data.breakdowns?.events, "eventName", "count", "No custom events recorded", availability.events !== "unavailable");
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  const unavailableCount = Object.values(availability).filter((value) => value === "unavailable").length;
  setStatus(
    warnings.length
      ? `Traffic loaded. ${unavailableCount || "One or more"} detailed ${unavailableCount === 1 ? "panel is" : "panels are"} temporarily unavailable.`
      : "Analytics loaded.",
    warnings.length ? "" : "success",
  );
}

async function loadAnalytics(force = false) {
  const range = document.getElementById("analytics-range");
  const refresh = document.getElementById("analytics-refresh");
  const days = Number(range?.value || 30);
  if (range) range.disabled = true;
  if (refresh) refresh.disabled = true;
  setStatus("Loading Vercel Analytics…");
  try {
    renderAnalytics(await analyticsRequest(days, force));
  } catch (error) {
    if (error.code === "vercel_analytics_not_configured") renderAnalyticsConfiguration(error);
    setStatus(error.message, "error");
  } finally {
    if (range) range.disabled = false;
    if (refresh) refresh.disabled = false;
  }
}

async function loadAnalyticsView() {
  document.getElementById("analytics-range")?.addEventListener("change", () => loadAnalytics(false));
  document.getElementById("analytics-refresh")?.addEventListener("click", () => loadAnalytics(true));
  await loadAnalytics(false);
}

const investmentLabels = { shareholders: "Shareholders table", "share-classes": "Share Classes", "share-ledger": "Share Ledger", "board-resolutions": "Board Resolutions", "dividend-history": "Dividend History", "cap-table": "Cap Table", "valuation-history": "Company Valuation History", vesting: "Vesting Schedules", voting: "Voting Rights", certificates: "Stock Certificates", transfers: "Share Transfer Requests", buybacks: "Company Buyback Requests" };

const productAdminApps = {
  websites: {
    label: "Website Admin",
    sections: {
      overview: ["Website Overview", "Manage client websites, access, files, and lifecycle records.", "/n3xra-admin/websites/"],
      services: ["Services & Ownership", "Manage services, ownership, and related website records.", "/n3xra-admin/services/"],
      requests: ["Website Requests", "Review incoming website requests and their next steps.", "/n3xra-admin/requests/"],
      proposals: ["Website Proposals", "Review proposals and their project context.", "/n3xra-admin/proposals/"],
      progress: ["Website Progress", "Follow active website project progress.", "/n3xra-admin/projects/"],
      onboarding: ["Website Onboarding", "Manage website onboarding workflows.", "/n3xra-admin/onboarding/"],
      assets: ["Files & Assets", "Manage website files and assets.", "/n3xra-admin/assets/"],
      billing: ["Website Billing", "Review website billing records.", "/n3xra-admin/billing/"],
    },
  },
  records: {
    label: "Records Admin",
    sections: {
      organizations: ["Records Organizations", "Manage Records plans, limits, features, trials, and owner support.", "/n3xra-admin/records/organizations/"],
      usage: ["Records Usage", "Review Records usage and limits.", "/n3xra-admin/records/usage/"],
    },
  },
  utilities: {
    label: "Utilities Admin",
    sections: {
      organizations: ["Utility Organizations", "Review utility organizations, portals, and launch readiness.", "/n3xra-admin/utilities/"],
      onboarding: ["Utility Onboarding", "Manage utility onboarding workflows.", "/utilities/onboarding/"],
    },
  },
  partners: {
    label: "Partner Admin",
    sections: {
      applications: ["Partner Applications", "Review partner program interest and application decisions.", "/n3xra-admin/partners/"],
    },
  },
};

const embeddedProductStyles = `
  .site-topbar, .site-mobile-menu, .portal-nav, .site-footer { display: none !important; }
  html, body { min-height: 100%; background: #fff; }
  main.portal-shell { width: 100% !important; max-width: none !important; min-height: 100%; margin: 0 !important; padding: 0 !important; }
  .portal-layout { grid-template-columns: minmax(0, 1fr) !important; gap: 0 !important; width: 100% !important; }
  .portal-layout > .portal-workspace { min-width: 0; }
  .utilities-shell, .utilities-onboarding-page { width: 100% !important; max-width: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
  body.utilities-onboarding { background: #07111d !important; }
`;

function fitProductFrame(frame, doc) {
  const height = Math.max(
    doc.documentElement?.scrollHeight || 0,
    doc.body?.scrollHeight || 0,
    doc.documentElement?.offsetHeight || 0,
    doc.body?.offsetHeight || 0,
  );
  frame.style.height = `${Math.max(height, 520)}px`;
}

function embedProductFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc?.head || !doc.body) return;
    doc.body.classList.add("n3xra-embedded-product");
    let style = doc.getElementById("n3xra-embedded-product-styles");
    if (!style) {
      style = doc.createElement("style");
      style.id = "n3xra-embedded-product-styles";
      style.textContent = embeddedProductStyles;
      doc.head.append(style);
    }
    frame.__n3xraProductResizeObserver?.disconnect?.();
    const resize = () => requestAnimationFrame(() => fitProductFrame(frame, doc));
    resize();
    if (doc.defaultView?.ResizeObserver) {
      const observer = new doc.defaultView.ResizeObserver(resize);
      observer.observe(doc.documentElement);
      observer.observe(doc.body);
      frame.__n3xraProductResizeObserver = observer;
    }
    frame.classList.remove("hidden");
    frame.classList.add("is-ready");
  } catch {
    // Product workspaces are same-origin. If that ever changes, leave the original page intact.
    frame.classList.remove("hidden");
  }
}

function loadProductAdminApp() {
  const params = new URLSearchParams(window.location.search);
  const app = productAdminApps[params.get("app")];
  const sectionKey = params.get("section");
  const section = app?.sections?.[sectionKey] || app?.sections?.[Object.keys(app.sections)[0]];
  if (!app || !section) return;
  window.location.replace(section[2]);
}

function selectInvestmentSection() {
  if (document.body.dataset.adminView !== "investment") return;
  const key = window.location.hash.slice(1);
  const label = investmentLabels[key];
  document.querySelectorAll("[data-investment-section]").forEach((link) => link.classList.toggle("is-current", link.dataset.investmentSection === key));
  if (!label) return;
  document.getElementById("investment-workspace-title").textContent = label;
  document.getElementById("investment-workspace-copy").textContent = "This workspace is reserved for the future controlled record and workflow.";
  document.getElementById("investment-empty-title").textContent = `${label} is not active`;
  document.getElementById("investment-empty-copy").textContent = "No records, controls, or workflows have been activated. This area will remain blank until the appropriate legal, accounting, and governance foundation is in place.";
}

window.addEventListener("hashchange", selectInvestmentSection);

async function loadAdminView() {
  if (view === "accounts") {
    document.getElementById("account-search")?.addEventListener("input", (event) => renderAccountOptions(event.target.value));
    document.getElementById("account-select")?.addEventListener("change", renderSelectedAccount);
    await loadAccounts();
  } else if (view === "billing") {
    document.getElementById("billing-filter")?.addEventListener("input", renderBilling);
    document.getElementById("billing-product")?.addEventListener("change", renderBilling);
    await loadBilling();
  } else if (view === "operations") {
    const operations = await import("/account/admin/operations/operations.js?v=4");
    await operations.startOperations({ supabase, session, invoke });
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
  } else if (view === "analytics") {
    await loadAnalyticsView();
  } else if (view === "investment") {
    selectInvestmentSection();
  } else if (view === "product-apps") {
    loadProductAdminApp();
  }
}

export async function startAdmin() {
  bindAdminDom();
  if (!hasConfig()) {
    setupPanel?.classList.remove("hidden");
    return;
  }
  if (!supabase) supabase = createBrowserSupabase();
  if (!session) session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  if (!isPlatformAdminEmail(session.user.email)) {
    try { await invoke("get-platform-admin-access"); } catch { window.location.replace("/account"); return; }
  }
  adminPanel?.classList.remove("hidden");
  arrangeAdminWorkspace();
  if (signOutButton && !signOutButton.dataset.adminSignoutBound) {
    signOutButton.dataset.adminSignoutBound = "true";
    signOutButton.addEventListener("click", async () => {
      await supabase.auth.signOut({ scope: "local" });
      window.location.replace("/account");
    });
  }
  await loadAdminView();
}

if (!window.__n3xraAdminSoftNavigation) {
  startAdmin().catch((error) => setStatus(error.message || "Unable to load admin app.", "error"));
}
