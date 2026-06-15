import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";

const STORAGE_KEY = "n3xraViralsFrameworks";
const FREE_USAGE_KEY = "n3xraViralsFreeRuns";
const FREE_USAGE_LIMIT = 3;

const form = document.getElementById("virals-analyze-form");
const statusEl = document.getElementById("analysis-status");
const frameworkOutput = document.getElementById("framework-output");
const hooksOutput = document.getElementById("hooks-output");
const scriptsOutput = document.getElementById("scripts-output");
const sourceOutput = document.getElementById("source-output");
const libraryList = document.getElementById("library-list");
const clearSingleButton = document.getElementById("clear-single");
const clearCompareButton = document.getElementById("clear-compare");
const compareForm = document.getElementById("virals-compare-form");
const compareStatusEl = document.getElementById("compare-status");
const compareOutput = document.getElementById("compare-output");
const compareSources = document.getElementById("compare-sources");
const urlInput = document.getElementById("video-url");
const singleResults = document.getElementById("single-results");
const compareResults = document.getElementById("compare-results");
const modeButtons = Array.from(document.querySelectorAll("[data-mode-target]"));
const modePanels = Array.from(document.querySelectorAll("[data-mode-panel]"));
const modeResults = Array.from(document.querySelectorAll("[data-mode-results]"));
const accessModal = document.getElementById("virals-access-modal");
const accessCloseButton = document.getElementById("virals-access-close");
const headerAuthLink = document.getElementById("virals-header-auth-link");
const transcriptModal = document.getElementById("transcript-modal");
const transcriptCloseButton = document.getElementById("transcript-close");
const transcriptModalBody = document.getElementById("transcript-modal-body");

let supabase = null;
let currentSession = null;
let currentTranscript = "";
let currentTranscriptBreakdown = null;

const frameworkPatterns = [
  {
    match: ["pain", "problem", "struggle", "annoying", "hate"],
    hookType: "Visual Pain Point Hook",
    formula: "Show the frustrating moment -> name the hidden cause -> reveal the product as the simple fix.",
    body: "Problem -> Product Education -> Proof -> CTA",
    psychology: ["Relief", "Recognition", "Low-friction solution", "Curiosity"],
  },
  {
    match: ["before", "after", "results", "transformation", "changed"],
    hookType: "Before-and-After Transformation Hook",
    formula: "Open with the result -> rewind to the problem -> explain the change -> invite action.",
    body: "Result -> Backstory -> Demonstration -> Proof -> CTA",
    psychology: ["Aspiration", "Proof", "Momentum", "Identity shift"],
  },
  {
    match: ["mistake", "wrong", "avoid", "stop", "never"],
    hookType: "Mistake Correction Hook",
    formula: "Call out the mistake -> explain the consequence -> show the better method.",
    body: "Warning -> Explanation -> Better Way -> Example -> CTA",
    psychology: ["Loss aversion", "Authority", "Urgency", "Competence"],
  },
  {
    match: ["cheap", "dupe", "alternative", "save", "instead"],
    hookType: "Smart Alternative Hook",
    formula: "Compare the expensive/common option -> reveal the better alternative -> prove the tradeoff.",
    body: "Comparison -> Product Reveal -> Benefit Stack -> Proof -> CTA",
    psychology: ["Value seeking", "Status protection", "Practicality", "Social proof"],
  },
  {
    match: ["why", "secret", "nobody", "hidden", "found"],
    hookType: "Curiosity Gap Hook",
    formula: "Tease hidden information -> delay the answer -> make the reveal useful.",
    body: "Curiosity -> Context -> Reveal -> Application -> CTA",
    psychology: ["Open loop", "Novelty", "Information gap", "Reward"],
  },
];

const defaultPattern = {
  hookType: "Proof-of-Concept Hook",
  formula: "Show the outcome -> explain who it helps -> demonstrate why it is believable.",
  body: "Hook -> Problem -> Demonstration -> Proof -> CTA",
  psychology: ["Clarity", "Trust", "Specificity", "Action bias"],
};

function setStatus(message) {
  statusEl.textContent = message;
}

function setCompareStatus(message) {
  compareStatusEl.textContent = message;
}

function getFreeRunCount() {
  const storedCount = Number.parseInt(localStorage.getItem(FREE_USAGE_KEY) || "", 10);
  return Number.isFinite(storedCount) ? Math.max(0, Math.min(storedCount, FREE_USAGE_LIMIT)) : 0;
}

function setFreeRunCount(count) {
  const parsedCount = Number.parseInt(count, 10);
  const safeCount = Number.isFinite(parsedCount) ? Math.max(0, Math.min(parsedCount, FREE_USAGE_LIMIT)) : 0;
  localStorage.setItem(FREE_USAGE_KEY, String(safeCount));
}

function incrementFreeRunCount() {
  if (currentSession?.user) return getFreeRunCount();
  const nextCount = Math.min(getFreeRunCount() + 1, FREE_USAGE_LIMIT);
  setFreeRunCount(nextCount);
  return nextCount;
}

function hasReachedFreeLimit() {
  return !currentSession?.user && getFreeRunCount() >= FREE_USAGE_LIMIT;
}

function showAccessModal() {
  accessModal?.classList.remove("is-hidden");
  if (accessModal) accessModal.hidden = false;
  document.body.classList.add("modal-open");
  accessCloseButton?.focus();
}

function hideAccessModal() {
  accessModal?.classList.add("is-hidden");
  if (accessModal) accessModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function cleanTranscriptText(value) {
  const text = String(value || "")
    .replace(/\bWEBVTT\b/gi, " ")
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .reduce((paragraphs, sentence, index) => {
      const groupIndex = Math.floor(index / 3);
      paragraphs[groupIndex] = paragraphs[groupIndex] ? `${paragraphs[groupIndex]} ${sentence}` : sentence;
      return paragraphs;
    }, [])
    .join("\n\n");
}

function getTranscriptBreakdown() {
  const breakdown = currentTranscriptBreakdown || {};
  const cleanedTranscript = String(breakdown.cleanedTranscript || "").trim() || cleanTranscriptText(currentTranscript);
  return {
    cleanedTranscript,
    hook: String(breakdown.hook || "").trim(),
    bodyStructure: String(breakdown.bodyStructure || "").trim(),
    cta: String(breakdown.cta || "").trim(),
    sellingBeats: Array.isArray(breakdown.sellingBeats) ? breakdown.sellingBeats.filter(Boolean) : [],
  };
}

function renderTranscriptBreakdown() {
  const breakdown = getTranscriptBreakdown();
  const sections = [
    breakdown.hook ? `<article class="transcript-section"><h3>Hook</h3><p>${escapeHtml(breakdown.hook)}</p></article>` : "",
    breakdown.bodyStructure ? `<article class="transcript-section"><h3>Body Structure</h3><p>${escapeHtml(breakdown.bodyStructure)}</p></article>` : "",
    breakdown.cta ? `<article class="transcript-section"><h3>CTA</h3><p>${escapeHtml(breakdown.cta)}</p></article>` : "",
    breakdown.sellingBeats.length
      ? `<article class="transcript-section"><h3>Selling Beats</h3><ul>${breakdown.sellingBeats.map((beat) => `<li>${escapeHtml(beat)}</li>`).join("")}</ul></article>`
      : "",
    `<article class="transcript-section transcript-clean"><h3>Cleaned Transcript</h3><p>${escapeHtml(breakdown.cleanedTranscript || "Transcript unavailable.")}</p></article>`,
  ].filter(Boolean);
  return sections.join("");
}

function showTranscriptModal() {
  if (!currentTranscript) return;
  if (transcriptModalBody) transcriptModalBody.innerHTML = renderTranscriptBreakdown();
  transcriptModal?.classList.remove("is-hidden");
  if (transcriptModal) transcriptModal.hidden = false;
  document.body.classList.add("modal-open");
  transcriptCloseButton?.focus();
}

function hideTranscriptModal() {
  transcriptModal?.classList.add("is-hidden");
  if (transcriptModal) transcriptModal.hidden = true;
  if (!accessModal || accessModal.hidden) document.body.classList.remove("modal-open");
}

function renderAuthState() {
  if (!headerAuthLink) return;
  if (currentSession?.user) {
    headerAuthLink.textContent = "Account";
    headerAuthLink.href = "/account/";
    return;
  }
  headerAuthLink.textContent = "Login";
  headerAuthLink.href = "/n3xra-virals/login/?next=/n3xra-virals/web/";
}

async function initAuthState() {
  if (!hasConfig()) {
    renderAuthState();
    return;
  }

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase).catch(() => null);
  renderAuthState();

  supabase?.auth?.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    renderAuthState();
    if (currentSession?.user) hideAccessModal();
  });
}

function setMode(mode) {
  modeButtons.forEach((button) => {
    const isActive = button.dataset.modeTarget === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  modePanels.forEach((panel) => {
    const isActive = panel.dataset.modePanel === mode;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  modeResults.forEach((panel) => {
    const isActive = panel.dataset.modeResults === mode;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive || panel.classList.contains("is-hidden");
  });
}

function revealSingleResults() {
  setMode("single");
  singleResults?.classList.remove("is-hidden");
  if (singleResults) singleResults.hidden = false;
}

function revealCompareResults() {
  setMode("compare");
  compareResults?.classList.remove("is-hidden");
  if (compareResults) compareResults.hidden = false;
}

function hideSingleResults() {
  singleResults?.classList.add("is-hidden");
  if (singleResults) singleResults.hidden = true;
}

function hideCompareResults() {
  compareResults?.classList.add("is-hidden");
  if (compareResults) compareResults.hidden = true;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function saveAll(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 30)));
}

function stampAnalysis(analysis) {
  return {
    ...analysis,
    id: analysis.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    createdAt: analysis.createdAt || new Date().toISOString(),
  };
}

function pickPattern(input) {
  const normalized = input.toLowerCase();
  return frameworkPatterns.find((pattern) => pattern.match.some((word) => normalized.includes(word))) || defaultPattern;
}

function getProduct(data) {
  return data.product || data.niche || "this product";
}

function buildAnalysis(data) {
  const source = [data.url, data.product, data.niche, data.goal, data.notes].join(" ");
  const pattern = pickPattern(source);
  const product = getProduct(data);
  const niche = data.niche || "TikTok Shop";

  const triggers = [...pattern.psychology, "Specific promise", "Creator trust"].slice(0, 6);
  const hooks = [
    `I did not realize ${product} fixed this until I tried it.`,
    `If you are in ${niche}, stop scrolling for this one thing.`,
    `This is the part nobody explains about ${product}.`,
    `I would not buy ${product} until I saw this happen.`,
    `The mistake most people make with ${product} is starting too late.`,
    `This looks simple, but it solves the annoying part first.`,
    `Before you buy another option, watch this comparison.`,
    `Here is the fastest way to know if ${product} is worth it.`,
  ];

  const scripts = [
    {
      title: "Direct Response Demo",
      text: `Hook: ${hooks[0]} Body: show the problem in one clear visual, introduce ${product}, demonstrate the main benefit, then close with a direct CTA tied to ${data.goal}.`,
    },
    {
      title: "Creator Trust Angle",
      text: `Hook: ${hooks[2]} Body: explain the hidden reason the product matters, show one proof point, mention who should avoid it, then invite viewers to check the product page.`,
    },
    {
      title: "Fast Remix Angle",
      text: `Hook: ${hooks[6]} Body: compare the old way versus ${product}, show the practical difference, remove one objection, and end with a low-pressure CTA.`,
    },
  ];

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: new Date().toISOString(),
    url: data.url,
    product,
    niche,
    goal: data.goal,
    hookType: pattern.hookType,
    formula: pattern.formula,
    body: pattern.body,
    triggers,
    conversionPattern: "Make the viewer feel the problem first, prove the product fast, then ask for one simple next action.",
    keep: "Keep the body structure, proof moment, and CTA timing.",
    change: "Swap the first visual, opening sentence, and audience-specific pain point.",
    hooks,
    scripts,
    captions: [
      `${product} makes the annoying part easier. Save this before you forget.`,
      `This is why the first 3 seconds matter. The product is simple, but the angle sells it.`,
      `If you have been comparing options, start with the problem this solves first.`,
    ],
    shotList: [
      "Open on the problem in motion.",
      "Cut to product reveal within 3 seconds.",
      "Show one close-up proof moment.",
      "Add a quick comparison or objection answer.",
      "End with product page or comment CTA.",
    ],
  };
}

function renderAnalysis(analysis) {
  currentTranscriptBreakdown = analysis.transcriptBreakdown || null;
  frameworkOutput.className = "framework-stack";
  frameworkOutput.innerHTML = `
    <div class="pill-row">
      <span class="pill">${escapeHtml(analysis.hookType)}</span>
      <span class="pill">${escapeHtml(analysis.niche)}</span>
      <span class="pill">${escapeHtml(analysis.goal)}</span>
    </div>
    <div class="insight-card">
      <h3>Hook Formula</h3>
      <p>${escapeHtml(analysis.formula)}</p>
    </div>
    <div class="insight-card">
      <h3>Body Framework</h3>
      <p>${escapeHtml(analysis.body)}</p>
    </div>
    <div class="insight-card">
      <h3>Psychology</h3>
      <div class="pill-row">${analysis.triggers.map((trigger) => `<span class="pill">${escapeHtml(trigger)}</span>`).join("")}</div>
    </div>
    <div class="insight-card">
      <h3>Conversion Logic</h3>
      <p>${escapeHtml(analysis.conversionPattern)}</p>
    </div>
    <div class="insight-card">
      <h3>Keep vs Change</h3>
      <p><strong>Keep:</strong> ${escapeHtml(analysis.keep)}</p>
      <p><strong>Change:</strong> ${escapeHtml(analysis.change)}</p>
    </div>
  `;

  hooksOutput.className = "content-stack";
  hooksOutput.innerHTML = `
    <ul class="generated-list">
      ${analysis.hooks.map((hook) => `<li>${escapeHtml(hook)}</li>`).join("")}
    </ul>
  `;

  scriptsOutput.className = "content-stack";
  scriptsOutput.innerHTML = `
    ${analysis.scripts.map((script) => `
      <div class="script-card">
        <h3>${escapeHtml(script.title)}</h3>
        <p>${escapeHtml(script.text)}</p>
        <button class="small-button save-script" type="button" data-script="${escapeHtml(script.title)}">Save Script</button>
      </div>
    `).join("")}
    <div class="insight-card">
      <h3>Captions</h3>
      <ul class="generated-list">${analysis.captions.map((caption) => `<li>${escapeHtml(caption)}</li>`).join("")}</ul>
    </div>
    <div class="insight-card">
      <h3>Shot List</h3>
      <ul class="generated-list">${analysis.shotList.map((shot) => `<li>${escapeHtml(shot)}</li>`).join("")}</ul>
    </div>
  `;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}

function renderSource(video) {
  if (!video) {
    currentTranscript = "";
    currentTranscriptBreakdown = null;
    sourceOutput.className = "empty-state";
    sourceOutput.textContent = "No TikTok metadata was extracted. Add transcript, caption, or notes manually.";
    revealSingleResults();
    return;
  }

  const image = video.coverUrl || video.dynamicCoverUrl || "";
  const stats = video.stats || {};
  currentTranscript = String(video.transcript || "").trim();
  currentTranscriptBreakdown = null;
  sourceOutput.className = "source-card";
  sourceOutput.innerHTML = `
    <div class="source-media">
      ${image ? `<img src="${escapeHtml(image)}" alt="TikTok cover image">` : ""}
    </div>
    <div class="source-details">
      <div>
        <p class="panel-kicker">${video.author?.uniqueId ? `@${escapeHtml(video.author.uniqueId)}` : "TikTok Source"}</p>
        <h3>${escapeHtml(video.caption || "Untitled TikTok")}</h3>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Plays</span><strong>${formatNumber(stats.plays)}</strong></div>
        <div class="metric"><span>Likes</span><strong>${formatNumber(stats.likes)}</strong></div>
        <div class="metric"><span>Shares</span><strong>${formatNumber(stats.shares)}</strong></div>
        <div class="metric"><span>Saves</span><strong>${formatNumber(stats.saves)}</strong></div>
        <div class="metric"><span>Comments</span><strong>${formatNumber(stats.comments)}</strong></div>
      </div>
      ${video.stickers?.length ? `<div class="insight-card"><h3>On-screen Text</h3><p>${escapeHtml(video.stickers.join(" | "))}</p></div>` : ""}
      ${video.hashtags?.length ? `<div class="pill-row">${video.hashtags.map((tag) => `<span class="pill">#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <div class="insight-card">
        <h3>Transcript</h3>
        ${currentTranscript ? `<button class="small-button transcript-action" type="button" data-view-transcript>View Transcript</button>` : "<p>No transcript loaded. Add context in notes if needed.</p>"}
      </div>
    </div>
  `;
  revealSingleResults();
}

async function loadSourcePreview(url) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !/tiktok\.com/i.test(cleanUrl)) return;
  setStatus("Loading TikTok source data...");
  try {
    const response = await fetch("/api/virals-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cleanUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not load source.");
    renderSource(payload.video);
    setStatus(payload.video?.transcript ? "TikTok source loaded with transcript." : "TikTok source loaded without transcript.");
  } catch (error) {
    setStatus(`${error.message || "Source preview unavailable."} You can still analyze with notes.`);
  }
}

function renderLibrary() {
  const saved = loadSaved();
  if (!saved.length) {
    libraryList.innerHTML = `<div class="empty-library">No saved frameworks yet. Run an analysis and it will be stored here.</div>`;
    return;
  }

  libraryList.innerHTML = saved.map((item) => {
    const date = new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `
      <article class="library-card">
        <div>
          <p class="panel-kicker">${escapeHtml(date)} / ${escapeHtml(item.niche)}</p>
          <h3>${escapeHtml(item.product)}</h3>
          <p class="library-meta">${escapeHtml(item.hookType)} | ${escapeHtml(item.body)}</p>
        </div>
        <div class="action-row">
          <button class="small-button load-analysis" type="button" data-id="${escapeHtml(item.id)}">Open</button>
          <button class="small-button button-ghost delete-analysis" type="button" data-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

async function requestAiAnalysis(data) {
  const response = await fetch("/api/virals-analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Virals AI request failed.");
  if (!payload.analysis) throw new Error("Virals AI returned no analysis.");
  return { analysis: stampAnalysis(payload.analysis), video: payload.video || null };
}

async function handleSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.url = String(data.url || "").trim();
  if (!data.url) {
    setStatus("Paste a TikTok or Daily Virals reference URL first.");
    return;
  }
  if (hasReachedFreeLimit()) {
    setStatus("Create a free N3XRA account or log in to keep analyzing.");
    showAccessModal();
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  setStatus("Analyzing...");

  let analysis;
  let video = null;
  try {
    const result = await requestAiAnalysis(data);
    analysis = result.analysis;
    video = result.video;
    setStatus("Framework analysis complete.");
  } catch (error) {
    analysis = stampAnalysis(buildAnalysis(data));
    setStatus("Analysis completed with limited source data.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }

  const saved = loadSaved().filter((item) => item.id !== analysis.id);
  saveAll([analysis, ...saved]);
  const usageCount = incrementFreeRunCount();
  renderSource(video);
  renderAnalysis(analysis);
  renderLibrary();
  revealSingleResults();
  document.getElementById("single-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!currentSession?.user && usageCount >= FREE_USAGE_LIMIT) {
    window.setTimeout(showAccessModal, 900);
  }
}

form?.addEventListener("submit", handleSubmit);

urlInput?.addEventListener("blur", () => {
  loadSourcePreview(urlInput.value);
});

function renderCompare(payload) {
  const comparison = payload.comparison;
  compareOutput.className = "framework-stack";
  compareOutput.innerHTML = `
    <div class="pill-row">
      <span class="pill">${escapeHtml(comparison.niche)}</span>
      <span class="pill">${escapeHtml(comparison.product)}</span>
    </div>
    <div class="insight-card"><h3>Shared Hook Pattern</h3><p>${escapeHtml(comparison.sharedHookPattern)}</p></div>
    <div class="insight-card"><h3>Shared Body Framework</h3><p>${escapeHtml(comparison.sharedBodyFramework)}</p></div>
    <div class="insight-card"><h3>Psychology</h3><div class="pill-row">${(comparison.sharedPsychology || []).map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}</div></div>
    <div class="insight-card"><h3>CTA Pattern</h3><p>${escapeHtml(comparison.commonCtaPattern)}</p></div>
    <div class="insight-card"><h3>Winning Framework</h3><p>${escapeHtml(comparison.winningFramework)}</p></div>
    <div class="insight-card"><h3>Remix Rules</h3><ul class="generated-list">${(comparison.remixRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="insight-card"><h3>New Hooks</h3><ul class="generated-list">${(comparison.hooks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="insight-card"><h3>Posting Plan</h3><ul class="generated-list">${(comparison.postingPlan || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
  `;

  compareSources.className = "source-mini-list";
  compareSources.innerHTML = (payload.videos || []).map((video) => `
    <div class="source-mini">
      ${video.coverUrl ? `<img src="${escapeHtml(video.coverUrl)}" alt="TikTok cover">` : `<div></div>`}
      <div>
        <h3>${video.author?.uniqueId ? `@${escapeHtml(video.author.uniqueId)}` : "TikTok"}</h3>
        <p>${escapeHtml(video.caption || "No caption")}</p>
        <p>${formatNumber(video.stats?.plays)} plays / ${video.transcript ? "Transcript found" : "No transcript"}</p>
      </div>
    </div>
  `).join("");
  revealCompareResults();
}

async function handleCompareSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(compareForm).entries());
  const urls = String(data.urls || "").split(/\s+/).map((url) => url.trim()).filter(Boolean);
  if (urls.length < 2) {
    setCompareStatus("Paste at least 2 TikTok URLs.");
    return;
  }
  if (hasReachedFreeLimit()) {
    setCompareStatus("Create a free N3XRA account or log in to keep comparing.");
    showAccessModal();
    return;
  }

  const submitButton = compareForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  setCompareStatus(`Extracting and comparing ${urls.length} videos...`);

  try {
    const response = await fetch("/api/virals-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, urls }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Compare request failed.");
    renderCompare(payload);
    const usageCount = incrementFreeRunCount();
    setCompareStatus(`Compared ${payload.videos?.length || urls.length} videos.`);
    document.getElementById("compare-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!currentSession?.user && usageCount >= FREE_USAGE_LIMIT) {
      window.setTimeout(showAccessModal, 900);
    }
  } catch (error) {
    setCompareStatus(error.message || "Batch compare failed.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

compareForm?.addEventListener("submit", handleCompareSubmit);

clearSingleButton?.addEventListener("click", () => {
  form?.reset();
  currentTranscript = "";
  currentTranscriptBreakdown = null;
  sourceOutput.className = "empty-state";
  sourceOutput.textContent = "Paste a TikTok URL and run analysis to load thumbnail, caption, creator, metrics, on-screen text, and transcript.";
  frameworkOutput.className = "empty-state";
  frameworkOutput.textContent = "Run an analysis to see hook type, body structure, psychology, conversion logic, and what to keep or change.";
  hooksOutput.className = "empty-state";
  hooksOutput.textContent = "Generated hooks will appear here.";
  scriptsOutput.className = "empty-state";
  scriptsOutput.textContent = "Scripts, captions, CTAs, and shot list will appear here.";
  hideSingleResults();
  setStatus("Ready to extract the system behind the content.");
});

clearCompareButton?.addEventListener("click", () => {
  compareForm?.reset();
  compareOutput.className = "empty-state";
  compareOutput.textContent = "Shared hook patterns, body frameworks, psychology, and remix rules will appear here.";
  compareSources.className = "source-mini-list";
  compareSources.innerHTML = "";
  hideCompareResults();
  setCompareStatus("Ready to compare multiple winners.");
});

libraryList?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const saved = loadSaved();
  const item = saved.find((analysis) => analysis.id === id);

  if (button.classList.contains("load-analysis") && item) {
    setMode("single");
    renderAnalysis(item);
    renderSource(null);
    revealSingleResults();
    setStatus("Saved framework opened.");
    document.getElementById("single-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (button.classList.contains("delete-analysis")) {
    saveAll(saved.filter((analysis) => analysis.id !== id));
    renderLibrary();
    setStatus("Saved framework deleted.");
  }
});

scriptsOutput?.addEventListener("click", (event) => {
  const button = event.target.closest(".save-script");
  if (!button) return;
  setStatus(`Saved script idea: ${button.dataset.script}. Full script saving will connect to accounts later.`);
});

sourceOutput?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-transcript]");
  if (!button) return;
  showTranscriptModal();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.modeTarget));
});

transcriptCloseButton?.addEventListener("click", hideTranscriptModal);
transcriptModal?.addEventListener("click", (event) => {
  if (event.target === transcriptModal) hideTranscriptModal();
});
accessCloseButton?.addEventListener("click", hideAccessModal);
accessModal?.addEventListener("click", (event) => {
  if (event.target === accessModal) hideAccessModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && transcriptModal && !transcriptModal.hidden) {
    hideTranscriptModal();
    return;
  }
  if (event.key === "Escape" && accessModal && !accessModal.hidden) {
    hideAccessModal();
  }
});

renderLibrary();
initAuthState();
