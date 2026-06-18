(function () {
  const form = document.getElementById("partner-form");
  const status = document.getElementById("partner-form-status");
  if (!form || !status) return;

  const submit = form.querySelector("button[type='submit']");

  function setStatus(message, type = "error") {
    status.textContent = message;
    status.classList.toggle("success", type === "success");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const interestedProducts = data.getAll("interested_products").map((value) => String(value).trim()).filter(Boolean);
    const payload = {
      full_name: String(data.get("full_name") || "").trim(),
      email: String(data.get("email") || "").trim().toLowerCase(),
      phone: String(data.get("phone") || "").trim(),
      organization: String(data.get("organization") || "").trim(),
      website: String(data.get("website") || "").trim(),
      audience_source: String(data.get("audience_source") || "").trim(),
      interested_products: interestedProducts,
      referral_plan: String(data.get("referral_plan") || "").trim(),
      payout_country: String(data.get("payout_country") || "").trim(),
      consent: data.get("consent") === "yes",
      company: String(data.get("company") || "").trim(),
    };

    if (!payload.interested_products.length) {
      setStatus("Select at least one product you expect to refer.");
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Submitting...";
    }

    try {
      const response = await fetch("/api/partners-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to submit the partner application.");
      }

      form.reset();
      setStatus("Application received. N3XRA will review it and follow up with next steps.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit the partner application.");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Submit Application";
      }
    }
  });
})();
