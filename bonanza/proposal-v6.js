"use strict";
const gate = document.querySelector("#access-gate");
const app = document.querySelector("#proposal-app");
const accessForm = document.querySelector("#access-form");
const accessCodeInput = document.querySelector("#access-code");
const accessStatus = document.querySelector("#access-status");
const lockPageButton = document.querySelector("#lock-page");
let accessCode = sessionStorage.getItem("bonanzaProposalCode") || "";
const proposalApiUrl = "https://vdbjlgmbpykjblprqnak.supabase.co/functions/v1/bonanza-proposal";
async function validateAccess() {
    const response = await fetch(proposalApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", accessCode }),
    });
    const data = await response.json().catch(() => ({ error: "The presentation could not be opened." }));
    if (!response.ok)
        throw new Error(data.error || "The presentation could not be opened.");
}
async function openPresentation() {
    await validateAccess();
    sessionStorage.setItem("bonanzaProposalCode", accessCode);
    gate.hidden = true;
    app.hidden = false;
}
accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    accessCode = accessCodeInput.value.trim();
    accessStatus.textContent = "Opening the presentation…";
    try {
        await openPresentation();
        accessStatus.textContent = "";
    }
    catch (error) {
        accessStatus.textContent = error instanceof Error ? error.message : "The presentation could not be opened.";
    }
});
lockPageButton.addEventListener("click", () => {
    sessionStorage.removeItem("bonanzaProposalCode");
    accessCode = "";
    accessCodeInput.value = "";
    app.hidden = true;
    gate.hidden = false;
    accessCodeInput.focus();
});
if (accessCode) {
    void openPresentation().catch(() => {
        sessionStorage.removeItem("bonanzaProposalCode");
        accessCode = "";
    });
}
