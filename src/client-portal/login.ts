import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getConfig,
  getSessionOrNull,
  getSupabaseAuthCallbackType,
  hasConfig,
} from "/shared/lib/supabase-client.js";
import {
  applyPortalTenantBranding,
  portalBrandIdentity,
  resolvePortalTenant,
  type PortalTenantResolution,
} from "./tenant-context.js";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string | number;
  reset(widgetId: string | number): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const loginView = document.querySelector<HTMLElement>("#portal-login-view");
const resetView = document.querySelector<HTMLElement>("#portal-reset-view");
const recoveryView = document.querySelector<HTMLElement>("#portal-recovery-view");
const loginForm = document.querySelector<HTMLFormElement>("#portal-login-form");
const resetForm = document.querySelector<HTMLFormElement>("#portal-reset-form");
const recoveryForm = document.querySelector<HTMLFormElement>("#portal-recovery-form");
const loginEmail = document.querySelector<HTMLInputElement>("#portal-login-email");
const loginPassword = document.querySelector<HTMLInputElement>("#portal-login-password");
const resetEmail = document.querySelector<HTMLInputElement>("#portal-reset-email");
const recoveryPassword = document.querySelector<HTMLInputElement>("#portal-recovery-password");
const recoveryConfirm = document.querySelector<HTMLInputElement>("#portal-recovery-confirm");
const status = document.querySelector<HTMLElement>("#portal-login-status");
const captchaField = document.querySelector<HTMLElement>("#portal-login-captcha");
const captchaElement = document.querySelector<HTMLElement>("#portal-login-turnstile");
const forgotButton = document.querySelector<HTMLButtonElement>("#portal-forgot-password");
const backButton = document.querySelector<HTMLButtonElement>("#portal-back-to-login");
const websiteLink = document.querySelector<HTMLAnchorElement>("#portal-website-link");
const returnLink = document.querySelector<HTMLAnchorElement>("#portal-return-link");

let supabase: ReturnType<typeof createBrowserSupabase> = null;
let tenant: PortalTenantResolution | null = null;
let captchaToken = "";
let captchaWidgetId: string | number | null = null;

function setStatus(message = "", isError = false): void {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function setView(view: "login" | "reset" | "recovery"): void {
  if (loginView) loginView.hidden = view !== "login";
  if (resetView) resetView.hidden = view !== "reset";
  if (recoveryView) recoveryView.hidden = view !== "recovery";
  setStatus();
}

function setBusy(form: HTMLFormElement | null, busy: boolean): void {
  form?.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach((control) => {
    control.disabled = busy;
  });
}

function isTestHostname(): boolean {
  const hostname = String(window.location.hostname || "").toLowerCase();
  return ["localhost", "127.0.0.1"].includes(hostname) || hostname.endsWith(".vercel.app");
}

async function waitForTurnstile(maxWaitMs = 5000): Promise<boolean> {
  const startedAt = Date.now();
  while (!window.turnstile) {
    if (Date.now() - startedAt > maxWaitMs) return false;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return true;
}

async function initializeCaptcha(): Promise<void> {
  const siteKey = String(getConfig().turnstileSiteKey || "").trim();
  if (!siteKey || !captchaField || !captchaElement) return;
  captchaField.hidden = false;
  if (!await waitForTurnstile() || !window.turnstile) {
    setStatus("The security check could not load. Refresh this page and try again.", true);
    return;
  }
  captchaWidgetId = window.turnstile.render(captchaElement, {
    sitekey: isTestHostname() ? "1x00000000000000000000AA" : siteKey,
    size: "flexible",
    callback: (token: unknown) => { captchaToken = String(token || ""); },
    "expired-callback": () => { captchaToken = ""; },
    "error-callback": () => { captchaToken = ""; },
  });
}

function resetCaptcha(): void {
  captchaToken = "";
  if (window.turnstile && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
}

async function verifyCaptcha(): Promise<void> {
  const siteKey = String(getConfig().turnstileSiteKey || "").trim();
  if (!siteKey || isTestHostname()) return;
  if (!captchaToken) throw new Error("Complete the security check first.");
  const response = await fetch("/api/verify-captcha", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ captchaToken }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; ok?: boolean };
  if (!response.ok || !payload.ok) throw new Error(payload.error || "The security check could not be verified.");
}

async function hasTenantAccess(userId: string): Promise<boolean> {
  if (!supabase || tenant?.mode !== "tenant" || !userId) return false;
  const { data, error } = await supabase
    .from("client_websites")
    .select("id")
    .eq("id", tenant.website_id)
    .maybeSingle();
  return !error && data?.id === tenant.website_id;
}

async function openPortalForSession(session: { user?: { id?: string } } | null): Promise<boolean> {
  const userId = String(session?.user?.id || "");
  if (!userId || !await hasTenantAccess(userId)) return false;
  window.location.replace("/client-portal/");
  return true;
}

async function handleLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!supabase || !loginEmail || !loginPassword) return;
  setBusy(loginForm, true);
  setStatus("Signing in…");
  try {
    await verifyCaptcha();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value,
    });
    if (error) throw error;
    if (!await openPortalForSession(data.session)) {
      await supabase.auth.signOut();
      throw new Error("This account does not have access to this website portal.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in.";
    setStatus(message, true);
    resetCaptcha();
  } finally {
    setBusy(loginForm, false);
  }
}

async function handleResetRequest(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!supabase || !resetEmail) return;
  setBusy(resetForm, true);
  setStatus("Sending your secure reset link…");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.value.trim(), {
      redirectTo: `${window.location.origin}/client-portal/login?mode=recovery`,
    });
    if (error) throw error;
    setStatus("Check your email for the password-reset link.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to send the reset link.", true);
  } finally {
    setBusy(resetForm, false);
  }
}

async function handleRecovery(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!supabase || !recoveryPassword || !recoveryConfirm) return;
  if (recoveryPassword.value !== recoveryConfirm.value) {
    setStatus("The passwords do not match.", true);
    return;
  }
  setBusy(recoveryForm, true);
  setStatus("Updating your password…");
  try {
    const { data, error } = await supabase.auth.updateUser({ password: recoveryPassword.value });
    if (error) throw error;
    const session = await getSessionOrNull(supabase);
    if (!await openPortalForSession(session || (data.user ? { user: data.user } : null))) {
      throw new Error("Your password was updated, but this account does not have access to this website portal.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to update your password.", true);
  } finally {
    setBusy(recoveryForm, false);
  }
}

async function initialize(): Promise<void> {
  if (!hasConfig()) throw new Error("This portal is temporarily unavailable.");
  supabase = createBrowserSupabase();
  if (!supabase) throw new Error("This portal is temporarily unavailable.");

  tenant = await resolvePortalTenant(supabase);
  const identity = applyPortalTenantBranding(tenant) || portalBrandIdentity(tenant);
  if (tenant.mode !== "tenant" || !identity) throw new Error("This portal address is not active.");

  if (websiteLink) {
    websiteLink.hidden = !identity.logoUrl;
    websiteLink.href = identity.websiteUrl || "/client-portal/login";
  }
  if (returnLink) {
    returnLink.hidden = !identity.websiteUrl;
    returnLink.href = identity.websiteUrl || "#";
    returnLink.textContent = `Return to ${identity.websiteName} website`;
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("signed_out") === "1") {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.history.replaceState({}, document.title, "/client-portal/login");
    setView("login");
    setStatus("You have been signed out.");
    document.body.classList.remove("portal-login-loading");
    await initializeCaptcha();
    return;
  }

  const callbackType = getSupabaseAuthCallbackType();
  const callbackSession = await consumeAuthCallbackSessionIfPresent(supabase).catch(() => null);
  const requestedRecovery = callbackType === "recovery" || searchParams.get("mode") === "recovery";
  if (requestedRecovery && callbackSession?.user) {
    setView("recovery");
  } else {
    const existingSession = callbackSession || await getSessionOrNull(supabase);
    if (existingSession?.user && await openPortalForSession(existingSession)) return;
    setView("login");
  }

  document.body.classList.remove("portal-login-loading");
  await initializeCaptcha();
}

loginForm?.addEventListener("submit", (event) => { void handleLogin(event); });
resetForm?.addEventListener("submit", (event) => { void handleResetRequest(event); });
recoveryForm?.addEventListener("submit", (event) => { void handleRecovery(event); });
forgotButton?.addEventListener("click", () => {
  if (resetEmail && loginEmail) resetEmail.value = loginEmail.value;
  setView("reset");
});
backButton?.addEventListener("click", () => setView("login"));

initialize().catch((error) => {
  document.body.classList.remove("portal-login-loading");
  setView("login");
  setBusy(loginForm, true);
  setStatus(error instanceof Error ? error.message : "This portal is unavailable.", true);
});
