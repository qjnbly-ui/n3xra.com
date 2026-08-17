import { AssistantVoiceController } from "./voice.mjs";
import { renderAssistantMarkdown } from "./markdown.mjs";

type Audience = "public" | "account" | "admin";
type AssistantMode = "shared" | "codebase";
type TurnstileOptions = {
  sitekey: string;
  action: string;
  appearance: "interaction-only";
  execution: "execute";
  callback(token: string): void;
  "error-callback"(): void;
  "expired-callback"(): void;
};
type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
};
type AssistantWindow = Window & {
  __n3xraAssistantOpenRequested?: boolean;
  RECORDS_APP_CONFIG?: { turnstileSiteKey?: string };
  turnstile?: TurnstileApi;
};
type HistoryMessage = { role: "user" | "assistant"; content: string };
type SessionContext = { token: string; scope: string };
type BrowserSupabaseModule = {
  createBrowserSupabase(): unknown;
  getSessionOrNull(client: unknown): Promise<{ access_token?: string; user?: { id?: string } } | null>;
  hasConfig(): boolean;
};
type FollowUpModule = {
  requestAiFollowUps(options: {
    question: string;
    answer: string;
    surface: Audience | "codebase";
    token: string;
  }): Promise<string[]>;
};

const RECORDS_APP_PREFIX = "/n3xra-records";
const CONVERSATION_KEY = "n3xra:site-assistant:conversation:v2";
const HISTORY_KEY = "n3xra:site-assistant:history:v2";
const TURNSTILE_SCRIPT_ID = "n3xra-ask-turnstile-script";
const assistantWindow = window as AssistantWindow;
let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing shared assistant element: ${selector}`);
  return element;
}

function readHistory(key: string, limit: number): HistoryMessage[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null") as unknown;
    if (!Array.isArray(value)) return [];
    return value.slice(-limit).flatMap((item): HistoryMessage[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const role = candidate.role === "user" || candidate.role === "assistant" ? candidate.role : null;
      const content = String(candidate.content || "").trim();
      return role && content ? [{ role, content }] : [];
    });
  } catch {
    return [];
  }
}

function conversationId(scope: string): string {
  const key = `${CONVERSATION_KEY}:${scope}`;
  const existing = String(sessionStorage.getItem(key) || "");
  if (/^[a-zA-Z0-9:_-]{8,120}$/.test(existing)) return existing;
  const created = `site-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, created);
  return created;
}

function pageContext(): { path: string; title: string; description: string; adminView: string } {
  return {
    path: location.pathname,
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "",
    adminView: document.body.dataset.adminView || "",
  };
}

async function sessionContext(): Promise<SessionContext> {
  try {
    const modulePath = "/shared/lib/supabase-client.js";
    const { createBrowserSupabase, getSessionOrNull, hasConfig } = await import(modulePath) as BrowserSupabaseModule;
    if (!hasConfig()) return { token: "", scope: "public" };
    const session = await getSessionOrNull(createBrowserSupabase());
    return { token: String(session?.access_token || ""), scope: String(session?.user?.id || "public") };
  } catch {
    return { token: "", scope: "public" };
  }
}

function assistantMarkup(): string {
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
        <div class="site-assistant-voice-controls" aria-label="Voice controls">
          <button type="button" data-assistant-voice aria-pressed="false"><span aria-hidden="true">●</span> Talk to N3XRA</button>
          <button type="button" data-assistant-listen hidden>Listen</button>
          <button type="button" data-assistant-stop-audio hidden>Stop</button>
        </div>
        <div class="site-assistant-security" data-assistant-security hidden>
          <div data-assistant-turnstile></div>
          <p>Completing a quick security check…</p>
        </div>
        <p class="site-assistant-status" data-assistant-status role="status"></p>
      </form>
    </aside>`;
}

function appendMessage(container: HTMLElement, role: HistoryMessage["role"], value: string, meta = "", sources: string[] = []): void {
  const article = document.createElement("article");
  article.className = `site-assistant-message is-${role}`;
  const label = document.createElement("small");
  label.textContent = role === "user" ? "You" : (meta || "N3XRA");
  const body = role === "assistant" ? document.createElement("div") : document.createElement("p");
  if (role === "assistant") {
    body.className = "site-assistant-message-body";
    renderAssistantMarkdown(body, value);
  } else {
    body.textContent = value;
  }
  article.append(label, body);
  if (sources.length) {
    const list = document.createElement("ul");
    list.setAttribute("aria-label", "Codebase sources");
    for (const source of sources.slice(0, 9)) {
      const item = document.createElement("li");
      item.textContent = source;
      list.append(item);
    }
    article.append(list);
  }
  container.append(article);
  container.scrollTop = container.scrollHeight;
}

function addNavTrigger(container: Element | null, mobile = false): HTMLButtonElement | null {
  if (!container) return null;
  const existing = container.querySelector<HTMLButtonElement>("[data-site-assistant-open]");
  if (existing) return existing;
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

function modeContent(mode: AssistantMode, audience: Audience) {
  if (mode === "codebase") return {
    kicker: "Private administrator tool", title: "Codebase AI", assistantName: "Codebase AI",
    description: "Answers grounded in the current private N3XRA code index.", label: "Ask a codebase question",
    placeholder: "How is this feature implemented?", welcome: "Codebase AI is on. Ask about a product, page, API, database table, function, or workflow.",
    prompts: ["How does admin authentication work?", "Trace the current page workflow", "Where is this feature implemented?"],
  };
  if (audience === "admin") return {
    kicker: "Verified platform administrator", title: "Ask Admin AI", assistantName: "Admin AI",
    description: "Current admin data, page guidance, and trusted N3XRA context.", label: "Ask an admin question",
    placeholder: "What needs my attention?", welcome: "Ask about current applications, accounts, support, websites, billing, operations, or this page.",
    prompts: ["What needs my attention?", "Show recent applications", "Summarize open support"],
  };
  if (audience === "account") return {
    kicker: "Signed-in account assistant", title: "Ask Account AI", assistantName: "Account AI",
    description: "Help based on this page, your account, and verified N3XRA information.", label: "Ask an account question",
    placeholder: "What can I do here?", welcome: "Ask about this page, your account, or N3XRA services.",
    prompts: ["Explain this page", "What is my account status?", "Where can I get support?"],
  };
  return {
    kicker: "N3XRA", title: "Ask N3XRA", assistantName: "N3XRA",
    description: "Guidance based on this page and verified N3XRA information.", label: "Ask a N3XRA question",
    placeholder: "How can N3XRA help?", welcome: "Ask about this page, N3XRA services, projects, support, or how to get started.",
    prompts: ["What does N3XRA build?", "Explain this page", "How do I contact support?"],
  };
}

async function initializeSiteAssistant(): Promise<void> {
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

  const form = queryRequired<HTMLFormElement>(layer, "[data-assistant-form]");
  const question = queryRequired<HTMLTextAreaElement>(layer, "#site-assistant-question");
  const messages = queryRequired<HTMLElement>(layer, "[data-assistant-messages]");
  const starters = queryRequired<HTMLElement>(layer, "[data-assistant-starters]");
  const status = queryRequired<HTMLElement>(layer, "[data-assistant-status]");
  const submit = queryRequired<HTMLButtonElement>(layer, "[data-assistant-submit]");
  const modes = queryRequired<HTMLElement>(layer, "[data-assistant-modes]");
  const security = queryRequired<HTMLElement>(layer, "[data-assistant-security]");
  const turnstileMount = queryRequired<HTMLElement>(layer, "[data-assistant-turnstile]");
  const session = await sessionContext();
  const headers: Record<string, string> = session.token ? { Authorization: `Bearer ${session.token}` } : {};
  const sharedHistoryKey = `${HISTORY_KEY}:${session.scope}:shared`;
  const codebaseHistoryKey = `${HISTORY_KEY}:${session.scope}:codebase`;
  let sharedHistory = readHistory(sharedHistoryKey, 10);
  let codebaseHistory = readHistory(codebaseHistoryKey, 8);
  let audience: Audience = desktopTrigger?.classList.contains("is-admin") ? "admin" : "public";
  let activeMode: AssistantMode = "shared";
  let codebaseReady = false;
  let followUpRequestVersion = 0;
  let publicAiReady = false;
  let publicAiAccessPromise: Promise<void> | null = null;
  let turnstileWidgetId = "";

  const loadTurnstile = async (): Promise<TurnstileApi> => {
    if (assistantWindow.turnstile) return assistantWindow.turnstile;
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const finish = (): void => {
        if (assistantWindow.turnstile) resolve(assistantWindow.turnstile);
        else reject(new Error("The security check could not load. Please try again."));
      };
      const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener("error", () => reject(new Error("The security check could not load. Please try again.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", () => reject(new Error("The security check could not load. Please try again.")), { once: true });
      document.head.append(script);
    }).catch((error: unknown) => {
      turnstileScriptPromise = null;
      throw error;
    });
    return turnstileScriptPromise;
  };

  const checkExistingPublicGrant = async (): Promise<boolean> => {
    const response = await fetch("/api/ask-security", { credentials: "same-origin", cache: "no-store" });
    return response.ok;
  };

  const runPublicSecurityCheck = async (): Promise<void> => {
    const sitekey = String(assistantWindow.RECORDS_APP_CONFIG?.turnstileSiteKey || "").trim();
    if (!sitekey) throw new Error("Ask N3XRA security is not configured.");
    security.hidden = false;
    status.textContent = "Completing a quick security check…";
    const turnstile = await loadTurnstile();
    if (turnstileWidgetId) turnstile.remove(turnstileWidgetId);
    turnstileMount.replaceChildren();
    await new Promise<void>((resolve, reject) => {
      const fail = (): void => reject(new Error("The security check expired. Please try again."));
      turnstileWidgetId = turnstile.render(turnstileMount, {
        sitekey,
        action: "ask-ai",
        appearance: "interaction-only",
        execution: "execute",
        callback: (captchaToken) => {
          void (async () => {
            try {
              const response = await fetch("/api/ask-security", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ captchaToken }),
              });
              const result = await response.json().catch(() => ({})) as { error?: unknown };
              if (!response.ok) throw new Error(String(result.error || "The security check could not be completed."));
              resolve();
            } catch (error) {
              reject(error);
            }
          })();
        },
        "error-callback": fail,
        "expired-callback": fail,
      });
      turnstile.execute(turnstileWidgetId);
    });
    publicAiReady = true;
    security.hidden = true;
    status.textContent = "";
  };

  const ensurePublicAiAccess = async (): Promise<void> => {
    if (session.token || audience !== "public" || publicAiReady) return;
    if (publicAiAccessPromise) return publicAiAccessPromise;
    publicAiAccessPromise = (async () => {
      if (await checkExistingPublicGrant().catch(() => false)) {
        publicAiReady = true;
        return;
      }
      await runPublicSecurityCheck();
    })().finally(() => {
      publicAiAccessPromise = null;
      if (!publicAiReady) security.hidden = true;
    });
    return publicAiAccessPromise;
  };

  const voice = new AssistantVoiceController({
    voiceButton: queryRequired(layer, "[data-assistant-voice]"),
    listenButton: queryRequired(layer, "[data-assistant-listen]"),
    stopButton: queryRequired(layer, "[data-assistant-stop-audio]"),
    status,
  }, (transcript) => {
    question.value = transcript;
    form.requestSubmit();
  });

  const currentHistory = (): HistoryMessage[] => activeMode === "codebase" ? codebaseHistory : sharedHistory;
  const renderStarterPrompts = (prompts: string[]): void => {
    starters.replaceChildren();
    for (const prompt of prompts.slice(0, 3)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.assistantPrompt = prompt;
      button.textContent = prompt;
      starters.append(button);
    }
  };
  const refreshFollowUps = async (
    latestQuestion: string,
    latestAnswer: string,
    surface: Audience | "codebase",
    requestedMode: AssistantMode,
  ): Promise<void> => {
    const requestVersion = ++followUpRequestVersion;
    renderStarterPrompts(modeContent(requestedMode, audience).prompts);
    starters.setAttribute("aria-busy", "true");
    try {
      const modulePath = "/shared/lib/ai-follow-ups.js?v=20260812";
      const { requestAiFollowUps } = await import(modulePath) as FollowUpModule;
      const prompts = await requestAiFollowUps({
        question: latestQuestion,
        answer: latestAnswer,
        surface,
        token: session.token,
      });
      if (requestVersion !== followUpRequestVersion || activeMode !== requestedMode || !prompts.length) return;
      renderStarterPrompts(prompts);
    } catch {
      // The assistant answer remains useful when optional follow-up generation is unavailable.
    } finally {
      if (requestVersion === followUpRequestVersion) starters.removeAttribute("aria-busy");
    }
  };
  const renderMode = (): void => {
    followUpRequestVersion += 1;
    starters.removeAttribute("aria-busy");
    const content = modeContent(activeMode, audience);
    layer.dataset.mode = activeMode;
    queryRequired<HTMLElement>(layer, "[data-assistant-kicker]").textContent = content.kicker;
    queryRequired<HTMLElement>(layer, "[data-assistant-title]").textContent = content.title;
    queryRequired<HTMLElement>(layer, "[data-assistant-description]").textContent = content.description;
    queryRequired<HTMLElement>(layer, "[data-assistant-label]").textContent = content.label;
    question.placeholder = content.placeholder;
    submit.textContent = activeMode === "codebase" ? "Search" : "Ask";
    voice.setAssistantName(content.assistantName);
    voice.prepareForRequest();
    messages.replaceChildren();
    appendMessage(messages, "assistant", content.welcome, content.assistantName);
    for (const item of currentHistory()) appendMessage(messages, item.role, item.content, content.assistantName);
    renderStarterPrompts(content.prompts);
    layer.querySelectorAll<HTMLButtonElement>("[data-assistant-mode]").forEach((button) => {
      const selected = button.dataset.assistantMode === activeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      if (button.dataset.assistantMode === "codebase") button.textContent = selected ? "Codebase AI on" : "Turn on Codebase AI";
    });
    status.textContent = activeMode === "codebase" && !codebaseReady ? "Checking the private code index…" : "";
  };

  const open = (): void => {
    layer.hidden = false;
    document.body.classList.add("site-assistant-is-open");
    document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.setAttribute("aria-expanded", "true"));
    question.focus();
  };
  const close = (): void => {
    layer.hidden = true;
    document.body.classList.remove("site-assistant-is-open");
    document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    desktopTrigger?.focus();
  };

  document.querySelectorAll("[data-site-assistant-open]").forEach((button) => button.addEventListener("click", open));
  layer.querySelectorAll("[data-assistant-close]").forEach((button) => button.addEventListener("click", close));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !layer.hidden) close(); });
  starters.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("[data-assistant-prompt]");
    if (!button) return;
    question.value = button.dataset.assistantPrompt || "";
    form.requestSubmit();
  });

  modes.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("[data-assistant-mode]");
    if (!button || audience !== "admin") return;
    activeMode = button.dataset.assistantMode === "codebase" ? "codebase" : "shared";
    renderMode();
    if (activeMode === "codebase" && !codebaseReady) {
      try {
        const response = await fetch("/api/codebase-ai", { headers });
        const result = await response.json().catch(() => ({})) as { error?: unknown; index?: { fileCount?: unknown; chunkCount?: unknown } };
        if (!response.ok) throw new Error(String(result.error || "Codebase AI is unavailable."));
        codebaseReady = true;
        status.textContent = `Private index ready · ${Number(result.index?.fileCount || 0).toLocaleString()} files · ${Number(result.index?.chunkCount || 0).toLocaleString()} sections`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Codebase AI is unavailable.";
      }
    }
  });

  try {
    const response = await fetch("/api/ask", { headers });
    if (response.ok) {
      const mode = await response.json() as { audience?: unknown };
      const resolved = String(mode?.audience || "public");
      audience = resolved === "admin" || resolved === "account" ? resolved : "public";
    }
  } catch {
    // Retain the navigation's already-resolved display audience. The API still
    // verifies authorization for every protected request.
  }

  if (audience === "admin") {
    modes.hidden = false;
  }
  const triggerAudience: Audience = desktopTrigger?.classList.contains("is-admin") ? "admin" : audience;
  const triggerLabel = triggerAudience === "admin" ? "Ask Admin AI" : triggerAudience === "account" ? "Ask Account AI" : "Ask N3XRA";
  [desktopTrigger, mobileTrigger].forEach((trigger) => {
    if (!trigger) return;
    trigger.textContent = triggerLabel;
    trigger.classList.toggle("is-admin", triggerAudience === "admin");
    trigger.removeAttribute("data-assistant-state");
  });
  renderMode();
  document.documentElement.dataset.siteAssistantReady = "true";
  if (assistantWindow.__n3xraAssistantOpenRequested) {
    delete assistantWindow.__n3xraAssistantOpenRequested;
    open();
  }

  question.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!submit.disabled) form.requestSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = question.value.trim();
    if (!value) return;
    submit.disabled = true;
    voice.prepareForRequest();
    try {
      const isCodebase = activeMode === "codebase";
      if (!isCodebase) await ensurePublicAiAccess();
      appendMessage(messages, "user", value);
      question.value = "";
      status.textContent = isCodebase ? "Searching the private code index…" : "Checking current context…";
      const requestAnswer = async (): Promise<{ response: Response; result: { answer?: unknown; audience?: unknown; sources?: unknown; error?: unknown; code?: unknown; dataStatus?: unknown } }> => {
        const response = await fetch(isCodebase ? "/api/codebase-ai" : "/api/ask", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(isCodebase
            ? { question: value, history: codebaseHistory }
            : { question: value, conversationId: conversationId(session.scope), history: sharedHistory, page: pageContext() }),
        });
        const result = await response.json().catch(() => ({})) as { answer?: unknown; audience?: unknown; sources?: unknown; error?: unknown; code?: unknown; dataStatus?: unknown };
        return { response, result };
      };
      let { response, result } = await requestAnswer();
      if (!isCodebase && response.status === 403 && result.code === "security_required") {
        publicAiReady = false;
        await ensurePublicAiAccess();
        ({ response, result } = await requestAnswer());
      }
      if (!response.ok) throw new Error(String(result.error || "The assistant could not answer this request."));
      const answer = String(result.answer || "").trim();
      const sources = Array.isArray(result.sources) ? result.sources.map(String) : [];
      appendMessage(messages, "assistant", answer, isCodebase ? "Codebase AI" : (result.audience === "admin" ? "Admin AI" : "N3XRA"), sources);
      voice.handleAnswer(answer);
      if (isCodebase) {
        const additions: HistoryMessage[] = [{ role: "user", content: value }, { role: "assistant", content: answer }];
        codebaseHistory = [...codebaseHistory, ...additions].slice(-8);
        sessionStorage.setItem(codebaseHistoryKey, JSON.stringify(codebaseHistory));
        status.textContent = "Answer grounded in the current private code index.";
      } else {
        const additions: HistoryMessage[] = [{ role: "user", content: value }, { role: "assistant", content: answer }];
        sharedHistory = [...sharedHistory, ...additions].slice(-10);
        sessionStorage.setItem(sharedHistoryKey, JSON.stringify(sharedHistory));
        status.textContent = result.dataStatus === "cached" ? "Using the latest recorded data" : "";
      }
      if (isCodebase || audience !== "public") {
        void refreshFollowUps(value, answer, isCodebase ? "codebase" : audience, activeMode);
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

if (!location.pathname.startsWith(RECORDS_APP_PREFIX) && !document.querySelector("[data-disable-site-assistant]")) {
  void initializeSiteAssistant();
}
