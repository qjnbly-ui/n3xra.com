export {};

const form = document.querySelector<HTMLFormElement>("#number-request-form");
const status = document.querySelector<HTMLElement>("#request-status");

function setStatus(message: string, isError = false): void {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function fieldValue(data: FormData, name: string): string {
  return String(data.get(name) || "").trim();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const data = new FormData(form);
  const channels = data.getAll("channels").map(String);
  if (!channels.length) {
    setStatus("Choose text messages, email, or both.", true);
    return;
  }

  if (button) button.disabled = true;
  setStatus("Submitting your request…");
  try {
    const response = await fetch("/api/communications-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: fieldValue(data, "organizationName"),
        websiteUrl: fieldValue(data, "websiteUrl"),
        contactName: fieldValue(data, "contactName"),
        contactEmail: fieldValue(data, "contactEmail"),
        contactPhone: fieldValue(data, "contactPhone"),
        areaCode: fieldValue(data, "areaCode"),
        intendedUse: fieldValue(data, "intendedUse"),
        estimatedSubscribers: fieldValue(data, "estimatedSubscribers"),
        estimatedMessages: fieldValue(data, "estimatedMessages"),
        topics: fieldValue(data, "topics").split(",").map((value) => value.trim()).filter(Boolean),
        keyword: fieldValue(data, "keyword"),
        channels,
        exampleMessages: fieldValue(data, "exampleMessages"),
        privacyPolicyUrl: fieldValue(data, "privacyPolicyUrl"),
        termsUrl: fieldValue(data, "termsUrl"),
        company: fieldValue(data, "company"),
      }),
    });
    const payload = await response.json() as { error?: string; message?: string };
    if (!response.ok) throw new Error(payload.error || "Your request could not be submitted.");
    form.reset();
    setStatus(payload.message || "Your request is in review.");
    status?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Your request could not be submitted.", true);
  } finally {
    if (button) button.disabled = false;
  }
});
