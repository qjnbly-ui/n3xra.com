import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getAppUrl,
  getConfig,
  getSessionOrNull,
  getSupabaseAuthCallbackType,
  hasConfig,
} from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail, isPlatformOwnerEmail, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const accountPanel = document.getElementById("account-panel");
const accountNavLink = document.getElementById("account-nav-link");
const authCard = document.getElementById("auth-card");
const recoveryCard = document.getElementById("recovery-card");
const dashboardCard = document.getElementById("dashboard-card");
const accountStatus = document.getElementById("account-status");
const signinForm = document.getElementById("signin-form");
const signupForm = document.getElementById("signup-form");
const showSigninButton = document.getElementById("show-signin-button");
const showSignupButton = document.getElementById("show-signup-button");
const forgotPasswordButton = document.getElementById("forgot-password-button");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const inviteCodeField = document.getElementById("invite-code-field");
const signupInviteCodeInput = document.getElementById("signup-invite-code");
const signupReferralCodeInput = document.getElementById("signup-referral-code");
const signupReferralStatus = document.getElementById("signup-referral-status");
const authCaptchaField = document.getElementById("auth-captcha-field");
const authTurnstile = document.getElementById("auth-turnstile");
const recoveryForm = document.getElementById("recovery-form");
const profileForm = document.getElementById("profile-form");
const passwordForm = document.getElementById("password-form");
const phoneAccessForm = document.getElementById("phone-access-form");
const phoneAccessDisclosure = document.getElementById("phone-access-disclosure");
const accountPhoneInput = document.getElementById("account-phone");
const accountPhonePinInput = document.getElementById("account-phone-pin");
const accountPhonePinConfirmInput = document.getElementById("account-phone-pin-confirm");
const accountPinState = document.getElementById("account-pin-state");
const accountSmsConsentInput = document.getElementById("account-sms-consent");
const accountSmsState = document.getElementById("account-sms-state");
const accountName = document.getElementById("account-name");
const accountEmail = document.getElementById("account-email");
const profileFullNameInput = document.getElementById("profile-full-name");
const settingsAccountEmail = document.getElementById("settings-account-email");
const accountSettingsModal = document.getElementById("account-settings-modal");
const openAccountSettingsButton = document.getElementById("open-account-settings");
const closeAccountSettingsButton = document.getElementById("close-account-settings");
const doneAccountSettingsButton = document.getElementById("done-account-settings");
const settingsStatus = document.getElementById("settings-status");
const recordsSummary = document.getElementById("records-summary");
const musicSummary = document.getElementById("music-summary");
const viralsSummary = document.getElementById("virals-summary");
const websitePortalSummary = document.getElementById("website-portal-summary");
const websitePortalLink = document.getElementById("website-portal-link");
const openRecordsButton = document.getElementById("open-records-button");
const openAdminViralsButton = document.getElementById("open-admin-virals-button");
const openAdminMusicButton = document.getElementById("open-admin-music-button");
const openMusicButton = document.getElementById("open-music-button");
const openViralsButton = document.getElementById("open-virals-button");
const recordsAppCard = document.getElementById("records-app-card");
const websitePortalCard = document.getElementById("website-portal-card");
const musicAppCard = document.getElementById("music-app-card");
const viralsAppCard = document.getElementById("virals-app-card");
const partnerPortalCard = document.getElementById("partner-portal-card");
const partnerPortalKicker = document.getElementById("partner-portal-kicker");
const partnerPortalTitle = document.getElementById("partner-portal-title");
const partnerPortalSummary = document.getElementById("partner-portal-summary");
const partnerPortalLink = document.getElementById("partner-portal-link");
const investmentInterestCard = document.getElementById("investment-interest-card");
const investmentInterestSummary = document.getElementById("investment-interest-summary");
const investmentInterestLink = document.getElementById("investment-interest-link");
const loanTrackerAppCard = document.getElementById("loan-tracker-app-card");
const loanTrackerSummary = document.getElementById("loan-tracker-summary");
const connectedAppsGrid = document.getElementById("connected-apps-grid");
const availableAppsGrid = document.getElementById("available-apps-grid");
const connectedAppsEmpty = document.getElementById("connected-apps-empty");
const availableAppsEmpty = document.getElementById("available-apps-empty");
const appsDashboardView = document.getElementById("apps-dashboard-view");
const adminAppSection = document.getElementById("admin-app-section");
const dashboardViewToggle = document.getElementById("dashboard-view-toggle");
const showAppsViewButton = document.getElementById("show-apps-view");
const showAdminViewButton = document.getElementById("show-admin-view");
const accountOverviewActions = document.querySelector(".account-overview-actions");
const adminNotificationButton = document.getElementById("admin-notification-button");
const adminNotificationCount = document.getElementById("admin-notification-count");

let supabase = null;
let currentSession = null;
let memberships = [];
let musicProfile = null;
let viralsProfile = null;
let websiteServiceRequest = null;
let loanAccount = null;
let platformAdminAccess = null;
let validatedSignupReferralCode = "";
let signupReferralTimer = null;
let phoneAccessConfigured = false;
let savedAccountPhone = "";
let smsConsentActive = false;

function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

function setSignupReferralStatus(message, state = "") {
  if (!signupReferralStatus) return;
  signupReferralStatus.textContent = message;
  signupReferralStatus.classList.toggle("is-valid", state === "valid");
  signupReferralStatus.classList.toggle("is-error", state === "error");
}

async function validateSignupReferralCode({ required = false } = {}) {
  if (!signupReferralCodeInput) return true;
  const code = normalizeReferralCode(signupReferralCodeInput.value);
  signupReferralCodeInput.value = code;
  signupReferralCodeInput.setCustomValidity("");

  if (!code) {
    validatedSignupReferralCode = "";
    setSignupReferralStatus("If a N3XRA partner referred you, enter their code here. It will be permanently connected to your account.");
    return true;
  }
  if (code.length < 4) {
    const message = "Referral codes contain at least four letters or numbers.";
    validatedSignupReferralCode = "";
    setSignupReferralStatus(message, "error");
    if (required) signupReferralCodeInput.setCustomValidity(message);
    return false;
  }
  if (validatedSignupReferralCode === code) return true;

  setSignupReferralStatus("Checking referral code…");
  try {
    const response = await fetch(`/api/website-referral-code?scope=account&code=${encodeURIComponent(code)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to check this code.");
    if (!data.valid) {
      const message = "That partner referral code is not valid.";
      validatedSignupReferralCode = "";
      setSignupReferralStatus(message, "error");
      if (required) signupReferralCodeInput.setCustomValidity(message);
      return false;
    }
    validatedSignupReferralCode = code;
    setSignupReferralStatus("Referral code applied. It will be permanently connected when this account is created.", "valid");
    return true;
  } catch (error) {
    const message = error?.message || "Unable to check this referral code right now.";
    validatedSignupReferralCode = "";
    setSignupReferralStatus(message, "error");
    if (required) signupReferralCodeInput.setCustomValidity(message);
    return false;
  }
}
let captchaToken = "";
let captchaWidgetId = null;
let captchaEnabled = false;
let isSubmitting = false;
let canViewAdminApps = false;

const ADMIN_ACCESS_CACHE_PREFIX = "n3xra-admin-access-v1:";
const DASHBOARD_VIEW_CACHE_PREFIX = "n3xra-dashboard-view-v1:";

function userStorageKey(prefix) {
  return currentSession?.user?.id ? `${prefix}${currentSession.user.id}` : "";
}

function readStoredValue(prefix) {
  const key = userStorageKey(prefix);
  if (!key) return "";
  try { return window.localStorage.getItem(key) || ""; } catch { return ""; }
}

function writeStoredValue(prefix, value) {
  const key = userStorageKey(prefix);
  if (!key) return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* Storage is a display optimization only. */ }
}

function hasCachedAdminAccess() {
  return ["owner", "admin"].includes(readStoredValue(ADMIN_ACCESS_CACHE_PREFIX));
}

function hasFullPlatformAdminAccess(access) {
  return ["owner", "admin"].includes(String(access?.role || ""));
}

function getPreferredDashboardView() {
  return readStoredValue(DASHBOARD_VIEW_CACHE_PREFIX) === "admin" ? "admin" : "apps";
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function placeAppCard(card, connected, state = connected ? "connected" : "available") {
  if (!card) return;
  const destination = connected ? connectedAppsGrid : availableAppsGrid;
  destination?.append(card);
  card.classList.toggle("is-connected", connected);
  card.classList.toggle("is-available", !connected);
  card.classList.toggle("is-pending", state === "pending");
  card.classList.toggle("is-action-required", state === "action-required");
  const badge = card.querySelector(".app-access-badge");
  if (badge) {
    badge.textContent = state === "pending"
      ? "Setup pending"
      : state === "action-required"
        ? "Action required"
        : connected
          ? "Connected"
          : "Available";
  }
  show(card, true);
}

function websiteAppState(status) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (normalizedStatus === "needs_info" || normalizedStatus === "proposal_sent") return "action-required";
  if (["draft", "submitted", "reviewing", "proposal_drafting"].includes(normalizedStatus)) return "pending";
  return "connected";
}

function updateAppSectionEmptyStates() {
  const connectedCount = connectedAppsGrid?.querySelectorAll(".app-card:not(.hidden)").length || 0;
  const availableCount = availableAppsGrid?.querySelectorAll(".app-card:not(.hidden)").length || 0;
  show(connectedAppsEmpty, connectedCount === 0);
  show(availableAppsEmpty, availableCount === 0);
}

function formatAppStatus(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setDashboardView(requestedView = "apps") {
  const view = requestedView === "admin" && canViewAdminApps ? "admin" : "apps";
  const showingApps = view === "apps";

  show(appsDashboardView, showingApps);
  show(adminAppSection, !showingApps);
  showAppsViewButton?.classList.toggle("is-active", showingApps);
  showAdminViewButton?.classList.toggle("is-active", !showingApps);
  showAppsViewButton?.setAttribute("aria-selected", String(showingApps));
  showAdminViewButton?.setAttribute("aria-selected", String(!showingApps));
  if (showAppsViewButton) showAppsViewButton.tabIndex = showingApps ? 0 : -1;
  if (showAdminViewButton) showAdminViewButton.tabIndex = showingApps ? -1 : 0;
  if (canViewAdminApps) writeStoredValue(DASHBOARD_VIEW_CACHE_PREFIX, view);
}

function setStatus(message, tone = "") {
  [accountStatus, settingsStatus].forEach((statusEl) => {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = statusEl === settingsStatus ? "status account-modal-status" : "status account-status";
    if (tone) statusEl.classList.add(tone);
  });
}

function updateAccountNav(isSignedIn = false) {
  if (!accountNavLink) return;
  accountNavLink.textContent = isSignedIn ? "Sign out" : "Login";
  accountNavLink.href = "/account";
  accountNavLink.dataset.authState = isSignedIn ? "signed-in" : "signed-out";
}

function getErrorMessage(error, fallback) {
  if (error && typeof error === "object" && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getAuthErrorMessage(error) {
  const message = getErrorMessage(error, "Unable to sign in.");
  const normalized = message.toLowerCase();
  if (normalized.includes("email not confirmed") || normalized.includes("email_not_confirmed")) {
    return "Email not confirmed. Please open the confirmation email we sent and confirm your account before signing in. If you do not see it, check your junk or spam folder.";
  }
  return message;
}

function getHashErrorMessage() {
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const error = hashParams.get("error_description") || hashParams.get("error");
  return error ? error.replaceAll("+", " ") : "";
}

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function shouldUseTurnstileTestMode() {
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
}

function getTurnstileSiteKey() {
  if (shouldUseTurnstileTestMode()) return TURNSTILE_TEST_SITE_KEY;
  return String(getConfig().turnstileSiteKey || "").trim();
}

function resetCaptcha() {
  captchaToken = "";
  if (!window.turnstile || captchaWidgetId === null) return;
  window.turnstile.reset(captchaWidgetId);
}

async function waitForTurnstile(maxWaitMs = 5000) {
  const startedAt = Date.now();
  while (!window.turnstile) {
    if (Date.now() - startedAt > maxWaitMs) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return true;
}

async function initCaptcha() {
  const siteKey = getTurnstileSiteKey();
  captchaEnabled = Boolean(siteKey);
  show(authCaptchaField, captchaEnabled);
  if (!siteKey) return;

  const ready = await waitForTurnstile();
  if (!ready || !authTurnstile) {
    setStatus("Security check failed to load. Refresh and try again.", "error");
    return;
  }

  captchaWidgetId = window.turnstile.render(authTurnstile, {
    sitekey: siteKey,
    callback: (token) => {
      captchaToken = token;
    },
    "expired-callback": () => {
      captchaToken = "";
    },
    "error-callback": () => {
      captchaToken = "";
    },
  });
}

async function verifyCaptchaServerSide() {
  if (!captchaEnabled) return;
  if (shouldUseTurnstileTestMode()) return;
  if (!captchaToken) throw new Error("Complete the security check first.");

  const response = await fetch("/api/verify-captcha", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ captchaToken }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Captcha verification failed.");
  }
}

function getSafeNextPath() {
  const params = new URLSearchParams(window.location.search);
  const next = String(params.get("next") || "").trim();
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "";
  return next;
}

function getRequestedApp() {
  const params = new URLSearchParams(window.location.search);
  const app = String(params.get("app") || "").trim().toLowerCase();
  if (["records", "music", "virals"].includes(app)) return app;

  const next = getSafeNextPath();
  if (next.startsWith("/ai-music-generator/")) return "music";
  if (next.startsWith("/n3xra-virals/")) return "virals";
  if (next.startsWith("/app/") || next.startsWith("/n3xra-records/")) return "records";
  return "";
}

function getInviteCode() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("invite") || params.get("invite_code") || params.get("code") || signupInviteCodeInput?.value || "").trim();
}

function getPlatformAdminInviteToken() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("admin_invite") || "").trim();
}

function buildAccountRedirectUrl({
  mode = "",
  app = "",
  next = "",
  invite = "",
  adminInvite = "",
  email = "",
  includeDestination = true,
  confirmed = false,
} = {}) {
  const url = new URL(getAppUrl("/account"));
  const nextApp = includeDestination ? app || getRequestedApp() : "";
  const nextPath = includeDestination ? next || getSafeNextPath() : "";
  if (mode) url.searchParams.set("mode", mode);
  if (confirmed) url.searchParams.set("confirmed", "1");
  if (nextApp) url.searchParams.set("app", nextApp);
  if (nextPath) url.searchParams.set("next", nextPath);
  if (invite) {
    url.searchParams.set("signup", "invite");
    url.searchParams.set("invite", invite);
  }
  if (adminInvite) url.searchParams.set("admin_invite", adminInvite);
  if (email) url.searchParams.set("email", email);
  return url.toString();
}

function setAuthMode(mode) {
  const signup = mode === "signup";
  show(signinForm, !signup);
  show(signupForm, signup);
  showSigninButton.classList.toggle("is-active", !signup);
  showSignupButton.classList.toggle("is-active", signup);
  showSigninButton.setAttribute("aria-pressed", String(!signup));
  showSignupButton.setAttribute("aria-pressed", String(signup));
  authTitle.textContent = signup ? "Create account" : "Sign in";
  authSubtitle.textContent = signup ? "Create your N3XRA account." : "Use your N3XRA account to continue.";
  setStatus("");
}

function applyUrlPrefill() {
  const params = new URLSearchParams(window.location.search);
  const requestedSignup = String(params.get("signup") || params.get("mode") || "").trim().toLowerCase();
  const inviteCode = getInviteCode();
  const adminInvite = getPlatformAdminInviteToken();
  const email = String(params.get("email") || "").trim();
  const referralCode = normalizeReferralCode(params.get("ref"));

  if (requestedSignup === "invite" || requestedSignup === "signup" || inviteCode || adminInvite || referralCode) {
    setAuthMode("signup");
    show(inviteCodeField, Boolean(inviteCode));
    if (signupInviteCodeInput) signupInviteCodeInput.value = inviteCode;
    if (signupReferralCodeInput && referralCode) {
      signupReferralCodeInput.value = referralCode;
      validateSignupReferralCode();
    }
  }

  if (email) {
    const signinEmail = document.getElementById("signin-email");
    const signupEmail = document.getElementById("signup-email");
    if (signinEmail) signinEmail.value = email;
    if (signupEmail) signupEmail.value = email;
  }
}

function renderShell(view) {
  show(accountPanel, true);
  accountPanel.classList.toggle("is-dashboard", view === "dashboard");
  show(authCard, view === "auth");
  show(recoveryCard, view === "recovery");
  show(dashboardCard, view === "dashboard");
  show(authCaptchaField, view === "auth" && captchaEnabled);
  updateAccountNav(view === "dashboard" || view === "recovery" || Boolean(currentSession?.user));
  document.title = view === "dashboard"
    ? "N3XRA | Dashboard"
    : view === "recovery"
      ? "N3XRA | Reset Password"
      : "N3XRA | Account Login";
}

async function loadMemberships() {
  const [{ data, error }, { data: entitlementData, error: entitlementError }] = await Promise.all([
    supabase
      .from("organization_memberships")
      .select("role, organization:organizations(id,name,subscription_tier,account_status,owner_user_id)")
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("organization_product_entitlements")
      .select("organization_id,status,portal_enabled")
      .eq("product_key", "records"),
  ]);
  if (error || entitlementError) throw error || entitlementError;

  const activeRecordsOrganizationIds = new Set((entitlementData || [])
    .filter((entitlement) => entitlement.portal_enabled && ["active", "trialing", "past_due"].includes(String(entitlement.status || "")))
    .map((entitlement) => String(entitlement.organization_id)));

  memberships = (data || []).map((membership) => ({
      ...membership,
      organization: Array.isArray(membership.organization) ? membership.organization[0] : membership.organization,
    }))
    .filter((membership) => activeRecordsOrganizationIds.has(String(membership.organization?.id || "")));
}

async function loadMusicProfile() {
  const { data, error } = await supabase
    .from("music_profiles")
    .select("plan, account_status, songs_used, monthly_song_limit")
    .eq("user_id", currentSession.user.id)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  musicProfile = data || null;
}

async function loadViralsProfile() {
  const { data, error } = await supabase
    .from("virals_profiles")
    .select("plan, account_status, analyses_used, monthly_analysis_limit")
    .eq("user_id", currentSession.user.id)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  viralsProfile = data || null;
}

async function loadWebsiteServiceRequest() {
  const { data, error } = await supabase
    .from("website_service_requests")
    .select("id,business_name,status,created_at")
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  websiteServiceRequest = data || null;
}

async function loadLoanAccount() {
  const { data, error } = await supabase
    .from("loan_accounts")
    .select("id,name,lender_name,planned_monthly_payment,status")
    .eq("user_id", currentSession.user.id)
    .eq("status", "active")
    .order("created_at")
    .limit(2);
  if (error && error.code !== "PGRST116") throw error;
  loanAccount = data?.length === 1 ? data[0] : null;
}

async function loadProfileName() {
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", currentSession.user.id)
    .maybeSingle();
  return String(data?.full_name || currentSession.user.user_metadata?.full_name || currentSession.user.email || "").trim();
}

async function loadPartnerAccess() {
  if (!currentSession?.access_token) return false;
  const response = await fetch("/api/partner-portal", {
    headers: { Authorization: `Bearer ${currentSession.access_token}` },
  });
  return response.ok;
}

async function invokePlatformAdmin(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action,
      ...body,
    },
  });
  if (error || data?.error) {
    throw new Error(data?.error || error?.message || "Platform admin request failed.");
  }
  return data || {};
}

async function loadPlatformAdminAccess() {
  if (!currentSession?.user) {
    platformAdminAccess = null;
    return null;
  }

  if (isPlatformAdminEmail(currentSession.user.email)) {
    platformAdminAccess = {
      email: currentSession.user.email,
      role: isPlatformOwnerEmail(currentSession.user.email) ? "owner" : "admin",
      status: "active",
    };
    writeStoredValue(ADMIN_ACCESS_CACHE_PREFIX, platformAdminAccess.role);
    return platformAdminAccess;
  }

  try {
    const data = await invokePlatformAdmin("get-platform-admin-access");
    platformAdminAccess = data.admin || null;
  } catch {
    const cachedRole = readStoredValue(ADMIN_ACCESS_CACHE_PREFIX);
    platformAdminAccess = hasCachedAdminAccess() ? { role: cachedRole, status: "cached" } : null;
  }
  writeStoredValue(ADMIN_ACCESS_CACHE_PREFIX, hasFullPlatformAdminAccess(platformAdminAccess) ? platformAdminAccess.role : "");
  return platformAdminAccess;
}

async function loadInvestmentInterest() {
  if (!currentSession?.user) return null;
  const { data, error } = await supabase
    .from("investment_interest_profiles")
    .select("status,submitted_at,email_updates")
    .eq("user_id", currentSession.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadPhoneAccess() {
  if (!currentSession?.access_token || !phoneAccessForm) return null;
  const response = await fetch("/api/account-phone", {
    headers: { Authorization: `Bearer ${currentSession.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Unable to load phone access.");
  phoneAccessConfigured = Boolean(payload.configured);
  savedAccountPhone = payload.phone || "";
  smsConsentActive = Boolean(payload.smsConsentActive);
  if (accountPhoneInput) accountPhoneInput.value = savedAccountPhone;
  if (accountSmsConsentInput) accountSmsConsentInput.checked = smsConsentActive;
  if (accountSmsState) {
    accountSmsState.textContent = smsConsentActive
      ? "SMS messages are active for this saved number."
      : "SMS messages are currently off.";
    accountSmsState.classList.toggle("is-active", smsConsentActive);
  }
  [accountPhonePinInput, accountPhonePinConfirmInput].forEach((input) => {
    if (!input) return;
    input.value = "";
    input.required = !phoneAccessConfigured;
    input.placeholder = phoneAccessConfigured ? "Enter four digits only to change PIN" : "Enter four digits";
  });
  if (accountPinState) {
    accountPinState.textContent = phoneAccessConfigured
      ? "Phone PIN is saved securely. Leave both PIN fields blank to keep it."
      : "Create a four-digit phone PIN.";
    accountPinState.classList.toggle("is-active", phoneAccessConfigured);
  }
  const clearBrowserAutofill = () => {
    [accountPhonePinInput, accountPhonePinConfirmInput].forEach((input) => {
      if (input && document.activeElement !== input) input.value = "";
    });
  };
  requestAnimationFrame(clearBrowserAutofill);
  window.setTimeout(clearBrowserAutofill, 350);
  return payload;
}

async function maybeRedeemPlatformAdminInvite() {
  const token = getPlatformAdminInviteToken();
  if (!token || !currentSession?.user) return "";

  const data = await invokePlatformAdmin("redeem-platform-admin-invite", { token });
  const url = new URL(window.location.href);
  url.searchParams.delete("admin_invite");
  url.searchParams.delete("mode");
  window.history.replaceState({}, "", url.toString());
  return data?.ok ? (data.role === "reviewer" ? "App reviewer invite redeemed." : "Platform admin invite redeemed.") : "";
}

async function renderDashboard(message = "") {
  renderShell("dashboard");
  setStatus(message);

  accountName.textContent = String(currentSession.user.user_metadata?.full_name || currentSession.user.email || "N3XRA account").trim();
  accountEmail.textContent = currentSession.user.email || "";

  // This cache controls presentation only. Every admin page and privileged request
  // continues to enforce platform-admin authorization independently.
  canViewAdminApps = isPlatformAdminEmail(currentSession.user.email) || hasCachedAdminAccess();
  show(dashboardViewToggle, canViewAdminApps);
  show(adminNotificationButton, canViewAdminApps);
  accountOverviewActions?.classList.toggle("has-admin-tools", canViewAdminApps);
  setDashboardView(getPreferredDashboardView());

  const [, partnerAccess, , investmentInterest] = await Promise.allSettled([
    loadMemberships(),
    loadPartnerAccess(),
    loadPlatformAdminAccess(),
    loadInvestmentInterest(),
    loadWebsiteServiceRequest(),
    loadLoanAccount(),
  ]);
  const isApprovedPartner = partnerAccess.status === "fulfilled" && partnerAccess.value === true;
  const interest = investmentInterest.status === "fulfilled" ? investmentInterest.value : null;

  const firstMembership = memberships[0] || null;
  const recordsOrgName = firstMembership?.organization?.name || "";
  const hasRecordsAccess = Boolean(firstMembership);
  recordsSummary.textContent = hasRecordsAccess
    ? `Connected to ${recordsOrgName || "a Records organization"}.`
    : "No Records library yet. Start one or join an existing organization.";
  openRecordsButton.textContent = hasRecordsAccess ? "Open Records" : "Start Records";

  const hasWebsiteService = Boolean(websiteServiceRequest);
  if (hasWebsiteService) {
    const businessName = String(websiteServiceRequest.business_name || "your website workspace").trim();
    const requestStatus = formatAppStatus(websiteServiceRequest.status);
    websitePortalSummary.textContent = `${businessName} · ${requestStatus || "Active request"}.`;
    websitePortalLink.textContent = "Open Website Portal";
  } else {
    websitePortalSummary.textContent = "No website workspace yet. Start a request when you are ready to build or manage a site.";
    websitePortalLink.textContent = "Start Website Request";
  }

  if (loanAccount && loanTrackerSummary) {
    loanTrackerSummary.textContent = `${loanAccount.lender_name || loanAccount.name} · ${Number(loanAccount.planned_monthly_payment).toLocaleString("en-US", { style: "currency", currency: "USD" })} planned monthly payment.`;
    placeAppCard(loanTrackerAppCard, true);
  } else {
    show(loanTrackerAppCard, false);
  }

  if (isApprovedPartner) {
    partnerPortalKicker.textContent = "Approved partner";
    partnerPortalTitle.textContent = "N3XRA Partners";
    partnerPortalSummary.textContent = "Manage your referral code, balances, referrals, and commission history.";
    partnerPortalLink.href = "/client-portal/partners/";
    partnerPortalLink.textContent = "Open Partner Portal";
  } else {
    partnerPortalKicker.textContent = "Partner program";
    partnerPortalTitle.textContent = "N3XRA Partners";
    partnerPortalSummary.textContent = "Apply to participate in approved N3XRA referral and partner opportunities.";
    partnerPortalLink.href = "/partners/#apply";
    partnerPortalLink.textContent = "Explore Partner Program";
  }

  if (interest && investmentInterestSummary) {
    investmentInterestSummary.textContent = interest.status === "withdrawn"
      ? "Your ownership-update request is withdrawn. You can review or rejoin it."
      : "Your request for future N3XRA ownership updates is connected to this account.";
    investmentInterestLink.href = "/account/investment/";
    investmentInterestLink.textContent = "Open Ownership Updates";
  } else if (investmentInterestSummary) {
    investmentInterestSummary.textContent = "Join the information list for future N3XRA company and ownership updates.";
    investmentInterestLink.href = "/invest/#ownership-updates";
    investmentInterestLink.textContent = "Request Ownership Updates";
  }

  [
    [recordsAppCard, hasRecordsAccess],
    [websitePortalCard, hasWebsiteService, hasWebsiteService ? websiteAppState(websiteServiceRequest.status) : "available"],
    [partnerPortalCard, isApprovedPartner],
    [investmentInterestCard, Boolean(interest && interest.status !== "withdrawn")],
  ].forEach(([card, connected, state]) => placeAppCard(card, connected, state));
  updateAppSectionEmptyStates();

  const displayName = await loadProfileName().catch(() => currentSession.user.email || "N3XRA account");
  accountName.textContent = displayName || "N3XRA account";
  accountEmail.textContent = currentSession.user.email || "";
  if (settingsAccountEmail) settingsAccountEmail.textContent = currentSession.user.email || "-";
  profileFullNameInput.value = displayName || "";

  try {
    await loadPhoneAccess();
    if (!phoneAccessConfigured || !smsConsentActive) {
      openAccountSettings({ focusClose: false });
      if (phoneAccessDisclosure) phoneAccessDisclosure.open = true;
      setStatus(phoneAccessConfigured
        ? "SMS messages are off. Review the saved phone settings and choose whether to opt in."
        : "Add your phone number and a four-digit keypad PIN for secure receptionist access, then choose whether to opt in to SMS.");
      requestAnimationFrame(() => (phoneAccessConfigured ? accountSmsConsentInput : accountPhoneInput)?.focus());
    }
  } catch (error) {
    console.warn("Phone access could not be loaded", error);
  }

  canViewAdminApps = hasFullPlatformAdminAccess(platformAdminAccess) || isPlatformAdminEmail(currentSession.user.email);
  show(dashboardViewToggle, canViewAdminApps);
  show(adminNotificationButton, canViewAdminApps);
  accountOverviewActions?.classList.toggle("has-admin-tools", canViewAdminApps);
  if (canViewAdminApps && adminNotificationCount) {
    const { count } = await supabase
      .from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .is("archived_at", null)
      .is("deleted_at", null);
    const unreadCount = Number(count || 0);
    adminNotificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    show(adminNotificationCount, unreadCount > 0);
  }
  setDashboardView(getPreferredDashboardView());
}

function openAccountSettings({ focusClose = true } = {}) {
  if (!accountSettingsModal) return;
  accountSettingsModal.classList.remove("hidden");
  setStatus("");
  if (focusClose) requestAnimationFrame(() => closeAccountSettingsButton?.focus());
}

function closeAccountSettings() {
  if (!accountSettingsModal) return;
  accountSettingsModal.classList.add("hidden");
}

async function maybeRouteAfterAuth(session) {
  currentSession = session;
  if (getPlatformAdminInviteToken()) {
    try {
      const message = await maybeRedeemPlatformAdminInvite();
      await renderDashboard(message || "Signed in.");
    } catch (error) {
      await renderDashboard(getErrorMessage(error, "Unable to redeem platform admin invite."));
    }
    return;
  }

  const next = getSafeNextPath();
  const requestedApp = getRequestedApp();
  if (!next && !requestedApp) {
    await renderDashboard("Signed in.");
    return;
  }

  if (requestedApp === "music") {
    await openMusic();
    return;
  }

  if (requestedApp === "virals") {
    await openVirals();
    return;
  }

  if (requestedApp === "records" || next.startsWith("/app/") || next.startsWith("/n3xra-records/")) {
    await openRecords();
    return;
  }

  if (next) {
    window.location.assign(next);
    return;
  }

  await renderDashboard("Signed in.");
}

async function handleSignin(event) {
  event.preventDefault();
  if (!supabase || isSubmitting) return;

  isSubmitting = true;
  try {
    await verifyCaptchaServerSide();
    setStatus("Signing in...");
    const email = document.getElementById("signin-email").value.trim();
    const password = document.getElementById("signin-password").value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    currentSession = data.session;
    await maybeRouteAfterAuth(data.session);
  } catch (error) {
    setStatus(getAuthErrorMessage(error), "error");
  } finally {
    isSubmitting = false;
    resetCaptcha();
  }
}

async function handleSignup(event) {
  event.preventDefault();
  if (!supabase || isSubmitting) return;

  const fullName = document.getElementById("signup-full-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirmPassword = document.getElementById("signup-password-confirm").value;
  const inviteCode = getInviteCode();

  if (password !== confirmPassword) {
    setStatus("Passwords do not match.", "error");
    return;
  }
  if (!await validateSignupReferralCode({ required: true })) {
    signupReferralCodeInput?.reportValidity();
    signupReferralCodeInput?.focus();
    return;
  }

  isSubmitting = true;
  try {
    await verifyCaptchaServerSide();
    setStatus("Creating account...");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: buildAccountRedirectUrl({
          invite: inviteCode,
          adminInvite: getPlatformAdminInviteToken(),
          email,
          includeDestination: false,
          confirmed: true,
        }),
        data: {
          full_name: fullName,
          invite_code: inviteCode,
          referral_code: validatedSignupReferralCode,
        },
      },
    });
    if (error) throw error;

    if (data?.session) {
      currentSession = data.session;
      await maybeRouteAfterAuth(data.session);
      return;
    }

    setAuthMode("signin");
    const signinEmail = document.getElementById("signin-email");
    const signinPassword = document.getElementById("signin-password");
    if (signinEmail) signinEmail.value = email;
    if (signinPassword) signinPassword.value = password;
    setStatus("Account created. Please open the confirmation email and confirm your account before signing in. If you do not see it, check your junk or spam folder.", "success");
  } catch (error) {
    setStatus(getAuthErrorMessage(error), "error");
  } finally {
    isSubmitting = false;
    resetCaptcha();
  }
}

async function handleForgotPassword() {
  if (!supabase || isSubmitting) return;

  const email = document.getElementById("signin-email").value.trim();
  if (!email) {
    setStatus("Enter your email address first.", "error");
    return;
  }

  isSubmitting = true;
  try {
    await verifyCaptchaServerSide();
    setStatus("Sending password reset...");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildAccountRedirectUrl({ mode: "recovery", email }),
    });
    if (error) throw error;
    setStatus("Password reset email sent. Check your inbox, junk, or spam folder.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error, "Unable to send password reset."), "error");
  } finally {
    isSubmitting = false;
    resetCaptcha();
  }
}

async function handleRecovery(event) {
  event.preventDefault();
  if (!supabase || isSubmitting || !currentSession?.user) return;

  const password = document.getElementById("recovery-password").value;
  const confirmPassword = document.getElementById("recovery-password-confirm").value;
  if (password.length < 8) {
    setStatus("Use a password with at least 8 characters.", "error");
    return;
  }
  if (password !== confirmPassword) {
    setStatus("Passwords do not match.", "error");
    return;
  }

  isSubmitting = true;
  setStatus("Updating password...");
  const { error } = await supabase.auth.updateUser({ password });
  isSubmitting = false;
  if (error) {
    setStatus(error.message || "Unable to update password.", "error");
    return;
  }

  recoveryForm.reset();
  await renderDashboard("Password updated. Choose an app to continue.");
}

async function openRecords() {
  if (!currentSession?.user) return;

  if (!memberships.length) {
    const inviteCode = String(
      getInviteCode()
      || currentSession.user.user_metadata?.invite_code
      || ""
    ).trim();
    const confirmed = window.confirm(inviteCode
      ? "Join the invited N3XRA Records workspace with this account?"
      : "Create a new N3XRA Records workspace for this account?");
    if (!confirmed) return;

    setStatus(inviteCode ? "Joining Records..." : "Creating your Records workspace...");
    let data = null;
    let error = null;

    if (inviteCode.toUpperCase().startsWith("DEMO-")) {
      const result = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "claim-records-demo-workspace",
          code: inviteCode,
        },
      });
      data = result.data?.error ? null : {
        active_organization_id: result.data?.organizationId || null,
      };
      error = result.error || (result.data?.error ? new Error(result.data.error) : null);
    } else {
      const result = await supabase.rpc("bootstrap_organization", {
        input_organization_name: inviteCode ? null : "Personal",
        input_invite_code: inviteCode || null,
      });
      data = result.data;
      error = result.error;
    }
    if (error) {
      setStatus(error.message || "Unable to open Records.", "error");
      return;
    }
    if (data?.active_organization_id) {
      setStoredActiveOrganizationId(String(data.active_organization_id));
    }
  } else if (memberships[0]?.organization?.id) {
    setStatus("Opening Records...");
    setStoredActiveOrganizationId(String(memberships[0].organization.id));
  }

  window.location.assign("/n3xra-records/library");
}

function openAdminVirals() {
  if (!currentSession?.access_token || !canViewAdminApps) return;
  window.location.assign("/virals/");
}

function openAdminMusic() {
  if (!currentSession?.access_token || !canViewAdminApps) return;
  window.location.assign("/ai-music-generator/app/");
}

async function openMusic() {
  if (!currentSession?.user) return;
  canViewAdminApps = isPlatformAdminEmail(currentSession.user.email) || hasCachedAdminAccess();
  if (canViewAdminApps) {
    openAdminMusic();
    return;
  }
  await renderDashboard("N3XRA AI Music is retired and available only to verified administrators.");
}

async function openVirals() {
  if (!currentSession?.user) return;
  canViewAdminApps = isPlatformAdminEmail(currentSession.user.email) || hasCachedAdminAccess();
  if (canViewAdminApps) {
    openAdminVirals();
    return;
  }
  await renderDashboard("N3XRA Virals is retired and available only to verified administrators.");
}

async function handleProfileSave(event) {
  event.preventDefault();
  if (!currentSession?.user || isSubmitting) return;

  const fullName = profileFullNameInput.value.trim();
  isSubmitting = true;
  setStatus("Saving account...");

  const { error: authError } = await supabase.auth.updateUser({
    data: { full_name: fullName },
  });
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName || null,
      email: currentSession.user.email || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentSession.user.id);

  isSubmitting = false;
  if (authError || profileError) {
    setStatus(authError?.message || profileError?.message || "Unable to save account.", "error");
    return;
  }

  accountName.textContent = fullName || currentSession.user.email || "N3XRA account";
  setStatus("Account name updated.", "success");
}

async function handlePasswordSave(event) {
  event.preventDefault();
  if (!currentSession?.user || isSubmitting) return;

  const password = document.getElementById("account-password").value;
  const confirmPassword = document.getElementById("account-password-confirm").value;
  if (!password && !confirmPassword) {
    setStatus("Enter a new password first.", "error");
    return;
  }
  if (password.length < 8) {
    setStatus("Use a password with at least 8 characters.", "error");
    return;
  }
  if (password !== confirmPassword) {
    setStatus("Passwords do not match.", "error");
    return;
  }

  isSubmitting = true;
  setStatus("Updating password...");
  const { error } = await supabase.auth.updateUser({ password });
  isSubmitting = false;
  if (error) {
    setStatus(error.message || "Unable to update password.", "error");
    return;
  }

  passwordForm.reset();
  setStatus("Password updated.", "success");
}

async function handlePhoneAccessSave(event) {
  event.preventDefault();
  if (!currentSession?.access_token || isSubmitting) return;

  const phone = accountPhoneInput?.value.trim() || "";
  const pin = accountPhonePinInput?.value || "";
  const pinConfirm = accountPhonePinConfirmInput?.value || "";
  const normalizedPhone = String(phone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const normalizedSavedPhone = String(savedAccountPhone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const phoneChanged = normalizedPhone !== normalizedSavedPhone;
  const pinProvided = Boolean(pin || pinConfirm);
  const needsPhoneSave = !phoneAccessConfigured || phoneChanged || pinProvided;
  const requestedSmsConsent = Boolean(accountSmsConsentInput?.checked);
  const consentChanged = requestedSmsConsent !== smsConsentActive;

  if (needsPhoneSave && !/^[0-9]{4}$/.test(pin)) {
    setStatus("Use exactly four digits for your phone PIN.", "error");
    accountPhonePinInput?.focus();
    return;
  }
  if (needsPhoneSave && pin !== pinConfirm) {
    setStatus("Phone PINs do not match.", "error");
    accountPhonePinConfirmInput?.focus();
    return;
  }
  if (!needsPhoneSave && !consentChanged) {
    setStatus("Your phone and SMS settings are already saved.", "success");
    return;
  }

  async function saveSmsPreference(preferencePhone, consent) {
    const response = await fetch("/api/sms-consent", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: preferencePhone,
        consent,
        company: "",
        sourceUrl: `${window.location.origin}/account/#phone-receptionist`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to save the SMS preference.");
    return payload;
  }

  isSubmitting = true;
  setStatus("Saving phone and SMS settings...");
  try {
    if (phoneChanged && smsConsentActive && savedAccountPhone) {
      await saveSmsPreference(savedAccountPhone, false);
      smsConsentActive = false;
    }

    let activePhone = savedAccountPhone || phone;
    if (needsPhoneSave) {
      const response = await fetch("/api/account-phone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, pin, pinConfirm }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to save phone access.");
      phoneAccessConfigured = true;
      savedAccountPhone = payload.phone || phone;
      activePhone = savedAccountPhone;
      if (accountPhoneInput) accountPhoneInput.value = activePhone;
      accountPhonePinInput.value = "";
      accountPhonePinConfirmInput.value = "";
      [accountPhonePinInput, accountPhonePinConfirmInput].forEach((input) => {
        input.required = false;
        input.placeholder = "Enter four digits only to change PIN";
      });
      if (accountPinState) {
        accountPinState.textContent = "Phone PIN is saved securely. Leave both PIN fields blank to keep it.";
        accountPinState.classList.add("is-active");
      }
    }

    if (requestedSmsConsent !== smsConsentActive) {
      await saveSmsPreference(activePhone, requestedSmsConsent);
      smsConsentActive = requestedSmsConsent;
    }
    if (accountSmsState) {
      accountSmsState.textContent = smsConsentActive
        ? "SMS messages are active for this saved number."
        : "SMS messages are currently off.";
      accountSmsState.classList.toggle("is-active", smsConsentActive);
    }
    setStatus(smsConsentActive
      ? "Phone settings saved. SMS messages are active for this number."
      : "Phone settings saved. SMS messages are off.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error, "Unable to save phone access."), "error");
  } finally {
    isSubmitting = false;
  }
}

async function handleSignout() {
  if (!supabase) return;
  writeStoredValue(ADMIN_ACCESS_CACHE_PREFIX, "");
  writeStoredValue(DASHBOARD_VIEW_CACHE_PREFIX, "");
  await supabase.auth.signOut({ scope: "local" });
  currentSession = null;
  memberships = [];
  musicProfile = null;
  viralsProfile = null;
  websiteServiceRequest = null;
  loanAccount = null;
  renderShell("auth");
  setAuthMode("signin");
  setStatus("Signed out.");
}

function bindEvents() {
  accountNavLink?.addEventListener("click", (event) => {
    if (accountNavLink.dataset.authState !== "signed-in") return;
    event.preventDefault();
    handleSignout();
  });
  signinForm.addEventListener("submit", handleSignin);
  signupForm.addEventListener("submit", handleSignup);
  forgotPasswordButton.addEventListener("click", handleForgotPassword);
  showSigninButton.addEventListener("click", () => setAuthMode("signin"));
  showSignupButton.addEventListener("click", () => setAuthMode("signup"));
  signupReferralCodeInput?.addEventListener("input", () => {
    const code = normalizeReferralCode(signupReferralCodeInput.value);
    signupReferralCodeInput.value = code;
    if (code !== validatedSignupReferralCode) validatedSignupReferralCode = "";
    signupReferralCodeInput.setCustomValidity("");
    clearTimeout(signupReferralTimer);
    signupReferralTimer = setTimeout(() => validateSignupReferralCode(), 450);
  });
  signupReferralCodeInput?.addEventListener("blur", () => validateSignupReferralCode());
  recoveryForm.addEventListener("submit", handleRecovery);
  profileForm.addEventListener("submit", handleProfileSave);
  passwordForm.addEventListener("submit", handlePasswordSave);
  phoneAccessForm?.addEventListener("submit", handlePhoneAccessSave);
  [accountPhonePinInput, accountPhonePinConfirmInput].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 4);
    });
  });
  openRecordsButton.addEventListener("click", openRecords);
  openAdminViralsButton?.addEventListener("click", openAdminVirals);
  openAdminMusicButton?.addEventListener("click", openAdminMusic);
  openMusicButton?.addEventListener("click", openMusic);
  openViralsButton?.addEventListener("click", openVirals);
  showAppsViewButton?.addEventListener("click", () => setDashboardView("apps"));
  showAdminViewButton?.addEventListener("click", () => setDashboardView("admin"));
  dashboardViewToggle?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const view = showAppsViewButton?.getAttribute("aria-selected") === "true" ? "admin" : "apps";
    setDashboardView(view);
    (view === "admin" ? showAdminViewButton : showAppsViewButton)?.focus();
  });
  openAccountSettingsButton?.addEventListener("click", openAccountSettings);
  closeAccountSettingsButton?.addEventListener("click", closeAccountSettings);
  doneAccountSettingsButton?.addEventListener("click", closeAccountSettings);
  accountSettingsModal?.addEventListener("click", (event) => {
    if (event.target === accountSettingsModal) closeAccountSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && accountSettingsModal && !accountSettingsModal.classList.contains("hidden")) {
      closeAccountSettings();
    }
  });
}

async function init() {
  show(setupPanel, !hasConfig());
  show(accountPanel, hasConfig());
  if (!hasConfig()) {
    updateAccountNav(false);
    return;
  }

  supabase = createBrowserSupabase();
  await initCaptcha();
  bindEvents();
  applyUrlPrefill();

  const hashError = getHashErrorMessage();
  if (hashError) {
    renderShell("auth");
    setStatus(hashError, "error");
    return;
  }

  const callbackType = getSupabaseAuthCallbackType();
  try {
    currentSession = await consumeAuthCallbackSessionIfPresent(supabase) || await getSessionOrNull(supabase);
  } catch (error) {
    renderShell("auth");
    setStatus(getErrorMessage(error, "This login link is invalid or expired."), "error");
    return;
  }

  if (callbackType === "recovery") {
    if (!currentSession?.user) {
      renderShell("auth");
      setStatus("This password reset link is invalid or expired. Request a new reset email.", "error");
      return;
    }
    renderShell("recovery");
    setStatus("Choose a new password.");
  } else if (currentSession?.user) {
    if (getPlatformAdminInviteToken()) {
      try {
        const message = await maybeRedeemPlatformAdminInvite();
        await renderDashboard(message || "Signed in.");
      } catch (error) {
        await renderDashboard(getErrorMessage(error, "Unable to redeem platform admin invite."));
      }
    } else {
      await maybeRouteAfterAuth(currentSession);
    }
  } else {
    renderShell("auth");
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session || currentSession;
  });
}

init();
