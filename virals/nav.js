import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";

const header = document.querySelector(".virals-topbar");
const toggle = document.getElementById("virals-nav-toggle");
const menu = document.getElementById("virals-menu");
const authLink = document.getElementById("virals-header-auth-link");
let accountModal = document.getElementById("virals-account-modal");
let accountCloseButton = document.getElementById("virals-account-close");
let accountSignoutButton = document.getElementById("virals-account-signout");
let accountEmail = document.getElementById("virals-account-email");
let accountPlan = document.getElementById("virals-account-plan");
let accountUsage = document.getElementById("virals-account-usage");
let accountSaved = document.getElementById("virals-account-saved");
let accountStatus = document.getElementById("virals-account-status");
let accountBillingPanel = null;
let creatorPanel = null;
let adminPanel = null;
const mobileDockItems = [
  { href: "/virals/", label: "Analyze", icon: "analyze" },
  { href: "/virals/most-searched-videos/", label: "Most Searched", icon: "search" },
  { href: "/virals/saved-scripts/", label: "Saved Scripts", icon: "saved" },
];

let supabase = null;
let currentSession = null;
let accountState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(cents) {
  const amount = Number(cents || 0) / 100;
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function normalizePath(path) {
  if (!path) return "/";
  const clean = path.split("#")[0].split("?")[0];
  return clean.endsWith("/") ? clean : `${clean}/`;
}

function isActivePath(href) {
  return normalizePath(window.location.pathname) === normalizePath(href);
}

function prepareMobileMenu() {
  return;
}

function renderMobileDock() {
  if (document.querySelector(".virals-mobile-dock")) return;
  const icons = {
    analyze: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M18.5 3.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"></path></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l5.5-5.5 4 4L20 9"></path><path d="M15 9h5v5"></path></svg>',
    saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.2L7 20z"></path></svg>',
  };
  const dock = document.createElement("nav");
  dock.className = "virals-mobile-dock";
  dock.setAttribute("aria-label", "N3XRA Virals mobile navigation");
  dock.innerHTML = mobileDockItems
    .map((item) => {
      const active = isActivePath(item.href) ? " is-active" : "";
      const primary = item.primary ? " is-primary" : "";
      return `
        <a class="mobile-dock-link${active}${primary}" href="${item.href}" aria-label="${item.label}">
          <span class="mobile-dock-icon mobile-dock-icon-${item.icon}">${icons[item.icon] || ""}</span>
          <span>${item.label}</span>
        </a>
      `;
    })
    .join("");
  document.body.appendChild(dock);
}

function getLoginUrl() {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/virals/";
  return `/n3xra-virals/login/?next=${encodeURIComponent(next)}`;
}

function ensureAccountModal() {
  if (!accountModal) {
    const wrapper = document.createElement("div");
    wrapper.className = "virals-account-modal is-hidden";
    wrapper.id = "virals-account-modal";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", "virals-account-title");
    wrapper.hidden = true;
    document.body.appendChild(wrapper);
    accountModal = wrapper;
  }
  accountModal.innerHTML = `
    <section class="virals-account-card">
      <button class="virals-account-close" id="virals-account-close" type="button" aria-label="Close account settings">Close</button>
      <p class="panel-kicker">N3XRA Virals</p>
      <h2 id="virals-account-title">Account Settings</h2>
      <div class="virals-account-grid">
        <article class="virals-account-stat">
          <span>Email</span>
          <strong id="virals-account-email">Signed in</strong>
        </article>
        <article class="virals-account-stat">
          <span>Plan</span>
          <strong id="virals-account-plan">Free Beta</strong>
        </article>
        <article class="virals-account-stat">
          <span>Usage</span>
          <strong id="virals-account-usage">Beta access</strong>
        </article>
        <article class="virals-account-stat">
          <span>Library</span>
          <strong id="virals-account-saved">Connected</strong>
        </article>
      </div>
      <div id="virals-account-billing-panel"></div>
      <div id="virals-creator-panel"></div>
      <div id="virals-admin-panel"></div>
      <div class="virals-account-actions">
        <button class="virals-access-secondary" id="virals-billing-portal" type="button">Billing Portal</button>
        <button class="virals-access-secondary" id="virals-account-signout" type="button">Sign Out</button>
      </div>
      <p class="status" id="virals-account-status">Virals billing and plan management will stay inside this app.</p>
    </section>
  `;
  accountCloseButton = document.getElementById("virals-account-close");
  accountSignoutButton = document.getElementById("virals-account-signout");
  accountEmail = document.getElementById("virals-account-email");
  accountPlan = document.getElementById("virals-account-plan");
  accountUsage = document.getElementById("virals-account-usage");
  accountSaved = document.getElementById("virals-account-saved");
  accountStatus = document.getElementById("virals-account-status");
  accountBillingPanel = document.getElementById("virals-account-billing-panel");
  creatorPanel = document.getElementById("virals-creator-panel");
  adminPanel = document.getElementById("virals-admin-panel");
  accountCloseButton?.addEventListener("click", hideAccountModal);
  accountSignoutButton?.addEventListener("click", handleAccountSignout);
}

function authHeaders() {
  return currentSession?.access_token ? { Authorization: `Bearer ${currentSession.access_token}` } : {};
}

async function loadAccountState() {
  if (!currentSession?.access_token) return null;
  const response = await fetch("/api/virals-account", { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Unable to load Virals account.");
  accountState = payload;
  return payload;
}

function renderBillingPlans(state) {
  const plans = state?.plans || {};
  const currentPlan = state?.profile?.plan || "free";
  const ordered = ["starter", "creator", "pro", "agency"];
  accountBillingPanel.innerHTML = `
    <details class="virals-settings-panel virals-settings-disclosure">
      <summary>
        <span class="panel-kicker">Plans</span>
        <strong>Billing Plans</strong>
      </summary>
      <div class="virals-plan-grid" aria-label="Virals plan options">
        ${ordered.map((planId) => {
          const plan = plans[planId] || {};
          const isCurrent = currentPlan === planId;
          return `
            <article class="virals-plan-card${isCurrent ? " is-current" : ""}">
              <span>${isCurrent ? "Current" : "Plan"}</span>
              <h3>${escapeHtml(plan.name || planId)}</h3>
              <p><strong>${escapeHtml(plan.priceLabel || "")}</strong> · ${Number(plan.monthlyAnalysisLimit || 0).toLocaleString()} analysis credits per month.</p>
              <button type="button" data-virals-checkout="${escapeHtml(planId)}" ${isCurrent ? "disabled" : ""}>${isCurrent ? "Current Plan" : "Choose Plan"}</button>
            </article>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function renderCreatorPanel(state) {
  const creator = state?.creator;
  if (creator) {
    const pending = formatMoney(creator.stats?.pendingCommission || 0);
    const paid = formatMoney(creator.stats?.paidCommission || 0);
    creatorPanel.innerHTML = `
      <details class="virals-settings-panel virals-settings-disclosure">
        <summary>
          <span class="panel-kicker">Creator Program</span>
          <strong>${escapeHtml(creator.status === "approved" ? "Creator Dashboard" : "Application Status")}</strong>
        </summary>
        <p>Status: <strong>${escapeHtml(creator.status)}</strong> · Code: <strong>${escapeHtml(creator.normalizedCode)}</strong></p>
        <p>${Number(creator.commissionRate * 100 || 0).toFixed(0)}% recurring commission. ${Number(creator.customerDiscountPercent || 0)}% customer discount for ${Number(creator.customerDiscountMonths || 0)} months.</p>
        <div class="virals-account-grid">
          <article class="virals-account-stat"><span>Referrals</span><strong>${Number(creator.stats?.activeReferrals || 0)}</strong></article>
          <article class="virals-account-stat"><span>Pending</span><strong>${pending}</strong></article>
          <article class="virals-account-stat"><span>Paid</span><strong>${paid}</strong></article>
        </div>
        ${creator.status === "approved" ? `<button class="virals-access-secondary" type="button" data-virals-connect>Stripe payout setup</button>` : ""}
      </details>
    `;
    return;
  }

  creatorPanel.innerHTML = `
    <details class="virals-settings-panel virals-settings-disclosure">
      <summary>
        <span class="panel-kicker">Creator Program</span>
        <strong>Apply to promote N3XRA Virals</strong>
      </summary>
      <p>Founding Creator spots earn 30% recurring commission, standard creators earn 20%. Customer codes give 10% off for the first 3 months.</p>
      <form id="virals-creator-application-form" class="virals-creator-form">
        <label>TikTok username <input name="tiktokUsername" autocomplete="off" placeholder="@yourhandle" required></label>
        <label>Requested promo code <input name="requestedCode" autocomplete="off" placeholder="YOURCODE" required></label>
        <label>Program <select name="requestedProgram"><option value="standard">Standard Creator</option><option value="founding">Founding Creator</option></select></label>
        <label>Audience notes <textarea name="notes" rows="4" placeholder="Tell us about your audience, niche, and how you would promote Virals."></textarea></label>
        <button type="submit">Submit Application</button>
      </form>
    </details>
  `;
}

function renderAdminPanel(state) {
  if (!state?.isAdmin) {
    adminPanel.innerHTML = "";
    return;
  }
  adminPanel.innerHTML = `
    <details class="virals-settings-panel virals-settings-disclosure">
      <summary>
        <span class="panel-kicker">Admin</span>
        <strong>Creator Applications</strong>
      </summary>
      <button class="virals-access-secondary" type="button" data-virals-load-admin>Refresh Applications</button>
      <div id="virals-admin-applications"></div>
    </details>
  `;
}

function renderAccountModal(state = accountState) {
  if (accountEmail) accountEmail.textContent = currentSession?.user?.email || "Signed in";
  const profile = state?.profile;
  if (accountPlan) accountPlan.textContent = profile?.plan_name || "Free";
  if (accountUsage) accountUsage.textContent = profile ? `${profile.analyses_used} / ${profile.monthly_analysis_limit}` : "Loading";
  if (accountSaved) accountSaved.textContent = "Connected";
  if (accountBillingPanel && state) renderBillingPlans(state);
  if (creatorPanel && state) renderCreatorPanel(state);
  if (adminPanel && state) renderAdminPanel(state);
  if (accountStatus) {
    accountStatus.textContent = currentSession?.user
      ? "Virals account loaded."
      : "Log in to connect usage and saved scripts to your Virals account.";
    accountStatus.className = "status";
  }
}

function showAccountModal() {
  if (!currentSession?.user) {
    window.location.assign(getLoginUrl());
    return;
  }
  ensureAccountModal();
  renderAccountModal();
  accountModal?.classList.remove("is-hidden");
  if (accountModal) accountModal.hidden = false;
  document.body.classList.add("modal-open");
  accountCloseButton?.focus();
  loadAccountState()
    .then((state) => renderAccountModal(state))
    .catch((error) => {
      if (accountStatus) {
        accountStatus.textContent = error.message || "Unable to load Virals account.";
        accountStatus.className = "status error";
      }
    });
}

function hideAccountModal() {
  accountModal?.classList.add("is-hidden");
  if (accountModal) accountModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function handleAccountSignout() {
  if (!supabase) return;
  if (accountSignoutButton) accountSignoutButton.disabled = true;
  if (accountStatus) {
    accountStatus.textContent = "Signing out...";
    accountStatus.className = "status";
  }
  try {
    await supabase.auth.signOut();
    currentSession = null;
    hideAccountModal();
    renderAuth();
  } catch (error) {
    if (accountStatus) {
      accountStatus.textContent = error instanceof Error ? error.message : "Unable to sign out.";
      accountStatus.className = "status error";
    }
  } finally {
    if (accountSignoutButton) accountSignoutButton.disabled = false;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function handleCheckout(planId) {
  if (accountStatus) {
    accountStatus.textContent = "Opening Stripe Checkout...";
    accountStatus.className = "status";
  }
  const payload = await postJson("/api/virals-billing", { action: "create-checkout-session", planId });
  if (payload.url) window.location.assign(payload.url);
}

async function handleBillingPortal() {
  if (accountStatus) {
    accountStatus.textContent = "Opening billing portal...";
    accountStatus.className = "status";
  }
  const payload = await postJson("/api/virals-billing", { action: "create-portal-session" });
  if (payload.url) window.location.assign(payload.url);
}

async function handleCreatorApplication(form) {
  const formData = new FormData(form);
  if (accountStatus) {
    accountStatus.textContent = "Submitting creator application...";
    accountStatus.className = "status";
  }
  await postJson("/api/virals-creator-apply", {
    tiktokUsername: formData.get("tiktokUsername"),
    requestedCode: formData.get("requestedCode"),
    requestedProgram: formData.get("requestedProgram"),
    notes: formData.get("notes"),
  });
  await loadAccountState();
  renderAccountModal();
  if (accountStatus) accountStatus.textContent = "Creator application submitted for review.";
}

async function handleConnectOnboarding() {
  if (accountStatus) {
    accountStatus.textContent = "Opening Stripe payout onboarding...";
    accountStatus.className = "status";
  }
  const payload = await postJson("/api/virals-connect", {});
  if (payload.url) window.location.assign(payload.url);
}

function renderAdminApplications(applications = []) {
  const container = document.getElementById("virals-admin-applications");
  if (!container) return;
  if (!applications.length) {
    container.innerHTML = `<p class="status">No creator applications yet.</p>`;
    return;
  }
  container.innerHTML = applications.map((application) => `
    <article class="virals-admin-application">
      <div>
        <strong>@${escapeHtml(application.tiktokUsername)}</strong>
        <span>${escapeHtml(application.status)} · ${escapeHtml(application.normalizedCode)} · ${escapeHtml(application.requestedProgram)}</span>
      </div>
      <p>${escapeHtml(application.aiEvaluation?.summary || "No AI summary.")}</p>
      <div class="virals-account-actions">
        <button type="button" data-virals-admin-approve="${escapeHtml(application.id)}" data-program="standard">Approve Standard</button>
        <button type="button" data-virals-admin-approve="${escapeHtml(application.id)}" data-program="founding">Approve Founding</button>
        <button type="button" data-virals-admin-reject="${escapeHtml(application.id)}">Reject</button>
        ${application.status === "approved" ? `<button type="button" data-virals-admin-payout="${escapeHtml(application.id)}">Pay eligible ${escapeHtml(formatMoney(application.stats?.pendingCommission || 0))}</button>` : ""}
      </div>
    </article>
  `).join("");
}

async function loadAdminApplications() {
  if (accountStatus) {
    accountStatus.textContent = "Loading creator applications...";
    accountStatus.className = "status";
  }
  const response = await fetch("/api/virals-admin-creators", { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Unable to load applications.");
  renderAdminApplications(payload.applications || []);
  if (accountStatus) accountStatus.textContent = "Creator applications loaded.";
}

async function handleAdminAction(button, action) {
  const id = button.dataset.viralsAdminApprove || button.dataset.viralsAdminReject;
  const program = button.dataset.program || "standard";
  if (accountStatus) {
    accountStatus.textContent = `${action === "approve" ? "Approving" : "Rejecting"} creator...`;
    accountStatus.className = "status";
  }
  await postJson("/api/virals-admin-creators", { action, id, program });
  await loadAdminApplications();
}

async function handleAdminPayout(button) {
  const applicationId = button.dataset.viralsAdminPayout;
  if (accountStatus) {
    accountStatus.textContent = "Sending eligible creator payout...";
    accountStatus.className = "status";
  }
  const payload = await postJson("/api/virals-admin-payouts", { applicationId });
  await loadAdminApplications();
  if (accountStatus) accountStatus.textContent = `Paid ${formatMoney(payload.amount || 0)} across ${Number(payload.count || 0)} commission rows.`;
}

function bindAccountModal() {
  ensureAccountModal();
  accountModal?.addEventListener("click", (event) => {
    if (event.target === accountModal) {
      hideAccountModal();
      return;
    }
    const checkout = event.target.closest?.("[data-virals-checkout]");
    const portal = event.target.closest?.("#virals-billing-portal");
    const connect = event.target.closest?.("[data-virals-connect]");
    const loadAdmin = event.target.closest?.("[data-virals-load-admin]");
    const approve = event.target.closest?.("[data-virals-admin-approve]");
    const reject = event.target.closest?.("[data-virals-admin-reject]");
    const payout = event.target.closest?.("[data-virals-admin-payout]");
    Promise.resolve()
      .then(() => {
        if (checkout) return handleCheckout(checkout.dataset.viralsCheckout);
        if (portal) return handleBillingPortal();
        if (connect) return handleConnectOnboarding();
        if (loadAdmin) return loadAdminApplications();
        if (approve) return handleAdminAction(approve, "approve");
        if (reject) return handleAdminAction(reject, "reject");
        if (payout) return handleAdminPayout(payout);
      })
      .catch((error) => {
        if (accountStatus) {
          accountStatus.textContent = error.message || "Virals account action failed.";
          accountStatus.className = "status error";
        }
      });
  });
  accountModal?.addEventListener("submit", (event) => {
    const form = event.target.closest?.("#virals-creator-application-form");
    if (!form) return;
    event.preventDefault();
    handleCreatorApplication(form).catch((error) => {
      if (accountStatus) {
        accountStatus.textContent = error.message || "Unable to submit creator application.";
        accountStatus.className = "status error";
      }
    });
  });
}

function closeMenu() {
  header?.classList.remove("is-menu-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function renderAuth() {
  if (!authLink) return;
  if (currentSession?.user) {
    authLink.textContent = "Account";
    authLink.href = "#virals-account";
    return;
  }
  authLink.textContent = "Login";
  authLink.href = getLoginUrl();
}

async function initAuth() {
  if (!hasConfig()) {
    renderAuth();
    return;
  }
  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase).catch(() => null);
  renderAuth();
  supabase?.auth?.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    renderAuth();
  });
}

toggle?.addEventListener("click", () => {
  const isOpen = header?.classList.toggle("is-menu-open");
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

menu?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});

authLink?.addEventListener("click", (event) => {
  if (!currentSession?.user) return;
  event.preventDefault();
  showAccountModal();
  closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    hideAccountModal();
  }
});

prepareMobileMenu();
renderMobileDock();
bindAccountModal();
initAuth();
