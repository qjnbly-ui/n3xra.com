import { requestAiFollowUps } from "/shared/lib/ai-follow-ups.js?v=20260812";

const CODEBASE_STARTER_PROMPTS = [
  "Where is platform administrator access controlled?",
  "How does subscription billing sync across N3XRA products?",
  "Trace the N3XRA Files folder upload flow from the page to storage.",
];

let session;
let escapeHtml;
let formatDate;
let setStatus;
let codebaseHistory = [];
let codebaseTurns = [];
let selectedCodebaseTurnId = "";
let currentCodebaseAnswerText = "";
let codebaseFollowUpVersion = 0;

function renderCodebasePrompts(prompts = CODEBASE_STARTER_PROMPTS) {
  const section = document.querySelector(".codebase-ai-prompt-section");
  if (!section) return;
  section.querySelectorAll("[data-codebase-prompt]").forEach((button) => button.remove());
  for (const prompt of prompts.slice(0, 3)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codebasePrompt = prompt;
    button.textContent = prompt;
    section.append(button);
  }
}

async function refreshCodebaseFollowUps(question, answer, turnId) {
  const requestVersion = ++codebaseFollowUpVersion;
  renderCodebasePrompts();
  try {
    const followUps = await requestAiFollowUps({
      question,
      answer,
      surface: "codebase",
      token: session.access_token,
    });
    if (requestVersion !== codebaseFollowUpVersion || !followUps.length) return;
    codebaseTurns = codebaseTurns.map((turn) => turn.id === turnId ? { ...turn, followUps } : turn);
    if (selectedCodebaseTurnId === turnId) renderCodebasePrompts(followUps);
  } catch {
    // Keep the starter prompts when optional follow-up generation is unavailable.
  }
}

async function codebaseRequest(path = "", options = {}) {
  const response = await fetch(`/api/codebase-ai${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || "Codebase AI request failed."));
  return data;
}

function renderCodebaseIndex(index = {}) {
  const element = document.getElementById("codebase-ai-index-status");
  const fileCount = Number(index.fileCount || 0);
  const chunkCount = Number(index.chunkCount || 0);
  const generated = index.generatedAt ? formatDate(index.generatedAt) : "not generated";
  if (element) element.textContent = fileCount && chunkCount ? "Private index ready for grounded search." : "The private index is not ready.";
  const fileCountElement = document.getElementById("codebase-ai-file-count");
  const chunkCountElement = document.getElementById("codebase-ai-chunk-count");
  const generatedElement = document.getElementById("codebase-ai-index-generated");
  if (fileCountElement) fileCountElement.textContent = fileCount.toLocaleString();
  if (chunkCountElement) chunkCountElement.textContent = chunkCount.toLocaleString();
  if (generatedElement) generatedElement.textContent = generated;
}

function renderSafeMarkdown(value) {
  const inline = (text) => escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const output = [];
  let listType = "";
  let codeLines = null;

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^```/.test(line)) {
      if (codeLines) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(rawLine.replace(/^\s{0,4}/, ""));
      continue;
    }

    if (!line) {
      closeList();
      continue;
    }

    if (/^\|.*\|$/.test(line)) {
      closeList();
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean);
      if (!cells.length || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      const [label, ...details] = cells;
      output.push(`<p><strong>${inline(label)}</strong>${details.length ? ` — ${details.map(inline).join(" · ")}` : ""}</p>`);
      continue;
    }

    if (/^(---+|___+|\*\*\*+)$/.test(line)) {
      closeList();
      output.push("<hr>");
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s*(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        output.push("<ol>");
      }
      output.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    const bullet = line.match(/^[*-]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        output.push("<ul>");
      }
      output.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return output.join("");
}

function renderCodebaseHistory() {
  const history = document.getElementById("codebase-ai-history");
  const count = document.getElementById("codebase-ai-history-count");
  if (count) count.textContent = `${codebaseTurns.length} question${codebaseTurns.length === 1 ? "" : "s"}`;
  if (!history) return;
  history.innerHTML = codebaseTurns.length ? codebaseTurns.map((turn, index) => `<button class="codebase-ai-history-item${turn.id === selectedCodebaseTurnId ? " is-selected" : ""}" type="button" data-codebase-turn-id="${escapeHtml(turn.id)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(turn.question)}</strong></button>`).join("") : "<p>No questions in this conversation.</p>";
}

function renderCodebaseAnswer(data = {}, question = "") {
  const answer = document.getElementById("codebase-ai-answer");
  const text = document.getElementById("codebase-ai-answer-text");
  const sources = document.getElementById("codebase-ai-sources");
  const sourceList = document.getElementById("codebase-ai-source-list");
  if (!answer || !text || !sources || !sourceList) return;
  currentCodebaseAnswerText = String(data.answer || "");
  text.innerHTML = renderSafeMarkdown(currentCodebaseAnswerText);
  const questionElement = document.getElementById("codebase-ai-answer-question");
  if (questionElement) questionElement.textContent = question || "Codebase question";
  const list = Array.isArray(data.sources) ? data.sources : [];
  sourceList.innerHTML = list.map((source) => `<li>${escapeHtml(source)}</li>`).join("");
  sources.classList.toggle("hidden", !list.length);
  document.getElementById("codebase-ai-empty-response")?.classList.add("hidden");
  answer.classList.remove("hidden");
  renderCodebaseIndex(data.index || {});
  renderCodebasePrompts(Array.isArray(data.followUps) && data.followUps.length ? data.followUps : CODEBASE_STARTER_PROMPTS);
  document.getElementById("codebase-ai-response-pane")?.scrollTo({ top: 0, behavior: "smooth" });
}

function resetCodebaseConversation() {
  codebaseFollowUpVersion += 1;
  codebaseHistory = [];
  codebaseTurns = [];
  selectedCodebaseTurnId = "";
  currentCodebaseAnswerText = "";
  document.getElementById("codebase-ai-answer")?.classList.add("hidden");
  document.getElementById("codebase-ai-empty-response")?.classList.remove("hidden");
  const input = document.getElementById("codebase-ai-question");
  if (input) input.value = "";
  const count = document.getElementById("codebase-ai-character-count");
  if (count) count.textContent = "0";
  renderCodebaseHistory();
  renderCodebasePrompts();
  input?.focus();
  setStatus("New Codebase AI conversation started.", "success");
}

async function copyCodebaseAnswer() {
  if (!currentCodebaseAnswerText) return;
  try {
    await navigator.clipboard.writeText(currentCodebaseAnswerText);
    setStatus("Codebase answer copied.", "success");
  } catch {
    setStatus("Copy failed. Select the answer text and copy it manually.", "error");
  }
}

async function askCodebase(event) {
  event.preventDefault();
  const input = document.getElementById("codebase-ai-question");
  const submit = document.getElementById("codebase-ai-submit");
  const question = String(input?.value || "").trim();
  if (!question) return;
  submit.disabled = true;
  submit.textContent = "Searching…";
  document.getElementById("codebase-ai-response-pane")?.classList.add("is-loading");
  setStatus("Searching the private codebase and preparing an answer…");
  try {
    const data = await codebaseRequest("", {
      method: "POST",
      body: JSON.stringify({ question, history: codebaseHistory }),
    });
    const turn = { id: `${Date.now()}-${codebaseTurns.length}`, question, answer: data.answer || "", sources: data.sources || [], index: data.index || {}, followUps: [] };
    codebaseTurns = [...codebaseTurns, turn].slice(-20);
    selectedCodebaseTurnId = turn.id;
    renderCodebaseHistory();
    renderCodebaseAnswer(data, question);
    codebaseHistory = [...codebaseHistory, { role: "user", content: question }, { role: "assistant", content: data.answer }].slice(-8);
    input.value = "";
    const characterCount = document.getElementById("codebase-ai-character-count");
    if (characterCount) characterCount.textContent = "0";
    setStatus("Answer grounded in the current private code index.", "success");
    void refreshCodebaseFollowUps(question, data.answer || "", turn.id);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Ask Codebase AI";
    document.getElementById("codebase-ai-response-pane")?.classList.remove("is-loading");
  }
}

async function loadCodebaseAi() {
  const form = document.getElementById("codebase-ai-form");
  const input = document.getElementById("codebase-ai-question");
  form?.addEventListener("submit", askCodebase);
  input?.addEventListener("input", () => {
    const count = document.getElementById("codebase-ai-character-count");
    if (count) count.textContent = String(input.value.length);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });
  document.getElementById("codebase-ai-new")?.addEventListener("click", resetCodebaseConversation);
  document.getElementById("codebase-ai-copy-answer")?.addEventListener("click", copyCodebaseAnswer);
  document.querySelector(".codebase-ai-prompt-section")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-codebase-prompt]");
    if (!button || !input) return;
    input.value = button.dataset.codebasePrompt || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form?.requestSubmit();
  });
  document.getElementById("codebase-ai-history")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-codebase-turn-id]");
    if (!button) return;
    const turn = codebaseTurns.find((item) => item.id === button.dataset.codebaseTurnId);
    if (!turn) return;
    selectedCodebaseTurnId = turn.id;
    renderCodebaseHistory();
    renderCodebaseAnswer(turn, turn.question);
  });
  renderCodebaseHistory();
  renderCodebasePrompts();
  const data = await codebaseRequest("", { method: "GET" });
  renderCodebaseIndex(data.index || {});
  setStatus("Private codebase index ready.", "success");
}


export async function startCodebaseAi(context = {}) {
  session = context.session;
  escapeHtml = context.escapeHtml;
  formatDate = context.formatDate;
  setStatus = context.setStatus;
  codebaseHistory = [];
  codebaseTurns = [];
  selectedCodebaseTurnId = "";
  currentCodebaseAnswerText = "";
  await loadCodebaseAi();
}
