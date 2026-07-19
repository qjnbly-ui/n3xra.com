import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";

const DRAFT_KEY = "n3xra.website-request.draft.v1";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FIELD_IDS = [
  "request-contact-name",
  "request-business-name",
  "request-email",
  "request-phone",
  "request-project-type",
  "request-existing-url",
  "request-goal",
  "request-audience",
  "request-pages",
  "request-features",
  "request-budget",
  "request-launch-date",
  "request-notes",
];

const form = document.getElementById("website-request-form");
const statusScreen = document.getElementById("portal-status");
const inlineStatus = document.getElementById("request-status");
const requestList = document.getElementById("request-list");
const requestHistory = document.getElementById("request-history");
const submitButton = document.getElementById("request-submit-button") || form?.querySelector('[type="submit"]');
const verificationCard = document.getElementById("request-verification-card");
const verificationEmail = document.getElementById("request-verification-email");
const resendButton = document.getElementById("request-resend-link");
const accountLink = document.getElementById("request-account-link");
const accountTitle = document.getElementById("request-account-title");
const accountCopy = document.getElementById("request-account-copy");
const accountState = document.getElementById("request-account-state");
const emailHelp = document.getElementById("request-email-help");
const menuTitle = document.getElementById("request-menu-title");
const isEmbedded = form?.dataset.portalEmbedded === "true";

let supabase = null;
let session = null;
let restoredDraft = false;
let isSubmitting = false;

function field(id) {
  return document.getElementById(id);
}

function value(id) {
  return String(field(id)?.value || "").trim();
}

function escapeHtml(input = "") {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listValue(id) {
  return value(id).split(",").map((item) => item.trim()).filter(Boolean);
}

function setStatus(message = "", error = false) {
  if (!inlineStatus) return;
  inlineStatus.textContent = message;
  inlineStatus.classList.toggle("is-error", error);
}

function formatStatus(status) {
  return String(status || "").replaceAll("_", " ");
}

function getDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
    if (!draft || draft.version !== 1 || !draft.savedAt) return null;
    if (Date.now() - Number(draft.savedAt) > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function saveDraft() {
  if (!form) return;
  const values = {};
  FIELD_IDS.forEach((id) => {
    const input = field(id);
    if (input) values[id] = input.value;
  });
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      values,
    }));
  } catch {
    // The intake still works when browser storage is unavailable.
  }
}

function restoreDraft() {
  const draft = getDraft();
  if (!draft?.values) return false;
  FIELD_IDS.forEach((id) => {
    const input = field(id);
    if (input && typeof draft.values[id] === "string") input.value = draft.values[id];
  });
  return true;
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
  restoredDraft = false;
}

function setMode(isSignedIn) {
  if (isEmbedded) return;
  document.body.classList.toggle("request-guest", !isSignedIn);
  document.body.classList.toggle("request-signed-in", isSignedIn);
  if (accountLink) {
    accountLink.textContent = isSignedIn ? "Dashboard" : "Login";
    accountLink.href = isSignedIn ? "/account/" : "/account/?next=%2Fwebsite-request%2F";
  }
  if (menuTitle) menuTitle.textContent = isSignedIn ? "Website portal" : "Start a project";
  if (requestHistory) requestHistory.hidden = !isSignedIn;
}

function updateAccountState() {
  const emailInput = field("request-email");
  if (!emailInput) return;

  if (session?.user) {
    const signedInEmail = String(session.user.email || "").trim().toLowerCase();
    if (signedInEmail) emailInput.value = signedInEmail;
    emailInput.readOnly = true;
    const contactName = field("request-contact-name");
    if (contactName && !contactName.value.trim()) {
      contactName.value = String(session.user.user_metadata?.full_name || "").trim();
    }
    if (accountTitle) accountTitle.textContent = "Your project will stay with this account.";
    if (accountCopy) accountCopy.textContent = "You are already verified. Submit when the website details are ready.";
    if (accountState) accountState.textContent = signedInEmail || "Signed in";
    if (emailHelp) emailHelp.textContent = "This request will be owned by your signed-in N3XRA account.";
    if (submitButton) submitButton.textContent = "Submit website request";
  } else {
    emailInput.readOnly = false;
    if (accountTitle) accountTitle.textContent = "Start now. Verify when you submit.";
    if (accountCopy) accountCopy.textContent = "Already use N3XRA? Enter the same email and this project will connect to your existing account. If it is new, the secure link creates your account automatically.";
    if (accountState) accountState.textContent = "Not signed in";
    if (emailHelp) emailHelp.textContent = "Use the email already connected to N3XRA to avoid creating another account.";
    if (submitButton) submitButton.textContent = "Verify email & submit project";
  }
}

function cleanSubmitIntent() {
  const url = new URL(window.location.href);
  url.searchParams.delete("submit");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function hasSubmitIntent() {
  return new URLSearchParams(window.location.search).get("submit") === "1";
}

function requestPayload() {
  return {
    user_id: session.user.id,
    contact_name: value("request-contact-name"),
    business_name: value("request-business-name"),
    contact_email: String(session.user.email || value("request-email")).trim().toLowerCase(),
    contact_phone: value("request-phone") || null,
    project_type: value("request-project-type"),
    existing_website_url: value("request-existing-url") || null,
    primary_goal: value("request-goal"),
    audience: value("request-audience") || null,
    requested_pages: listValue("request-pages"),
    requested_features: listValue("request-features"),
    budget_range: value("request-budget") || null,
    target_launch_date: value("request-launch-date") || null,
    additional_notes: value("request-notes") || null,
    status: "submitted",
  };
}

async function loadRequests() {
  if (!session?.user || !requestList) return;
  const { data, error } = await supabase.from("website_service_requests")
    .select("id,business_name,project_type,status,created_at,primary_goal,website_proposals(id,status),website_projects(id,status)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  requestList.innerHTML = (data || []).length ? data.map((request) => {
    const proposal = Array.isArray(request.website_proposals) ? request.website_proposals[0] : request.website_proposals;
    const project = Array.isArray(request.website_projects) ? request.website_projects[0] : request.website_projects;
    return `
      <article class="portal-request-card">
        <div><p class="portal-kicker">${escapeHtml(formatStatus(request.project_type))}</p><h3>${escapeHtml(request.business_name)}</h3><p>${escapeHtml(request.primary_goal)}</p></div>
        <div class="portal-request-client-actions">
          <span class="portal-badge portal-status-${escapeHtml(request.status)}">${escapeHtml(formatStatus(request.status))}</span>
          <p>${new Date(request.created_at).toLocaleDateString()}</p>
          ${project ? `<a class="portal-button" href="/project-workspace/?project=${encodeURIComponent(project.id)}">Open project</a>` : ""}
          ${proposal ? `<a class="portal-button portal-button-secondary" href="/proposals/?proposal=${encodeURIComponent(proposal.id)}">Review proposal</a>` : ""}
        </div>
      </article>
    `;
  }).join("") : '<div class="portal-empty"><p>No project requests have been submitted from this account yet.</p></div>';
}

async function submitAuthenticatedRequest({ automatic = false } = {}) {
  if (!session?.user || isSubmitting) return;
  if (!form.reportValidity()) {
    if (automatic) {
      cleanSubmitIntent();
      setStatus("Email verified. Review the highlighted fields, then submit your project.", true);
    }
    return;
  }

  isSubmitting = true;
  submitButton.disabled = true;
  setStatus(automatic ? "Email verified. Submitting your project…" : "Submitting your request…");
  try {
    const { error } = await supabase.from("website_service_requests").insert(requestPayload());
    if (error) throw error;

    form.reset();
    clearDraft();
    cleanSubmitIntent();
    updateAccountState();
    if (verificationCard) verificationCard.hidden = true;
    setStatus("Your website request was submitted and connected to your N3XRA account.");
    await loadRequests();
  } catch (error) {
    setStatus(error?.message || "Unable to submit your request.", true);
  } finally {
    isSubmitting = false;
    submitButton.disabled = false;
  }
}

async function sendVerificationLink() {
  if (session?.user || isSubmitting) return;
  const emailInput = field("request-email");
  const email = value("request-email").toLowerCase();
  if (!email || !emailInput?.checkValidity()) {
    emailInput?.focus();
    emailInput?.reportValidity();
    setStatus("Enter a valid email to connect with this project.", true);
    return;
  }

  saveDraft();
  isSubmitting = true;
  submitButton.disabled = true;
  if (resendButton) resendButton.disabled = true;
  setStatus("Sending your secure verification link…");
  try {
    const redirectUrl = `${window.location.origin}/website-request/?submit=1`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl,
        data: {
          full_name: value("request-contact-name"),
          project_intake: true,
        },
      },
    });
    if (error) throw error;

    if (verificationEmail) verificationEmail.textContent = email;
    if (verificationCard) verificationCard.hidden = false;
    setStatus("Secure link sent. Your website details are saved on this device.");
    verificationCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStatus(error?.message || "Unable to send the verification link.", true);
  } finally {
    isSubmitting = false;
    submitButton.disabled = false;
    if (resendButton) resendButton.disabled = false;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  saveDraft();
  if (session?.user) {
    await submitAuthenticatedRequest();
  } else {
    await sendVerificationLink();
  }
}

function bindEvents() {
  form?.addEventListener("submit", handleSubmit);
  form?.querySelectorAll("input, select, textarea").forEach((input) => {
    input.addEventListener("input", saveDraft);
    input.addEventListener("change", saveDraft);
  });
  resendButton?.addEventListener("click", sendVerificationLink);
}

function finishLoading() {
  if (isEmbedded) return;
  document.body.classList.remove("portal-loading");
  if (statusScreen) statusScreen.hidden = true;
}

async function init() {
  if (!form) return;
  restoredDraft = restoreDraft();
  bindEvents();

  if (!hasConfig()) {
    setMode(false);
    finishLoading();
    setStatus("Project intake is temporarily unavailable.", true);
    return;
  }

  supabase = createBrowserSupabase();
  try {
    session = await consumeAuthCallbackSessionIfPresent(supabase) || await getSessionOrNull(supabase);
  } catch {
    session = null;
    setStatus("This verification link is invalid or expired. Send a new link to continue.", true);
  }

  if (isEmbedded && !session?.user) return;

  setMode(Boolean(session?.user));
  updateAccountState();
  finishLoading();

  if (!session?.user) {
    if (hasSubmitIntent()) {
      cleanSubmitIntent();
      setStatus("This verification link is invalid or expired. Send a new link to continue.", true);
    }
    return;
  }

  await loadRequests();
  if (hasSubmitIntent()) {
    if (restoredDraft) {
      await submitAuthenticatedRequest({ automatic: true });
    } else {
      cleanSubmitIntent();
      setStatus("Email verified. Your account is ready; complete the website details to submit.");
    }
  }
}

init().catch((error) => {
  finishLoading();
  if (statusScreen && !statusScreen.hidden) {
    statusScreen.textContent = error?.message || "Project intake could not be opened.";
  } else {
    setStatus(error?.message || "Project intake could not be opened.", true);
  }
});
