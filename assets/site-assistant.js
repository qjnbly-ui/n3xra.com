const RECORDS_APP_PREFIX = "/n3xra-records";
const CONVERSATION_KEY = "n3xra:site-assistant:conversation";
const HISTORY_KEY = "n3xra:site-assistant:history";

if (!location.pathname.startsWith(RECORDS_APP_PREFIX) && !document.querySelector("[data-disable-site-assistant]")) {
  initializeSiteAssistant().catch(() => {});
}

function readJson(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") || fallback; } catch { return fallback; }
}

function conversationId(scope) {
  const key = `${CONVERSATION_KEY}:${scope}`;
  const existing = String(sessionStorage.getItem(key) || "");
  if (/^[a-zA-Z0-9:_-]{8,120}$/.test(existing)) return existing;
  const created = `site-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, created);
  return created;
}

function pageContext() {
  return {
    path: location.pathname,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || "",
    adminView: document.body.dataset.adminView || "",
  };
}

async function sessionContext() {
  try {
    const { createBrowserSupabase, getSessionOrNull, hasConfig } = await import("/shared/lib/supabase-client.js");
    if (!hasConfig()) return { token: "", scope: "public" };
    const session = await getSessionOrNull(createBrowserSupabase());
    return { token: String(session?.access_token || ""), scope: String(session?.user?.id || "public") };
  } catch { return { token: "", scope: "public" }; }
}

function assistantMarkup() {
  return `
    <button class="site-assistant-scrim" type="button" data-assistant-close aria-label="Close N3XRA AI"></button>
    <aside class="site-assistant-drawer" role="dialog" aria-modal="true" aria-labelledby="site-assistant-title">
      <header class="site-assistant-drawer-head">
        <div>
          <p class="site-assistant-kicker" data-assistant-kicker>N3XRA</p>
          <h2 id="site-assistant-title" data-assistant-title>Ask N3XRA</h2>
          <p data-assistant-description>Guidance based on this page and verified N3XRA information.</p>
        </div>
        <button class="site-assistant-close" type="button" data-assistant-close aria-label="Close N3XRA AI">×</button>
      </header>
      <div class="site-assistant-mode-switch" data-assistant-modes hidden aria-label="Admin assistant mode">
        <button type="button" class="is-active" data-assistant-mode="shared">Admin AI</button>
        <button type="button" data-assistant-mode="codebase">Turn on Codebase AI</button>
      </div>
      <div class="site-assistant-messages" data-assistant-messages aria-live="polite"></div>
      <div class="site-assistant-starters" data-assistant-starters aria-label="Suggested questions"></div>
      <form class="site-assistant-composer" data-assistant-form>
        <label for="site-assistant-question" data-assistant-label>Ask a N3XRA question</label>
        <div class="site-assistant-input-row">
          <textarea id="site-assistant-question" maxlength="1200" rows="2" placeholder="How can N3XRA help?" required></textarea>
          <button type="submit" data-assistant-submit>Ask</button>
        </div>
        <p class="site-assistant-status" data-assistant-status role="status"></p>
      </form>
    </aside>`;
}

function appendMessage(container, role, text, meta = "", sources = []) {
  const article = document.createElement("article");
  article.className = `site-assistant-message is-${role}`;
  const label = document.createElement("small");
  label.textContent = role === "user" ? "You" : (meta || "N3XRA");
  const body = document.createElement("p");
  body.textContent = text;
  article.append(label, body);
  if (Array.isArray(sources) && sources.length) {
    const sourceList = document.createElement("ul");
    sourceList.setAttribute("aria-label", "Codebase sources");
    for (const source of sources.slice(0, 9)) {
      const item = document.createElement("li");
      item.textContent = String(source);
      sourceList.append(item);
    }
    article.append(sourceList);
  }
  container.append(article);
  container.scrollTop = container.scrollHeight;
}

function addNavTrigger(container, mobile = false) {
  if (!container || container.querySelector("[data-site-assistant-open]")) return null;
  const trigger = document.createElement("button");
  trigger.className = mobile ? "site-menu-link site-assistant-mobile-trigger" : "site-menu-link site-assistant-nav-trigger";
  trigger.type = "button";
  trigger.dataset.siteAssistantOpen = "";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "site-assistant-layer");
  trigger.textContent = "Ask N3XRA";
  if (mobile) container.append(trigger);
  else container.prepend(trigger);
  return trigger;
}

async function initializeSiteAssistant() {
  if (document.querySelector("[data-site-assistant-layer]")) return;
  const desktopActions = document.querySelector(".site-nav-actions");
  if (!desktopActions) return;

  const desktopTrigger = addNavTrigger(desktopActions);
  const mobileTrigger = addNavTrigger(document.querySelector(".site-mobile-menu"), true);
  const layer = document.createElement("div");
  layer.className = "site-assistant-layer";
  layer.id = "site-assistant-layer";
  layer.dataset.siteAssistantLayer = "";
  layer.hidden = true;
  layer.innerHTML = assistantMarkup();
  document.body.append(layer);

  const form = layer.querySelector("[data-assistant-form]");
  const question = layer.querySelector("#site-assistant-question");
  const messages = layer.querySelector("[data-assistant-messages]");
  const starters = layer.querySelector("[data-assistant-starters]");
  const status = layer.querySelector("[data-assistant-status]");
  const submit = layer.querySelector("[data-assistant-submit]");
  const modes = layer.querySelector("[data-assistant-modes]");
  const session = await sessionContext();
  const headers = session.token ? { Authorization: `Bearer ${session.token}` } : {};
  const sharedHistoryKey = `${HISTORY_KEY}:${session.scope}:shared`;
  const codebaseHistoryKey = `${HISTORY_KEY}:${session.scope}:codebase`;
  let sharedHistory = readJson(sharedHistoryKey, []).filter((item) => item && ["user", "assistant"].includes(item.role) && item.content).slice(-10);
  let codebaseHistory = readJson(codebaseHistoryKey, []).filter((item) => item && ["user", "assistant"].includes(item.role) && item.content).slice(-8);
  let audience = "public";
  let activeMode = "shared";
  let codebaseReady = false;

  const modeContent = () => {
    if (activeMode === "codebase") return {
      kicker: "Private administrator tool",
      title: "Codebase AI",
      description: "Answers grounded in the current private N3XRA code index.",
      label: "Ask a codebase question",
      placeholder: "How is this feature implemented?",
      welcome: "Codebase AI is on. Ask about a product, page, API, database table, function, or workflow.",
      prompts: ["How does admin authentication work?", "Trace the current page workflow", "Where is this feature implemented?"],
    };
    if (audience === "admin") return {
      kicker: "Verified platform administrator",
      title: "Ask Admin AI",
      description: "Current admin data, page guidance, and trusted N3XRA context.",
      label: "Ask an admin question",
      placeholder: "What needs my attention?",
      welcome: "Ask about current applications, accounts, support, websites, billing, operations, or this page.",
      prompts: ["What needs my attention?", "Show recent applications", "Summarize open support"],
    };
    if (audience === "account") return {
      kicker: "Signed-in account assistant",
      title: "Ask Account AI",
      description: "Help based on this page, your account, and verified N3XRA information.",
      label: "Ask an account question",
      placeholder: "What can I do here?",
      welcome: "Ask about this page, your account, or N3XRA services.",
      prompts: ["Explain this page", "What is my account status?", "Where can I get support?"],
    };
    return {
      kicker: "N3XRA",
      title: "Ask N3XRA",
      description: "Guidance based on this page and verified N3XRA information.",
      label: "Ask a N3XRA question",
      placeholder: "How can N3XRA help?",
      welcome: "Ask about this page, N3XRA services, projects, support, or how to get started.",
      prompts: ["What does N3XRA build?", "Explain this page", "How do I contact support?"],
    };
  };

  const currentHistory = () => activeMode === "codebase" ? codebaseHistory : sharedHistory;
  const renderMode = () => {
    const content = modeContent();
    layer.dataset.mode = activeMode;
    layer.querySelector("[data-assistant-kicker]").textContent = content.kicker;
    layer.querySelector("[data-assistant-title]").textContent = content.title;
    layer.querySelector("[data-assistant-description]").textContent = content.description;
    layer.querySelector("[data-assistant-label]").textContent = content.label;
    question.placeholder = content.placeholder;
    submit.textContent = activeMode === "codebase" ? "Search" : "Ask";
    messages.replaceChildren();
    appendMessage(messages, "assistant", content.welcome, activeMode === "codebase" ? "Codebase AI" : content.title.replace(/^Ask /, ""));
    for (const item of currentHistory()) appendMessage(messages, item.role, item.content, activeMode === "codebase" ? "Codebase AI" : "N3XRA");
    starters.replaceChildren();
    for (const prompt of content.prompts) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.assistantPrompt = prompt;
      button.textContent = prompt;
      starters.append(button);
    }
    layer.querySelectorAll("[data-assistant-mode]").forEach((button) => {
      const selected = button.dataset.assistantMode === activeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      if (button.dataset.assistantMode === "codebase") button.textContent = selected ? "Codebase AI on" : "Turn on Codebase AI";
    });
    status.textContent = activeMode === "codebase" && !codebaseReady ? "Checking the private code index…" : "";
  };

  const open = () => {
    layer.hidden = false;
    document.body.classList.add("site-assistant-is-open");
    document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.setAttribute("aria-expanded", "true"));
    question.focus();
  };
  const close = () => {
    layer.hidden = true;
    document.body.classList.remove("site-assistant-is-open");
    document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    desktopTrigger?.focus();
  };

  document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.addEventListener("click", open));
  layer.querySelectorAll("[data-assistant-close]").forEach((button) => button.addEventListener("click", close));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !layer.hidden) close(); });
  starters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-assistant-prompt]");
    if (!button) return;
    question.value = button.dataset.assistantPrompt || "";
    question.focus();
  });

  modes.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-assistant-mode]");
    if (!button || audience !== "admin") return;
    activeMode = button.dataset.assistantMode === "codebase" ? "codebase" : "shared";
    renderMode();
    if (activeMode === "codebase" && !codebaseReady) {
      try {
        const response = await fetch("/api/codebase-ai", { headers });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(result.error || "Codebase AI is unavailable."));
        codebaseReady = true;
        const files = Number(result.index?.fileCount || 0).toLocaleString();
        const chunks = Number(result.index?.chunkCount || 0).toLocaleString();
        status.textContent = `Private index ready · ${files} files · ${chunks} sections`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Codebase AI is unavailable.";
      }
    }
  });

  try {
    const response = await fetch("/api/ask", { headers });
    const mode = response.ok ? await response.json() : null;
    audience = String(mode?.audience || "public");
  } catch { audience = "public"; }

  if (audience === "admin") {
    modes.hidden = false;
    desktopTrigger.textContent = "Ask Admin AI";
    desktopTrigger.classList.add("is-admin");
    if (mobileTrigger) mobileTrigger.textContent = "Ask Admin AI";
  } else if (audience === "account") {
    desktopTrigger.textContent = "Ask Account AI";
    if (mobileTrigger) mobileTrigger.textContent = "Ask Account AI";
  }
  renderMode();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = question.value.trim();
    if (!value) return;
    appendMessage(messages, "user", value);
    question.value = "";
    submit.disabled = true;
    status.textContent = activeMode === "codebase" ? "Searching the private code index…" : "Checking current context…";
    try {
      const isCodebase = activeMode === "codebase";
      const response = await fetch(isCodebase ? "/api/codebase-ai" : "/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(isCodebase
          ? { question: value, history: codebaseHistory }
          : { question: value, conversationId: conversationId(session.scope), history: sharedHistory, page: pageContext() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error || "The assistant could not answer this request."));
      const answer = String(result.answer || "").trim();
      appendMessage(messages, "assistant", answer, isCodebase ? "Codebase AI" : (result.audience === "admin" ? "Admin AI" : "N3XRA"), result.sources);
      if (isCodebase) {
        codebaseHistory = [...codebaseHistory, { role: "user", content: value }, { role: "assistant", content: answer }].slice(-8);
        sessionStorage.setItem(codebaseHistoryKey, JSON.stringify(codebaseHistory));
        status.textContent = "Answer grounded in the current private code index.";
      } else {
        sharedHistory = [...sharedHistory, { role: "user", content: value }, { role: "assistant", content: answer }].slice(-10);
        sessionStorage.setItem(sharedHistoryKey, JSON.stringify(sharedHistory));
        status.textContent = result.dataStatus === "cached" ? "Using the latest recorded data" : "";
      }
    } catch (error) {
      appendMessage(messages, "assistant", error instanceof Error ? error.message : "The assistant could not answer this request.", activeMode === "codebase" ? "Codebase AI" : "N3XRA");
      status.textContent = "";
    } finally {
      submit.disabled = false;
      question.focus();
    }
  });
}
