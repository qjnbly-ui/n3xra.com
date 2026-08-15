import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const FREE_USAGE_KEY = "n3xraViralsFreeRuns";
const FREE_USAGE_LIMIT = 3;

const form = document.getElementById("virals-analyze-form");
const statusEl = document.getElementById("analysis-status");
const frameworkOutput = document.getElementById("framework-output");
const productOutput = document.getElementById("product-output");
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
const accountModal = document.getElementById("virals-account-modal");
const accountCloseButton = document.getElementById("virals-account-close");
const accountSignoutButton = document.getElementById("virals-account-signout");
const accountEmail = document.getElementById("virals-account-email");
const accountPlan = document.getElementById("virals-account-plan");
const accountUsage = document.getElementById("virals-account-usage");
const accountSaved = document.getElementById("virals-account-saved");
const accountStatus = document.getElementById("virals-account-status");
const scriptSaveModal = document.getElementById("script-save-modal");
const scriptSaveCloseButton = document.getElementById("script-save-close");
const scriptSaveForm = document.getElementById("script-save-form");
const scriptSaveTitle = document.getElementById("script-save-title");
const scriptSaveNotes = document.getElementById("script-save-notes");

let supabase = null;
let currentSession = null;
let currentTranscript = "";
let currentTranscriptBreakdown = null;
let currentAnalysis = null;
let pendingScriptIndex = null;
let cloudFrameworks = [];
let savedScriptCount = 0;

const VIRALS_BILLING_PREVIEW = {
  plan: "Free Beta",
  accountStatus: "active",
  monthlyAnalysisLimit: null,
};

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
  if (!isAnyModalOpen()) document.body.classList.remove("modal-open");
}

function isAnyModalOpen() {
  return Boolean(
    (accessModal && !accessModal.hidden) ||
      (transcriptModal && !transcriptModal.hidden) ||
      (scriptSaveModal && !scriptSaveModal.hidden) ||
      (accountModal && !accountModal.hidden)
  );
}

function getDisplayEmail() {
  return currentSession?.user?.email || currentSession?.user?.user_metadata?.email || "Signed in";
}

function getViralsAccountSnapshot() {
  const freeRuns = getFreeRunCount();
  return {
    ...VIRALS_BILLING_PREVIEW,
    email: getDisplayEmail(),
    savedFrameworks: cloudFrameworks.length + savedScriptCount,
    usageLabel: currentSession?.user ? "Beta access" : `${freeRuns} / ${FREE_USAGE_LIMIT}`,
    statusLabel: currentSession?.user
      ? "Virals billing and plan management will stay inside this app."
      : "Log in to connect usage and saved frameworks to your Virals account.",
  };
}

function renderAccountModal() {
  const snapshot = getViralsAccountSnapshot();
  if (accountEmail) accountEmail.textContent = snapshot.email;
  if (accountPlan) accountPlan.textContent = snapshot.plan;
  if (accountUsage) accountUsage.textContent = snapshot.usageLabel;
  if (accountSaved) accountSaved.textContent = `${snapshot.savedFrameworks} saved`;
  if (accountStatus) {
    accountStatus.textContent = snapshot.statusLabel;
    accountStatus.className = "status";
  }
}

function showAccountModal() {
  if (!currentSession?.user) {
    window.location.assign("/n3xra-virals/login/?next=/virals/");
    return;
  }
  renderAccountModal();
  accountModal?.classList.remove("is-hidden");
  if (accountModal) accountModal.hidden = false;
  document.body.classList.add("modal-open");
  accountCloseButton?.focus();
}

function hideAccountModal() {
  accountModal?.classList.add("is-hidden");
  if (accountModal) accountModal.hidden = true;
  if (!isAnyModalOpen()) document.body.classList.remove("modal-open");
}

function buildScriptSavePayload(script, notes = "") {
  const analysis = currentAnalysis || {};
  return {
    createdAt: new Date().toISOString(),
    sourceAnalysisId: analysis.id || "",
    title: script.title || "Saved Script",
    scriptText: script.text || "",
    notes: String(notes || "").trim(),
    sourceUrl: analysis.url || "",
    product: analysis.product || analysis.productIntelligence?.name || "",
    niche: analysis.niche || "",
    goal: analysis.goal || "",
    hookType: analysis.hookType || "",
    hookFormula: analysis.formula || "",
    bodyFramework: analysis.body || "",
    conversionLogic: analysis.conversionPattern || "",
    keep: analysis.keep || "",
    change: analysis.change || "",
    captions: Array.isArray(analysis.captions) ? analysis.captions : [],
    shotList: Array.isArray(analysis.shotList) ? analysis.shotList : [],
    productIntelligence: analysis.productIntelligence || null,
  };
}

function showScriptSaveModal(index) {
  const script = currentAnalysis?.scripts?.[index];
  if (!script) return;
  pendingScriptIndex = index;
  if (scriptSaveTitle) scriptSaveTitle.textContent = script.title || "Saved Script";
  if (scriptSaveNotes) scriptSaveNotes.value = "";
  scriptSaveModal?.classList.remove("is-hidden");
  if (scriptSaveModal) scriptSaveModal.hidden = false;
  document.body.classList.add("modal-open");
  scriptSaveNotes?.focus();
}

function hideScriptSaveModal() {
  pendingScriptIndex = null;
  scriptSaveModal?.classList.add("is-hidden");
  if (scriptSaveModal) scriptSaveModal.hidden = true;
  if (!isAnyModalOpen()) document.body.classList.remove("modal-open");
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
  if (!isAnyModalOpen()) document.body.classList.remove("modal-open");
}

function renderAuthState() {
  if (!headerAuthLink) return;
  if (currentSession?.user) {
    headerAuthLink.textContent = "Account";
    headerAuthLink.href = "#virals-account";
    headerAuthLink.dataset.authState = "signed-in";
    return;
  }
  headerAuthLink.textContent = "Login";
  headerAuthLink.href = "/n3xra-virals/login/?next=/virals/";
  headerAuthLink.dataset.authState = "signed-out";
}

async function initAuthState() {
  if (!hasConfig()) {
    renderAuthState();
    return;
  }

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase).catch(() => null);
  renderAuthState();
  await refreshLibrary();
  await refreshSavedScriptCount();

  supabase?.auth?.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    renderAuthState();
    refreshLibrary();
    refreshSavedScriptCount();
    if (currentSession?.user) hideAccessModal();
    if (!currentSession?.user) hideAccountModal();
  });
}

async function handleAccountSignout() {
  if (!supabase) return;
  if (accountSignoutButton) accountSignoutButton.disabled = true;
  if (accountStatus) {
    accountStatus.textContent = "Signing out...";
    accountStatus.className = "status";
  }

  try {
    await supabase.auth.signOut({ scope: "local" });
    currentSession = null;
    cloudFrameworks = [];
    savedScriptCount = 0;
    renderAuthState();
    renderLibrary();
    hideAccountModal();
    setStatus("Signed out of N3XRA Virals.");
  } catch (error) {
    if (accountStatus) {
      accountStatus.textContent = error instanceof Error ? error.message : "Unable to sign out.";
      accountStatus.className = "status error";
    }
  } finally {
    if (accountSignoutButton) accountSignoutButton.disabled = false;
  }
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

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function buildFallbackProductIntelligence(data, product) {
  const source = [data.url, data.product, data.niche, data.goal, data.notes].join(" ").toLowerCase();
  const category =
    data.niche ||
    (source.includes("teeth") || source.includes("skin") ? "Beauty" : source.includes("car") ? "Automotive" : "TikTok Shop");
  return {
    name: product,
    category,
    offer: data.goal || "TikTok Shop affiliate sale",
    confidence: data.product ? "Medium" : "Low",
    source: data.product ? "User input" : "Caption/transcript inference",
    shopProductId: "",
    productUrl: "",
    claims: ["Solves a visible problem", "Easy to demonstrate in short-form video"],
    objections: ["Viewer may need proof it works", "Price and quality may need clarification"],
    proofPoints: ["Show a close-up demonstration", "Show before/after or problem/solution contrast"],
    ctaPath: "Drive viewers to the product page, cart, or comment prompt after the proof moment.",
    apiReadiness: "No TikTok Shop product ID yet. Resolver can attach official API data when available.",
  };
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
    productIntelligence: buildFallbackProductIntelligence(data, product),
  };
}

function renderProductIntelligence(product) {
  if (!productOutput) return;
  if (!product) {
    productOutput.className = "empty-state";
    productOutput.textContent = "Product intelligence will appear after analysis.";
    return;
  }

  const claims = normalizeList(product.claims);
  const objections = normalizeList(product.objections);
  const proofPoints = normalizeList(product.proofPoints);
  const confidence = product.confidence || "Inferred";
  productOutput.className = "product-stack";
  productOutput.innerHTML = `
    <div class="product-hero-card">
      <div>
        <p class="panel-kicker">${escapeHtml(product.category || "Product Angle")}</p>
        <h3>${escapeHtml(product.name || "Detected product")}</h3>
        ${product.offer ? `<p>${escapeHtml(product.offer)}</p>` : ""}
      </div>
      <div class="product-confidence">
        <span>Confidence</span>
        <strong>${escapeHtml(confidence)}</strong>
      </div>
    </div>
    <div class="product-signal-grid">
      <div class="insight-card">
        <h3>Claims</h3>
        <ul class="generated-list">${(claims.length ? claims : ["Product claims were not clear from the source."]).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="insight-card">
        <h3>Objections</h3>
        <ul class="generated-list">${(objections.length ? objections : ["Main buyer objections were not clear from the source."]).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="insight-card">
        <h3>Proof Points</h3>
        <ul class="generated-list">${(proofPoints.length ? proofPoints : ["Proof points were not clear from the source."]).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </div>
  `;
}

function renderAnalysis(analysis) {
  currentAnalysis = analysis;
  currentTranscriptBreakdown = analysis.transcriptBreakdown || null;
  renderProductIntelligence(analysis.productIntelligence || buildFallbackProductIntelligence(analysis, analysis.product));
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
    ${analysis.scripts.map((script, index) => `
      <div class="script-card">
        <h3>${escapeHtml(script.title)}</h3>
        <p>${escapeHtml(script.text)}</p>
        <button class="small-button save-script" type="button" data-script-index="${index}">Save Script</button>
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
  const playUrl = video.playUrl || video.videoUrl || "";
  const embedUrl = buildTikTokPlayerUrl(video.embedUrl, video.videoId || video.externalVideoId);
  const stats = video.stats || {};
  const mediaLabel = embedUrl ? "Play TikTok video on page" : "Hover, focus, or tap to preview video";
  currentTranscript = String(video.transcript || "").trim();
  currentTranscriptBreakdown = null;
  sourceOutput.className = "source-card";
  sourceOutput.innerHTML = `
    <div class="source-media${playUrl ? " has-video-preview" : ""}${embedUrl ? " has-embed-preview" : ""}" ${embedUrl ? `data-embed-url="${escapeHtml(embedUrl)}"` : ""} ${playUrl || embedUrl ? `tabindex="0" aria-label="${escapeHtml(mediaLabel)}"` : ""}>
      ${image ? `<img src="${escapeHtml(image)}" alt="TikTok cover image">` : ""}
      ${playUrl ? `<video class="source-media-video" src="${escapeHtml(playUrl)}" poster="${escapeHtml(image)}" muted loop playsinline controls preload="metadata"></video>` : ""}
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

function cleanTikTokHandle(handle) {
  return String(handle || "").trim().replace(/^@+/, "");
}

function buildTikTokPlayerUrl(value, videoId) {
  const raw = String(value || "").trim();
  const id = String(videoId || "").trim();
  const base = raw || (id ? `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}` : "");
  if (!base) return "";
  try {
    const url = new URL(base);
    url.searchParams.set("controls", "1");
    url.searchParams.set("progress_bar", "1");
    url.searchParams.set("play_button", "1");
    url.searchParams.set("volume_control", "1");
    url.searchParams.set("fullscreen_button", "1");
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("muted", "0");
    url.searchParams.set("music_info", "0");
    url.searchParams.set("description", "0");
    return url.toString();
  } catch (_error) {
    return id
      ? `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&autoplay=1&muted=0&music_info=0&description=0&rel=0`
      : "";
  }
}

function buildOpenSourceUrl(video = {}) {
  const handle = cleanTikTokHandle(video.author?.uniqueId || video.creatorHandle || "");
  const videoId = String(video.videoId || video.externalVideoId || "").trim();
  if (handle && videoId) return `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${encodeURIComponent(videoId)}`;
  return normalizeOpenSourceUrl(video.url || video.sourceUrl || "");
}

function normalizeOpenSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^www\.tiktok\.com\//i.test(raw) || /^tiktok\.com\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function playSourcePreview(container) {
  const video = container?.querySelector?.(".source-media-video");
  if (!video) return;
  container.classList.remove("is-preview-failed");
  container.classList.add("is-previewing");
  video.play().catch(() => {
    container.classList.remove("is-previewing");
    container.classList.add("is-preview-failed");
  });
}

function postTikTokPlayerMessage(iframe, type) {
  iframe?.contentWindow?.postMessage({ type, "x-tiktok-player": true }, "*");
}

function primeTikTokPlayer(iframe) {
  postTikTokPlayerMessage(iframe, "unMute");
  postTikTokPlayerMessage(iframe, "play");
}

window.addEventListener("message", (event) => {
  if (event.data?.["x-tiktok-player"] !== true || event.data?.type !== "onPlayerReady") return;
  document.querySelectorAll(".source-media-embed").forEach((iframe) => {
    if (iframe.contentWindow === event.source) primeTikTokPlayer(iframe);
  });
});

function loadEmbeddedPlayer(container) {
  const embedUrl = String(container?.dataset?.embedUrl || "").trim();
  if (!container || !embedUrl) return false;
  pauseSourcePreview(container);
  let iframe = container.querySelector(".source-media-embed");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.className = "source-media-embed";
    iframe.title = "TikTok video player";
    iframe.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.addEventListener("load", () => primeTikTokPlayer(iframe), { once: true });
    container.appendChild(iframe);
  }
  if (!iframe.src) iframe.src = embedUrl;
  setTimeout(() => primeTikTokPlayer(iframe), 450);
  container.classList.remove("is-preview-failed");
  container.classList.add("is-embed-previewing");
  return true;
}

function pauseSourcePreview(container) {
  const video = container?.querySelector?.(".source-media-video");
  if (video) {
    video.pause();
    video.currentTime = 0;
  }
  const iframe = container?.querySelector?.(".source-media-embed");
  if (iframe?.src) postTikTokPlayerMessage(iframe, "pause");
  container.classList.remove("is-previewing");
}

function toggleSourcePreview(container) {
  if (!container) return;
  if (container.classList.contains("is-embed-previewing")) {
    const iframe = container.querySelector(".source-media-embed");
    primeTikTokPlayer(iframe);
    return;
  }
  if (container.classList.contains("has-embed-preview")) {
    if (loadEmbeddedPlayer(container)) return;
  }
  if (!container.classList.contains("has-video-preview")) {
    return;
  }
  if (container.classList.contains("is-previewing")) {
    playSourcePreview(container);
    return;
  }
  playSourcePreview(container);
}

async function fetchSourceVideo(url) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !/tiktok\.com/i.test(cleanUrl)) return null;
  const response = await fetch("/api/virals-transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: cleanUrl }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not load source.");
  return payload.video || null;
}

async function loadSourcePreview(url) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !/tiktok\.com/i.test(cleanUrl)) return;
  setStatus("Loading TikTok source data...");
  try {
    const video = await fetchSourceVideo(cleanUrl);
    renderSource(video);
    setStatus(video?.transcript ? "TikTok source loaded with transcript." : "TikTok source loaded without transcript.");
  } catch (error) {
    setStatus(`${error.message || "Source preview unavailable."} You can still analyze with notes.`);
  }
}

async function renderSavedFrameworkSource(item) {
  if (item?.video?.playUrl || (item?.video && !item?.url)) {
    renderSource(item.video);
    return;
  }
  if (item?.url) {
    if (item?.video) renderSource(item.video);
    try {
      const video = await fetchSourceVideo(item.url);
      if (video) renderSource(video);
    } catch (_error) {
      if (!item?.video) renderSource(null);
    }
    return;
  }
  renderSource(null);
}

function renderLibrary() {
  if (!libraryList) return;
  if (!currentSession?.user) {
    libraryList.innerHTML = `<div class="empty-library">Log in to save frameworks to your N3XRA Virals library.</div>`;
    renderAccountModal();
    return;
  }

  if (!cloudFrameworks.length) {
    libraryList.innerHTML = `<div class="empty-library">No saved frameworks yet. Run an analysis while logged in and it will appear here.</div>`;
    renderAccountModal();
    return;
  }

  libraryList.innerHTML = cloudFrameworks.map((item) => {
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
  renderAccountModal();
}

async function refreshLibrary() {
  if (!currentSession?.access_token) {
    cloudFrameworks = [];
    renderLibrary();
    return;
  }
  try {
    const response = await fetch("/api/virals-library", {
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load library.");
    cloudFrameworks = Array.isArray(payload.frameworks) ? payload.frameworks : [];
  } catch (_error) {
    cloudFrameworks = [];
  }
  renderLibrary();
}

async function refreshSavedScriptCount() {
  if (!currentSession?.access_token) {
    savedScriptCount = 0;
    renderAccountModal();
    return;
  }
  try {
    const response = await fetch("/api/virals-saved-scripts", {
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    savedScriptCount = Array.isArray(payload.scripts) ? payload.scripts.length : 0;
  } catch (_error) {
    savedScriptCount = 0;
  }
  renderAccountModal();
}

function authHeaders() {
  if (!currentSession?.access_token) return {};
  return { Authorization: `Bearer ${currentSession.access_token}` };
}

async function requestAiAnalysis(data) {
  const response = await fetch("/api/virals-analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Virals AI request failed.");
  if (!payload.analysis) throw new Error("Virals AI returned no analysis.");
  const analysis = stampAnalysis(payload.analysis);
  if (payload.saved?.analysis_id) analysis.id = payload.saved.analysis_id;
  return { analysis, video: payload.video || null, saved: payload.saved || null };
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

  const usageCount = incrementFreeRunCount();
  renderSource(video);
  renderAnalysis(analysis);
  await refreshLibrary();
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
  currentAnalysis = null;
  currentTranscript = "";
  currentTranscriptBreakdown = null;
  sourceOutput.className = "empty-state";
  sourceOutput.textContent = "Paste a TikTok URL and run analysis to load thumbnail, caption, creator, metrics, on-screen text, and transcript.";
  productOutput.className = "empty-state";
  productOutput.textContent = "Product angle, category, claims, objections, and proof points will appear here.";
  frameworkOutput.className = "empty-state";
  frameworkOutput.textContent = "Run an analysis to see hook type, body structure, psychology, conversion logic, and what to keep or change.";
  hooksOutput.className = "empty-state";
  hooksOutput.textContent = "Generated hooks will appear here.";
  scriptsOutput.className = "empty-state";
  scriptsOutput.textContent = "Scripts, captions, CTAs, and shot list will appear here.";
  hideSingleResults();
  setStatus("Ready to extract the system behind the content.");
});

scriptsOutput?.addEventListener("click", (event) => {
  const button = event.target.closest(".save-script");
  if (!button) return;
  const index = Number.parseInt(button.dataset.scriptIndex || "", 10);
  if (!Number.isFinite(index)) return;
  showScriptSaveModal(index);
});

scriptSaveForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const script = currentAnalysis?.scripts?.[pendingScriptIndex];
  if (!script) return;
  const payload = buildScriptSavePayload(script, scriptSaveNotes?.value || "");
  if (!currentSession?.access_token) {
    hideScriptSaveModal();
    setStatus("Log in to save scripts to your library.");
    showAccessModal();
    return;
  }

  const submitButton = scriptSaveForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  fetch("/api/virals-saved-scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save script.");
      savedScriptCount += 1;
      renderAccountModal();
      hideScriptSaveModal();
      setStatus("Script saved.");
    })
    .catch((error) => {
      setStatus(error.message || "Unable to save script.");
    })
    .finally(() => {
      if (submitButton) submitButton.disabled = false;
    });
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

libraryList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const item = cloudFrameworks.find((analysis) => analysis.id === id);

  if (button.classList.contains("load-analysis") && item) {
    setMode("single");
    renderAnalysis(item);
    await renderSavedFrameworkSource(item);
    revealSingleResults();
    setStatus("Saved framework opened.");
    document.getElementById("single-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (button.classList.contains("delete-analysis")) {
    fetch("/api/virals-library", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ id }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to delete framework.");
        cloudFrameworks = cloudFrameworks.filter((analysis) => analysis.id !== id);
        renderLibrary();
        setStatus("Saved framework deleted.");
      })
      .catch((error) => setStatus(error.message || "Unable to delete framework."));
  }
});

sourceOutput?.addEventListener("click", (event) => {
  const media = event.target.closest(".source-media.has-video-preview, .source-media.has-embed-preview");
  if (media) {
    toggleSourcePreview(media);
    return;
  }

  const button = event.target.closest("[data-view-transcript]");
  if (!button) return;
  showTranscriptModal();
});

sourceOutput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const media = event.target.closest?.(".source-media.has-video-preview, .source-media.has-embed-preview");
  if (!media) return;
  event.preventDefault();
  toggleSourcePreview(media);
});

sourceOutput?.addEventListener("error", (event) => {
  const video = event.target.closest?.(".source-media-video");
  if (!video) return;
  const media = video.closest(".source-media.has-video-preview");
  media?.classList.remove("is-previewing");
  media?.classList.add("is-preview-failed");
}, true);

sourceOutput?.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch") return;
  const media = event.target.closest?.(".source-media.has-video-preview");
  if (media) playSourcePreview(media);
}, true);

sourceOutput?.addEventListener("focusin", (event) => {
  const media = event.target.closest?.(".source-media.has-video-preview");
  if (media) playSourcePreview(media);
});

headerAuthLink?.addEventListener("click", (event) => {
  if (!currentSession?.user) return;
  event.preventDefault();
  showAccountModal();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.modeTarget));
});

accountCloseButton?.addEventListener("click", hideAccountModal);
accountModal?.addEventListener("click", (event) => {
  if (event.target === accountModal) hideAccountModal();
});
accountSignoutButton?.addEventListener("click", handleAccountSignout);
transcriptCloseButton?.addEventListener("click", hideTranscriptModal);
transcriptModal?.addEventListener("click", (event) => {
  if (event.target === transcriptModal) hideTranscriptModal();
});
scriptSaveCloseButton?.addEventListener("click", hideScriptSaveModal);
scriptSaveModal?.addEventListener("click", (event) => {
  if (event.target === scriptSaveModal) hideScriptSaveModal();
});
accessCloseButton?.addEventListener("click", hideAccessModal);
accessModal?.addEventListener("click", (event) => {
  if (event.target === accessModal) hideAccessModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && accountModal && !accountModal.hidden) {
    hideAccountModal();
    return;
  }
  if (event.key === "Escape" && transcriptModal && !transcriptModal.hidden) {
    hideTranscriptModal();
    return;
  }
  if (event.key === "Escape" && scriptSaveModal && !scriptSaveModal.hidden) {
    hideScriptSaveModal();
    return;
  }
  if (event.key === "Escape" && accessModal && !accessModal.hidden) {
    hideAccessModal();
  }
});

renderLibrary();
initAuthState();
