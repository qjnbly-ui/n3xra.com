"use strict";
const sectionConfig = {
    included_website: included("Municipal website"),
    included_data: included("Dedicated Town data"),
    included_content: included("Town-managed information"),
    included_forms: included("Forms and request intake"),
    included_payments: included("Five payment purposes"),
    addon_records: {
        title: "Records organization",
        question: "When should the Town consider this add-on?",
        choices: choices(["add_now", "Add now · +$39/mo"], ["later", "Revisit later"], ["question", "I have a question"]),
    },
    addon_communications: {
        title: "Town communications",
        question: "Which starting point should the Town consider?",
        choices: choices(["basic", "Basic · +$39/mo"], ["plus", "Plus · +$69/mo"], ["later", "Revisit later"], ["question", "I have a question"]),
    },
    later_grant: later("Cybersecurity grant phase"),
    later_workspace: later("Additional municipal tools"),
    overall: {
        title: "Overall direction",
        question: "What should happen next?",
        choices: choices(["comfortable", "Prepare the formal proposal"], ["discuss", "Talk through it first"]),
    },
};
function choices(...items) {
    return items.map(([value, label]) => ({ value, label }));
}
function included(title) {
    return { title, question: "Does this included scope look right?", choices: choices(["looks_good", "Good as proposed"], ["question", "I have a question"]) };
}
function later(title) {
    return { title, question: "Should this stay in the later roadmap?", choices: choices(["interested", "Keep in the roadmap"], ["later", "Discuss later"], ["question", "I have a question"]) };
}
const gate = document.querySelector("#access-gate");
const app = document.querySelector("#proposal-app");
const accessForm = document.querySelector("#access-form");
const accessCodeInput = document.querySelector("#access-code");
const participantNameInput = document.querySelector("#participant-name");
const accessStatus = document.querySelector("#access-status");
const viewerName = document.querySelector("#viewer-name");
const responseTemplate = document.querySelector("#response-controls-template");
const feedbackList = document.querySelector("#feedback-list");
const feedbackEmpty = document.querySelector("#feedback-empty");
const workingTotal = document.querySelector("#working-total");
const workingTotalDetail = document.querySelector("#working-total-detail");
let accessCode = sessionStorage.getItem("bonanzaProposalCode") || "";
let participantName = localStorage.getItem("bonanzaProposalName") || "";
let participantId = localStorage.getItem("bonanzaProposalParticipantId") || "";
let responses = [];
const proposalApiUrl = "https://vdbjlgmbpykjblprqnak.supabase.co/functions/v1/bonanza-proposal";
if (!participantId) {
    participantId = crypto.randomUUID();
    localStorage.setItem("bonanzaProposalParticipantId", participantId);
}
participantNameInput.value = participantName;
function ownResponse(sectionKey) {
    return responses.find((row) => row.participant_id === participantId && row.section_key === sectionKey);
}
function choiceLabel(sectionKey, choice) {
    return sectionConfig[sectionKey]?.choices.find((item) => item.value === choice)?.label || choice.replaceAll("_", " ");
}
async function api(payload) {
    const response = await fetch(proposalApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, accessCode }),
    });
    const data = await response.json().catch(() => ({ error: "The proposal could not be opened." }));
    if (!response.ok)
        throw new Error(data.error || "The proposal could not be opened.");
    return data;
}
function renderTotal() {
    const records = ownResponse("addon_records")?.choice;
    const communications = ownResponse("addon_communications")?.choice;
    let total = 79;
    const details = ["Website $79"];
    if (records === "add_now") {
        total += 39;
        details.push("Records $39");
    }
    if (communications === "basic") {
        total += 39;
        details.push("Communications Basic $39");
    }
    if (communications === "plus") {
        total += 69;
        details.push("Communications Plus $69");
    }
    workingTotal.textContent = `$${total}/month`;
    workingTotalDetail.textContent = details.join(" + ");
}
function renderFeedback() {
    const grouped = new Map();
    responses.forEach((row) => {
        const key = `${row.participant_id}:${row.participant_name}`;
        grouped.set(key, [...(grouped.get(key) || []), row]);
    });
    feedbackEmpty.hidden = responses.length > 0;
    feedbackList.replaceChildren();
    grouped.forEach((rows) => {
        const article = document.createElement("article");
        article.className = "person-feedback";
        const latest = rows.reduce((value, row) => row.updated_at > value ? row.updated_at : value, "");
        const header = document.createElement("header");
        const title = document.createElement("h3");
        title.textContent = rows[0].participant_name;
        const stamp = document.createElement("span");
        stamp.textContent = `Updated ${new Date(latest).toLocaleString()}`;
        header.append(title, stamp);
        const list = document.createElement("ul");
        rows.sort((a, b) => Object.keys(sectionConfig).indexOf(a.section_key) - Object.keys(sectionConfig).indexOf(b.section_key)).forEach((row) => {
            const item = document.createElement("li");
            const section = document.createElement("span");
            const choice = document.createElement("strong");
            const note = document.createElement("p");
            section.textContent = sectionConfig[row.section_key]?.title || row.section_key;
            choice.textContent = choiceLabel(row.section_key, row.choice);
            note.textContent = row.note || "No note added.";
            item.append(section, choice, note);
            list.append(item);
        });
        article.append(header, list);
        feedbackList.append(article);
    });
}
function updateControls() {
    document.querySelectorAll("[data-section-key]").forEach((card) => {
        const key = card.dataset.sectionKey;
        const row = ownResponse(key);
        card.querySelectorAll(".choice-button").forEach((button) => button.classList.toggle("is-selected", button.dataset.choice === row?.choice));
        const textarea = card.querySelector("textarea");
        if (textarea && document.activeElement !== textarea)
            textarea.value = row?.note || "";
    });
    renderTotal();
    renderFeedback();
}
async function save(sectionKey, choice, note, card) {
    const status = card.querySelector(".save-status");
    const buttons = card.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = "Saving…";
    try {
        const data = await api({ action: "save", participantId, participantName, sectionKey, choice, note });
        responses = data.responses || [];
        status.textContent = "Saved for everyone to see.";
        updateControls();
    }
    catch (error) {
        status.textContent = error instanceof Error ? error.message : "This response could not be saved.";
    }
    finally {
        buttons.forEach((button) => { button.disabled = false; });
    }
}
function installControls() {
    document.querySelectorAll("[data-section-key]").forEach((card) => {
        const key = card.dataset.sectionKey;
        const config = sectionConfig[key];
        if (!config || card.querySelector(".response-controls"))
            return;
        const controls = responseTemplate.content.firstElementChild.cloneNode(true);
        controls.querySelector(".response-question").textContent = config.question;
        const choiceRow = controls.querySelector(".choice-row");
        config.choices.forEach((choice) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "choice-button";
            button.dataset.choice = choice.value;
            button.textContent = choice.label;
            button.addEventListener("click", () => {
                const textarea = controls.querySelector("textarea");
                if (choice.value === "question" && !textarea.value.trim()) {
                    controls.querySelector(".note-panel").open = true;
                    textarea.focus();
                    controls.querySelector(".save-status").textContent = "Add your question, then save the note.";
                    return;
                }
                void save(key, choice.value, textarea.value.trim(), card);
            });
            choiceRow.append(button);
        });
        controls.querySelector(".save-note").addEventListener("click", () => {
            const row = ownResponse(key);
            if (!row?.choice) {
                controls.querySelector(".save-status").textContent = "Choose a response first.";
                return;
            }
            void save(key, row.choice, controls.querySelector("textarea").value.trim(), card);
        });
        card.append(controls);
    });
}
async function openProposal() {
    const data = await api({ action: "read" });
    responses = data.responses || [];
    sessionStorage.setItem("bonanzaProposalCode", accessCode);
    localStorage.setItem("bonanzaProposalName", participantName);
    viewerName.textContent = participantName;
    gate.hidden = true;
    app.hidden = false;
    installControls();
    updateControls();
}
accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    accessCode = accessCodeInput.value.trim();
    participantName = participantNameInput.value.trim();
    accessStatus.textContent = "Opening the shared proposal…";
    try {
        await openProposal();
        accessStatus.textContent = "";
    }
    catch (error) {
        accessStatus.textContent = error instanceof Error ? error.message : "The proposal could not be opened.";
    }
});
document.querySelector("#change-viewer").addEventListener("click", () => {
    sessionStorage.removeItem("bonanzaProposalCode");
    accessCode = "";
    accessCodeInput.value = "";
    participantNameInput.value = participantName;
    app.hidden = true;
    gate.hidden = false;
    accessCodeInput.focus();
});
if (accessCode && participantName) {
    void openProposal().catch(() => {
        sessionStorage.removeItem("bonanzaProposalCode");
        accessCode = "";
    });
}
