import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const loginForm = document.getElementById("utilities-login-form");
const loginStatus = document.getElementById("utilities-login-status");
const ADMIN_DESTINATION = "/n3xra-admin/utilities";

let supabase = null;

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

async function routeSession(session) {
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

async function init() {
  if (!loginForm || !loginStatus) return;
  if (!hasConfig()) {
    setStatus("Missing N3XRA auth configuration.", "is-error");
    return;
  }

  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (session?.user && await routeSession(session)) return;

  setStatus("Sign in with your N3XRA utility account.");
  loginForm.addEventListener("submit", handleLogin);
}

init().catch((error) => {
  setStatus(getErrorMessage(error, "Unable to load Utilities login."), "is-error");
});
