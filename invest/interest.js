import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";

const DRAFT_KEY = "n3xra.investment-interest.draft.v1";
const form = document.getElementById("investment-interest-form");
const fullNameInput = document.getElementById("interest-full-name");
const emailInput = document.getElementById("interest-email");
const connectionInput = document.getElementById("interest-connection");
const emailUpdatesInput = document.getElementById("interest-email-updates");
const acknowledgmentInput = document.getElementById("interest-acknowledgment");
const accountState = document.getElementById("interest-account-state");
const submitButton = document.getElementById("interest-submit");
const status = document.getElementById("interest-status");
const verification = document.getElementById("interest-verification");
const verificationEmail = document.getElementById("interest-verification-email");

let supabase = null;
let session = null;
let submitting = false;

function setStatus(message = "", isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function readDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
    if (!draft || typeof draft !== "object") return null;
    return draft;
  } catch {
    return null;
  }
}

function saveDraft() {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      fullName: fullNameInput.value.trim(),
      email: emailInput.value.trim().toLowerCase(),
      connectionType: connectionInput.value,
      emailUpdates: emailUpdatesInput.checked,
      acknowledgment: acknowledgmentInput.checked,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // The verified account still allows submission if local storage is unavailable.
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // No further cleanup is required.
  }
}

function restoreDraft() {
  const draft = readDraft();
  if (!draft) return false;
  fullNameInput.value = String(draft.fullName || "");
  emailInput.value = String(draft.email || "");
  connectionInput.value = String(draft.connectionType || "");
  emailUpdatesInput.checked = draft.emailUpdates === true;
  acknowledgmentInput.checked = draft.acknowledgment === true;
  return true;
}

function cleanCompletionIntent() {
  const url = new URL(window.location.href);
  url.searchParams.delete("interest");
  url.hash = "ownership-updates";
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function loadExistingInterest() {
  if (!session?.user) return null;
  const { data, error } = await supabase
    .from("investment_interest_profiles")
    .select("full_name,email,connection_type,email_updates,status,submitted_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  fullNameInput.value = data.full_name || fullNameInput.value;
  connectionInput.value = data.connection_type || "";
  emailUpdatesInput.checked = Boolean(data.email_updates);
  acknowledgmentInput.checked = true;
  submitButton.textContent = data.status === "withdrawn" ? "Rejoin ownership updates" : "Update my information";
  accountState.innerHTML = data.status === "withdrawn"
    ? `Your earlier request was withdrawn. You can rejoin here or review it in <a href="/account/investment/">My Apps</a>.`
    : `Your request is connected to your N3XRA account. <a href="/account/investment/">Open Ownership Updates</a>.`;
  return data;
}

async function saveAuthenticatedInterest() {
  const draft = readDraft();
  const fullName = (draft?.fullName || fullNameInput.value).trim();
  const connectionType = draft?.connectionType || connectionInput.value || null;
  const emailUpdates = draft ? draft.emailUpdates === true : emailUpdatesInput.checked;
  const email = String(session.user.email || emailInput.value).trim().toLowerCase();

  const { error } = await supabase.from("investment_interest_profiles").upsert({
    user_id: session.user.id,
    full_name: fullName,
    email,
    connection_type: connectionType || null,
    email_updates: emailUpdates,
    status: "interested",
    acknowledged_not_offering_at: new Date().toISOString(),
    withdrawn_at: null,
  }, { onConflict: "user_id" });
  if (error) throw error;

  clearDraft();
  fullNameInput.value = fullName;
  emailInput.value = email;
  emailUpdatesInput.checked = emailUpdates;
  acknowledgmentInput.checked = true;
  verification.hidden = true;
  submitButton.textContent = "Update my information";
  accountState.innerHTML = `Your request is connected to your N3XRA account. <a href="/account/investment/">Open Ownership Updates</a>.`;
  setStatus("Your interest is recorded. We’ll keep you posted as N3XRA’s plans develop.");
}

async function sendVerificationLink() {
  saveDraft();
  const email = emailInput.value.trim().toLowerCase();
  const redirectUrl = `${window.location.origin}/invest/?interest=complete#ownership-updates`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectUrl,
      data: {
        full_name: fullNameInput.value.trim(),
        investment_interest: true,
      },
    },
  });
  if (error) throw error;

  verificationEmail.textContent = email;
  verification.hidden = false;
  setStatus("Secure verification link sent. Check your email to finish.");
}

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting || !form.reportValidity()) return;
  submitting = true;
  submitButton.disabled = true;
  verification.hidden = true;
  setStatus(session?.user ? "Saving your information…" : "Sending a secure verification link…");
  try {
    if (session?.user) {
      await saveAuthenticatedInterest();
    } else {
      await sendVerificationLink();
    }
  } catch (error) {
    setStatus(error?.message || "We could not save your request right now.", true);
  } finally {
    submitting = false;
    submitButton.disabled = false;
  }
}

async function init() {
  if (!form) return;
  restoreDraft();
  form.addEventListener("submit", handleSubmit);
  form.querySelectorAll("input,select").forEach((field) => {
    field.addEventListener("change", saveDraft);
    field.addEventListener("input", saveDraft);
  });

  if (!hasConfig()) {
    submitButton.disabled = true;
    setStatus("Ownership updates are temporarily unavailable.", true);
    return;
  }

  supabase = createBrowserSupabase();
  try {
    session = await consumeAuthCallbackSessionIfPresent(supabase) || await getSessionOrNull(supabase);
  } catch {
    session = null;
    setStatus("That verification link is invalid or expired. Please request a new one.", true);
  }

  if (!session?.user) {
    accountState.textContent = "We’ll securely connect this request to your existing N3XRA account or create one after you verify your email.";
    return;
  }

  const email = String(session.user.email || "").trim().toLowerCase();
  emailInput.value = email;
  emailInput.readOnly = true;
  if (!fullNameInput.value.trim()) {
    fullNameInput.value = String(session.user.user_metadata?.full_name || "").trim();
  }
  accountState.textContent = `Signed in as ${email}. This request will be connected to your N3XRA account.`;

  const completing = new URLSearchParams(window.location.search).get("interest") === "complete";
  if (completing && readDraft()) {
    try {
      await saveAuthenticatedInterest();
      cleanCompletionIntent();
      document.getElementById("ownership-updates")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(error?.message || "Your email is verified, but the request could not be saved.", true);
    }
    return;
  }

  try {
    await loadExistingInterest();
  } catch (error) {
    setStatus(error?.message || "Your saved interest could not be loaded.", true);
  }
}

init();
