(function () {
  const loginForm = document.getElementById("utilities-login-form");
  const loginStatus = document.getElementById("utilities-login-status");
  const onboardingForm = document.getElementById("utilities-onboarding-form");
  const onboardingStatus = document.getElementById("utilities-onboarding-status");

  function formToPayload(form) {
    const data = new FormData(form);
    const payload = {};
    for (const [key, value] of data.entries()) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        payload[key] = Array.isArray(payload[key]) ? payload[key].concat(value) : [payload[key], value];
      } else {
        payload[key] = value;
      }
    }

    for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
      if (!checkbox.checked && !Object.prototype.hasOwnProperty.call(payload, checkbox.name)) {
        payload[checkbox.name] = false;
      }
    }

    return payload;
  }

  if (loginForm && loginStatus) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(loginForm);
      const tenant = String(data.get("tenant") || "").trim() || "your district";
      loginStatus.textContent = `Preview only: ${tenant} login will be connected when tenant authentication is wired.`;
      loginStatus.classList.add("is-active");
    });
  }

  if (onboardingForm && onboardingStatus) {
    onboardingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = formToPayload(onboardingForm);
      const provider = String(payload.provider_name || "").trim() || "your utility";
      onboardingStatus.textContent = "Creating utility setup...";
      onboardingStatus.classList.remove("is-active", "is-error");

      try {
        const response = await fetch("/api/utilities-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || "Unable to send onboarding request.");
        }
        onboardingForm.reset();
        onboardingStatus.textContent = `${provider} setup created. Reserved portal: ${result.domain || result.slug || "pending"}.`;
        onboardingStatus.classList.add("is-active");
      } catch (error) {
        onboardingStatus.textContent = error instanceof Error ? error.message : "Unable to send onboarding request.";
        onboardingStatus.classList.add("is-error");
      }
    });
  }
})();
