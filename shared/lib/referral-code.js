export function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

export function createReferralCodeController({ input, status }) {
  let validatedCode = "";
  let validationTimer = null;

  function setStatus(message, state = "") {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-valid", state === "valid");
    status.classList.toggle("is-error", state === "error");
  }

  async function validate({ required = false } = {}) {
    if (!input) return true;
    const code = normalizeReferralCode(input.value);
    input.value = code;
    input.setCustomValidity("");

    if (!code) {
      validatedCode = "";
      setStatus("If a N3XRA partner referred you, enter their code here. It will be permanently connected to your account.");
      return true;
    }
    if (code.length < 4) {
      const message = "Referral codes contain at least four letters or numbers.";
      validatedCode = "";
      setStatus(message, "error");
      if (required) input.setCustomValidity(message);
      return false;
    }
    if (validatedCode === code) return true;

    setStatus("Checking referral code…");
    try {
      const response = await fetch(`/api/website-referral-code?scope=account&code=${encodeURIComponent(code)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Unable to check this code.");
      if (!data.valid) {
        const message = "That partner referral code is not valid.";
        validatedCode = "";
        setStatus(message, "error");
        if (required) input.setCustomValidity(message);
        return false;
      }
      validatedCode = code;
      setStatus("Referral code applied. It will be permanently connected when this account is created.", "valid");
      return true;
    } catch (error) {
      const message = error?.message || "Unable to check this referral code right now.";
      validatedCode = "";
      setStatus(message, "error");
      if (required) input.setCustomValidity(message);
      return false;
    }
  }

  input?.addEventListener("input", () => {
    const code = normalizeReferralCode(input.value);
    input.value = code;
    if (code !== validatedCode) validatedCode = "";
    input.setCustomValidity("");
    clearTimeout(validationTimer);
    validationTimer = setTimeout(() => validate(), 450);
  });
  input?.addEventListener("blur", () => validate());

  const linkedCode = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
  if (input && linkedCode) {
    input.value = linkedCode;
    validate();
  }

  return {
    validate,
    getCode: () => validatedCode,
  };
}
