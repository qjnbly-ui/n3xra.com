import {
  consumeAuthCallbackSessionIfPresent,
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";

const DRAFT_KEY = "n3xra.website-request.draft.v1";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FOUNDING_OFFER_ACCESS_KEY = "n3xra.freewebsite.access.v1";
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
const ADVANCED_FEATURES = new Set([
  "Online payments", "Online store", "Appointment scheduling", "Event registration",
  "Customer accounts", "Client portal", "Member-only content", "File uploads",
  "Multiple languages", "CRM integration",
]);
const ADVANCED_SCOPE_LIMITS = {
  pages: 5,
  features: 6,
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
  "request-service-plan",
  "request-budget",
  "request-launch-date",
  "request-referral-code",
  "request-notes",
];

const form = document.getElementById("website-request-form");
const statusScreen = document.getElementById("portal-status");
const inlineStatus = document.getElementById("request-status");
const requestList = document.getElementById("request-list");
const requestHistory = document.getElementById("request-history");
const submitButton = document.getElementById("request-submit-button") || form?.querySelector('[type="submit"]');
const aiReview = document.getElementById("request-ai-review");
const reviewLoading = document.getElementById("request-review-loading");
const reviewContent = document.getElementById("request-review-content");
const reviewMessage = document.getElementById("request-review-message");
const reviewSummary = document.getElementById("request-review-summary");
const reviewGuidance = document.getElementById("request-review-guidance");
const reviewQuestions = document.getElementById("request-review-questions");
const reviewQuestionFields = document.getElementById("request-review-question-fields");
const reviewQuestionsTitle = document.getElementById("request-review-questions-title");
const reviewQuestionsCopy = document.getElementById("request-review-questions-copy");
const reviewCloseButton = document.getElementById("request-review-close");
const applyAnswersButton = document.getElementById("request-apply-answers");
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
const referralCodeInput = document.getElementById("request-referral-code");
const referralCodeStatus = document.getElementById("request-referral-code-status");
const referralCodeLabel = document.getElementById("request-referral-code-label");
const referralCodeLabelText = document.getElementById("request-referral-code-label-text");
const referralCodeOptional = document.getElementById("request-referral-code-optional");
const referralCodeRemove = document.getElementById("request-referral-code-remove");
const appliedOffer = document.getElementById("request-applied-offer");
const pricingCopy = document.getElementById("request-pricing-copy");
const pricingPlansLink = document.getElementById("request-pricing-plans-link");
const servicePlanField = document.getElementById("request-service-plan-field");
const servicePlanInput = document.getElementById("request-service-plan");
const servicePlanStatus = document.getElementById("request-service-plan-status");
const servicePlanTrigger = document.getElementById("request-service-plan-trigger");
const servicePlanDialog = document.getElementById("request-service-plan-dialog");
const servicePlanDialogClose = document.getElementById("request-service-plan-dialog-close");
const servicePlanOptions = [...document.querySelectorAll("[data-plan-option]")];
const isEmbedded = form?.dataset.portalEmbedded === "true";

let supabase = null;
let session = null;
let restoredDraft = false;
let isSubmitting = false;
let isReviewing = false;
let reviewedSnapshot = "";
let pendingQuestions = [];
let latestReviewId = "";
let referralValidationTimer = null;
let validatedReferralCode = "";
let foundingOfferActive = false;
let servicePlanAutoApplied = false;
let servicePlanReason = "";

function field(id) {
  return document.getElementById(id);
}

function value(id) {
  return String(field(id)?.value || "").trim();
}

function normalizeReferralCode(input) {
  return String(input || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

function normalizePlan(input) {
  const plan = String(input || "").trim().toLowerCase();
  return ["starter", "starter_plus", "advanced"].includes(plan) ? plan : "";
}

function hasFoundingOfferAccess() {
  try {
    const expiresAt = Number(localStorage.getItem(FOUNDING_OFFER_ACCESS_KEY) || 0);
    const active = expiresAt > Date.now();
    if (!active) localStorage.removeItem(FOUNDING_OFFER_ACCESS_KEY);
    return active;
  } catch {
    return false;
  }
}

function clearFoundingOfferAccess() {
  try {
    localStorage.removeItem(FOUNDING_OFFER_ACCESS_KEY);
  } catch {}
}

function planLabel(plan) {
  const normalized = normalizePlan(plan);
  return normalized === "starter_plus" ? "Starter+" : normalized === "advanced" ? "Advanced" : normalized === "starter" ? "Starter" : "Not specified";
}

function updateServicePlanTrigger() {
  const selected = normalizePlan(servicePlanInput?.value);
  if (servicePlanTrigger) {
    servicePlanTrigger.textContent = selected ? `Selected: ${planLabel(selected)}` : "Choose service plan";
    servicePlanTrigger.setAttribute("aria-expanded", String(Boolean(servicePlanDialog && !servicePlanDialog.hidden)));
    servicePlanTrigger.setAttribute("aria-invalid", String(!selected));
  }
}

function openServicePlanDialog() {
  if (!servicePlanDialog) return;
  servicePlanDialog.hidden = false;
  servicePlanTrigger?.setAttribute("aria-expanded", "true");
  const current = servicePlanOptions.find((button) => button.dataset.planOption === normalizePlan(servicePlanInput?.value));
  (current || servicePlanOptions[0])?.focus();
}

function closeServicePlanDialog() {
  if (!servicePlanDialog) return;
  servicePlanDialog.hidden = true;
  servicePlanTrigger?.setAttribute("aria-expanded", "false");
  servicePlanTrigger?.focus();
}

function chooseServicePlan(plan) {
  if (!servicePlanInput) return;
  servicePlanInput.value = normalizePlan(plan);
  servicePlanAutoApplied = false;
  servicePlanReason = "";
  updateServicePlanFit({ announce: true });
  saveDraft();
  closeServicePlanDialog();
}

function advancedScopeReasons() {
  const pages = listValue("request-pages");
  const features = listValue("request-features");
  const advancedFeatures = features.filter((feature) => ADVANCED_FEATURES.has(feature));
  const customAdvancedFeatures = features.filter((feature) => {
    if (ADVANCED_FEATURES.has(feature)) return false;
    return /(payment|store|shop|account|portal|member|membership|schedule|booking|upload|protected|language|crm|api|automation|subscription)/i.test(feature);
  });
  const reasons = [];
  if (advancedFeatures.length || customAdvancedFeatures.length) {
    const names = [...advancedFeatures, ...customAdvancedFeatures].slice(0, 3);
    reasons.push(`${names.join(", ")}${advancedFeatures.length + customAdvancedFeatures.length > 3 ? " and other advanced functionality" : ""}`);
  }
  if (pages.length > ADVANCED_SCOPE_LIMITS.pages) reasons.push(`${pages.length} requested pages`);
  if (features.length > ADVANCED_SCOPE_LIMITS.features) reasons.push(`${features.length} requested features`);
  return reasons;
}

function updateServicePlanFit({ announce = false } = {}) {
  if (!servicePlanInput || !servicePlanStatus) return;
  const selectedPlan = normalizePlan(servicePlanInput.value);
  const reasons = advancedScopeReasons();
  const requiresAdvanced = reasons.length > 0;
  servicePlanInput.setCustomValidity("");
  servicePlanStatus.classList.remove("is-upgraded", "is-error");
  servicePlanStatus.hidden = true;

  if (requiresAdvanced && selectedPlan !== "advanced") {
    servicePlanInput.value = "advanced";
    servicePlanAutoApplied = true;
    servicePlanReason = `Advanced was applied because your request includes ${reasons.join(" and ")}. These projects need custom build work and service matched to the system.`;
    servicePlanStatus.textContent = servicePlanReason;
    servicePlanStatus.classList.add("is-upgraded");
    servicePlanStatus.hidden = false;
    updateServicePlanTrigger();
    return;
  }

  if (selectedPlan === "advanced") {
    if (!servicePlanAutoApplied) servicePlanReason = "";
    if (servicePlanAutoApplied) {
      servicePlanStatus.textContent = servicePlanReason;
      servicePlanStatus.classList.add("is-upgraded");
      servicePlanStatus.hidden = false;
    }
    updateServicePlanTrigger();
    return;
  }

  servicePlanAutoApplied = false;
  servicePlanReason = "";
  servicePlanStatus.textContent = "";
  if (announce && !selectedPlan) servicePlanInput.setCustomValidity("Choose a website service plan before continuing.");
  updateServicePlanTrigger();
}

function foundingOfferMessage() {
  return "FREEBUILD applied: your $250 website build fee is waived. You may also add a referral code for attribution; discounts do not stack.";
}

function syncReferralCodeUi() {
  const code = normalizeReferralCode(referralCodeInput?.value);
  if (appliedOffer) appliedOffer.hidden = !foundingOfferActive;
  if (referralCodeRemove) referralCodeRemove.hidden = !code || code === "FREEBUILD";
}

function setReferralStatus(message, state = "") {
  if (!referralCodeStatus) return;
  referralCodeStatus.textContent = message;
  referralCodeStatus.classList.toggle("is-valid", state === "valid");
  referralCodeStatus.classList.toggle("is-error", state === "error");
  syncReferralCodeUi();
}

async function validateReferralCode({ required = false } = {}) {
  if (!referralCodeInput) return true;
  const code = normalizeReferralCode(referralCodeInput.value);
  referralCodeInput.value = code;
  referralCodeInput.setCustomValidity("");
  if (!code) {
    validatedReferralCode = "";
    setReferralStatus(
      foundingOfferActive ? foundingOfferMessage() : "Enter a valid website referral code for 10% off the website build.",
      foundingOfferActive ? "valid" : "",
    );
    return true;
  }
  if (code.length < 4) {
    validatedReferralCode = "";
    const message = "Referral codes contain at least four letters or numbers.";
    setReferralStatus(message, "error");
    if (required) referralCodeInput.setCustomValidity(message);
    return false;
  }
  if (code === "FREEBUILD") {
    validatedReferralCode = "";
    referralCodeInput.value = "";
    if (foundingOfferActive) {
      setReferralStatus(foundingOfferMessage(), "valid");
      return true;
    }
    const message = "FREEBUILD is available only through the Limited Founding Offer link.";
    setReferralStatus(message, "error");
    if (required) referralCodeInput.setCustomValidity(message);
    return false;
  }
  if (validatedReferralCode === code) return true;

  setReferralStatus("Checking referral code…");
  try {
    const response = await fetch(`/api/website-referral-code?code=${encodeURIComponent(code)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to check this code.");
    if (!data.valid) {
      validatedReferralCode = "";
      const message = "That referral code is not valid for website referrals.";
      setReferralStatus(message, "error");
      if (required) referralCodeInput.setCustomValidity(message);
      return false;
    }
    validatedReferralCode = code;
    setReferralStatus(
      foundingOfferActive
        ? `Referral code ${code} added for attribution. FREEBUILD remains applied; discounts do not stack.`
        : "Referral code verified. Your proposal will include 10% off the website build.",
      "valid",
    );
    return true;
  } catch (error) {
    validatedReferralCode = "";
    const message = error?.message || "Unable to check this referral code right now.";
    setReferralStatus(message, "error");
    if (required) referralCodeInput.setCustomValidity(message);
    return false;
  }
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
  updateServicePlanFit();
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
      aiReviewId: latestReviewId,
      servicePlanAutoApplied,
      servicePlanReason,
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
  latestReviewId = typeof draft.aiReviewId === "string" ? draft.aiReviewId : "";
  servicePlanAutoApplied = draft.servicePlanAutoApplied === true;
  servicePlanReason = typeof draft.servicePlanReason === "string" ? draft.servicePlanReason : "";
  return true;
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
  restoredDraft = false;
  latestReviewId = "";
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
    if (submitButton) submitButton.textContent = "Review";
    if (finalSubmitButton) finalSubmitButton.textContent = "Submit website request";
  } else {
    emailInput.readOnly = false;
    if (accountTitle) accountTitle.textContent = "Use your N3XRA email.";
    if (accountCopy) accountCopy.textContent = "We’ll match an existing account or create one after you verify your email.";
    if (accountState) accountState.textContent = "Not signed in";
    if (emailHelp) emailHelp.textContent = "Use the email already connected to N3XRA to avoid creating another account.";
    if (submitButton) submitButton.textContent = "Review";
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
    servicePlan: normalizePlan(value("request-service-plan")),
    servicePlanAutoApplied,
    servicePlanReason,
    budgetRange: value("request-budget"),
    preferredLaunchDate: value("request-launch-date"),
    referralCode: normalizeReferralCode(value("request-referral-code")),
    offerCode: foundingOfferActive ? "FREEBUILD" : null,
    additionalNotes: value("request-notes"),
  };
}

function currentProjectSnapshot() {
  return JSON.stringify(projectDetails());
}

const REVIEW_FIELD_MAP = {
  phone: "request-phone",
  existingWebsiteUrl: "request-existing-url",
  primaryGoal: "request-goal",
  primaryAudience: "request-audience",
  budgetRange: "request-budget",
  preferredLaunchDate: "request-launch-date",
  additionalNotes: "request-notes",
};

function displayValue(input, fallback = "Not specified") {
  if (Array.isArray(input)) return input.length ? input.join(", ") : fallback;
  return String(input || "").trim() || fallback;
}

function renderReviewSummary() {
  const project = projectDetails();
  const groups = [
    ["Project", [
      ["Business or project", project.businessName],
      ["Project type", field("request-project-type")?.selectedOptions?.[0]?.textContent],
      ["Primary goal", project.primaryGoal],
      ["Audience", project.primaryAudience],
    ]],
    ["Scope", [
      ["Pages", project.requestedPages],
      ["Features", project.requestedFeatures],
      ["Service plan", `${planLabel(project.servicePlan)}${project.servicePlanAutoApplied ? " (applied automatically)" : ""}`],
      ...(project.servicePlanReason ? [["Plan fit", project.servicePlanReason]] : []),
      ["Budget", field("request-budget")?.selectedOptions?.[0]?.textContent],
      ["Preferred launch", project.preferredLaunchDate],
    ]],
    ["Contact", [
      ["Name", project.contactName],
      ["Email", project.email],
      ["Phone", project.phone],
      ["Referral code", project.referralCode],
      ...(project.offerCode === "FREEBUILD" ? [["Offer", "Founding offer — build fee waived"]] : []),
    ]],
  ];
  reviewSummary.innerHTML = groups.map(([title, items]) => `
    <section><h4>${title}</h4>${items.map(([label, item]) => `<div><span>${label}</span><strong>${escapeHtml(displayValue(item))}</strong></div>`).join("")}</section>
  `).join("");
}

function renderGuidance(observations = []) {
  const cards = observations.slice(0, 3).map((item) => `<section><h4>${escapeHtml(item.title || "Worth knowing")}</h4><p>${escapeHtml(item.body || "")}</p></section>`);
  reviewGuidance.hidden = cards.length === 0;
  reviewGuidance.innerHTML = cards.length ? `<div class="request-review-guidance-head"><h4>A little context before you send</h4><p>Based on what you selected, here are a few things worth knowing.</p></div><div>${cards.join("")}</div>` : "";
}

function renderQuestionFields(questions = [], questionsNote = "") {
  pendingQuestions = questions.filter((question) => REVIEW_FIELD_MAP[question.field]).slice(0, 3);
  reviewQuestions.hidden = pendingQuestions.length === 0;
  reviewQuestionsTitle.textContent = pendingQuestions.length === 1 ? "One detail that would help" : "A few details that would help";
  reviewQuestionsCopy.textContent = String(questionsNote || "These are relevant to your project. Answer what you can and we’ll add it directly to your request.");
  reviewQuestionFields.innerHTML = pendingQuestions.map((question, index) => {
    const source = field(REVIEW_FIELD_MAP[question.field]);
    const inputId = `request-review-answer-${index}`;
    if (question.field === "budgetRange") {
      return `<label for="${inputId}">${escapeHtml(question.question)}<span>${escapeHtml(question.reason || "")}</span><select id="${inputId}" data-review-field="${question.field}">${Array.from(source.options).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === source.value ? " selected" : ""}>${escapeHtml(option.textContent)}</option>`).join("")}</select></label>`;
    }
    const type = question.field === "phone" ? "tel" : question.field === "existingWebsiteUrl" ? "url" : question.field === "preferredLaunchDate" ? "date" : "";
    const control = type
      ? `<input id="${inputId}" data-review-field="${question.field}" type="${type}" value="${escapeHtml(source.value)}">`
      : `<textarea id="${inputId}" data-review-field="${question.field}" rows="3">${escapeHtml(source.value)}</textarea>`;
    return `<label for="${inputId}">${escapeHtml(question.question)}<span>${escapeHtml(question.reason || "")}</span>${control}</label>`;
  }).join("");
}

function closeAiReview() {
  aiReview.hidden = true;
  document.body.classList.remove("request-review-open");
  submitButton.focus();
}

async function askProjectAi() {
  if (isReviewing) return;
  isReviewing = true;
  submitButton.disabled = true;
  if (finalSubmitButton) finalSubmitButton.disabled = true;
  reviewLoading.hidden = false;
  reviewContent.hidden = true;
  setAiStatus("");
  try {
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const response = await fetch("/api/project-request-review", {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectDetails(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "N3XRA AI could not review the project.");
    reviewMessage.textContent = String(data.message || `Thanks, ${value("request-contact-name").split(" ")[0]}. We have your project details and we’re genuinely excited to help bring this together.`);
    renderReviewSummary();
    renderGuidance(Array.isArray(data.observations) ? data.observations : []);
    renderQuestionFields(Array.isArray(data.questions) ? data.questions : [], data.questionsNote);
    latestReviewId = String(data.reviewId || "");
    reviewedSnapshot = currentProjectSnapshot();
    saveDraft();
    reviewLoading.hidden = true;
    reviewContent.hidden = false;
    setAiStatus(pendingQuestions.length ? "Add the details above, or continue if you’d rather discuss them with us later." : "Everything looks ready. We’re excited to review your request.");
  } catch (error) {
    reviewLoading.hidden = true;
    reviewContent.hidden = false;
    renderReviewSummary();
    renderGuidance();
    reviewMessage.textContent = "We have your project details together and we’re excited to help. You can review everything below before sending it.";
    renderQuestionFields([]);
    reviewedSnapshot = currentProjectSnapshot();
    setAiStatus("The extra AI check was unavailable, but your complete request is ready to submit.", true);
  } finally {
    isReviewing = false;
    submitButton.disabled = false;
    if (finalSubmitButton) finalSubmitButton.disabled = false;
  }
}

async function openAiReview() {
  updateServicePlanFit({ announce: true });
  if (!normalizePlan(value("request-service-plan"))) {
    servicePlanTrigger?.focus();
    openServicePlanDialog();
    return;
  }
  if (!form.reportValidity()) return;
  if (!await validateReferralCode({ required: true })) {
    referralCodeInput?.reportValidity();
    referralCodeInput?.focus();
    return;
  }
  saveDraft();
  reviewedSnapshot = "";
  aiReview.hidden = false;
  document.body.classList.add("request-review-open");
  await askProjectAi();
}

function applyReviewAnswers() {
  reviewQuestionFields.querySelectorAll("[data-review-field]").forEach((input) => {
    const target = field(REVIEW_FIELD_MAP[input.dataset.reviewField]);
    if (target && input.value.trim()) target.value = input.value.trim();
  });
  updateServicePlanFit();
  saveDraft();
  reviewedSnapshot = currentProjectSnapshot();
  renderReviewSummary();
  reviewQuestions.hidden = true;
  setAiStatus("Added. Your request is updated and ready to send.");
}

async function finalizeRequest() {
  if (!form.reportValidity() || isSubmitting || isReviewing) return;
  if (!reviewedSnapshot || reviewedSnapshot !== currentProjectSnapshot()) {
    setAiStatus("Your details changed. Please run the AI review again before submitting.", true);
    await openAiReview();
    return;
  }
  saveDraft();
  closeAiReview();
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
    service_plan: normalizePlan(value("request-service-plan")),
    service_plan_auto_applied: servicePlanAutoApplied,
    service_plan_reason: servicePlanReason || null,
    budget_range: value("request-budget") || null,
    target_launch_date: value("request-launch-date") || null,
    referral_code: validatedReferralCode || null,
    offer_code: foundingOfferActive ? "FREEBUILD" : null,
    additional_notes: value("request-notes") || null,
    ai_review_id: latestReviewId || null,
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
    const response = await fetch("/api/submit-website-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(requestPayload()),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "Unable to submit your request.");

    form.reset();
    validatedReferralCode = "";
    servicePlanAutoApplied = false;
    servicePlanReason = "";
    if (referralCodeInput) {
      referralCodeInput.value = "";
      referralCodeInput.readOnly = false;
    }
    syncPickers();
    updateServicePlanFit();
    if (aiReview) aiReview.hidden = true;
    document.body.classList.remove("request-review-open");
    pendingQuestions = [];
    reviewedSnapshot = "";
    clearDraft();
    if (foundingOfferActive) {
      clearFoundingOfferAccess();
      foundingOfferActive = false;
    }
    setReferralStatus("Enter a valid website referral code for 10% off the website build.");
    cleanSubmitIntent();
    updateAccountState();
    if (verificationCard) verificationCard.hidden = true;
    setStatus("Your website request is submitted. N3XRA has been notified and will contact you by email with the next step.");
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
    const redirectParams = new URLSearchParams({ submit: "1" });
    if (foundingOfferActive) {
      redirectParams.set("offer", "freewebsite");
    }
    const referralCode = normalizeReferralCode(referralCodeInput?.value);
    if (referralCode && referralCode !== "FREEBUILD") redirectParams.set("ref", referralCode);
    const redirectUrl = `${window.location.origin}/website-request/?${redirectParams.toString()}`;
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
  reviewCloseButton?.addEventListener("click", closeAiReview);
  aiReview?.addEventListener("click", (event) => {
    if (event.target === aiReview) closeAiReview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && aiReview && !aiReview.hidden) closeAiReview();
  });
  applyAnswersButton?.addEventListener("click", applyReviewAnswers);
  editDetailsButton?.addEventListener("click", () => {
    closeAiReview();
    field("request-contact-name")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  finalSubmitButton?.addEventListener("click", finalizeRequest);
  referralCodeInput?.addEventListener("input", () => {
    const normalized = normalizeReferralCode(referralCodeInput.value);
    referralCodeInput.value = normalized;
    if (normalized !== validatedReferralCode) validatedReferralCode = "";
    referralCodeInput.setCustomValidity("");
    syncReferralCodeUi();
    clearTimeout(referralValidationTimer);
    referralValidationTimer = setTimeout(() => validateReferralCode(), 450);
  });
  referralCodeInput?.addEventListener("blur", () => validateReferralCode());
  referralCodeRemove?.addEventListener("click", () => {
    referralCodeInput.value = "";
    referralCodeInput.setCustomValidity("");
    validatedReferralCode = "";
    clearTimeout(referralValidationTimer);
    setReferralStatus(
      foundingOfferActive ? foundingOfferMessage() : "Enter a valid website referral code for 10% off the website build.",
      foundingOfferActive ? "valid" : "",
    );
    saveDraft();
    referralCodeInput.focus();
  });
  servicePlanInput?.addEventListener("change", () => {
    servicePlanAutoApplied = false;
    servicePlanReason = "";
    updateServicePlanFit({ announce: true });
    saveDraft();
  });
  servicePlanTrigger?.addEventListener("click", openServicePlanDialog);
  pricingPlansLink?.addEventListener("click", (event) => {
    event.preventDefault();
    servicePlanField?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(openServicePlanDialog, 280);
  });
  servicePlanDialogClose?.addEventListener("click", closeServicePlanDialog);
  servicePlanOptions.forEach((button) => {
    button.addEventListener("click", () => chooseServicePlan(button.dataset.planOption));
  });
  servicePlanDialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeServicePlanDialog();
    }
  });
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
  const params = new URLSearchParams(window.location.search);
  foundingOfferActive = params.get("offer") === "freewebsite" && hasFoundingOfferAccess();
  const linkedReferralCode = normalizeReferralCode(params.get("ref"));
  if (linkedReferralCode && linkedReferralCode !== "FREEBUILD" && referralCodeInput) {
    referralCodeInput.value = linkedReferralCode;
  }
  if (referralCodeInput?.value === "FREEBUILD") referralCodeInput.value = "";
  if (foundingOfferActive) {
    if (pricingCopy) pricingCopy.textContent = "Limited founding offer: the one-time website build fee is waived. Service plans start at $25/month.";
    setReferralStatus(foundingOfferMessage(), "valid");
  }
  syncReferralCodeUi();
  syncPickers();
  updateServicePlanFit();
  bindEvents();
  if (referralCodeInput?.value) validateReferralCode();

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
