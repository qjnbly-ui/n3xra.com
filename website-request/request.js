import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";

const DRAFT_KEY = "n3xra.website-request.draft.v1";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PICKER_OPTIONS = {
  pages: [
    "Home", "About", "Services", "Service detail", "Products", "Shop",
    "Portfolio", "Projects", "Gallery", "Blog", "News", "Events",
    "Team", "Testimonials", "FAQ", "Pricing", "Resources", "Contact",
    "Booking", "Client portal", "Privacy policy", "Terms & conditions",
  ],
  features: [
    "Contact form", "Quote request form", "Online payments", "Online store",
    "Appointment scheduling", "Event registration", "Photo gallery",
    "Video gallery", "Blog or news", "Email newsletter signup", "Live chat",
    "Customer accounts", "Client portal", "Member-only content", "File uploads",
    "Downloads", "Search", "Reviews or testimonials", "Social media feed",
    "Interactive map", "Multiple languages", "Accessibility enhancements",
    "Analytics", "CRM integration",
  ],
};
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
const aiReview = document.getElementById("request-ai-review");
const aiMessages = document.getElementById("request-ai-messages");
const aiQuestion = document.getElementById("request-ai-question");
const aiSendButton = document.getElementById("request-ai-send");
const aiStatus = document.getElementById("request-ai-status");
const editDetailsButton = document.getElementById("request-edit-details");
const finalSubmitButton = document.getElementById("request-final-submit");
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
let isReviewing = false;
let reviewedSnapshot = "";
let aiHistory = [];

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

function pickerValues(picker) {
  return listValue(picker.querySelector("input[type='hidden']").id);
}

function renderPickerState(picker) {
  const values = pickerValues(picker);
  const summary = picker.querySelector(".request-picker-summary");
  const chips = picker.querySelector(".request-picker-chips");
  const placeholder = picker.dataset.requestPicker === "pages" ? "Choose pages" : "Choose features";
  summary.textContent = values.length ? `${values.length} selected` : placeholder;
  chips.innerHTML = values.map((item) => `
    <button class="request-picker-chip" type="button" data-remove-value="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">
      ${escapeHtml(item)} <span aria-hidden="true">×</span>
    </button>
  `).join("");
  picker.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = values.includes(checkbox.value);
  });
}

function setPickerValues(picker, values) {
  const hidden = picker.querySelector("input[type='hidden']");
  hidden.value = [...new Set(values.map((item) => item.trim()).filter(Boolean))].join(", ");
  renderPickerState(picker);
  saveDraft();
}

function initializePickers() {
  document.querySelectorAll("[data-request-picker]").forEach((picker) => {
    const type = picker.dataset.requestPicker;
    const label = type === "pages" ? "pages" : "features";
    picker.insertAdjacentHTML("beforeend", `
      <details class="request-picker">
        <summary><span class="request-picker-summary">Choose ${label}</span><span class="request-picker-arrow" aria-hidden="true"></span></summary>
        <div class="request-picker-menu">
          <p class="request-picker-hint">Select all that apply</p>
          <div class="request-picker-options">
            ${PICKER_OPTIONS[type].map((option) => `<label><input type="checkbox" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join("")}
          </div>
          <div class="request-picker-custom">
            <label for="request-${type}-custom">Add your own idea</label>
            <div><input id="request-${type}-custom" type="text" placeholder="Type another ${type === "pages" ? "page" : "feature"}"><button type="button">Add</button></div>
          </div>
        </div>
      </details>
      <div class="request-picker-chips" aria-live="polite"></div>
    `);

    picker.addEventListener("change", (event) => {
      if (!event.target.matches("input[type='checkbox']")) return;
      const values = pickerValues(picker);
      const next = event.target.checked
        ? [...values, event.target.value]
        : values.filter((item) => item !== event.target.value);
      setPickerValues(picker, next);
    });

    picker.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-value]");
      if (removeButton) {
        setPickerValues(picker, pickerValues(picker).filter((item) => item !== removeButton.dataset.removeValue));
        return;
      }
      if (!event.target.matches(".request-picker-custom button")) return;
      const customInput = picker.querySelector(".request-picker-custom input");
      if (!customInput.value.trim()) return customInput.focus();
      setPickerValues(picker, [...pickerValues(picker), customInput.value]);
      customInput.value = "";
      customInput.focus();
    });

    picker.querySelector(".request-picker-custom input").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      picker.querySelector(".request-picker-custom button").click();
    });
  });
}

function syncPickers() {
  document.querySelectorAll("[data-request-picker]").forEach(renderPickerState);
}

function setStatus(message = "", error = false) {
  if (!inlineStatus) return;
  inlineStatus.textContent = message;
  inlineStatus.classList.toggle("is-error", error);
}

function setAiStatus(message = "", error = false) {
  if (!aiStatus) return;
  aiStatus.textContent = message;
  aiStatus.classList.toggle("is-error", error);
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
    if (accountTitle) accountTitle.textContent = "Signed in and ready.";
    if (accountCopy) accountCopy.textContent = "This project will be saved to your current N3XRA account.";
    if (accountState) accountState.textContent = signedInEmail || "Signed in";
    if (emailHelp) emailHelp.textContent = "This request will be owned by your signed-in N3XRA account.";
    if (submitButton) submitButton.textContent = "Review with N3XRA AI";
    if (finalSubmitButton) finalSubmitButton.textContent = "Submit website request";
  } else {
    emailInput.readOnly = false;
    if (accountTitle) accountTitle.textContent = "Use your N3XRA email.";
    if (accountCopy) accountCopy.textContent = "We’ll match an existing account or create one after you verify your email.";
    if (accountState) accountState.textContent = "Not signed in";
    if (emailHelp) emailHelp.textContent = "Use the email already connected to N3XRA to avoid creating another account.";
    if (submitButton) submitButton.textContent = "Review with N3XRA AI";
    if (finalSubmitButton) finalSubmitButton.textContent = "Continue & submit request";
  }
}

function projectDetails() {
  return {
    contactName: value("request-contact-name"),
    businessName: value("request-business-name"),
    email: value("request-email"),
    phone: value("request-phone"),
    projectType: value("request-project-type"),
    existingWebsiteUrl: value("request-existing-url"),
    primaryGoal: value("request-goal"),
    primaryAudience: value("request-audience"),
    requestedPages: listValue("request-pages"),
    requestedFeatures: listValue("request-features"),
    budgetRange: value("request-budget"),
    preferredLaunchDate: value("request-launch-date"),
    additionalNotes: value("request-notes"),
  };
}

function currentProjectSnapshot() {
  return JSON.stringify(projectDetails());
}

function appendAiMessage(role, content) {
  if (!aiMessages) return;
  const message = document.createElement("article");
  message.className = `request-ai-message is-${role}`;
  const name = document.createElement("strong");
  name.textContent = role === "assistant" ? "N3XRA AI" : "You";
  const copy = document.createElement("p");
  copy.textContent = content;
  message.append(name, copy);
  aiMessages.append(message);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

async function askProjectAi(question = "") {
  if (isReviewing) return;
  isReviewing = true;
  submitButton.disabled = true;
  if (aiSendButton) aiSendButton.disabled = true;
  if (finalSubmitButton) finalSubmitButton.disabled = true;
  setAiStatus(question ? "N3XRA AI is responding…" : "N3XRA AI is reviewing your project…");

  if (question) appendAiMessage("user", question);
  try {
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const response = await fetch("/api/project-request-review", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectDetails(),
        question,
        history: aiHistory,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "N3XRA AI could not review the project.");
    const answer = String(data.answer || "").trim();
    if (!answer) throw new Error("N3XRA AI returned an empty response.");
    if (question) aiHistory.push({ role: "user", content: question });
    aiHistory.push({ role: "assistant", content: answer });
    aiHistory = aiHistory.slice(-10);
    appendAiMessage("assistant", answer);
    reviewedSnapshot = currentProjectSnapshot();
    setAiStatus("Review ready. You can keep chatting, edit details, or submit.");
  } catch (error) {
    setAiStatus(error?.message || "Unable to complete the AI review.", true);
  } finally {
    isReviewing = false;
    submitButton.disabled = false;
    if (aiSendButton) aiSendButton.disabled = false;
    if (finalSubmitButton) finalSubmitButton.disabled = false;
  }
}

async function openAiReview() {
  if (!form.reportValidity()) return;
  saveDraft();
  aiHistory = [];
  reviewedSnapshot = "";
  if (aiMessages) aiMessages.innerHTML = "";
  aiReview.hidden = false;
  aiReview.scrollIntoView({ behavior: "smooth", block: "start" });
  await askProjectAi();
}

async function sendAiQuestion() {
  const question = String(aiQuestion?.value || "").trim();
  if (!question) return aiQuestion?.focus();
  aiQuestion.value = "";
  await askProjectAi(question);
}

async function finalizeRequest() {
  if (!form.reportValidity() || isSubmitting || isReviewing) return;
  if (!reviewedSnapshot || reviewedSnapshot !== currentProjectSnapshot()) {
    setAiStatus("Your details changed. Please run the AI review again before submitting.", true);
    await openAiReview();
    return;
  }
  saveDraft();
  if (session?.user) {
    await submitAuthenticatedRequest();
  } else {
    await sendVerificationLink();
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
    syncPickers();
    if (aiReview) aiReview.hidden = true;
    if (aiMessages) aiMessages.innerHTML = "";
    aiHistory = [];
    reviewedSnapshot = "";
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
  await openAiReview();
}

function bindEvents() {
  form?.addEventListener("submit", handleSubmit);
  form?.querySelectorAll("input, select, textarea").forEach((input) => {
    input.addEventListener("input", saveDraft);
    input.addEventListener("change", saveDraft);
  });
  resendButton?.addEventListener("click", sendVerificationLink);
  aiSendButton?.addEventListener("click", sendAiQuestion);
  aiQuestion?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    sendAiQuestion();
  });
  editDetailsButton?.addEventListener("click", () => {
    aiReview.hidden = true;
    field("request-contact-name")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  finalSubmitButton?.addEventListener("click", finalizeRequest);
}

function finishLoading() {
  if (isEmbedded) return;
  document.body.classList.remove("portal-loading");
  if (statusScreen) statusScreen.hidden = true;
}

async function init() {
  if (!form) return;
  initializePickers();
  restoredDraft = restoreDraft();
  syncPickers();
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
