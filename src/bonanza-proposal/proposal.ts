type ResponseRow = {
  participant_id: string;
  participant_name: string;
  section_key: string;
  choice: string;
  note: string;
  updated_at: string;
};

type Choice = { value: string; label: string };
type SectionConfig = { title: string; question: string; choices: Choice[] };

const sectionConfig: Record<string, SectionConfig> = {
  included_website: included("Municipal website"),
  included_data: included("Dedicated Town data"),
  included_content: included("Town-managed information"),
  included_forms: included("Forms and request intake"),
  included_payments: included("Stripe payments"),
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
  overall: {
    title: "Overall direction",
    question: "What should happen next?",
    choices: choices(["comfortable", "Prepare the formal proposal"], ["discuss", "Talk through it first"]),
  },
};

function choices(...items: [string, string][]): Choice[] {
  return items.map(([value, label]) => ({ value, label }));
}

function included(title: string): SectionConfig {
  return { title, question: "Does this included scope look right?", choices: choices(["looks_good", "Good as proposed"], ["question", "I have a question"]) };
}

const gate = document.querySelector<HTMLElement>("#access-gate")!;
const app = document.querySelector<HTMLElement>("#proposal-app")!;
const accessForm = document.querySelector<HTMLFormElement>("#access-form")!;
const accessCodeInput = document.querySelector<HTMLInputElement>("#access-code")!;
const participantNameInput = document.querySelector<HTMLInputElement>("#participant-name")!;
const accessStatus = document.querySelector<HTMLElement>("#access-status")!;
const viewerName = document.querySelector<HTMLElement>("#viewer-name")!;
const responseTemplate = document.querySelector<HTMLTemplateElement>("#response-controls-template")!;
const feedbackList = document.querySelector<HTMLElement>("#feedback-list")!;
const feedbackEmpty = document.querySelector<HTMLElement>("#feedback-empty")!;
const workingTotal = document.querySelector<HTMLElement>("#working-total")!;
const workingTotalDetail = document.querySelector<HTMLElement>("#working-total-detail")!;

let accessCode = sessionStorage.getItem("bonanzaProposalCode") || "";
let participantName = localStorage.getItem("bonanzaProposalName") || "";
let participantId = localStorage.getItem("bonanzaProposalParticipantId") || "";
let responses: ResponseRow[] = [];

const proposalApiUrl = "https://vdbjlgmbpykjblprqnak.supabase.co/functions/v1/bonanza-proposal";

if (!participantId) {
  participantId = crypto.randomUUID();
  localStorage.setItem("bonanzaProposalParticipantId", participantId);
}
participantNameInput.value = participantName;

function ownResponse(sectionKey: string): ResponseRow | undefined {
  return responses.find((row) => row.participant_id === participantId && row.section_key === sectionKey);
}

function choiceLabel(sectionKey: string, choice: string): string {
  return sectionConfig[sectionKey]?.choices.find((item) => item.value === choice)?.label || choice.replaceAll("_", " ");
}

async function api(payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(proposalApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, accessCode }),
  });
  const data = await response.json().catch(() => ({ error: "The proposal could not be opened." }));
  if (!response.ok) throw new Error(data.error || "The proposal could not be opened.");
  return data;
}

function renderTotal(): void {
  const records = ownResponse("addon_records")?.choice;
  const communications = ownResponse("addon_communications")?.choice;
  let total = 79;
  const details = ["Website $79"];
  if (records === "add_now") { total += 39; details.push("Records $39"); }
  if (communications === "basic") { total += 39; details.push("Communications Basic $39"); }
  if (communications === "plus") { total += 69; details.push("Communications Plus $69"); }
  workingTotal.textContent = `$${total}/month`;
  workingTotalDetail.textContent = details.join(" + ");
}

function renderFeedback(): void {
  const grouped = new Map<string, ResponseRow[]>();
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

function updateControls(): void {
  document.querySelectorAll<HTMLElement>("[data-section-key]").forEach((card) => {
    const key = card.dataset.sectionKey!;
    const row = ownResponse(key);
    card.querySelectorAll<HTMLButtonElement>(".choice-button").forEach((button) => button.classList.toggle("is-selected", button.dataset.choice === row?.choice));
    const textarea = card.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea && document.activeElement !== textarea) textarea.value = row?.note || "";
  });
  renderTotal();
  renderFeedback();
}

async function save(sectionKey: string, choice: string, note: string, card: HTMLElement): Promise<void> {
  const status = card.querySelector<HTMLElement>(".save-status")!;
  const buttons = card.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach((button) => { button.disabled = true; });
  status.textContent = "Saving…";
  try {
    const data = await api({ action: "save", participantId, participantName, sectionKey, choice, note });
    responses = data.responses || [];
    status.textContent = "Saved for everyone to see.";
    updateControls();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "This response could not be saved.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function installControls(): void {
  document.querySelectorAll<HTMLElement>("[data-section-key]").forEach((card) => {
    const key = card.dataset.sectionKey!;
    const config = sectionConfig[key];
    if (!config || card.querySelector(".response-controls")) return;
    const controls = responseTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    controls.querySelector<HTMLElement>(".response-question")!.textContent = config.question;
    const choiceRow = controls.querySelector<HTMLElement>(".choice-row")!;
    config.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.dataset.choice = choice.value;
      button.textContent = choice.label;
      button.addEventListener("click", () => {
        const textarea = controls.querySelector<HTMLTextAreaElement>("textarea")!;
        if (choice.value === "question" && !textarea.value.trim()) {
          controls.querySelector<HTMLDetailsElement>(".note-panel")!.open = true;
          textarea.focus();
          controls.querySelector<HTMLElement>(".save-status")!.textContent = "Add your question, then save the note.";
          return;
        }
        void save(key, choice.value, textarea.value.trim(), card);
      });
      choiceRow.append(button);
    });
    controls.querySelector<HTMLButtonElement>(".save-note")!.addEventListener("click", () => {
      const row = ownResponse(key);
      if (!row?.choice) {
        controls.querySelector<HTMLElement>(".save-status")!.textContent = "Choose a response first.";
        return;
      }
      void save(key, row.choice, controls.querySelector<HTMLTextAreaElement>("textarea")!.value.trim(), card);
    });
    card.append(controls);
  });
}

async function openProposal(): Promise<void> {
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
  } catch (error) {
    accessStatus.textContent = error instanceof Error ? error.message : "The proposal could not be opened.";
  }
});

document.querySelector<HTMLButtonElement>("#change-viewer")!.addEventListener("click", () => {
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
