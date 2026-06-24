import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const list = document.getElementById("saved-script-list");

let supabase = null;
let currentSession = null;
let savedScripts = [];

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authHeaders() {
  if (!currentSession?.access_token) return {};
  return { Authorization: `Bearer ${currentSession.access_token}` };
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderEmpty(message = "Save a generated script from the analyzer.") {
  if (!list) return;
  list.innerHTML = `
    <article class="insight-empty">
      <p class="panel-kicker">No Scripts Yet</p>
      <h2>${escapeHtml(message)}</h2>
      <p>Your saved scripts will appear here with their supporting framework and notes.</p>
      <a class="insight-cta" href="/virals/">Open analyzer</a>
    </article>
  `;
}

function renderScripts() {
  if (!list) return;
  if (!currentSession?.user) {
    renderEmpty("Log in to view saved scripts.");
    return;
  }
  if (!savedScripts.length) return renderEmpty();
  list.innerHTML = savedScripts.map((item) => `
    <article class="saved-script-card">
      <div class="saved-script-head">
        <div>
          <p class="panel-kicker">${escapeHtml(formatDate(item.createdAt) || "Saved Script")}</p>
          <h2>${escapeHtml(item.title || "Saved Script")}</h2>
        </div>
        <button class="button-ghost delete-saved-script" type="button" data-id="${escapeHtml(item.id)}">Delete</button>
      </div>
      <p class="saved-script-text">${escapeHtml(item.scriptText)}</p>
      ${item.notes ? `<div class="insight-card"><h3>Notes</h3><p>${escapeHtml(item.notes)}</p></div>` : ""}
      <div class="saved-script-grid">
        <div class="metric"><span>Product</span><strong>${escapeHtml(item.product || "Not set")}</strong></div>
        <div class="metric"><span>Niche</span><strong>${escapeHtml(item.niche || "Not set")}</strong></div>
        <div class="metric"><span>Hook</span><strong>${escapeHtml(item.hookType || "Not set")}</strong></div>
      </div>
      <div class="insight-card">
        <h3>Framework</h3>
        <p>${escapeHtml(item.hookFormula || "")}</p>
        <p>${escapeHtml(item.bodyFramework || "")}</p>
      </div>
      <div class="saved-script-grid">
        <div class="insight-card">
          <h3>Captions</h3>
          <ul class="generated-list">${(item.captions || []).slice(0, 4).map((caption) => `<li>${escapeHtml(caption)}</li>`).join("") || "<li>No captions saved.</li>"}</ul>
        </div>
        <div class="insight-card">
          <h3>Shot List</h3>
          <ul class="generated-list">${(item.shotList || []).slice(0, 6).map((shot) => `<li>${escapeHtml(shot)}</li>`).join("") || "<li>No shot list saved.</li>"}</ul>
        </div>
      </div>
      ${item.sourceUrl ? `<a class="insight-cta" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">Open source</a>` : ""}
    </article>
  `).join("");
}

async function loadScripts() {
  if (!currentSession?.access_token) {
    savedScripts = [];
    renderScripts();
    return;
  }
  try {
    const response = await fetch("/api/virals-saved-scripts", {
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load saved scripts.");
    savedScripts = Array.isArray(payload.scripts) ? payload.scripts : [];
  } catch (_error) {
    savedScripts = [];
  }
  renderScripts();
}

async function init() {
  if (!hasConfig()) {
    renderEmpty("Log in to view saved scripts.");
    return;
  }
  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase).catch(() => null);
  await loadScripts();
  supabase?.auth?.onAuthStateChange((_event, session) => {
    currentSession = session || null;
    loadScripts();
  });
}

list?.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-saved-script");
  if (!button || !currentSession?.access_token) return;
  const id = button.dataset.id;
  try {
    const response = await fetch("/api/virals-saved-scripts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ id }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to delete saved script.");
    savedScripts = savedScripts.filter((item) => item.id !== id);
    renderScripts();
  } catch (_error) {
    renderScripts();
  }
});

init();
