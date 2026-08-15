import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const form = document.querySelector("#careers-form"); const status = document.querySelector("#careers-status");
const confirmationDialog = document.querySelector("#careers-confirmation");
const confirmationHeading = document.querySelector("#careers-confirmation-heading");
const confirmationMessage = document.querySelector("#careers-confirmation-message");
const confirmationNextStep = document.querySelector("#careers-confirmation-next-step");
const clean = (value) => String(value || "").trim();
const allowedFileTypes = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const safeFilename = (value) => clean(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "resume";

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
    if (file?.size) {
      if (file.size > 10 * 1024 * 1024 || !allowedFileTypes.has(file.type)) throw new Error("Upload a PDF, DOC, or DOCX file up to 10 MB.");
      const path = `applications/${crypto.randomUUID()}/${safeFilename(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("careers-files").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      values.cv_storage_path = path; values.cv_filename = file.name;
    }
    const payload = { id: crypto.randomUUID(), ...values, account_user_id: session?.user?.id || null, status: "new" };
    const { error } = await supabase.from("careers_applications").insert(payload);
    if (error) throw error;
    form.reset(); status.textContent = "Thank you — your application has been received.";
    await showConfirmation(payload.id, payload.full_name);
  } catch (error) { status.textContent = error.message || "We could not send your application. Please try again."; }
  finally { button.disabled = false; }
});

document.querySelector("#careers-confirmation-close")?.addEventListener("click", () => confirmationDialog?.close());
