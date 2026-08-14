const form = document.querySelector("#subscription-form");
const loading = document.querySelector("#subscription-loading");
const loadingStatus = document.querySelector("#loading-status");
const status = document.querySelector("#subscription-status");
const params = new URLSearchParams(window.location.search);
const workspaceSlug = String(params.get("workspace") || "").trim().toLowerCase();
const sourceToken = String(params.get("source") || "").trim();
let workspace = null;
let submissionKey = crypto.randomUUID().replaceAll("-", "");
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function setStatus(message, isError = false) {
    if (!status)
        return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
}
function renderWorkspace(data) {
    document.title = `Subscribe | ${data.senderName}`;
    const name = document.querySelector("#program-name");
    const brand = document.querySelector("#program-brand");
    const intro = document.querySelector("#program-intro");
    const contact = document.querySelector("#program-contact");
    const home = document.querySelector("#program-home");
    const terms = document.querySelector("#program-terms-link");
    const disclosures = document.querySelector("#consent-disclosures");
    const topicOptions = document.querySelector("#topic-options");
    const topicField = document.querySelector("#topic-field");
    const smsChoice = document.querySelector("#sms-choice");
    const emailChoice = document.querySelector("#email-choice");
    if (name)
        name.textContent = data.programName;
    if (brand)
        brand.textContent = data.senderName;
    if (intro)
        intro.textContent = `Choose text messages, email updates, or both—and select only the topics you care about.`;
    if (contact)
        contact.innerHTML = `${data.phoneNumber ? `${escapeHtml(data.phoneNumber)}<br>` : ""}${escapeHtml(data.supportEmail)}`;
    if (home)
        home.href = data.websiteUrl;
    if (terms)
        terms.href = `/nexra-communications/terms/?workspace=${encodeURIComponent(data.slug)}`;
    const smsDisclosure = data.channels.sms.disclosure?.disclosure || "Text messaging is not currently available.";
    const emailDisclosure = data.channels.email.disclosure?.disclosure || "Email updates are not currently available.";
    if (disclosures)
        disclosures.innerHTML = `<strong>Text messages:</strong> ${escapeHtml(smsDisclosure)}<br><br><strong>Email:</strong> ${escapeHtml(emailDisclosure)}<br><br><a href="${escapeHtml(data.privacyPolicyUrl)}">Privacy Policy</a> · <a href="${escapeHtml(data.programTermsUrl)}">Messaging Program Terms</a>`;
    if (smsChoice) {
        smsChoice.hidden = !data.channels.sms.available;
        const label = smsChoice.querySelector("span");
        if (label && data.channels.sms.disclosure)
            label.textContent = data.channels.sms.disclosure.checkbox_label;
    }
    if (emailChoice) {
        emailChoice.hidden = !data.channels.email.available;
        const label = emailChoice.querySelector("span");
        if (label && data.channels.email.disclosure)
            label.textContent = data.channels.email.disclosure.checkbox_label;
    }
    if (topicOptions)
        topicOptions.innerHTML = data.topics.map((topic) => `<label class="comms-topic-option"><input type="checkbox" name="topics" value="${escapeHtml(topic.id)}"><span><strong>${escapeHtml(topic.name)}</strong>${topic.description ? `<br><small>${escapeHtml(topic.description)}</small>` : ""}</span></label>`).join("");
    if (topicField)
        topicField.hidden = !data.topics.length;
    if (loading)
        loading.hidden = true;
    if (form)
        form.hidden = false;
}
async function initialize() {
    if (!workspaceSlug)
        throw new Error("This signup link is missing an organization workspace.");
    if (!sourceToken)
        throw new Error("This signup link is missing a verified source.");
    const response = await fetch(`/api/communications-public?workspace=${encodeURIComponent(workspaceSlug)}&source=${encodeURIComponent(sourceToken)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || "This signup page is unavailable.");
    workspace = payload;
    renderWorkspace(payload);
}
form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!workspace || !form.reportValidity())
        return;
    const data = new FormData(form);
    const smsConsent = data.get("smsConsent") === "on";
    const emailConsent = data.get("emailConsent") === "on";
    const topicIds = data.getAll("topics").map(String);
    if (!smsConsent && !emailConsent) {
        setStatus("Choose text messages, email, or both.", true);
        return;
    }
    if (workspace.topics.length && !topicIds.length) {
        setStatus("Choose at least one topic.", true);
        return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (button)
        button.disabled = true;
    setStatus("Saving your preferences…");
    try {
        const response = await fetch("/api/communications-public", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workspace: workspace.slug,
                fullName: String(data.get("fullName") || ""),
                phone: String(data.get("phone") || ""),
                email: String(data.get("email") || ""),
                smsConsent,
                emailConsent,
                topicIds,
                sourceToken,
                sourcePage: window.location.href,
                idempotencyKey: submissionKey,
                consentVersions: {
                    ...(smsConsent && workspace.channels.sms.disclosure ? { sms: workspace.channels.sms.disclosure.version } : {}),
                    ...(emailConsent && workspace.channels.email.disclosure ? { email: workspace.channels.email.disclosure.version } : {}),
                },
                company: String(data.get("company") || ""),
            }),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || "Your preferences could not be saved.");
        setStatus(payload.message || "Your preferences are saved.");
        form.reset();
        submissionKey = crypto.randomUUID().replaceAll("-", "");
    }
    catch (error) {
        setStatus(error instanceof Error ? error.message : "Your preferences could not be saved.", true);
    }
    finally {
        if (button)
            button.disabled = false;
    }
});
void initialize().catch((error) => {
    if (loadingStatus) {
        loadingStatus.textContent = error instanceof Error ? error.message : "This signup page is unavailable.";
        loadingStatus.classList.add("is-error");
    }
});
export {};
