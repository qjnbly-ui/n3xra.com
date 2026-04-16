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

let supabase = null;
let isSubmittingAuth = false;

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
    ? "Create your account, start your own library, or redeem an invite code for a shared one."
    : "Use the account tied to your records library.";
  setStatus("");
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
  const organizationName = document.getElementById("signup-organization").value.trim();
  const role = document.getElementById("signup-role").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const inviteCode = document.getElementById("signup-invite-code").value.trim();

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

async function init() {
  show(setupPanel, !hasConfig());
  show(authPanel, hasConfig());
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  toggleSignup(false);

  if (await redirectIfAuthed()) return;

  signupForm.addEventListener("submit", handleSignup);
  signinForm.addEventListener("submit", handleSignin);
  showSigninButton.addEventListener("click", () => toggleSignup(false));
  showSignupButton.addEventListener("click", () => toggleSignup(true));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user && !isSubmittingAuth) {
      window.location.replace(getPostAuthDestination(session));
    }
  });
}

init();
