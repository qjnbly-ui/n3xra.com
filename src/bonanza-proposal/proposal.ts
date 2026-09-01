type ResponseRow = {
  participant_id: string;
  participant_name: string;
  section_key: string;
  choice: string;
  note: string;
  updated_at: string;
};

type ProposalResponse = { responses?: ResponseRow[]; error?: string };

const gate = document.querySelector<HTMLElement>("#access-gate")!;
const app = document.querySelector<HTMLElement>("#proposal-app")!;
const accessForm = document.querySelector<HTMLFormElement>("#access-form")!;
const accessCodeInput = document.querySelector<HTMLInputElement>("#access-code")!;
const participantNameInput = document.querySelector<HTMLInputElement>("#participant-name")!;
const accessStatus = document.querySelector<HTMLElement>("#access-status")!;
const viewerName = document.querySelector<HTMLElement>("#viewer-name")!;
const commenterName = document.querySelector<HTMLElement>("#commenter-name")!;
const changeViewerButton = document.querySelector<HTMLButtonElement>("#change-viewer")!;
const commentForm = document.querySelector<HTMLFormElement>("#comment-form")!;
const commentText = document.querySelector<HTMLTextAreaElement>("#comment-text")!;
const commentStatus = document.querySelector<HTMLElement>("#comment-status")!;
const commentList = document.querySelector<HTMLElement>("#comment-list")!;
const commentEmpty = document.querySelector<HTMLElement>("#comment-empty")!;
const commentSubmit = commentForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;

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

async function api(payload: Record<string, unknown>): Promise<ProposalResponse> {
  const response = await fetch(proposalApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, accessCode }),
  });
  const data = await response.json().catch(() => ({ error: "The presentation could not be opened." })) as ProposalResponse;
  if (!response.ok) throw new Error(data.error || "The presentation could not be opened.");
  return data;
}

function ownComment(): ResponseRow | undefined {
  return responses.find((row) => row.participant_id === participantId && row.section_key === "presentation_comments");
}

function renderComments(): void {
  const comments = responses.filter((row) => row.section_key === "presentation_comments" && row.note.trim());
  commentEmpty.hidden = comments.length > 0;
  commentList.replaceChildren();

  comments.forEach((row) => {
    const article = document.createElement("article");
    article.className = "comment-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    const date = document.createElement("time");
    const body = document.createElement("p");
    name.textContent = row.participant_name;
    date.dateTime = row.updated_at;
    date.textContent = new Date(row.updated_at).toLocaleString();
    body.textContent = row.note;
    header.append(name, date);
    article.append(header, body);
    commentList.append(article);
  });

  if (document.activeElement !== commentText) commentText.value = ownComment()?.note || "";
  commentSubmit.textContent = ownComment() ? "Update comment" : "Save comment";
}

async function openPresentation(): Promise<void> {
  const data = await api({ action: "read" });
  responses = data.responses || [];
  sessionStorage.setItem("bonanzaProposalCode", accessCode);
  localStorage.setItem("bonanzaProposalName", participantName);
  viewerName.textContent = participantName;
  commenterName.textContent = participantName;
  renderComments();
  gate.hidden = true;
  app.hidden = false;
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessCode = accessCodeInput.value.trim();
  participantName = participantNameInput.value.trim();
  accessStatus.textContent = "Opening the presentation…";
  try {
    await openPresentation();
    accessStatus.textContent = "";
  } catch (error) {
    accessStatus.textContent = error instanceof Error ? error.message : "The presentation could not be opened.";
  }
});

commentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = commentText.value.trim();
  if (note.length < 2) {
    commentStatus.textContent = "Add a comment before saving.";
    return;
  }
  commentSubmit.disabled = true;
  commentStatus.textContent = "Saving…";
  try {
    const data = await api({
      action: "save",
      participantId,
      participantName,
      sectionKey: "presentation_comments",
      choice: "comment",
      note,
    });
    responses = data.responses || [];
    renderComments();
    commentStatus.textContent = "Saved for everyone viewing this presentation.";
  } catch (error) {
    commentStatus.textContent = error instanceof Error ? error.message : "The comment could not be saved.";
  } finally {
    commentSubmit.disabled = false;
  }
});

changeViewerButton.addEventListener("click", () => {
  sessionStorage.removeItem("bonanzaProposalCode");
  accessCode = "";
  accessCodeInput.value = "";
  participantNameInput.value = participantName;
  app.hidden = true;
  gate.hidden = false;
  accessCodeInput.focus();
});

if (accessCode && participantName) {
  void openPresentation().catch(() => {
    sessionStorage.removeItem("bonanzaProposalCode");
    accessCode = "";
  });
}
