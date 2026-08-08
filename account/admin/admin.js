import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";
import { arrangeAdminWorkspace } from "/account/admin/admin-navigation.js?v=9";
import { confirmAdminAction } from "/account/admin/admin-dialogs.js";
import { initializeAdminSelects } from "/account/admin/admin-select.js?v=1";

initializeAdminSelects();

let view = "";
let setupPanel = null;
let adminPanel = null;
let signOutButton = null;
let statusEl = null;
let supabase = null;
let session = null;
let accounts = [];
let billing = [];
let selectedBillingKey = "";
let supportRequests = [];
let platformAdminInviteUrl = "";
let platformAdminDirectory = { admins: [], invites: [] };
let selectedPlatformAdminKey = "";
let codebaseHistory = [];
let codebaseTurns = [];
let selectedCodebaseTurnId = "";
let currentCodebaseAnswerText = "";

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

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value || "Not provided";
}

function providerLabel(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "Unknown";
  if (provider === "email") return "Email/password or magic link";
  if (provider === "phone") return "Phone";
  if (provider === "azure") return "Microsoft";
  return provider[0].toUpperCase() + provider.slice(1);
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

function isAccountSuspended(account) {
  if (!account?.bannedUntil) return false;
  const date = new Date(account.bannedUntil);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function productAdminLink(item, account) {
  const params = new URLSearchParams({ user: account.id, email: account.email });
  if (item.organizationId) params.set("organization", item.organizationId);
  if (item.product === "records") return { href: `/n3xra-admin/records/organizations/?${params}`, label: "Open Records admin" };
  if (item.product === "utilities") return { href: `/n3xra-admin/utilities/?${params}`, label: "Open Utilities admin" };
  if (item.product === "websites") {
    params.delete("organization");
    if (item.organizationId) params.set("website", item.organizationId);
    return { href: `/n3xra-admin/websites/?${params}`, label: "Open Website admin" };
  }
  params.set("product", item.product || "all");
  return { href: `/account/admin/billing/?${params}`, label: `Open ${item.productLabel || "product"} billing` };
}

function renderAccountOptions(filter = "") {
  const select = document.getElementById("account-select");
  if (!select) return;
  const query = filter.trim().toLowerCase();
  const filtered = accounts.filter((account) => !query || [accountLabel(account), account.phone, account.profileOrganization, ...(account.providers || [])].join(" ").toLowerCase().includes(query));
  const current = select.value;
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
  const access = Array.isArray(account.access) ? account.access : [];
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
        <div class="account-admin-actions"><button class="portal-button portal-button-secondary ${suspended ? "" : "account-danger-button"}" id="account-toggle-suspension" type="button">${suspended ? "Restore access" : "Suspend access"}</button><button class="portal-button" type="submit">Save account</button></div>
      </form>
    </section>
    <section class="account-oversight-section">
      <div class="account-oversight-heading"><div><p class="portal-kicker">Product enrollment</p><h4>Apps and workspaces</h4><p>Open the correct admin workspace with this customer’s organization or site already selected.</p></div><span class="account-admin-count">${access.length} enrollment${access.length === 1 ? "" : "s"}</span></div>
      <div class="account-admin-card-grid">
        ${access.length ? access.map((item) => { const link = productAdminLink(item, account); return `<article class="account-access-card"><div><span>${escapeHtml(item.productLabel)}</span><h4>${escapeHtml(item.organization || item.plan || "Product account")}</h4><p>${escapeHtml(item.role || "account")} · ${escapeHtml(item.status || "active")}</p></div><a class="portal-button portal-button-secondary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></article>`; }).join("") : '<article class="account-access-card"><div><h4>No product access found</h4><p>This identity has no mapped product memberships.</p></div><a class="portal-button portal-button-secondary" href="/account/admin/product-apps/">Review product apps</a></article>'}
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
  const params = new URLSearchParams(window.location.search);
  const requested = accounts.find((account) => account.id === params.get("user") || account.email === String(params.get("email") || "").toLowerCase());
  const select = document.getElementById("account-select");
  if (requested && select) {
    select.value = requested.id;
    renderAccountOptions(document.getElementById("account-search")?.value || "");
  }
  setStatus(`${accounts.length} account${accounts.length === 1 ? "" : "s"} loaded.`, "success");
}

function billingKey(item) {
  return `${item?.product || "product"}:${item?.id || item?.email || "account"}`;
}

function normalizeBillingStatus(value) {
  return String(value || "unknown").trim().toLowerCase().replaceAll("-", "_");
}

function billingHealth(item) {
  const status = normalizeBillingStatus(item?.status);
  const hasCustomer = Boolean(item?.customerId);
  const hasSubscription = Boolean(item?.subscriptionId);
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status)) {
    return { key: "attention", label: "Needs attention", detail: `The subscription is ${status.replaceAll("_", " ")}. Review it in Stripe before changing local access.` };
  }
  if (hasCustomer && !hasSubscription) {
    return { key: "attention", label: "Customer without subscription", detail: "A Stripe customer exists, but no subscription is connected to this product record." };
  }
  if (hasCustomer && hasSubscription) {
    return { key: "connected", label: "Stripe connected", detail: "The local billing record is connected to both a Stripe customer and subscription." };
  }
  if (["active", "trial", "trialing"].includes(status)) {
    return { key: "internal", label: "Internal access only", detail: "This account has product access without a connected Stripe customer or subscription." };
  }
  if (["canceled", "cancelled"].includes(status)) {
    return { key: "canceled", label: "Canceled", detail: "This product record is canceled and has no connected Stripe subscription." };
  }
  return { key: "disconnected", label: "No Stripe record", detail: "No Stripe customer or subscription is connected to this product record." };
}

function billingMatchesHealth(item, filter) {
  if (filter === "all") return true;
  const status = normalizeBillingStatus(item.status);
  if (filter === "active") return status === "active";
  if (filter === "trialing") return ["trial", "trialing"].includes(status);
  if (filter === "disconnected") return !item.customerId && !item.subscriptionId;
  return billingHealth(item).key === filter;
}

function billingProductLink(item) {
  const params = new URLSearchParams({ email: item.email || "" });
  if (item.product === "records") {
    params.set("organization", item.id || "");
    return { href: `/n3xra-admin/records/organizations/?${params.toString()}`, label: "Open Records admin" };
  }
  if (item.product === "ai_music") return { href: `/ai-music-generator/app/?${params.toString()}`, label: "Open AI Music" };
  if (item.product === "virals") return { href: `/virals/?${params.toString()}`, label: "Open Virals" };
  return null;
}

function renderBillingDetail(item) {
  const detail = document.getElementById("billing-detail");
  if (!detail) return;
  if (!item) {
    detail.innerHTML = '<div class="billing-empty-detail"><p class="portal-kicker">Billing operations</p><h2>No billing account selected</h2><p>Choose a billing record from the list to review its plan, usage, and Stripe connection.</p></div>';
    return;
  }
  const health = billingHealth(item);
  const status = normalizeBillingStatus(item.status).replaceAll("_", " ");
  const accountParams = new URLSearchParams({ email: item.email || "" });
  const productLink = billingProductLink(item);
  const stripeCustomerUrl = item.customerId ? `https://dashboard.stripe.com/customers/${encodeURIComponent(item.customerId)}` : "";
  const stripeSubscriptionUrl = item.subscriptionId ? `https://dashboard.stripe.com/subscriptions/${encodeURIComponent(item.subscriptionId)}` : "";
  detail.innerHTML = `
    <header class="billing-detail-head">
      <div><p class="portal-kicker">${escapeHtml(item.productLabel || "Product billing")}</p><h2>${escapeHtml(item.account || item.email || "Billing account")}</h2><p>${escapeHtml(item.email || "No account email")}</p><span class="billing-state is-${escapeHtml(health.key)}">${escapeHtml(status)}</span></div>
      <div class="billing-detail-actions"><a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Account oversight</a>${productLink ? `<a class="portal-button" href="${escapeHtml(productLink.href)}">${escapeHtml(productLink.label)}</a>` : ""}</div>
    </header>
    <div class="billing-detail-facts">
      <div><span>Plan</span><strong>${escapeHtml(item.plan || "Not set")}</strong></div>
      <div><span>Billing cycle</span><strong>${escapeHtml(item.cycle || "Not recorded")}</strong></div>
      <div><span>Current period end</span><strong>${escapeHtml(formatDate(item.periodEnd))}</strong></div>
      <div><span>Usage</span><strong>${escapeHtml(item.usage || "Not recorded")}</strong></div>
    </div>
    <section class="billing-detail-section">
      <div class="billing-section-heading"><div><p class="portal-kicker">Billing health</p><h3>${escapeHtml(health.label)}</h3><p>${escapeHtml(health.detail)}</p></div><span class="billing-health-mark is-${escapeHtml(health.key)}" aria-hidden="true"></span></div>
      <div class="billing-detail-rows">
        <div><span>Product status</span><strong>${escapeHtml(status)}</strong></div>
        <div><span>Stripe connection</span><strong>${escapeHtml(deriveStripeState(item))}</strong></div>
        <div><span>Renewal information</span><strong>${item.periodEnd ? escapeHtml(formatDate(item.periodEnd)) : "No period end recorded"}</strong></div>
      </div>
    </section>
    <section class="billing-detail-section">
      <div class="billing-section-heading"><div><p class="portal-kicker">Stripe records</p><h3>Customer and subscription</h3><p>Open the source billing records directly when they exist. Payment changes remain in Stripe.</p></div></div>
      <div class="billing-detail-rows">
        <div><span>Customer ID</span><strong class="billing-identifier">${escapeHtml(item.customerId || "Not connected")}</strong>${stripeCustomerUrl ? `<a href="${escapeHtml(stripeCustomerUrl)}" target="_blank" rel="noreferrer">Open customer in Stripe</a>` : ""}</div>
        <div><span>Subscription ID</span><strong class="billing-identifier">${escapeHtml(item.subscriptionId || "Not connected")}</strong>${stripeSubscriptionUrl ? `<a href="${escapeHtml(stripeSubscriptionUrl)}" target="_blank" rel="noreferrer">Open subscription in Stripe</a>` : ""}</div>
        <div><span>Local billing record</span><strong class="billing-identifier">${escapeHtml(item.id || "Not recorded")}</strong></div>
      </div>
    </section>
  `;
}

function renderBilling() {
  const list = document.getElementById("billing-list");
  if (!list) return;
  const query = String(document.getElementById("billing-filter")?.value || "").trim().toLowerCase();
  const product = document.getElementById("billing-product")?.value || "all";
  const healthFilter = document.getElementById("billing-health")?.value || "all";
  const rows = billing.filter((item) => {
    const searchable = [item.account, item.email, item.productLabel, item.plan, item.status, item.usage, deriveStripeState(item)].join(" ").toLowerCase();
    return (product === "all" || item.product === product) && billingMatchesHealth(item, healthFilter) && (!query || searchable.includes(query));
  });
  if (!rows.some((item) => billingKey(item) === selectedBillingKey)) selectedBillingKey = rows[0] ? billingKey(rows[0]) : "";
  list.innerHTML = rows.length ? rows.map((item) => {
    const health = billingHealth(item);
    const selected = billingKey(item) === selectedBillingKey;
    return `<button class="billing-roster-item${selected ? " is-selected" : ""}" type="button" data-billing-key="${escapeHtml(billingKey(item))}"><span class="billing-product-mark">${escapeHtml(String(item.productLabel || "B").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span><span class="billing-roster-copy"><strong>${escapeHtml(item.account || item.email)}</strong><small>${escapeHtml(item.productLabel || "Product")} · ${escapeHtml(item.plan || "No plan")}</small></span><span class="billing-roster-state is-${escapeHtml(health.key)}" title="${escapeHtml(health.label)}"></span></button>`;
  }).join("") : '<p class="billing-empty-list">No billing accounts match these filters.</p>';
  const count = document.getElementById("billing-count");
  if (count) count.textContent = `${rows.length} of ${billing.length}`;
  const connected = billing.filter((item) => item.customerId && item.subscriptionId).length;
  const attention = billing.filter((item) => billingHealth(item).key === "attention").length;
  const internal = billing.filter((item) => billingHealth(item).key === "internal").length;
  const summary = document.getElementById("billing-summary");
  if (summary) summary.innerHTML = `<span><strong>${connected}</strong> connected</span><span><strong>${internal}</strong> internal</span><span class="${attention ? "has-attention" : ""}"><strong>${attention}</strong> attention</span>`;
  renderBillingDetail(rows.find((item) => billingKey(item) === selectedBillingKey));
}

async function loadBilling() {
  setStatus("Loading billing accounts…");
  const data = await invoke("list-platform-billing");
  billing = data.billing || [];
  const params = new URLSearchParams(window.location.search);
  const email = String(params.get("email") || "").trim();
  const product = String(params.get("product") || "").trim();
  const user = String(params.get("user") || "").trim();
  const filter = document.getElementById("billing-filter");
  const productSelect = document.getElementById("billing-product");
  if (filter && email) filter.value = email;
  if (productSelect && product && Array.from(productSelect.options).some((option) => option.value === product)) productSelect.value = product;
  const requested = billing.find((item) => (email && String(item.email || "").toLowerCase() === email.toLowerCase()) || (user && String(item.id || "") === user));
  if (requested) selectedBillingKey = billingKey(requested);
  renderBilling();
  setStatus(`${billing.length} billing account${billing.length === 1 ? "" : "s"} loaded.`, "success");
}

function supportLabel(request) {
  return `${request.subject} — ${request.requester_name} (${request.status})`;
}

function supportInitials(request) {
  return String(request?.requester_name || request?.requester_email || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function supportStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function renderSupportOptions() {
  const select = document.getElementById("support-select");
  if (!select) return;
  const status = document.getElementById("support-filter")?.value || "open";
  const priority = document.getElementById("support-priority-filter")?.value || "all";
  const query = String(document.getElementById("support-search")?.value || "").trim().toLowerCase();
  const filtered = supportRequests.filter((item) => {
    const statusMatch = status === "all" || (status === "open" ? !["resolved", "closed"].includes(item.status) : item.status === status);
    const priorityMatch = priority === "all" || item.priority === priority;
    const searchable = [item.subject, item.requester_name, item.requester_email, item.organization_name, item.topic, item.message, item.status, item.priority].join(" ").toLowerCase();
    return statusMatch && priorityMatch && (!query || searchable.includes(query));
  });
  const current = select.value;
  select.innerHTML = filtered.map((request) => `<option value="${escapeHtml(request.id)}">${escapeHtml(supportLabel(request))}</option>`).join("");
  if (filtered.some((request) => request.id === current)) select.value = current;
  const list = document.getElementById("support-list");
  if (list) {
    list.innerHTML = filtered.length ? filtered.map((request) => `
      <button class="support-request-item${request.id === select.value ? " is-selected" : ""}" type="button" data-support-request-id="${escapeHtml(request.id)}">
        <span class="support-request-avatar">${escapeHtml(supportInitials(request))}</span>
        <span class="support-request-copy"><strong>${escapeHtml(request.subject || "Support request")}</strong><small>${escapeHtml(request.requester_name || request.requester_email || "Unknown requester")} · ${escapeHtml(formatDate(request.created_at))}</small></span>
        <span class="support-priority-mark is-${escapeHtml(request.priority || "normal")}" title="${escapeHtml(request.priority || "normal")} priority"></span>
      </button>
    `).join("") : '<div class="support-empty-list"><strong>No support cases here</strong><p>New requests matching this view will appear in the queue.</p></div>';
  }
  const count = document.getElementById("support-count");
  if (count) count.textContent = `${filtered.length} of ${supportRequests.length}`;
  const openCount = supportRequests.filter((item) => !["resolved", "closed"].includes(item.status)).length;
  const newCount = supportRequests.filter((item) => item.status === "new").length;
  const urgentCount = supportRequests.filter((item) => item.priority === "urgent" && !["resolved", "closed"].includes(item.status)).length;
  const summary = document.getElementById("support-summary");
  if (summary) summary.innerHTML = `<span><strong>${openCount}</strong> open</span><span><strong>${newCount}</strong> new</span><span class="${urgentCount ? "has-urgent" : ""}"><strong>${urgentCount}</strong> urgent</span>`;
  renderSelectedSupport();
}

function renderSelectedSupport() {
  const select = document.getElementById("support-select");
  const detail = document.getElementById("support-detail");
  if (!select || !detail) return;
  const request = supportRequests.find((item) => item.id === select.value);
  if (!request) {
    detail.innerHTML = '<div class="support-empty-detail"><p class="portal-kicker">Support operations</p><h2>No case selected</h2><p>Select a support request from the queue to review the message, account context, and internal handling notes.</p></div>';
    return;
  }
  const accountParams = new URLSearchParams({ email: request.requester_email || "" });
  if (request.requester_user_id) accountParams.set("user", request.requester_user_id);
  const mailSubject = encodeURIComponent(`Re: ${request.subject || "N3XRA support request"}`);
  detail.innerHTML = `
    <header class="support-detail-head">
      <div class="support-request-identity"><span class="support-request-avatar is-large" aria-hidden="true">${escapeHtml(supportInitials(request))}</span><div><p class="portal-kicker">${escapeHtml(request.topic || "Support request")}</p><h2>${escapeHtml(request.subject || "Support request")}</h2><p>${escapeHtml(request.requester_name || "Unknown requester")} · ${escapeHtml(request.requester_email || "No email")}</p><span class="support-case-state is-${escapeHtml(request.status || "new")}">${escapeHtml(supportStatusLabel(request.status))}</span></div></div>
      <div class="support-detail-actions"><a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Account oversight</a><a class="portal-button" href="mailto:${escapeHtml(request.requester_email || "")}?subject=${mailSubject}">Reply by email</a></div>
    </header>
    <div class="support-detail-facts">
      <div><span>Status</span><strong>${escapeHtml(supportStatusLabel(request.status))}</strong></div>
      <div><span>Priority</span><strong>${escapeHtml(request.priority || "normal")}</strong></div>
      <div><span>Received</span><strong>${escapeHtml(formatDate(request.created_at))}</strong></div>
      <div><span>Last updated</span><strong>${escapeHtml(formatDate(request.updated_at))}</strong></div>
    </div>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Customer message</p><h3>Request details</h3></div></div>
      <div class="support-message">${escapeHtml(request.message || "No message was provided.")}</div>
    </section>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Case context</p><h3>Requester and source</h3></div></div>
      <div class="support-context-rows">
        <div><span>Organization</span><strong>${escapeHtml(request.organization_name || "Not provided")}</strong></div>
        <div><span>Topic</span><strong>${escapeHtml(request.topic || "General support")}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(request.source || "Platform support")}</strong></div>
        <div><span>Case ID</span><strong class="support-identifier">${escapeHtml(request.id)}</strong></div>
        ${request.resolved_at ? `<div><span>Resolved</span><strong>${escapeHtml(formatDate(request.resolved_at))}</strong></div>` : ""}
      </div>
    </section>
    <section class="support-detail-section">
      <div class="support-section-heading"><div><p class="portal-kicker">Case management</p><h3>Status and internal notes</h3><p>These notes remain inside the admin workspace and are not included in the customer email.</p></div></div>
      <form class="support-case-form" id="support-update-form">
        <div class="support-control-grid">
          <label class="account-admin-field"><span>Status</span><select id="support-status">${["new","in_progress","waiting","resolved","closed"].map((value) => `<option value="${value}"${(request.status || "new") === value ? " selected" : ""}>${supportStatusLabel(value)}</option>`).join("")}</select></label>
          <label class="account-admin-field"><span>Priority</span><select id="support-priority">${["low","normal","high","urgent"].map((value) => `<option value="${value}"${(request.priority || "normal") === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>
        </div>
        <label class="account-admin-field"><span>Internal notes</span><textarea id="support-notes" rows="7" placeholder="Add investigation notes, decisions, or follow-up context">${escapeHtml(request.internal_notes || "")}</textarea></label>
        <div class="support-form-actions"><span>Saving updates this case immediately.</span><button class="portal-button" type="submit">Save case</button></div>
      </form>
    </section>
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
  const params = new URLSearchParams(window.location.search);
  const requestedEmail = String(params.get("email") || "").trim().toLowerCase();
  const requestedUser = String(params.get("user") || "").trim();
  if (requestedEmail || requestedUser) {
    const filter = document.getElementById("support-filter");
    if (filter) filter.value = "all";
  }
  renderSupportOptions();
  if (requestedEmail || requestedUser) {
    const request = supportRequests.find((item) => (requestedEmail && String(item.requester_email || "").trim().toLowerCase() === requestedEmail) || (requestedUser && String(item.requester_user_id || "") === requestedUser));
    const select = document.getElementById("support-select");
    if (request && select) {
      select.value = request.id;
      renderSupportOptions();
    }
  }
  setStatus(`${supportRequests.length} support request${supportRequests.length === 1 ? "" : "s"} loaded.`, "success");
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
  const isOwner = String(item.role || "admin") === "owner";
  const pending = !isAdmin && status === "pending";
  const accountParams = new URLSearchParams({ email });
  if (item.user_id) accountParams.set("user", item.user_id);
  detail.innerHTML = `
    <article class="platform-admin-detail-card">
      <div class="platform-admin-detail-head"><div class="account-admin-identity"><span class="account-admin-avatar" aria-hidden="true">${escapeHtml(platformAdminInitials(email))}</span><div><p class="portal-kicker">${isAdmin ? "Administrator account" : "Administrator invitation"}</p><h3>${escapeHtml(email)}</h3><span class="account-state-pill ${status === "active" || pending ? "is-active" : "is-suspended"}">${escapeHtml(status)}</span></div></div>${isAdmin ? `<a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Open account</a>` : ""}</div>
      <div class="platform-admin-detail-facts">
        <div><span>Access level</span><strong>${isOwner ? "Master owner" : isAdmin ? "Platform administrator" : "Platform admin invitation"}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(status)}</strong></div>
        <div><span>${isAdmin ? "Access granted" : "Created"}</span><strong>${escapeHtml(formatAdminDate(item.created_at))}</strong></div>
        <div><span>${isAdmin ? "Last updated" : "Expires"}</span><strong>${escapeHtml(formatAdminDate(isAdmin ? item.updated_at : item.expires_at))}</strong></div>
      </div>
      <div class="platform-admin-permission-note"><div><p class="portal-kicker">Permission scope</p><h4>${isOwner ? "Full owner control" : "N3XRA administration access"}</h4><p>${isOwner ? "The master owner controls administrator invitations and cannot be revoked from this page." : isAdmin ? "This account can open N3XRA administration tools and internal admin workspaces." : "This person receives platform administration access after accepting the secure invitation."}</p></div></div>
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
      const role = String(admin.role || "admin");
      return `<button class="platform-admin-roster-item${key === selectedPlatformAdminKey ? " is-selected" : ""}" type="button" data-platform-entry-key="${escapeHtml(key)}"><span class="platform-admin-roster-avatar">${escapeHtml(platformAdminInitials(admin.email))}</span><span><strong>${escapeHtml(admin.email || "Unknown admin")}</strong><small>${role === "owner" ? "Master owner" : "Platform administrator"} · ${escapeHtml(admin.status || "active")}</small></span></button>`;
    }).join("")
    : '<p class="platform-admin-empty">No platform admins found.</p>';

  inviteList.innerHTML = invites.length
    ? invites.map((invite) => {
      const key = `invite:${invite.id}`;
      const status = String(invite.status || "pending");
      return `<button class="platform-admin-roster-item${key === selectedPlatformAdminKey ? " is-selected" : ""}" type="button" data-platform-entry-key="${escapeHtml(key)}"><span class="platform-admin-roster-avatar is-invite">${escapeHtml(platformAdminInitials(invite.email))}</span><span><strong>${escapeHtml(invite.email || "Unknown invite")}</strong><small>${escapeHtml(status)} · expires ${escapeHtml(formatAdminDate(invite.expires_at))}</small></span></button>`;
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
    if (data.invite?.id) selectedPlatformAdminKey = `invite:${data.invite.id}`;
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
  const fileCount = Number(index.fileCount || 0);
  const chunkCount = Number(index.chunkCount || 0);
  const generated = index.generatedAt ? formatDate(index.generatedAt) : "not generated";
  if (element) element.textContent = fileCount && chunkCount ? "Private index ready for grounded search." : "The private index is not ready.";
  const fileCountElement = document.getElementById("codebase-ai-file-count");
  const chunkCountElement = document.getElementById("codebase-ai-chunk-count");
  const generatedElement = document.getElementById("codebase-ai-index-generated");
  if (fileCountElement) fileCountElement.textContent = fileCount.toLocaleString();
  if (chunkCountElement) chunkCountElement.textContent = chunkCount.toLocaleString();
  if (generatedElement) generatedElement.textContent = generated;
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

function renderCodebaseHistory() {
  const history = document.getElementById("codebase-ai-history");
  const count = document.getElementById("codebase-ai-history-count");
  if (count) count.textContent = `${codebaseTurns.length} question${codebaseTurns.length === 1 ? "" : "s"}`;
  if (!history) return;
  history.innerHTML = codebaseTurns.length ? codebaseTurns.map((turn, index) => `<button class="codebase-ai-history-item${turn.id === selectedCodebaseTurnId ? " is-selected" : ""}" type="button" data-codebase-turn-id="${escapeHtml(turn.id)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(turn.question)}</strong></button>`).join("") : "<p>No questions in this conversation.</p>";
}

function renderCodebaseAnswer(data = {}, question = "") {
  const answer = document.getElementById("codebase-ai-answer");
  const text = document.getElementById("codebase-ai-answer-text");
  const sources = document.getElementById("codebase-ai-sources");
  const sourceList = document.getElementById("codebase-ai-source-list");
  if (!answer || !text || !sources || !sourceList) return;
  currentCodebaseAnswerText = String(data.answer || "");
  text.innerHTML = renderSafeMarkdown(currentCodebaseAnswerText);
  const questionElement = document.getElementById("codebase-ai-answer-question");
  if (questionElement) questionElement.textContent = question || "Codebase question";
  const list = Array.isArray(data.sources) ? data.sources : [];
  sourceList.innerHTML = list.map((source) => `<li>${escapeHtml(source)}</li>`).join("");
  sources.classList.toggle("hidden", !list.length);
  document.getElementById("codebase-ai-empty-response")?.classList.add("hidden");
  answer.classList.remove("hidden");
  renderCodebaseIndex(data.index || {});
  document.getElementById("codebase-ai-response-pane")?.scrollTo({ top: 0, behavior: "smooth" });
}

function resetCodebaseConversation() {
  codebaseHistory = [];
  codebaseTurns = [];
  selectedCodebaseTurnId = "";
  currentCodebaseAnswerText = "";
  document.getElementById("codebase-ai-answer")?.classList.add("hidden");
  document.getElementById("codebase-ai-empty-response")?.classList.remove("hidden");
  const input = document.getElementById("codebase-ai-question");
  if (input) input.value = "";
  const count = document.getElementById("codebase-ai-character-count");
  if (count) count.textContent = "0";
  renderCodebaseHistory();
  input?.focus();
  setStatus("New Codebase AI conversation started.", "success");
}

async function copyCodebaseAnswer() {
  if (!currentCodebaseAnswerText) return;
  try {
    await navigator.clipboard.writeText(currentCodebaseAnswerText);
    setStatus("Codebase answer copied.", "success");
  } catch {
    setStatus("Copy failed. Select the answer text and copy it manually.", "error");
  }
}

async function askCodebase(event) {
  event.preventDefault();
  const input = document.getElementById("codebase-ai-question");
  const submit = document.getElementById("codebase-ai-submit");
  const question = String(input?.value || "").trim();
  if (!question) return;
  submit.disabled = true;
  submit.textContent = "Searching…";
  document.getElementById("codebase-ai-response-pane")?.classList.add("is-loading");
  setStatus("Searching the private codebase and preparing an answer…");
  try {
    const data = await codebaseRequest("", {
      method: "POST",
      body: JSON.stringify({ question, history: codebaseHistory }),
    });
    const turn = { id: `${Date.now()}-${codebaseTurns.length}`, question, answer: data.answer || "", sources: data.sources || [], index: data.index || {} };
    codebaseTurns = [...codebaseTurns, turn].slice(-20);
    selectedCodebaseTurnId = turn.id;
    renderCodebaseHistory();
    renderCodebaseAnswer(data, question);
    codebaseHistory = [...codebaseHistory, { role: "user", content: question }, { role: "assistant", content: data.answer }].slice(-8);
    input.value = "";
    const characterCount = document.getElementById("codebase-ai-character-count");
    if (characterCount) characterCount.textContent = "0";
    setStatus("Answer grounded in the current private code index.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Ask Codebase AI";
    document.getElementById("codebase-ai-response-pane")?.classList.remove("is-loading");
  }
}

async function loadCodebaseAi() {
  const form = document.getElementById("codebase-ai-form");
  const input = document.getElementById("codebase-ai-question");
  form?.addEventListener("submit", askCodebase);
  input?.addEventListener("input", () => {
    const count = document.getElementById("codebase-ai-character-count");
    if (count) count.textContent = String(input.value.length);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });
  document.getElementById("codebase-ai-new")?.addEventListener("click", resetCodebaseConversation);
  document.getElementById("codebase-ai-copy-answer")?.addEventListener("click", copyCodebaseAnswer);
  document.querySelector(".codebase-ai-prompt-section")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-codebase-prompt]");
    if (!button || !input) return;
    input.value = button.dataset.codebasePrompt || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  document.getElementById("codebase-ai-history")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-codebase-turn-id]");
    if (!button) return;
    const turn = codebaseTurns.find((item) => item.id === button.dataset.codebaseTurnId);
    if (!turn) return;
    selectedCodebaseTurnId = turn.id;
    renderCodebaseHistory();
    renderCodebaseAnswer(turn, turn.question);
  });
  renderCodebaseHistory();
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
  container.innerHTML = list.map((row, index) => {
    const value = Number(row?.[metric] || 0);
    const rawLabel = row?.[key];
    const label = key === "requestPath"
      ? String(rawLabel || "/")
      : analyticsLabel(rawLabel, key === "referrerHostname" ? "Direct / none" : "Unknown");
    const width = Math.max(4, Math.round((value / maximum) * 100));
    return `
      <div class="analytics-list-row">
        <div><em>${String(index + 1).padStart(2, "0")}</em><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><strong>${formatAnalyticsNumber(value)}</strong></div>
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
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = "Connection required";
}

function renderAnalytics(data = {}) {
  document.getElementById("analytics-configuration")?.classList.add("hidden");
  document.getElementById("analytics-dashboard")?.classList.remove("hidden");
  const totals = data.totals || {};
  document.getElementById("analytics-visitors").textContent = formatAnalyticsNumber(totals.visitors);
  document.getElementById("analytics-pageviews").textContent = formatAnalyticsNumber(totals.pageviews);
  document.getElementById("analytics-pages-per-visitor").textContent = formatAnalyticsNumber(totals.pagesPerVisitor, 2);
  document.getElementById("analytics-events").textContent = formatAnalyticsNumber(totals.events);
  const periodLabel = document.getElementById("analytics-period-label");
  if (periodLabel) periodLabel.textContent = data.period?.label || "Current range";
  const updated = document.getElementById("analytics-updated");
  if (updated) {
    updated.textContent = `${data.period?.label || "Current range"} · Updated ${formatDate(data.generatedAt)}${data.cached ? " · cached" : ""}`;
  }
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = `Updated ${formatDate(data.generatedAt)}${data.cached ? " · cached" : ""}`;
  renderAnalyticsChart(data.trend);
  const availability = data.availability || {};
  renderAnalyticsList("analytics-pages", data.breakdowns?.pages, "requestPath", "visitors", "No data recorded", availability.pages !== "unavailable");
  renderAnalyticsList("analytics-referrers", data.breakdowns?.referrers, "referrerHostname", "visitors", "No data recorded", availability.referrers !== "unavailable");
  renderAnalyticsList("analytics-countries", data.breakdowns?.countries, "country", "visitors", "No data recorded", availability.countries !== "unavailable");
  renderAnalyticsList("analytics-devices", data.breakdowns?.devices, "deviceType", "visitors", "No data recorded", availability.devices !== "unavailable");
  renderAnalyticsList("analytics-event-list", data.breakdowns?.events, "eventName", "count", "No custom events recorded", availability.events !== "unavailable");
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  const warningList = document.getElementById("analytics-warnings");
  if (warningList) {
    warningList.innerHTML = warnings.map((warning) => `<div><span>${escapeHtml(analyticsLabel(warning.section, "Report section"))}</span><strong>${escapeHtml(warning.message || "This report section could not be loaded.")}</strong></div>`).join("");
    warningList.classList.toggle("hidden", !warnings.length);
  }
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
  const sourceUpdated = document.getElementById("analytics-source-updated");
  if (sourceUpdated) sourceUpdated.textContent = "Loading current data…";
  setStatus("Loading Vercel Analytics…");
  try {
    renderAnalytics(await analyticsRequest(days, force));
  } catch (error) {
    if (error.code === "vercel_analytics_not_configured") renderAnalyticsConfiguration(error);
    else if (sourceUpdated) sourceUpdated.textContent = "Report unavailable";
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
    document.getElementById("account-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-account-id]");
      if (!button) return;
      const select = document.getElementById("account-select");
      if (select) select.value = button.dataset.accountId;
      renderAccountOptions(document.getElementById("account-search")?.value || "");
    });
    await loadAccounts();
  } else if (view === "files") {
    const files = await import("/account/admin/files/files.js?v=18");
    await files.startFiles({ supabase, session, invoke });
  } else if (view === "business-info") {
    const businessInformation = await import("/account/admin/business-info/business-info.js?v=1");
    await businessInformation.startBusinessInformation({ invoke });
  } else if (view === "billing") {
    document.getElementById("billing-filter")?.addEventListener("input", renderBilling);
    document.getElementById("billing-product")?.addEventListener("change", renderBilling);
    document.getElementById("billing-health")?.addEventListener("change", renderBilling);
    document.getElementById("billing-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-billing-key]");
      if (!button) return;
      selectedBillingKey = button.dataset.billingKey || "";
      renderBilling();
    });
    await loadBilling();
  } else if (view === "operations") {
    const operations = await import("/account/admin/operations/operations.js?v=11");
    await operations.startOperations({ supabase, session, invoke });
  } else if (view === "support") {
    document.getElementById("support-search")?.addEventListener("input", renderSupportOptions);
    document.getElementById("support-filter")?.addEventListener("change", renderSupportOptions);
    document.getElementById("support-priority-filter")?.addEventListener("change", renderSupportOptions);
    document.getElementById("support-select")?.addEventListener("change", renderSelectedSupport);
    document.getElementById("support-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-support-request-id]");
      if (!button) return;
      const select = document.getElementById("support-select");
      if (select) select.value = button.dataset.supportRequestId || "";
      renderSupportOptions();
    });
    await loadSupport();
  } else if (view === "platform-admins") {
    document.getElementById("platform-admin-invite-form")?.addEventListener("submit", createPlatformAdminInvite);
    document.getElementById("platform-admin-refresh")?.addEventListener("click", loadPlatformAdmins);
    document.getElementById("platform-admin-copy-invite")?.addEventListener("click", copyPlatformAdminInvite);
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
    document.body.classList.add("admin-ready");
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
  document.body.classList.add("admin-ready");
}

if (!window.__n3xraAdminSoftNavigation) {
  startAdmin().catch((error) => {
    document.body.classList.add("admin-ready");
    setStatus(error.message || "Unable to load admin app.", "error");
  });
}
