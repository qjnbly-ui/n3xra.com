let accounts = [];
let supabase;
let invoke;
let escapeHtml;
let formatDate;
let formatPhone;
let providerLabel;
let setStatus;
let confirmAdminAction;
let promptAdminText;
let canRemoveEnrollments = false;
let canDeleteAccounts = false;
let currentUserId = "";

function accountLabel(account) {
  return `${account.name || account.email} — ${account.email}`;
}

function isAccountSuspended(account) {
  if (!account?.bannedUntil) return false;
  const date = new Date(account.bannedUntil);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function productAdminLink(item, account) {
  const params = new URLSearchParams({ user: account.id, email: account.email });
  if (item.organizationId) params.set("organization", item.organizationId);
  if (item.product === "records") return { href: `/n3xra-admin/records/organizations/?${params}`, label: "Open Records admin" };
  if (item.product === "websites") {
    params.delete("organization");
    if (item.organizationId) params.set("website", item.organizationId);
    return { href: `/n3xra-admin/websites/?${params}`, label: "Open Website admin" };
  }
  params.set("product", item.product || "all");
  return { href: `/account/admin/billing/?${params}`, label: `Open ${item.productLabel || "product"} billing` };
}

function productClientPreviewLink(item) {
  if (!item.organizationId) return null;
  if (item.product === "records") {
    return `/n3xra-records/library/?support_org=${encodeURIComponent(item.organizationId)}`;
  }
  if (item.product === "websites") {
    return `/project-workspace/?website=${encodeURIComponent(item.organizationId)}`;
  }
  return null;
}

function enrollmentRemovalCopy(item) {
  const retiredProduct = ["ai_music", "virals"].includes(item.product);
  const workspaceName = retiredProduct ? item.productLabel : item.organization || item.plan || item.productLabel || "this workspace";
  const deletesWorkspace = item.product === "loan_tracker" || item.role === "owner" || item.role === "account";
  const removesRecordsProduct = item.product === "records" && item.role === "owner";
  return {
    workspaceName,
    deletesWorkspace,
    buttonLabel: deletesWorkspace ? "Delete product & data" : "Remove access",
    message: removesRecordsProduct
      ? `This removes only N3XRA Records from “${workspaceName}” and permanently deletes its Records documents, drafts, recordings, and Records settings. The client website, website files, Communications data, shared contacts, and N3XRA login are preserved. Type DELETE ${workspaceName} to continue.`
      : deletesWorkspace
      ? `This permanently deletes the ${item.productLabel} workspace “${workspaceName}”, its database records, uploaded files, and this person's access. Their N3XRA login and other products are not affected. Type DELETE ${workspaceName} to continue.`
      : `This removes this person's access to ${item.productLabel} “${workspaceName}”. Shared workspace data and other members are preserved. Type DELETE ${workspaceName} to continue.`,
  };
}

async function deleteAccount(account) {
  const expected = `DELETE ${account.email}`;
  const confirmation = await promptAdminText(
    `This permanently deletes ${account.email}, removes the Auth identity, and deletes all account-linked product data from Supabase. This cannot be undone. Type ${expected} to continue.`,
    {
      title: "Delete account and all data",
      inputLabel: `Type ${expected}`,
      confirmLabel: "Delete account",
    },
  );
  if (confirmation === null) return;
  if (confirmation.trim() !== expected) {
    setStatus(`Nothing was deleted. Type ${expected} exactly to confirm.`, "error");
    return;
  }

  setStatus(`Deleting ${account.email} and all linked data…`);
  try {
    const result = await invoke("delete-platform-account", {
      userId: account.id,
      confirmation,
    });
    accounts = accounts.filter((item) => item.id !== account.id);
    renderAccountOptions(document.getElementById("account-search")?.value || "");
    const cleanupNote = result.storageCleanupPending ? " The account is deleted, but some storage files need administrator review." : "";
    setStatus(`Account deleted from Supabase.${cleanupNote}`, result.storageCleanupPending ? "error" : "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function removeEnrollment(account, item) {
  const copy = enrollmentRemovalCopy(item);
  const expected = `DELETE ${copy.workspaceName}`;
  const confirmation = await promptAdminText(copy.message, {
    title: copy.deletesWorkspace ? "Delete product and all data" : "Remove product access",
    inputLabel: `Type ${expected}`,
    confirmLabel: copy.deletesWorkspace ? "Delete product & data" : "Remove access",
  });
  if (confirmation === null) return;
  if (confirmation.trim() !== expected) {
    setStatus(`Nothing was deleted. Type ${expected} exactly to confirm.`, "error");
    return;
  }

  setStatus(copy.deletesWorkspace ? `Deleting ${item.productLabel} data…` : `Removing ${item.productLabel} access…`);
  try {
    const result = await invoke("remove-product-enrollment", {
      userId: account.id,
      product: item.product,
      workspaceId: item.organizationId,
      confirmation,
    });
    await loadAccounts(account.id);
    const cleanupNote = result.storageCleanupPending ? " Database access is removed; storage cleanup needs administrator review." : "";
    setStatus(result.mode === "access_only" ? `Product access removed.${cleanupNote}` : result.mode === "product_data" ? `N3XRA Records and its data were removed. The website and Communications data were preserved.${cleanupNote}` : `${item.productLabel} and its data were deleted.${cleanupNote}`, result.storageCleanupPending ? "error" : "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderAccountOptions(filter = "", preferredAccountId = "") {
  const select = document.getElementById("account-select");
  if (!select) return;
  const query = filter.trim().toLowerCase();
  const filtered = accounts.filter((account) => !query || [accountLabel(account), account.phone, account.profileOrganization, ...(account.providers || [])].join(" ").toLowerCase().includes(query));
  const current = preferredAccountId || select.value;
  select.innerHTML = filtered.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(accountLabel(account))}</option>`).join("");
  if (filtered.some((account) => account.id === current)) select.value = current;
  const count = document.getElementById("account-count");
  if (count) count.textContent = `${filtered.length} of ${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
  const list = document.getElementById("account-list");
  if (list) {
    list.innerHTML = filtered.length ? filtered.map((account) => `<button class="account-directory-list-item${account.id === select.value ? " is-selected" : ""}" type="button" data-account-id="${escapeHtml(account.id)}"><span class="account-directory-list-avatar">${escapeHtml(String(account.name || account.email || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span><span><strong>${escapeHtml(account.name || account.email)}</strong><small>${escapeHtml(account.email)}</small></span></button>`).join("") : '<p class="account-directory-empty">No accounts match this search.</p>';
  }
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
  const access = Array.isArray(account.access) ? account.access.filter((item) => item.product !== "utilities") : [];
  const initials = String(account.name || account.email || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const suspended = isAccountSuspended(account);
  const phoneLocked = account.phoneLockedUntil && new Date(account.phoneLockedUntil).getTime() > Date.now();
  const providers = Array.isArray(account.providers) && account.providers.length ? account.providers.map(providerLabel).join(", ") : "No sign-in provider recorded";
  const phoneDetail = account.authPhone
    ? account.phoneConfirmedAt ? `Auth phone confirmed ${formatDate(account.phoneConfirmedAt)}` : "Auth phone is not confirmed"
    : account.phoneAccessConfigured ? "N3XRA phone receptionist access" : "No phone connected";
  const phoneAccessDetail = account.phoneAccessConfigured
    ? `${phoneLocked ? `Locked until ${formatDate(account.phoneLockedUntil)}` : "Not locked"} · ${Number(account.phoneFailedAttempts || 0)} failed attempt${Number(account.phoneFailedAttempts || 0) === 1 ? "" : "s"} · ${account.phoneLastAuthenticatedAt ? `last used ${formatDate(account.phoneLastAuthenticatedAt)}` : "not used yet"}`
    : "Not configured";
  const supportParams = new URLSearchParams({ email: account.email, user: account.id });
  const billingParams = new URLSearchParams({ email: account.email, user: account.id });
  detail.innerHTML = `
    <div class="account-admin-detail-head">
      <div class="account-admin-identity"><span class="account-admin-avatar" aria-hidden="true">${escapeHtml(initials)}</span><div><p class="portal-kicker">Selected account</p><h3>${escapeHtml(account.name || account.email)}</h3><p>${escapeHtml(account.email)}</p><span class="account-state-pill ${suspended ? "is-suspended" : "is-active"}">${suspended ? "Access suspended" : "Active account"}</span></div></div>
      <div class="account-admin-head-actions"><a class="portal-button portal-button-secondary" href="/account/admin/support/?${escapeHtml(supportParams.toString())}">Support</a><button class="portal-button portal-button-secondary" id="account-reset-password" type="button">Send password reset</button></div>
    </div>
    <div class="account-admin-facts">
      <div class="account-admin-fact"><span>Created</span><strong>${escapeHtml(formatDate(account.createdAt))}</strong></div>
      <div class="account-admin-fact"><span>Last sign in</span><strong>${escapeHtml(formatDate(account.lastSignInAt))}</strong></div>
      <div class="account-admin-fact"><span>Email</span><strong>${account.emailConfirmedAt ? "Confirmed" : "Not confirmed"}</strong></div>
      <div class="account-admin-fact"><span>Account ID</span><strong class="account-admin-id">${escapeHtml(account.id)}</strong></div>
    </div>
    <section class="account-oversight-section account-authentication-section">
      <div class="account-oversight-heading"><div><p class="portal-kicker">Account profile</p><h4>Contact and sign-in</h4><p>Identity, authentication, and phone-access details stored for this account.</p></div></div>
      <div class="account-detail-list">
        <div class="account-detail-row"><span>Phone number</span><div><strong>${escapeHtml(formatPhone(account.phone))}</strong><small>${escapeHtml(phoneDetail)}</small></div></div>
        <div class="account-detail-row"><span>Sign-in methods</span><div><strong>${escapeHtml(providers)}</strong><small>${account.isAnonymous ? "Anonymous identity" : "Permanent identity"}</small></div></div>
        <div class="account-detail-row"><span>Profile organization</span><div><strong>${escapeHtml(account.profileOrganization || "Not provided")}</strong><small>${escapeHtml([account.profileRole, account.profilePlan, account.profileStatus].filter(Boolean).join(" · ") || "No legacy profile details")}</small></div></div>
        <div class="account-detail-row"><span>N3XRA phone access</span><div><strong>${account.phoneAccessConfigured ? "Configured" : "Not configured"}</strong><small>${escapeHtml(phoneAccessDetail)}</small></div></div>
        <div class="account-detail-row"><span>Account updated</span><div><strong>${escapeHtml(formatDate(account.updatedAt))}</strong><small>Last identity record update</small></div></div>
        <div class="account-detail-row"><span>Email verification</span><div><strong>${account.emailConfirmedAt ? "Confirmed" : "Not confirmed"}</strong><small>${escapeHtml(account.emailConfirmedAt ? formatDate(account.emailConfirmedAt) : "No confirmation date")}</small></div></div>
      </div>
    </section>
    <section class="account-oversight-section">
      <div class="account-oversight-heading"><div><p class="portal-kicker">Quick edits</p><h4>Identity and access</h4><p>Correct account details, help with sign-in, or temporarily stop platform access.</p></div><a class="portal-button portal-button-secondary" href="/account/admin/billing/?${escapeHtml(billingParams.toString())}">View billing</a></div>
      <form class="account-admin-form account-profile-form" id="account-profile-form">
        <div class="account-admin-form-row"><label class="account-admin-field"><span>Full name</span><input id="account-profile-name" type="text" value="${escapeHtml(account.name || "")}" maxlength="180" required></label><label class="account-admin-field"><span>Email address</span><input id="account-profile-email" type="email" value="${escapeHtml(account.email)}" required></label></div>
        <div class="account-admin-actions">${canDeleteAccounts && account.id !== currentUserId ? '<button class="portal-button portal-button-secondary account-danger-button" id="account-delete" type="button">Delete account</button>' : ""}<button class="portal-button portal-button-secondary ${suspended ? "" : "account-danger-button"}" id="account-toggle-suspension" type="button">${suspended ? "Restore access" : "Suspend access"}</button><button class="portal-button" type="submit">Save account</button></div>
      </form>
    </section>
    <section class="account-oversight-section">
      <div class="account-oversight-heading"><div><p class="portal-kicker">Product enrollment</p><h4>Products and workspaces</h4><p>Preview the customer experience or open the matching admin workspace with this account already selected.</p></div><span class="account-admin-count">${access.length} enrollment${access.length === 1 ? "" : "s"}</span></div>
      <div class="account-admin-card-grid">
        ${access.length ? access.map((item) => { const link = productAdminLink(item, account); const previewHref = productClientPreviewLink(item); const removable = canRemoveEnrollments && ["records", "websites", "ai_music", "virals"].includes(item.product) && item.organizationId; const removal = removable ? enrollmentRemovalCopy(item) : null; return `<article class="account-access-card"><div><span>${escapeHtml(item.productLabel)}</span><h4>${escapeHtml(item.organization || item.plan || "Product account")}</h4><p>${escapeHtml(item.role || "account")} · ${escapeHtml(item.status || "active")}</p></div><div class="account-admin-head-actions">${previewHref ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(previewHref)}">Preview client view</a>` : ""}<a class="portal-button portal-button-secondary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>${removal ? `<button class="portal-button portal-button-secondary account-danger-button" type="button" data-remove-enrollment data-product="${escapeHtml(item.product)}" data-workspace-id="${escapeHtml(item.organizationId)}">${escapeHtml(removal.buttonLabel)}</button>` : ""}</div></article>`; }).join("") : '<article class="account-access-card"><div><h4>No product access found</h4><p>This identity has no mapped product memberships.</p></div><a class="portal-button portal-button-secondary" href="/account/admin/product-apps/">Review products</a></article>'}
      </div>
    </section>
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

  document.getElementById("account-profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("account-profile-name")?.value.trim() || "";
    const email = document.getElementById("account-profile-email")?.value.trim().toLowerCase() || "";
    setStatus("Saving account…");
    try {
      const data = await invoke("update-platform-account", { userId: account.id, name, email });
      accounts = accounts.map((item) => item.id === account.id ? { ...item, ...data.account } : item);
      renderAccountOptions(document.getElementById("account-search")?.value || "");
      setStatus("Account details saved.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.getElementById("account-toggle-suspension")?.addEventListener("click", async () => {
    const nextSuspended = !suspended;
    const confirmed = await confirmAdminAction(
      nextSuspended
        ? `Suspend sign-in access for ${account.name || account.email}? Their product records will be preserved.`
        : `Restore sign-in access for ${account.name || account.email}?`,
      { title: nextSuspended ? "Suspend account access" : "Restore account access", confirmLabel: nextSuspended ? "Suspend access" : "Restore access" },
    );
    if (!confirmed) return;
    setStatus(nextSuspended ? "Suspending account…" : "Restoring account…");
    try {
      const data = await invoke("set-platform-account-suspension", { userId: account.id, suspended: nextSuspended });
      accounts = accounts.map((item) => item.id === account.id ? { ...item, bannedUntil: data.bannedUntil } : item);
      renderSelectedAccount();
      setStatus(nextSuspended ? "Account access suspended." : "Account access restored.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.getElementById("account-delete")?.addEventListener("click", () => deleteAccount(account));

  detail.querySelectorAll("[data-remove-enrollment]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = access.find((candidate) => candidate.product === button.dataset.product && String(candidate.organizationId || "") === String(button.dataset.workspaceId || ""));
      if (item) removeEnrollment(account, item);
    });
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
        <div><span>Loan Tracker</span>
        <h4>${escapeHtml(loan.lender_name || "Loan account")}</h4>
        <p>${Number(loan.original_balance).toLocaleString("en-US", { style: "currency", currency: "USD" })} original · ${Number(loan.planned_monthly_payment).toLocaleString("en-US", { style: "currency", currency: "USD" })}/month</p></div>
        <div class="account-admin-head-actions">
          <a class="portal-button portal-button-secondary" href="/account/loan-tracker/?user=${encodeURIComponent(account.id)}">Preview client view</a>
          ${canRemoveEnrollments ? '<button class="portal-button portal-button-secondary account-danger-button" id="remove-loan-enrollment" type="button">Delete product & data</button>' : ""}
        </div>
      </article>
    `);
    document.getElementById("remove-loan-enrollment")?.addEventListener("click", () => removeEnrollment(account, {
      product: "loan_tracker",
      productLabel: "Loan Tracker",
      organizationId: loan.id,
      organization: loan.lender_name || loan.borrower_name || "Loan Tracker",
      role: "owner",
    }));
  } catch (error) {
    setStatus(error.message || "Unable to load Loan Tracker access.", "error");
  }
}

async function loadAccounts(preferredUserId = "") {
  setStatus("Loading accounts…");
  const data = await invoke("list-platform-accounts");
  accounts = data.accounts || [];
  const params = new URLSearchParams(window.location.search);
  const requested = accounts.find((account) => account.id === preferredUserId || account.id === params.get("user") || account.email === String(params.get("email") || "").toLowerCase());
  renderAccountOptions(document.getElementById("account-search")?.value || "", requested?.id || preferredUserId);
  setStatus(`${accounts.length} account${accounts.length === 1 ? "" : "s"} loaded.`, "success");
}

export async function startAccounts(context = {}) {
  ({ supabase, invoke, escapeHtml, formatDate, formatPhone, providerLabel, setStatus, confirmAdminAction, promptAdminText } = context);
  canRemoveEnrollments = String(context.platformAdminRole || "").toLowerCase() === "owner";
  canDeleteAccounts = canRemoveEnrollments;
  currentUserId = String(context.currentUserId || "");
  document.getElementById("account-search")?.addEventListener("input", (event) => renderAccountOptions(event.target.value));
  document.getElementById("account-select")?.addEventListener("change", renderSelectedAccount);
  document.getElementById("account-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-id]");
    if (!button) return;
    const select = document.getElementById("account-select");
    if (select) select.value = button.dataset.accountId;
    renderAccountOptions(document.getElementById("account-search")?.value || "");
  });
  await loadAccounts();
}
