import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { setStoredActiveOrganizationId } from "./lib/orgs.js";

const PLATFORM_ADMIN_EMAIL = "quentin@quentinnichols.com";

const setupPanel = document.getElementById("setup-panel");
const authPanel = document.getElementById("auth-panel");
const authStatus = document.getElementById("auth-status");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const signupForm = document.getElementById("signup-form");
const signinForm = document.getElementById("signin-form");
const showSigninButton = document.getElementById("show-signin-button");
const showSignupButton = document.getElementById("show-signup-button");
const forgotPasswordButton = document.getElementById("forgot-password-button");
const authedState = document.getElementById("authed-state");
const authedCopy = document.getElementById("authed-copy");
const continueSessionButton = document.getElementById("continue-session-button");
const signoutForSignupButton = document.getElementById("signout-for-signup-button");
const signupOrganizationField = document.getElementById("signup-organization-field");
const signupOrganizationInput = document.getElementById("signup-organization");
const signupInviteCodeField = document.getElementById("signup-invite-code-field");
const signupInviteCodeInput = document.getElementById("signup-invite-code");
const signupPasswordInput = document.getElementById("signup-password");
const signupPasswordConfirmInput = document.getElementById("signup-password-confirm");
const signupModeCreateOrgButton = document.getElementById("signup-mode-create-org");
const signupModePersonalButton = document.getElementById("signup-mode-personal");
const signupModeInviteButton = document.getElementById("signup-mode-invite");
const authCaptchaField = document.getElementById("auth-captcha-field");
const authTurnstile = document.getElementById("auth-turnstile");
const RECORDS_CONFIRM_REDIRECT_PATH = "/app/login/";

let supabase = null;
let isSubmittingAuth = false;
let signupMode = "create_org";
let currentAuthedSession = null;
let captchaToken = "";
let captchaWidgetId = null;
let captchaEnabled = false;

function getTurnstileSiteKey() {
  return String(getConfig().turnstileSiteKey || "").trim();
}

function resetCaptcha() {
  captchaToken = "";
  if (!window.turnstile || captchaWidgetId === null) return;
  window.turnstile.reset(captchaWidgetId);
}

function getCaptchaTokenForRequest() {
  if (!getTurnstileSiteKey()) return "";
  if (!captchaToken) {
    throw new Error("Complete the security check first.");
  }
  return captchaToken;
}

async function verifyCaptchaServerSide(captchaToken) {
  if (!getTurnstileSiteKey()) return;

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

function isPlatformAdminEmail(email) {
  return String(email || "").trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}

function getPostAuthDestination(session) {
  return isPlatformAdminEmail(session?.user?.email) ? "./admin.html" : "./dashboard.html";
}

function setStatus(message, tone = "") {
  authStatus.textContent = message || "";
  authStatus.className = "status";
  if (tone) authStatus.classList.add(tone);
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function getErrorMessage(error, fallback) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function notifyNewAccount(payload) {
  try {
    await fetch("/api/new-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (_error) {
    // Notifications should not block signup completion.
  }
}

function setSignupPasswordsVisible(visible) {
  const nextType = visible ? "text" : "password";
  [signupPasswordInput, signupPasswordConfirmInput].forEach((input) => {
    if (input instanceof HTMLInputElement) {
      input.type = nextType;
    }
  });
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.textContent = visible ? "Hide" : "Show";
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  });
}

function togglePasswordVisibility() {
  const nextVisible = signupPasswordInput.type === "password";
  setSignupPasswordsVisible(nextVisible);
}

function toggleSignup(visible) {
  if (currentAuthedSession?.user) {
    return;
  }
  show(signupForm, visible);
  show(signinForm, !visible);
  showSignupButton.classList.toggle("is-active", visible);
  showSigninButton.classList.toggle("is-active", !visible);
  showSignupButton.setAttribute("aria-pressed", String(visible));
  showSigninButton.setAttribute("aria-pressed", String(!visible));
  authTitle.textContent = visible ? "Create account" : "Sign in";
  authSubtitle.textContent = visible
    ? "Choose how to start: create an organization, use Personal, or join with an invite code."
    : "Use your email and password to sign in.";
  if (visible) setSignupMode(signupMode);
  setStatus("");
}

function setAuthedState(session) {
  currentAuthedSession = session || null;
  const isAuthed = Boolean(currentAuthedSession?.user);

  show(authedState, isAuthed);
  show(signinForm, !isAuthed && !showSignupButton.classList.contains("is-active"));
  show(signupForm, !isAuthed && showSignupButton.classList.contains("is-active"));
  show(authCaptchaField, !isAuthed && captchaEnabled);
  showSigninButton.disabled = isAuthed;
  showSignupButton.disabled = isAuthed;

  if (!isAuthed) {
    authTitle.textContent = showSignupButton.classList.contains("is-active") ? "Create account" : "Sign in";
    authSubtitle.textContent = showSignupButton.classList.contains("is-active")
      ? "Choose how to start: create an organization, use Personal, or join with an invite code."
      : "Use your email and password to sign in.";
    return;
  }

  authTitle.textContent = "Already signed in";
  authSubtitle.textContent = "Continue to your dashboard or sign out to create another account.";
  authedCopy.textContent = `Signed in as ${currentAuthedSession.user.email || "this account"}.`;
  setStatus("");
}

function setSignupMode(mode) {
  signupMode = mode;
  const isCreateOrg = mode === "create_org";
  const isPersonal = mode === "personal";
  const isInvite = mode === "invite";

  signupModeCreateOrgButton.classList.toggle("is-active", isCreateOrg);
  signupModePersonalButton.classList.toggle("is-active", isPersonal);
  signupModeInviteButton.classList.toggle("is-active", isInvite);

  signupModeCreateOrgButton.setAttribute("aria-pressed", String(isCreateOrg));
  signupModePersonalButton.setAttribute("aria-pressed", String(isPersonal));
  signupModeInviteButton.setAttribute("aria-pressed", String(isInvite));

  show(signupOrganizationField, !isInvite);
  show(signupInviteCodeField, isInvite);

  signupInviteCodeInput.required = isInvite;

  if (isPersonal && !signupOrganizationInput.value.trim()) {
    signupOrganizationInput.value = "Personal";
  }
  if (isInvite) {
    signupOrganizationInput.value = "";
  }
}

async function loadSessionState() {
  const session = await getSessionOrNull(supabase);
  setAuthedState(session);
  return session;
}

async function bootstrapMemberships(organizationName, inviteCode) {
  const payload = {
    input_organization_name: organizationName || null,
    input_invite_code: inviteCode || null,
  };
  const { data, error } = await supabase.rpc("bootstrap_organization", payload);
  if (error) {
    throw error;
  }
  return data || null;
}

async function handleSignup(event) {
  event.preventDefault();
  isSubmittingAuth = true;
  const fullName = document.getElementById("signup-full-name").value.trim();
  const organizationName = signupMode === "invite" ? "" : signupOrganizationInput.value.trim();
  const role = signupMode === "invite" ? "" : "account_owner";
  const email = document.getElementById("signup-email").value.trim();
  const password = signupPasswordInput.value;
  const passwordConfirm = signupPasswordConfirmInput.value;
  const inviteCode = signupMode === "invite" ? signupInviteCodeInput.value.trim() : "";

  if (password !== passwordConfirm) {
    isSubmittingAuth = false;
    setStatus("Passwords do not match.", "error");
    return;
  }

  if (signupMode === "invite" && !inviteCode) {
    isSubmittingAuth = false;
    setStatus("Enter an invite code to join a shared library.", "error");
    return;
  }

  let submitCaptchaToken = "";
  try {
    submitCaptchaToken = getCaptchaTokenForRequest();
    await verifyCaptchaServerSide(submitCaptchaToken);
  } catch (captchaError) {
    isSubmittingAuth = false;
    setStatus(getErrorMessage(captchaError, "Complete the security check first."), "error");
    return;
  }

  setStatus("Creating account...");
  const emailRedirectTo = `${window.location.origin}${RECORDS_CONFIRM_REDIRECT_PATH}`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        full_name: fullName,
        organization_name: organizationName,
        invite_code: inviteCode,
        role,
      },
    },
  });

  if (error) {
    resetCaptcha();
    isSubmittingAuth = false;
    setStatus(error.message, "error");
    return;
  }

  notifyNewAccount({
    fullName,
    email,
    signupMode,
    organizationName,
    inviteCode,
    createdAt: new Date().toISOString(),
  });

  if (data?.session) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => null);
  }

  isSubmittingAuth = false;
  resetCaptcha();
  toggleSignup(false);
  setStatus(
    "Account created. Check your email if confirmation is enabled, then sign in. Your library and invite access will be finished on first sign-in.",
    "success"
  );
}

async function handleSignin(event) {
  event.preventDefault();
  isSubmittingAuth = true;
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;

  let submitCaptchaToken = "";
  try {
    submitCaptchaToken = getCaptchaTokenForRequest();
    await verifyCaptchaServerSide(submitCaptchaToken);
  } catch (captchaError) {
    isSubmittingAuth = false;
    setStatus(getErrorMessage(captchaError, "Complete the security check first."), "error");
    return;
  }

  setStatus("Signing in...");
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
      });
  if (error) {
    resetCaptcha();
    isSubmittingAuth = false;
    setStatus(error.message, "error");
    return;
  }

  try {
    const bootstrapData = await bootstrapMemberships(null, null);
    if (bootstrapData?.active_organization_id) {
      setStoredActiveOrganizationId(String(bootstrapData.active_organization_id));
    }
  } catch (bootstrapError) {
    isSubmittingAuth = false;
    resetCaptcha();
    const message = getErrorMessage(bootstrapError, "Unable to finish library setup.");
    setStatus(message, "error");
    return;
  }

  window.location.replace(getPostAuthDestination(data.session));
}

async function handleForgotPassword() {
  if (!supabase || isSubmittingAuth) return;

  const email = document.getElementById("signin-email").value.trim();
  if (!email) {
    setStatus("Enter your email address first.", "error");
    return;
  }

  isSubmittingAuth = true;

  let submitCaptchaToken = "";
  try {
    submitCaptchaToken = getCaptchaTokenForRequest();
    await verifyCaptchaServerSide(submitCaptchaToken);
  } catch (captchaError) {
    isSubmittingAuth = false;
    setStatus(getErrorMessage(captchaError, "Complete the security check first."), "error");
    return;
  }

  setStatus("Sending password reset...");

  const redirectTo = `${window.location.origin}/app/reset-password.html`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,  });

  resetCaptcha();
  isSubmittingAuth = false;
  if (error) {
    setStatus(error.message || "Unable to send password reset.", "error");
    return;
  }

  setStatus("Password reset email sent. Check your inbox.", "success");
}

async function handleSignoutForSignup() {
  if (!supabase || isSubmittingAuth) return;
  isSubmittingAuth = true;
  setStatus("Signing out...");

  const { error } = await supabase.auth.signOut();
  isSubmittingAuth = false;

  if (error) {
    setStatus(error.message || "Unable to sign out.", "error");
    return;
  }

  setAuthedState(null);
  toggleSignup(true);
}

async function init() {
  show(setupPanel, !hasConfig());
  show(authPanel, hasConfig());
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  toggleSignup(false);
  await initCaptcha();
  await loadSessionState();

  signupForm.addEventListener("submit", handleSignup);
  signinForm.addEventListener("submit", handleSignin);
  forgotPasswordButton.addEventListener("click", handleForgotPassword);
  continueSessionButton.addEventListener("click", () => {
    const session = currentAuthedSession;
    if (!session?.user) return;
    window.location.replace(getPostAuthDestination(session));
  });
  signoutForSignupButton.addEventListener("click", handleSignoutForSignup);
  signupModeCreateOrgButton.addEventListener("click", () => setSignupMode("create_org"));
  signupModePersonalButton.addEventListener("click", () => setSignupMode("personal"));
  signupModeInviteButton.addEventListener("click", () => setSignupMode("invite"));
  showSigninButton.addEventListener("click", () => toggleSignup(false));
  showSignupButton.addEventListener("click", () => toggleSignup(true));
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => togglePasswordVisibility());
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (isSubmittingAuth) return;
    setAuthedState(session);
  });
}

init();
