(function () {
  const loginForm = document.getElementById("utilities-login-form");
  const loginStatus = document.getElementById("utilities-login-status");
  const onboardingForm = document.getElementById("utilities-onboarding-form");
  const onboardingStatus = document.getElementById("utilities-onboarding-status");

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
      const data = new FormData(onboardingForm);
      const district = String(data.get("district") || "").trim() || "your district";
      onboardingStatus.textContent = "Sending onboarding request...";
      onboardingStatus.classList.remove("is-active", "is-error");

      try {
        const response = await fetch("/api/utilities-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(data.entries())),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || "Unable to send onboarding request.");
        }
        onboardingForm.reset();
        onboardingStatus.textContent = `${district} onboarding request sent. N3XRA will follow up by email.`;
        onboardingStatus.classList.add("is-active");
      } catch (error) {
        onboardingStatus.textContent = error instanceof Error ? error.message : "Unable to send onboarding request.";
        onboardingStatus.classList.add("is-error");
      }
    });
  }
})();
