import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";

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
const signupOrganizationField = document.getElementById("signup-organization-field");
const signupOrganizationInput = document.getElementById("signup-organization");
const signupInviteCodeField = document.getElementById("signup-invite-code-field");
const signupInviteCodeInput = document.getElementById("signup-invite-code");
const signupModeCreateOrgButton = document.getElementById("signup-mode-create-org");
const signupModePersonalButton = document.getElementById("signup-mode-personal");
const signupModeInviteButton = document.getElementById("signup-mode-invite");

let supabase = null;
let isSubmittingAuth = false;
let signupMode = "create_org";

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

function toggleSignup(visible) {
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

async function redirectIfAuthed() {
  const session = await getSessionOrNull(supabase);
  if (session?.user) {
    window.location.replace(getPostAuthDestination(session));
    return true;
  }
  return false;
}

async function bootstrapMemberships(organizationName, inviteCode) {
  const payload = {
    input_organization_name: organizationName || null,
    input_invite_code: inviteCode || null,
  };
  const { error } = await supabase.rpc("bootstrap_organization", payload);
  if (error) {
    throw error;
  }
}

async function handleSignup(event) {
  event.preventDefault();
  isSubmittingAuth = true;
  const fullName = document.getElementById("signup-full-name").value.trim();
  const organizationName = signupMode === "invite" ? "" : signupOrganizationInput.value.trim();
  const role = signupMode === "invite" ? "" : "account_owner";
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const inviteCode = signupMode === "invite" ? signupInviteCodeInput.value.trim() : "";

  if (signupMode === "invite" && !inviteCode) {
    isSubmittingAuth = false;
    setStatus("Enter an invite code to join a shared library.", "error");
    return;
  }

  setStatus("Creating account...");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        organization_name: organizationName,
        role,
      },
    },
  });

  if (error) {
    isSubmittingAuth = false;
    setStatus(error.message, "error");
    return;
  }

  if (data?.user) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        email,
        full_name: fullName || null,
      })
      .eq("id", data.user.id);

    if (profileError) {
      isSubmittingAuth = false;
      setStatus(`Account created, but profile save failed: ${profileError.message}`, "error");
      return;
    }
  }

  if (data?.session) {
    try {
      await bootstrapMemberships(organizationName, inviteCode);
    } catch (bootstrapError) {
      isSubmittingAuth = false;
      const message = bootstrapError instanceof Error ? bootstrapError.message : "Unable to finish library setup.";
      setStatus(`Account created, but library setup failed: ${message}`, "error");
      return;
    }

    window.location.replace(getPostAuthDestination(data.session));
    return;
  }

  isSubmittingAuth = false;
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

  setStatus("Signing in...");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    isSubmittingAuth = false;
    setStatus(error.message, "error");
    return;
  }

  try {
    await bootstrapMemberships(null, null);
  } catch (bootstrapError) {
    isSubmittingAuth = false;
    const message = bootstrapError instanceof Error ? bootstrapError.message : "Unable to finish library setup.";
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
  setStatus("Sending password reset...");

  const redirectTo = `${window.location.origin}/app/reset-password.html`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  isSubmittingAuth = false;
  if (error) {
    setStatus(error.message || "Unable to send password reset.", "error");
    return;
  }

  setStatus("Password reset email sent. Check your inbox.", "success");
}

async function init() {
  show(setupPanel, !hasConfig());
  show(authPanel, hasConfig());
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  toggleSignup(false);

  if (await redirectIfAuthed()) return;

  signupForm.addEventListener("submit", handleSignup);
  signinForm.addEventListener("submit", handleSignin);
  forgotPasswordButton.addEventListener("click", handleForgotPassword);
  signupModeCreateOrgButton.addEventListener("click", () => setSignupMode("create_org"));
  signupModePersonalButton.addEventListener("click", () => setSignupMode("personal"));
  signupModeInviteButton.addEventListener("click", () => setSignupMode("invite"));
  showSigninButton.addEventListener("click", () => toggleSignup(false));
  showSignupButton.addEventListener("click", () => toggleSignup(true));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user && !isSubmittingAuth) {
      window.location.replace(getPostAuthDestination(session));
    }
  });
}

init();
