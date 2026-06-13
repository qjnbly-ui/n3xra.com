import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getAppUrl,
  getConfig,
  getSessionOrNull,
  getSupabaseAuthCallbackType,
  hasConfig,
} from "../app/lib/supabase-client.js";
import { isPlatformAdminEmail, setStoredActiveOrganizationId } from "../app/lib/orgs.js";

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
const authCaptchaField = document.getElementById("auth-captcha-field");
const authTurnstile = document.getElementById("auth-turnstile");
const recoveryForm = document.getElementById("recovery-form");
const profileForm = document.getElementById("profile-form");
const passwordForm = document.getElementById("password-form");
const accountName = document.getElementById("account-name");
const accountEmail = document.getElementById("account-email");
const profileFullNameInput = document.getElementById("profile-full-name");
const recordsSummary = document.getElementById("records-summary");
const musicSummary = document.getElementById("music-summary");
const openRecordsButton = document.getElementById("open-records-button");
const openMusicButton = document.getElementById("open-music-button");
const signoutButton = document.getElementById("signout-button");

let supabase = null;
let currentSession = null;
let memberships = [];
let musicProfile = null;
let captchaToken = "";
let captchaWidgetId = null;
let captchaEnabled = false;
let isSubmitting = false;

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setStatus(message, tone = "") {
  accountStatus.textContent = message || "";
  accountStatus.className = "status account-status";
  if (tone) accountStatus.classList.add(tone);
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

function getTurnstileSiteKey() {
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
  if (["records", "music"].includes(app)) return app;

  const next = getSafeNextPath();
  if (next.startsWith("/ai-music-generator/")) return "music";
  if (next.startsWith("/app/")) return "records";
  return "";
}

function getInviteCode() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("invite") || params.get("invite_code") || params.get("code") || signupInviteCodeInput?.value || "").trim();
}

function buildAccountRedirectUrl({ mode = "", app = "", next = "", invite = "", email = "" } = {}) {
  const url = new URL(getAppUrl("/account"));
  const nextApp = app || getRequestedApp();
  const nextPath = next || getSafeNextPath();
  if (mode) url.searchParams.set("mode", mode);
  if (nextApp) url.searchParams.set("app", nextApp);
  if (nextPath) url.searchParams.set("next", nextPath);
  if (invite) {
    url.searchParams.set("signup", "invite");
    url.searchParams.set("invite", invite);
  }
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
  const email = String(params.get("email") || "").trim();

  if (requestedSignup === "invite" || inviteCode) {
    setAuthMode("signup");
    show(inviteCodeField, Boolean(inviteCode));
    if (signupInviteCodeInput) signupInviteCodeInput.value = inviteCode;
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
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("role, organization:organizations(id,name,subscription_tier,account_status,owner_user_id)")
    .order("created_at", { ascending: true });
  if (error) throw error;

  memberships = (data || []).map((membership) => ({
    ...membership,
    organization: Array.isArray(membership.organization) ? membership.organization[0] : membership.organization,
  }));
}

async function loadMusicProfile() {
  const { data, error } = await supabase
    .from("music_profiles")
    .select("plan, account_status, songs_used, monthly_song_limit")
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  musicProfile = data || null;
}

async function loadProfileName() {
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", currentSession.user.id)
    .maybeSingle();
  return String(data?.full_name || currentSession.user.user_metadata?.full_name || currentSession.user.email || "").trim();
}

async function renderDashboard(message = "") {
  renderShell("dashboard");
  setStatus(message);

  await Promise.allSettled([loadMemberships(), loadMusicProfile()]);
  const displayName = await loadProfileName().catch(() => currentSession.user.email || "N3XRA account");
  accountName.textContent = displayName || "N3XRA account";
  accountEmail.textContent = currentSession.user.email || "";
  profileFullNameInput.value = displayName || "";

  const firstMembership = memberships[0] || null;
  const recordsOrgName = firstMembership?.organization?.name || "";
  recordsSummary.textContent = recordsOrgName
    ? `Connected to ${recordsOrgName}.`
    : "No Records library yet. Open Records to create or join one.";
  openRecordsButton.textContent = recordsOrgName ? "Open Records" : "Start Records";

  const hasMusicProfile = Boolean(musicProfile);
  musicSummary.textContent = hasMusicProfile
    ? `${musicProfile.plan || "Free"} plan. ${Number(musicProfile.songs_used || 0)} of ${Number(musicProfile.monthly_song_limit || 0)} songs used.`
    : "Not active yet. Activate it only if you want to create and save songs.";
  openMusicButton.textContent = hasMusicProfile ? "Open AI Music" : "Activate AI Music";
}

async function maybeRouteAfterAuth(session) {
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

  if (requestedApp === "records" || next.startsWith("/app/")) {
    await openRecords();
    return;
  }

  currentSession = session;
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

  isSubmitting = true;
  try {
    await verifyCaptchaServerSide();
    setStatus("Creating account...");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: buildAccountRedirectUrl({ invite: inviteCode, email }),
        data: {
          full_name: fullName,
          invite_code: inviteCode,
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

  setStatus("Opening Records...");
  if (!memberships.length) {
    const inviteCode = getInviteCode();
    const { data, error } = await supabase.rpc("bootstrap_organization", {
      input_organization_name: inviteCode ? null : "Personal",
      input_invite_code: inviteCode || null,
    });
    if (error) {
      setStatus(error.message || "Unable to open Records.", "error");
      return;
    }
    if (data?.active_organization_id) {
      setStoredActiveOrganizationId(String(data.active_organization_id));
    }
  } else if (memberships[0]?.organization?.id) {
    setStoredActiveOrganizationId(String(memberships[0].organization.id));
  }

  window.location.assign(isPlatformAdminEmail(currentSession.user.email) ? "/app/admin" : "/app/library");
}

async function openMusic() {
  if (!currentSession?.access_token) return;

  setStatus(musicProfile ? "Opening AI Music..." : "Activating AI Music...");
  try {
    const response = await fetch("/api/music-account", {
      headers: { Authorization: `Bearer ${currentSession.access_token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to activate AI Music.");
    window.location.assign("/ai-music-generator/app/");
  } catch (error) {
    setStatus(getErrorMessage(error, "Unable to open AI Music."), "error");
  }
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

async function handleSignout() {
  if (!supabase) return;
  await supabase.auth.signOut({ scope: "local" });
  currentSession = null;
  memberships = [];
  musicProfile = null;
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
  recoveryForm.addEventListener("submit", handleRecovery);
  profileForm.addEventListener("submit", handleProfileSave);
  passwordForm.addEventListener("submit", handlePasswordSave);
  openRecordsButton.addEventListener("click", openRecords);
  openMusicButton.addEventListener("click", openMusic);
  signoutButton.addEventListener("click", handleSignout);
}

async function init() {
  show(setupPanel, !hasConfig());
  show(accountPanel, hasConfig());
  if (!hasConfig()) return;

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
    await renderDashboard(callbackType ? "Signed in. Choose an app to continue." : "");
  } else {
    renderShell("auth");
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session || currentSession;
  });
}

init();
