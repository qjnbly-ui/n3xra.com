let platformAdminDirectory = { admins: [], invites: [] };
let platformAdminCandidates = [];
let selectedPlatformAdminKey = "";
let invoke;
let escapeHtml;
let setStatus;
let confirmAdminAction;

function setPlatformAdminModalStatus(message = "", tone = "") {
  const status = document.getElementById("platform-admin-modal-status");
  if (!status) return;
  status.textContent = message;
  status.className = "platform-admin-modal-status";
  if (tone) status.classList.add(`is-${tone}`);
}

async function openPlatformAdminInviteDialog() {
  const dialog = document.getElementById("platform-admin-invite-dialog");
  if (!(dialog instanceof HTMLDialogElement)) return;
  document.getElementById("platform-admin-invite-form")?.reset();
  renderPlatformAdminCandidateOptions();
  setPlatformAdminModalStatus();
  if (!dialog.open) dialog.showModal();
  try {
    await loadPlatformAdminCandidates();
    requestAnimationFrame(() => document.querySelector("#platform-admin-invite-account + .admin-select .admin-select-trigger")?.focus());
  } catch (error) {
    setPlatformAdminModalStatus(error.message || "Unable to load N3XRA accounts.", "error");
  }
}

function closePlatformAdminInviteDialog() {
  const dialog = document.getElementById("platform-admin-invite-dialog");
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
}

function formatAdminDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function platformAdminInitials(email) {
  return String(email || "?").split("@")[0].split(/[._-]+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function platformAdminEntry(key) {
  const [type, id] = String(key || "").split(":");
  if (type === "admin") return { type, item: platformAdminDirectory.admins.find((admin) => String(admin.user_id) === id) };
  if (type === "invite") return { type, item: platformAdminDirectory.invites.find((invite) => String(invite.id) === id) };
  return { type: "", item: null };
}

function effectivePlatformAdminRole(item) {
  if (String(item?.role || "") === "sales_rep") return "sales_rep";
  return String(item?.role || "admin") === "admin" && String(item?.access_scope || "full") === "operations"
    ? "operations_admin"
    : String(item?.role || "admin");
}

function candidateAccessLabel(candidate) {
  if (candidate.access === "owner") return "Master owner";
  if (candidate.access === "admin") return "Platform administrator";
  if (candidate.access === "operations_admin") return "Operations administrator";
  if (candidate.access === "sales_rep") return "Partner / Sales Representative";
  if (candidate.access === "reviewer") return "App reviewer";
  if (candidate.access === "pending") return "Invitation pending";
  return "Available";
}

const customerDashboardAreas = [
  ["N3XRA Records", "Document and organization workspace"],
  ["N3XRA Communications", "Email and text communications"],
  ["N3XRA Project Cards", "Project pages and physical cards"],
  ["Files & Assets", "Private organization file library"],
  ["N3XRA Website Portal", "Website request and project workspace"],
  ["N3XRA Contact Card", "Contact profile and tap card"],
];

const fullAdminAreas = [
  "Sales Leads", "Admin Inbox", "Accounts", "Support Requests", "Billing & Plans", "Financial Operations",
  "Site Analytics", "Career Applications", "Company Information", "Internal Files", "Strategy & Policies",
  "Codebase AI", "Calls & Messages", "Account Announcements", "Ownership & Governance", "Websites", "Records",
  "Partners", "Communications", "Contact Cards", "Project Cards",
];
const operationsAdminAreas = [
  "Sales Leads", "Admin Inbox", "Accounts", "Support Requests", "Billing & Plans", "Financial Operations",
  "Site Analytics", "Career Applications", "Company Information", "Internal Files", "Calls & Messages",
  "Account Announcements", "Websites", "Records", "Communications", "Contact Cards",
];

function previewAreaCard(title, description, options = {}) {
  const action = options.href
    ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(options.href)}"${options.newTab ? ' target="_blank" rel="noopener"' : ""}>${escapeHtml(options.label || `Open ${title}`)}</a>`
    : '<span class="platform-dashboard-preview-private">Structure only</span>';
  return `<article class="platform-dashboard-preview-card"><div><span>${escapeHtml(options.kicker || "App area")}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>${action}</article>`;
}

function renderDashboardPreview(data = {}) {
  const target = document.getElementById("platform-dashboard-preview-content");
  if (!target) return;
  const role = effectivePlatformAdminRole(data);
  const staffLabel = role === "sales_rep" ? "Sales" : role === "reviewer" ? "Review app" : "Admin";
  const partnerHref = data.partner_application_id
    ? `/client-portal/partners/?admin_preview=${encodeURIComponent(data.partner_application_id)}`
    : "/n3xra-admin/partners/";
  const staffAreas = role === "sales_rep"
    ? [previewAreaCard("Sales Leads", "Shared leads, notes, business-card scans, and lead status.", { href: "/account/admin/prospects/", label: "Open Sales Leads", kicker: "Live shared workspace", newTab: true })]
    : role === "reviewer"
      ? [previewAreaCard("N3XRA Admin mobile review", "Synthetic review data only. This role does not receive the web administration dashboard.", { kicker: "Review-only role" })]
      : (role === "operations_admin" ? operationsAdminAreas : fullAdminAreas).map((area) => previewAreaCard(area, "This workspace appears in the staff dashboard for this role.", { kicker: "Staff workspace" }));
  const partnerCard = previewAreaCard("N3XRA Partners", "Referral identity, referrals, commission balances, and commission history.", { href: partnerHref, label: data.partner_application_id ? "Open read-only preview" : "Open Partner Admin", kicker: data.partner_application_id ? "Connected partner" : "Partner program", newTab: true });

  target.innerHTML = `
    <div class="platform-dashboard-preview-account"><span class="platform-admin-roster-avatar">${escapeHtml(platformAdminInitials(data.email))}</span><div><strong>${escapeHtml(data.email || "Account")}</strong><p>Structure preview · no impersonation · no personal product records loaded</p></div></div>
    <div class="platform-dashboard-preview-switch" role="tablist" aria-label="Dashboard view"><button class="is-active" type="button" role="tab" aria-selected="true" data-dashboard-preview-tab="products">My products</button><button type="button" role="tab" aria-selected="false" data-dashboard-preview-tab="staff">${escapeHtml(staffLabel)}</button></div>
    <section class="platform-dashboard-preview-panel" data-dashboard-preview-panel="products">
      <div class="platform-dashboard-preview-heading"><span>Dashboard structure</span><h3>Your products</h3><p>Personal enrollment status and private product content are intentionally omitted.</p></div>
      <div class="platform-dashboard-preview-grid">${customerDashboardAreas.map(([title, description]) => previewAreaCard(title, description)).join("")}</div>
      <div class="platform-dashboard-preview-heading"><span>More from N3XRA</span><h3>Programs and updates</h3></div>
      <div class="platform-dashboard-preview-grid">${partnerCard}${previewAreaCard("N3XRA Ownership Updates", "Company and ownership information list.", { kicker: "Company updates" })}</div>
    </section>
    <section class="platform-dashboard-preview-panel hidden" data-dashboard-preview-panel="staff">
      <div class="platform-dashboard-preview-heading"><span>${role === "sales_rep" ? "Sales workspace" : "Staff workspace"}</span><h3>${role === "sales_rep" ? "Partner / Sales Representative" : role === "reviewer" ? "App reviewer" : "Run N3XRA"}</h3><p>${role === "sales_rep" ? "This is the complete staff-side structure Lindsey sees." : "These are the workspaces visible to this role."}</p></div>
      <div class="platform-dashboard-preview-grid">${staffAreas.join("")}</div>
    </section>`;
}

async function openDashboardPreview(accountUserId) {
  const dialog = document.getElementById("platform-dashboard-preview-dialog");
  const content = document.getElementById("platform-dashboard-preview-content");
  if (!(dialog instanceof HTMLDialogElement) || !content) return;
  content.innerHTML = '<div class="platform-dashboard-preview-loading">Building the safe dashboard structure preview…</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const data = await invoke("get-platform-admin-structure-preview", { accountUserId });
    renderDashboardPreview(data.preview || {});
  } catch (error) {
    content.innerHTML = `<div class="platform-dashboard-preview-loading is-error">${escapeHtml(error.message || "Unable to load dashboard preview.")}</div>`;
  }
}

function closeDashboardPreview() {
  const dialog = document.getElementById("platform-dashboard-preview-dialog");
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
}

function selectDashboardPreviewTab(tabName) {
  document.querySelectorAll("[data-dashboard-preview-tab]").forEach((button) => {
    const active = button.dataset.dashboardPreviewTab === tabName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-dashboard-preview-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.dashboardPreviewPanel !== tabName));
}

function renderSelectedPlatformAdminCandidate() {
  const select = document.getElementById("platform-admin-invite-account");
  const detail = document.getElementById("platform-admin-selected-account");
  if (!select || !detail) return;
  const candidate = platformAdminCandidates.find((account) => String(account.id) === String(select.value));
  detail.classList.toggle("hidden", !candidate);
  detail.innerHTML = candidate ? `<span class="platform-admin-roster-avatar" aria-hidden="true">${escapeHtml(platformAdminInitials(candidate.name || candidate.email))}</span><div><strong>${escapeHtml(candidate.name || candidate.email)}</strong><p>${escapeHtml(candidate.email)}</p><small>Access will be granted directly to account ${escapeHtml(candidate.id)}.</small></div>` : "";
}

function renderPlatformAdminCandidateOptions() {
  const select = document.getElementById("platform-admin-invite-account");
  if (!select) return;
  const current = select.value;
  const availableCount = platformAdminCandidates.filter((candidate) => candidate.access === "available").length;
  const placeholder = platformAdminCandidates.length
    ? `Choose from ${availableCount} available account${availableCount === 1 ? "" : "s"}`
    : "Loading accounts…";
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${platformAdminCandidates.map((candidate) => {
    const disabled = candidate.access !== "available";
    const label = `${candidate.name || candidate.email} — ${candidate.email}${disabled ? ` (${candidateAccessLabel(candidate)})` : ""}`;
    return `<option value="${escapeHtml(candidate.id)}"${disabled ? " disabled" : ""}>${escapeHtml(label)}</option>`;
  }).join("")}`;
  if (platformAdminCandidates.some((candidate) => candidate.id === current && candidate.access === "available")) select.value = current;
  renderSelectedPlatformAdminCandidate();
}

async function loadPlatformAdminCandidates() {
  const select = document.getElementById("platform-admin-invite-account");
  if (select) select.disabled = true;
  try {
    const data = await invoke("list-platform-admin-candidates");
    platformAdminCandidates = Array.isArray(data.accounts) ? data.accounts : [];
    renderPlatformAdminCandidateOptions();
  } finally {
    if (select) select.disabled = false;
  }
}

function renderPlatformAdminDetail() {
  const detail = document.getElementById("platform-admin-detail");
  if (!detail) return;
  const { type, item } = platformAdminEntry(selectedPlatformAdminKey);
  if (!item) {
    detail.innerHTML = '<div class="platform-admin-empty-detail"><p class="portal-kicker">Access oversight</p><h3>Select an administrator</h3><p>Choose an administrator or invitation from the roster to review its status and available actions.</p></div>';
    return;
  }

  const email = String(item.email || "Unknown account");
  const status = String(item.status || "active");
  const isAdmin = type === "admin";
  const role = effectivePlatformAdminRole(item);
  const isOwner = role === "owner";
  const isReviewer = role === "reviewer";
  const isOperationsAdmin = role === "operations_admin";
  const isSalesRepresentative = role === "sales_rep";
  const pending = !isAdmin && status === "pending";
  const accountParams = new URLSearchParams({ email });
  if (item.user_id) accountParams.set("user", item.user_id);
  detail.innerHTML = `
    <article class="platform-admin-detail-card">
      <div class="platform-admin-detail-head"><div class="account-admin-identity"><span class="account-admin-avatar" aria-hidden="true">${escapeHtml(platformAdminInitials(email))}</span><div><p class="portal-kicker">${isAdmin ? "Administrator account" : "Administrator invitation"}</p><h3>${escapeHtml(email)}</h3><span class="account-state-pill ${status === "active" || pending ? "is-active" : "is-suspended"}">${escapeHtml(status)}</span></div></div>${isAdmin ? `<div class="platform-admin-detail-head-actions"><button class="portal-button" type="button" data-platform-admin-action="preview-dashboard" data-platform-admin-id="${escapeHtml(String(item.user_id))}">View dashboard</button><a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Open account</a></div>` : ""}</div>
      <div class="platform-admin-detail-facts">
        <div><span>Access level</span><strong>${isOwner ? "Master owner" : isReviewer ? "App reviewer" : isSalesRepresentative ? "Partner / Sales Representative" : isOperationsAdmin ? "Operations administrator" : isAdmin ? "Platform administrator" : "Access invitation"}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(status)}</strong></div>
        <div><span>${isAdmin ? "Access granted" : "Created"}</span><strong>${escapeHtml(formatAdminDate(item.created_at))}</strong></div>
        <div><span>${isAdmin ? "Last updated" : "Expires"}</span><strong>${escapeHtml(formatAdminDate(isAdmin ? item.updated_at : item.expires_at))}</strong></div>
      </div>
      <div class="platform-admin-permission-note"><div><p class="portal-kicker">Permission scope</p><h4>${isOwner ? "Full owner control" : isReviewer ? "Review-only mobile access" : isSalesRepresentative ? "Sales Leads only" : isOperationsAdmin ? "Selected operations workspaces" : "N3XRA administration access"}</h4><p>${isOwner ? "The master owner controls administrator invitations and cannot be revoked from this page." : isReviewer ? "This account can sign in to the N3XRA Admin mobile app and see synthetic review data only. It cannot open web administration or live customer data." : isSalesRepresentative ? "This account can view, add, scan, and update Sales Leads. Lead deletion and every other administrative workspace remain unavailable. Referral and commission activity stays in the person's Partner Portal." : isOperationsAdmin ? "This account can use the approved customer, product, company, communications, and financial workspaces without owner, partner, strategy, governance, or codebase administration." : isAdmin ? "This account can open N3XRA administration tools and internal admin workspaces." : role === "reviewer" ? "This person receives review-only mobile access after accepting the secure invitation." : role === "sales_rep" ? "This person receives Sales Leads access after accepting the secure invitation." : role === "operations_admin" ? "This person receives the selected Operations Administrator workspaces after accepting the secure invitation." : "This person receives platform administration access after accepting the secure invitation."}</p></div></div>
      ${isAdmin && !isOwner && status === "active" ? `<div class="platform-admin-detail-actions"><select class="platform-admin-role-select" data-platform-role-select aria-label="Change access role"><option value="sales_rep"${isSalesRepresentative ? " selected" : ""}>Partner / Sales Representative</option><option value="operations_admin"${isOperationsAdmin ? " selected" : ""}>Operations administrator</option><option value="admin"${role === "admin" ? " selected" : ""}>Platform administrator</option><option value="reviewer"${isReviewer ? " selected" : ""}>App reviewer</option></select><button class="portal-button" type="button" data-platform-admin-action="change-role" data-platform-admin-id="${escapeHtml(String(item.user_id))}">Change role</button></div>` : ""}
      ${(isAdmin && !isOwner && status === "active") || pending ? `<div class="platform-admin-detail-actions"><button class="portal-button portal-button-secondary account-danger-button" type="button" data-platform-admin-action="${isAdmin ? "revoke-admin" : "revoke-invite"}" data-platform-admin-id="${escapeHtml(String(isAdmin ? item.user_id : item.id))}">${isAdmin ? "Revoke administrator access" : "Revoke invitation"}</button></div>` : ""}
    </article>
  `;
}

function renderPlatformAdmins(data = {}) {
  const adminList = document.getElementById("platform-admin-list");
  const inviteList = document.getElementById("platform-admin-invite-list");
  if (!adminList || !inviteList) return;

  platformAdminDirectory = {
    admins: Array.isArray(data.admins) ? data.admins : platformAdminDirectory.admins,
    invites: Array.isArray(data.invites) ? data.invites : platformAdminDirectory.invites,
  };
  const query = String(document.getElementById("platform-admin-search")?.value || "").trim().toLowerCase();
  const admins = platformAdminDirectory.admins.filter((admin) => !query || [admin.email, admin.role, admin.status].join(" ").toLowerCase().includes(query));
  const invites = platformAdminDirectory.invites.filter((invite) => !query || [invite.email, invite.role, invite.status].join(" ").toLowerCase().includes(query));
  const allKeys = [...platformAdminDirectory.admins.map((admin) => `admin:${admin.user_id}`), ...platformAdminDirectory.invites.map((invite) => `invite:${invite.id}`)];
  if (!allKeys.includes(selectedPlatformAdminKey)) selectedPlatformAdminKey = allKeys[0] || "";
  adminList.innerHTML = admins.length
    ? admins.map((admin) => {
      const key = `admin:${admin.user_id}`;
      const role = effectivePlatformAdminRole(admin);
      const roleLabel = role === "owner" ? "Master owner" : role === "reviewer" ? "App reviewer" : role === "sales_rep" ? "Partner / Sales Representative" : role === "operations_admin" ? "Operations administrator" : "Platform administrator";
      return `<button class="platform-admin-roster-item${key === selectedPlatformAdminKey ? " is-selected" : ""}" type="button" data-platform-entry-key="${escapeHtml(key)}"><span class="platform-admin-roster-avatar">${escapeHtml(platformAdminInitials(admin.email))}</span><span><strong>${escapeHtml(admin.email || "Unknown admin")}</strong><small>${roleLabel} · ${escapeHtml(admin.status || "active")}</small></span></button>`;
    }).join("")
    : '<p class="platform-admin-empty">No platform admins found.</p>';

  inviteList.innerHTML = invites.length
    ? invites.map((invite) => {
      const key = `invite:${invite.id}`;
      const status = String(invite.status || "pending");
      const inviteRole = effectivePlatformAdminRole(invite);
      const roleLabel = inviteRole === "reviewer" ? "App reviewer" : inviteRole === "sales_rep" ? "Partner / Sales Representative" : inviteRole === "operations_admin" ? "Operations administrator" : "Platform administrator";
      return `<button class="platform-admin-roster-item${key === selectedPlatformAdminKey ? " is-selected" : ""}" type="button" data-platform-entry-key="${escapeHtml(key)}"><span class="platform-admin-roster-avatar is-invite">${escapeHtml(platformAdminInitials(invite.email))}</span><span><strong>${escapeHtml(invite.email || "Unknown invite")}</strong><small>${roleLabel} · ${escapeHtml(status)} · expires ${escapeHtml(formatAdminDate(invite.expires_at))}</small></span></button>`;
    }).join("")
    : '<p class="platform-admin-empty">No admin invites yet.</p>';
  const adminCount = document.getElementById("platform-admin-count");
  const inviteCount = document.getElementById("platform-admin-invite-count");
  if (adminCount) adminCount.textContent = String(admins.length);
  if (inviteCount) inviteCount.textContent = String(invites.length);
  renderPlatformAdminDetail();
}

async function loadPlatformAdmins() {
  setStatus("Loading platform admins…");
  try {
    const data = await invoke("list-platform-admins");
    renderPlatformAdmins(data);
    setStatus(`${(data.admins || []).length} platform administrator${(data.admins || []).length === 1 ? "" : "s"} loaded.`, "success");
  } catch (error) {
    document.querySelector(".platform-admin-workbench")?.classList.add("hidden");
    setStatus(error.message || "Owner admin access is required.", "error");
  }
}

async function grantPlatformAdminAccess(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const accountInput = document.getElementById("platform-admin-invite-account");
  const roleInput = document.getElementById("platform-admin-invite-role");
  const accountUserId = String(accountInput?.value || "").trim();
  const account = platformAdminCandidates.find((candidate) => String(candidate.id) === accountUserId);
  const role = String(roleInput?.value || "sales_rep").trim().toLowerCase();
  if (!accountUserId || !account) {
    setStatus("Choose an existing N3XRA account first.", "error");
    setPlatformAdminModalStatus("Choose an existing N3XRA account first.", "error");
    return;
  }

  const submitButton = document.getElementById("platform-admin-invite-submit");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Granting…";
  }
  setStatus("Granting administrator access…");
  setPlatformAdminModalStatus("Granting access to the selected account…");
  try {
    const data = await invoke("grant-platform-admin-access", { accountUserId, role });
    if (data.access?.user_id) selectedPlatformAdminKey = `admin:${data.access.user_id}`;
    form.reset();
    await Promise.all([loadPlatformAdmins(), loadPlatformAdminCandidates()]);
    const successMessage = `${role === "reviewer" ? "App reviewer" : role === "sales_rep" ? "Partner / Sales Representative" : role === "operations_admin" ? "Operations administrator" : "Administrator"} access granted to ${account.email}. It is available immediately.`;
    setStatus(successMessage, "success");
    closePlatformAdminInviteDialog();
  } catch (error) {
    const message = error.message || "Unable to grant administrator access.";
    setStatus(message, "error");
    setPlatformAdminModalStatus(message, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Grant access now";
    }
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
    if (action === "preview-dashboard") {
      await openDashboardPreview(id);
      button.disabled = false;
    } else if (action === "change-role") {
      const role = String(button.closest(".platform-admin-detail-actions")?.querySelector("[data-platform-role-select]")?.value || "");
      if (!role) throw new Error("Choose an access role.");
      setStatus("Changing access role…");
      await invoke("grant-platform-admin-access", { accountUserId: id, role });
      await Promise.all([loadPlatformAdmins(), loadPlatformAdminCandidates()]);
      setStatus("Access role updated.", "success");
    } else if (action === "revoke-admin") {
      const selected = platformAdminDirectory.admins.find((admin) => String(admin.user_id) === id);
      const confirmed = await confirmAdminAction(
        `Revoke platform administration access for ${selected?.email || "this administrator"}? Their N3XRA account and product data will remain intact.`,
        { title: "Revoke administrator access", confirmLabel: "Revoke access" },
      );
      if (!confirmed) { button.disabled = false; return; }
      setStatus("Revoking platform administrator…");
      await invoke("revoke-platform-admin", { userId: id });
      await loadPlatformAdmins();
      setStatus("Platform administrator access revoked.", "success");
    } else if (action === "revoke-invite") {
      const selected = platformAdminDirectory.invites.find((invite) => String(invite.id) === id);
      const confirmed = await confirmAdminAction(
        `Revoke the pending administrator invitation for ${selected?.email || "this email"}?`,
        { title: "Revoke administrator invitation", confirmLabel: "Revoke invitation" },
      );
      if (!confirmed) { button.disabled = false; return; }
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

export async function startPlatformAdmins(context = {}) {
  ({ invoke, escapeHtml, setStatus, confirmAdminAction } = context);
  document.getElementById("platform-admin-add")?.addEventListener("click", openPlatformAdminInviteDialog);
  document.getElementById("platform-admin-invite-close")?.addEventListener("click", closePlatformAdminInviteDialog);
  document.getElementById("platform-admin-invite-cancel")?.addEventListener("click", closePlatformAdminInviteDialog);
  document.getElementById("platform-admin-invite-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePlatformAdminInviteDialog();
  });
  document.getElementById("platform-admin-invite-form")?.addEventListener("submit", grantPlatformAdminAccess);
  document.getElementById("platform-admin-invite-account")?.addEventListener("change", renderSelectedPlatformAdminCandidate);
  document.getElementById("platform-admin-refresh")?.addEventListener("click", loadPlatformAdmins);
  document.getElementById("platform-admin-search")?.addEventListener("input", () => renderPlatformAdmins());
  document.getElementById("platform-admin-list")?.addEventListener("click", handlePlatformAdminAction);
  document.getElementById("platform-admin-invite-list")?.addEventListener("click", handlePlatformAdminAction);
  document.querySelector(".platform-admin-roster-pane")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-platform-entry-key]");
    if (!button) return;
    selectedPlatformAdminKey = button.dataset.platformEntryKey || "";
    renderPlatformAdmins();
  });
  document.getElementById("platform-admin-detail")?.addEventListener("click", handlePlatformAdminAction);
  document.getElementById("platform-dashboard-preview-close")?.addEventListener("click", closeDashboardPreview);
  document.getElementById("platform-dashboard-preview-done")?.addEventListener("click", closeDashboardPreview);
  document.getElementById("platform-dashboard-preview-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDashboardPreview();
    const tabButton = event.target.closest("[data-dashboard-preview-tab]");
    if (tabButton) selectDashboardPreviewTab(tabButton.dataset.dashboardPreviewTab || "products");
  });
  await loadPlatformAdmins();
}
