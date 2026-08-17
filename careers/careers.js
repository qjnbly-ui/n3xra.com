import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const form = document.querySelector("#careers-form"); const status = document.querySelector("#careers-status");
const confirmationDialog = document.querySelector("#careers-confirmation");
const confirmationHeading = document.querySelector("#careers-confirmation-heading");
const confirmationMessage = document.querySelector("#careers-confirmation-message");
const confirmationNextStep = document.querySelector("#careers-confirmation-next-step");
const submitButton = document.querySelector("#careers-submit");
const turnstileElement = document.querySelector("#careers-turnstile");
let turnstileWidgetId = null;
let captchaToken = "";
const clean = (value) => String(value || "").trim();
const allowedFileTypes = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const safeFilename = (value) => clean(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "resume";

function resetTurnstile() {
  captchaToken = "";
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
  if (submitButton) submitButton.disabled = true;
}

function renderTurnstile() {
  const sitekey = clean(window.RECORDS_APP_CONFIG?.turnstileSiteKey);
  if (!sitekey) {
    status.textContent = "Applications are temporarily unavailable because the security check is not configured.";
    return;
  }
  if (!window.turnstile || !turnstileElement || turnstileWidgetId !== null) return;
  turnstileWidgetId = window.turnstile.render(turnstileElement, {
    sitekey,
    callback(token) {
      captchaToken = token;
      status.textContent = "";
      if (submitButton) submitButton.disabled = false;
    },
    "expired-callback"() {
      captchaToken = "";
      status.textContent = "Security check expired. Please complete it again.";
      if (submitButton) submitButton.disabled = true;
    },
    "error-callback"() {
      captchaToken = "";
      status.textContent = "Security check failed to load. Please refresh and try again.";
      if (submitButton) submitButton.disabled = true;
    },
  });
}

const turnstileTimer = window.setInterval(() => {
  if (!window.turnstile) return;
  window.clearInterval(turnstileTimer);
  renderTurnstile();
}, 100);

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("The résumé file could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function fallbackConfirmation(name) {
  const firstName = clean(name).split(/\s+/)[0] || "there";
  return {
    heading: `Thank you, ${firstName}.`,
    message: "Your application has been received and is safely in our hands.",
    next_step: "Our team will review it and contact you by email if there is a next step.",
  };
}

async function showConfirmation(applicationId, name) {
  const fallback = fallbackConfirmation(name);
  let confirmation = fallback;
  try {
    const response = await fetch("/api/careers-submission-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) confirmation = { ...fallback, ...result };
  } catch (_) {}
  confirmationHeading.textContent = clean(confirmation.heading) || fallback.heading;
  confirmationMessage.textContent = clean(confirmation.message) || fallback.message;
  confirmationNextStep.textContent = clean(confirmation.next_step) || fallback.next_step;
  confirmationDialog?.showModal();
}

async function prefillFromAccount() {
  if (!hasConfig()) return;
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  const user = session?.user;
  if (!user) return;
  const name = clean(user.user_metadata?.full_name || user.user_metadata?.name);
  const email = clean(user.email);
  if (name && !form.elements.full_name.value) form.elements.full_name.value = name;
  if (email && !form.elements.email.value) form.elements.email.value = email;
}

prefillFromAccount().catch(() => {});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasConfig()) { status.textContent = "Applications are temporarily unavailable. Please email hello@n3xra.com."; return; }
  if (!captchaToken) { status.textContent = "Complete the security check before sending."; return; }
  const button = form.querySelector("button[type=submit]"); button.disabled = true; status.textContent = "Sending…";
  try {
    const supabase = createBrowserSupabase(); const session = await getSessionOrNull(supabase); const input = new FormData(form);
    const contributionAreas = input.getAll("contribution_areas").map(clean).filter(Boolean);
    const participationPreferences = input.getAll("participation_preferences").map(clean).filter(Boolean);
    const file = input.get("cv_file"); input.delete("cv_file");
    const values = Object.fromEntries([...input.entries()].map(([key, value]) => [key, clean(value)]));
    values.role_interest = values.role_interest || "open_to_best_fit";
    values.experience_level = values.experience_level || "not_specified";
    values.work_arrangement = values.work_arrangement || "flexible";
    values.message = values.message || "";
    values.contribution_areas = contributionAreas;
    values.participation_preferences = participationPreferences;
    values.information_retention_consent = form.elements.information_retention_consent.checked;
    let resume = null;
    if (file?.size) {
      if (file.size > 3 * 1024 * 1024 || !allowedFileTypes.has(file.type)) throw new Error("Upload a PDF, DOC, or DOCX file up to 3 MB.");
      resume = { filename: safeFilename(file.name), originalFilename: file.name, contentType: file.type, base64: await fileAsBase64(file) };
    }
    const response = await fetch("/api/submit-career-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ captchaToken, application: values, resume }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not send your application. Please try again.");
    form.reset(); status.textContent = "Thank you — your application has been received.";
    resetTurnstile();
    await showConfirmation(result.applicationId, values.full_name);
  } catch (error) { status.textContent = error.message || "We could not send your application. Please try again."; }
  finally { if (captchaToken) button.disabled = false; }
});

document.querySelector("#careers-confirmation-close")?.addEventListener("click", () => confirmationDialog?.close());
