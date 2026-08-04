const form = document.getElementById("sms-consent-form");
const phoneInput = document.getElementById("sms-phone");
const consentInput = document.getElementById("sms-consent");
const companyInput = document.getElementById("sms-company");
const submitButton = document.getElementById("sms-submit");
const status = document.getElementById("sms-status");

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `sms-status${type ? ` is-${type}` : ""}`;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  setStatus("Saving your SMS preference…");
  try {
    const response = await fetch("/api/sms-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phoneInput.value,
        consent: consentInput.checked,
        company: companyInput.value,
        sourceUrl: window.location.href,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to save your preference.");
    form.reset();
    setStatus(payload?.message || "Your N3XRA SMS preference has been saved.", "success");
  } catch (error) {
    setStatus(error?.message || "Unable to save your preference.", "error");
  } finally {
    submitButton.disabled = false;
  }
});
