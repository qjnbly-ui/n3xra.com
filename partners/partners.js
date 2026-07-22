(function () {
  const modal = document.getElementById("partner-application-modal");
  const modalCard = modal?.querySelector(".partner-modal-card");
  const openButtons = document.querySelectorAll("[data-partner-modal-open]");
  const closeButton = document.querySelector("[data-partner-modal-close]");
  const confirmationCloseButton = document.querySelector("[data-partner-confirmation-close]");

  function openModal() {
    if (!modal) return;
    modal.showModal();
    document.body.classList.add("partner-modal-open");
  }

  function closeModal() {
    if (!modal) return;
    modal.close();
    document.body.classList.remove("partner-modal-open");
  }

  openButtons.forEach((button) => button.addEventListener("click", openModal));
  closeButton?.addEventListener("click", closeModal);
  confirmationCloseButton?.addEventListener("click", closeModal);
  modal?.addEventListener("close", () => document.body.classList.remove("partner-modal-open"));
  modal?.addEventListener("cancel", (event) => event.preventDefault());

  const form = document.getElementById("partner-form");
  const status = document.getElementById("partner-form-status");
  const confirmation = document.getElementById("partner-confirmation");
  const confirmationHeading = document.getElementById("partner-confirmation-heading");
  const confirmationMessage = document.getElementById("partner-confirmation-message");
  const confirmationPrograms = document.getElementById("partner-confirmation-programs");
  const confirmationNext = document.getElementById("partner-confirmation-next");
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
      partner_terms_version: "2026-07-21",
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

      const firstName = payload.full_name.split(/\s+/)[0] || "there";
      const aiConfirmation = result.confirmation || {};
      if (confirmationHeading) confirmationHeading.textContent = aiConfirmation.heading || `Thank you, ${firstName}.`;
      if (confirmationMessage) {
        confirmationMessage.textContent = aiConfirmation.message || "Your application is safely in our hands. We’re excited to learn more about the opportunities you could create with N3XRA.";
      }
      if (confirmationPrograms) confirmationPrograms.textContent = payload.interested_products.join(" · ");
      if (confirmationNext) {
        confirmationNext.textContent = aiConfirmation.next_step || "Our team will review your application and contact you by email with the next step. Your application is not approved until you receive that confirmation.";
      }
      form.reset();
      form.hidden = true;
      modal?.classList.add("confirmation-active");
      if (confirmation) confirmation.hidden = false;
      requestAnimationFrame(() => {
        if (modalCard) modalCard.scrollTop = 0;
        confirmation?.focus({ preventScroll: true });
      });
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
