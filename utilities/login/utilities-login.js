import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const loginForm = document.getElementById("utilities-login-form");
const signupForm = document.getElementById("utilities-signup-form");
const loginStatus = document.getElementById("utilities-login-status");
const invitePanel = document.getElementById("utilities-invite-panel");
const inviteCopy = document.getElementById("utilities-invite-copy");
const ADMIN_DESTINATION = "/n3xra-admin/utilities";
const PENDING_INVITE_KEY = "n3xra.utilities.pendingInvite";

let supabase = null;
let inviteCode = "";

function setStatus(message, tone = "") {
  if (!loginStatus) return;
  loginStatus.textContent = message || "";
  loginStatus.className = "status-line";
  if (tone) loginStatus.classList.add(tone);
}

function getErrorMessage(error, fallback) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

function getAuthErrorMessage(error) {
  const message = getErrorMessage(error, "Unable to sign in.");
  const normalized = message.toLowerCase();
  if (normalized.includes("email not confirmed") || normalized.includes("email_not_confirmed")) {
    return "Email not confirmed. Please confirm your account from the email we sent, then sign in again.";
  }
  return message;
}

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getInviteCode() {
  return normalizeInviteCode(inviteCode || window.localStorage?.getItem(PENDING_INVITE_KEY));
}

function setFormEmail(form, email) {
  const input = form?.elements?.email;
  if (input && email) input.value = email;
}

async function loadUtilityAccess(session) {
  const accessToken = session?.access_token || "";
  if (!accessToken) return null;

  const response = await fetch("/api/utilities-member-access", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to check utility portal access.");
  }
  return payload;
}

async function redeemInvite(session) {
  const code = normalizeInviteCode(inviteCode);
  const accessToken = session?.access_token || "";
  if (!code || !accessToken) return null;

  setStatus("Accepting utility invite...");
  const response = await fetch("/api/utilities-workspace", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "redeem-team-invite", invite_code: code }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to accept this utility invite.");
  }
  window.localStorage?.removeItem(PENDING_INVITE_KEY);
  return payload?.redeem || null;
}

async function routeSession(session) {
  const redeemResult = await redeemInvite(session);
  if (redeemResult?.workspace_url) {
    window.location.replace(redeemResult.workspace_url);
    return true;
  }

  if (isPlatformAdminEmail(session?.user?.email)) {
    window.location.replace(ADMIN_DESTINATION);
    return true;
  }

  setStatus("Checking utility portal access...");
  const access = await loadUtilityAccess(session);
  if (access?.hasAccess && (access?.workspaceUrl || access?.portalUrl)) {
    window.location.replace(access.workspaceUrl || access.portalUrl);
    return true;
  }

  setStatus("This N3XRA account is signed in, but it is not linked to an active utility organization yet.", "is-error");
  return false;
}

async function handleLogin(event) {
  event.preventDefault();
  if (!supabase || !loginForm) return;

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) {
    setStatus("Enter your email and password.", "is-error");
    return;
  }

  setStatus("Signing in...");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(getAuthErrorMessage(error), "is-error");
    return;
  }

  await routeSession(data?.session);
}

async function handleSignup(event) {
  event.preventDefault();
  if (!supabase || !signupForm) return;

  const code = getInviteCode();
  if (!code) {
    setStatus("Open the invite link again to create an invited utility account.", "is-error");
    return;
  }

  const formData = new FormData(signupForm);
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("password_confirm") || "");

  if (!fullName || !email || !password) {
    setStatus("Enter your name, email, and password.", "is-error");
    return;
  }
  if (password !== passwordConfirm) {
    setStatus("Passwords do not match.", "is-error");
    return;
  }

  window.localStorage?.setItem(PENDING_INVITE_KEY, code);
  setStatus("Creating account...");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/utilities/login?invite=${encodeURIComponent(code)}`,
      data: {
        full_name: fullName,
        utility_invite_code: code,
      },
    },
  });

  if (error) {
    setStatus(getAuthErrorMessage(error), "is-error");
    return;
  }

  if (data?.session) {
    await routeSession(data.session);
    return;
  }

  setFormEmail(loginForm, email);
  setStatus("Account created. Confirm your email, then return to this invite link and sign in.", "is-active");
}

function initInviteState() {
  const params = new URLSearchParams(window.location.search);
  inviteCode = normalizeInviteCode(params.get("invite") || params.get("invite_code"));
  const email = String(params.get("email") || "").trim();
  if (inviteCode) {
    window.localStorage?.setItem(PENDING_INVITE_KEY, inviteCode);
    if (invitePanel) invitePanel.hidden = false;
    if (signupForm) signupForm.hidden = false;
    if (inviteCopy) inviteCopy.textContent = `Invite code ${inviteCode}. Sign in or create an account to join this utility workspace.`;
    setFormEmail(loginForm, email);
    setFormEmail(signupForm, email);
  }
}

async function init() {
  if (!loginForm || !loginStatus) return;
  if (!hasConfig()) {
    setStatus("Missing N3XRA auth configuration.", "is-error");
    return;
  }

  supabase = createBrowserSupabase();
  initInviteState();
  const session = await getSessionOrNull(supabase);
  if (session?.user && await routeSession(session)) return;

  setStatus(normalizeInviteCode(inviteCode) ? "Sign in or create an account to accept this utility invite." : "Sign in with your N3XRA utility account.");
  loginForm.addEventListener("submit", handleLogin);
  signupForm?.addEventListener("submit", handleSignup);
}

init().catch((error) => {
  setStatus(getErrorMessage(error, "Unable to load Utilities login."), "is-error");
});
