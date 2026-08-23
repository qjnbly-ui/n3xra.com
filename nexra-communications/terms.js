const content = document.querySelector("#terms-content");
const slug = String(new URLSearchParams(window.location.search).get("workspace") || "").trim().toLowerCase();
function escapeHtml(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
async function initialize() {
    if (!slug)
        throw new Error("This terms link is missing an organization workspace.");
    const response = await fetch(`/api/communications-public?workspace=${encodeURIComponent(slug)}`);
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error || "These program terms are unavailable.");
    document.title = `${data.senderName} Messaging Program Terms`;
    const brand = document.querySelector("#terms-brand");
    if (brand)
        brand.textContent = data.senderName;
    if (!content)
        return;
    const support = data.supportPhone || data.supportEmail;
    content.innerHTML = `<p class="comms-eyebrow">Messaging Program Terms</p><h1>${escapeHtml(data.programName)}</h1><p>Last updated August 14, 2026</p><h2>About this program</h2><p>${escapeHtml(data.senderName)} sends permission-based informational updates through this messaging program. Messages may include the topics a subscriber selects on the signup form or by text-to-join keyword.</p><h2>Message frequency and charges</h2><p>${escapeHtml(data.expectedMessageFrequency)} Message and data rates may apply. A mobile carrier may split long messages or messages containing certain characters into multiple SMS segments.</p><h2>Your choices</h2><ul><li>Reply <strong>STOP</strong> to stop text messages.</li><li>Reply <strong>START</strong> to subscribe again.</li><li>Reply <strong>HELP</strong> for help, or contact ${escapeHtml(support)}.</li><li>Email consent is managed separately from text consent.</li></ul><p>Consent to receive text messages is not a condition of purchase.</p><h2>Consent records and privacy</h2><p>The program records when consent was given or withdrawn, the signup source, selected topics, and the disclosure shown at the time. Subscriber information is used to operate this messaging program and honor subscriber preferences.</p><p>Read the <a href="${escapeHtml(data.privacyPolicyUrl)}">${escapeHtml(data.senderName)} Privacy Policy</a>.</p><h2>Technology provider</h2><p>N3XRA Communications provides the number, preference, consent, and messaging technology for this program. ${escapeHtml(data.senderName)} is the organization sending the updates and deciding their content.</p><h2>Contact</h2><p>Program number: ${escapeHtml(data.phoneNumber || "Available after texting activation")}<br>Support: ${escapeHtml(support)}<br><a href="${escapeHtml(data.websiteUrl)}">Visit ${escapeHtml(data.senderName)}</a></p>`;
}
void initialize().catch((error) => { const status = document.querySelector("#terms-status"); if (status)
    status.textContent = error instanceof Error ? error.message : "These program terms are unavailable."; });
export {};
