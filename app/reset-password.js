import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";

const setupPanel = document.getElementById("setup-panel");
const resetPanel = document.getElementById("reset-panel");
const resetForm = document.getElementById("reset-form");
const resetHelp = document.getElementById("reset-help");
const resetStatus = document.getElementById("reset-status");
const resetSubmit = document.getElementById("reset-submit");
const passwordInput = document.getElementById("reset-password");
const confirmPasswordInput = document.getElementById("reset-password-confirm");
const resetSuccessActions = document.getElementById("reset-success-actions");

let supabase = null;
let isSubmitting = false;
let recoveryReady = false;

function setStatus(message, tone = "") {
  resetStatus.textContent = message || "";
  resetStatus.className = "status";
  if (tone) resetStatus.classList.add(tone);
}

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setFormEnabled(enabled) {
  passwordInput.disabled = !enabled;
  confirmPasswordInput.disabled = !enabled;
  resetSubmit.disabled = !enabled;
}

function hasRecoveryParams() {
  return (
    window.location.hash.includes("access_token=") ||
    window.location.hash.includes("type=recovery") ||
    new URLSearchParams(window.location.search).has("code")
  );
}

function markRecoveryReady() {
  recoveryReady = true;
  setFormEnabled(true);
  resetHelp.textContent = "Choose a new password. Passwords must be at least 8 characters.";
  setStatus("");
}

function markRecoveryFailed(message) {
  recoveryReady = false;
  setFormEnabled(false);
  resetHelp.textContent = "Request a new password reset email and open the latest link.";
  setStatus(message, "error");
}

async function handleReset(event) {
  event.preventDefault();
  if (!supabase || isSubmitting || !recoveryReady) return;

  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

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

  resetForm.reset();
  setFormEnabled(false);
  show(resetSuccessActions, true);
  resetHelp.textContent = "Your password has been updated.";
  setStatus("Password updated successfully.", "success");
}

async function resolveRecoveryState() {
  const session = await getSessionOrNull(supabase);
  if (session?.user) {
    markRecoveryReady();
    return;
  }

  if (!hasRecoveryParams()) {
    markRecoveryFailed("This page only works from a password reset email.");
    return;
  }

  setStatus("Checking reset link...");

  window.setTimeout(async () => {
    const delayedSession = await getSessionOrNull(supabase);
    if (delayedSession?.user) {
      markRecoveryReady();
      return;
    }

    markRecoveryFailed("This password reset link is invalid or has expired.");
  }, 1200);
}

async function init() {
  show(setupPanel, !hasConfig());
  show(resetPanel, hasConfig());
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  setFormEnabled(false);
  show(resetSuccessActions, false);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || session?.user) {
      markRecoveryReady();
    }
  });

  resetForm.addEventListener("submit", handleReset);
  await resolveRecoveryState();
}

init();
