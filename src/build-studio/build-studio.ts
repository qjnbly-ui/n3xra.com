import { setupAssetPicker } from './asset-picker.js';
import { getAdminSession } from "/account/admin/admin-session.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

type Website = { id: string; name: string; organization_id?: string | null };
type Repository = { website_id: string; full_name: string; default_branch: string; html_url?: string | null };
type BuildSession = {
  id: string;
  state: "preparing" | "ready" | "working" | "awaiting_approval" | "failed" | "stopped" | "archived";
  workingBranch: string;
  previewUrl?: string;
  previewState: "offline" | "starting" | "ready" | "failed";
  changedFileCount: number;
  progress?: string; progressDetail?: string; cancellable?: boolean; syncIssue?: string; selectedModel?: string; selectedEffort?: string;
  hasUnpushedCommits?: boolean;
  canClose?: boolean;
  codexAuthenticated?: boolean;
};
type WorkerEvent = { history?: boolean; replay?: boolean; id?: number; eventType: string; message?: string; technicalNotes?: string; metadata?: Record<string, unknown> };

const workerBase = String(window.RECORDS_APP_CONFIG?.buildWorkerUrl || "").replace(/\/+$/, "");
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const studio = byId<HTMLElement>("build-studio");
const setup = byId<HTMLElement>("build-setup");
const workspace = byId<HTMLElement>("build-workspace");
const websiteSelect = byId<HTMLSelectElement>("build-website-select");
const startButton = byId<HTMLButtonElement>("build-start");
const connectButton = byId<HTMLButtonElement>("build-connect");
const servicesLink = byId<HTMLAnchorElement>("build-open-services");
const composer = byId<HTMLFormElement>("build-composer");
const prompt = byId<HTMLTextAreaElement>("build-prompt");
const messages = byId<HTMLElement>("build-messages");
type ModelOption = { model: string; displayName: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[] };
const modelSelect = byId<HTMLSelectElement>("build-model");
const effortSelect = byId<HTMLSelectElement>("build-effort");
let availableModels: ModelOption[] = [];
let modelSessionId = "";
let modelsLoading = "";
const activity = byId<HTMLElement>("build-activity");
const notesToggle = byId<HTMLInputElement>("build-show-notes");
const technicalEntries: HTMLElement[] = [];
const notice = byId<HTMLElement>("build-notice");
const previewFrame = byId<HTMLIFrameElement>("build-preview-frame");
const checkpointButton = byId<HTMLButtonElement>("build-checkpoint");
const pushButton = byId<HTMLButtonElement>("build-push");
const openPreviewLink = byId<HTMLAnchorElement>("build-open-preview");

let accessToken = "";
let currentWebsite: Website | null = null;
let repositories: Repository[] = [];
let activeSession: BuildSession | null = null;
let eventAbort: AbortController | null = null;
const seenEvents = new Set<number>();
let sending = false;
let assetPicker: ReturnType<typeof setupAssetPicker> | undefined;

type SavedTask = { id: string; title: string; updatedAt: string; messages: { role: string; text: string }[] };
async function loadSavedTasks() {
  if (!currentWebsite) return;
  const websiteId = currentWebsite.id;
  try {
    const result = await workerRequest<{ tasks: SavedTask[] }>(`/v1/projects/${websiteId}/tasks`);
    if (currentWebsite?.id !== websiteId) return;
    const list = byId("build-history-messages"); list.replaceChildren();
    byId("build-history").hidden = !result.tasks.length;
    for (const task of result.tasks) {
      const item = document.createElement("details"); item.className = "build-saved-task";
      const title = document.createElement("summary"); title.textContent = task.title.length >= 80 ? task.title.replace(/\s+\S*$/, "") + "…" : task.title;
      const transcript = document.createElement("div"); transcript.className = "build-task-transcript"; transcript.tabIndex = 0; transcript.setAttribute("role", "region"); transcript.setAttribute("aria-label", task.title + " conversation");
      for (const message of task.messages) {
        const entry = document.createElement("p");
        const label = document.createElement("strong"); label.textContent = message.role + ": ";
        const text = document.createElement("span"); text.textContent = message.text;
        entry.append(label, text); transcript.append(entry);
      }
      const reopen = document.createElement("button"); reopen.type = "button"; reopen.className = "build-button build-task-reopen"; reopen.textContent = "Reopen task";
      reopen.disabled = Boolean(activeSession && activeSession.state !== "stopped");
      reopen.addEventListener("click", () => { if (currentWebsite?.id === websiteId) void startSession(task.id); });
      item.append(title, transcript, reopen); list.append(item);
    }
  } catch { setNotice("Saved tasks could not load. Your history is still saved; try refreshing.", true); }
}

function setNotice(value = "", error = false) {
  notice.textContent = value;
  notice.style.color = error ? "#9f453e" : "#28766c";
}

function setSetup(title: string, copy: string) {
  byId("build-setup-title").textContent = title;
  byId("build-setup-copy").textContent = copy;
}

function showOnly(action: "start" | "connect" | "repository" | "none") {
  startButton.hidden = action !== "start";
  connectButton.hidden = action !== "connect";
  servicesLink.hidden = action !== "repository";
}

async function workerRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!workerBase) throw new Error("The private Build Studio worker has not been connected yet.");
  const response = await fetch(`${workerBase}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || `Build worker returned ${response.status}.`);
  return data;
}

function addMessage(role: "user" | "agent" | "status" | "technical", text: string) {
  if (!text.trim()) return;
  const item = document.createElement("article");
  item.className = `build-message${role === "user" ? " is-user" : ""}`;
  if (role === "technical") {
    item.classList.add("is-technical");
    item.hidden = !notesToggle.checked;
    technicalEntries.push(item);
  }
  const label = role === "technical" ? "Technical notes" : role === "agent" ? "Codex" : role === "user" ? "You" : "Build Studio";
  const small = document.createElement("small");
  small.textContent = label;
  const body = document.createElement("div");
  body.textContent = role === "status" && text.includes("Another astro dev server is already running")
    ? "The preview could not restart because an earlier preview had not cleared. Your work is saved. Use Restart preview to try again."
    : text;
  item.append(small, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderActivity(message = "") {
  activity.hidden = !message;
  activity.textContent = message;
  const detail = byId("build-activity-detail");
  detail.textContent = activeSession?.progressDetail || "";
  detail.hidden = !message || !notesToggle.checked || !detail.textContent;
}

notesToggle.addEventListener("change", () => {
  technicalEntries.forEach(item => { item.hidden = !notesToggle.checked; });
  renderActivity(activity.hidden ? "" : activity.textContent || "");
});

function renderEfforts(preferred = "") {
  effortSelect.replaceChildren();
  const model = availableModels.find(item => item.model === modelSelect.value);
  for (const effort of model?.supportedReasoningEfforts || []) {
    const option = document.createElement("option"); option.value = effort.reasoningEffort;
    option.textContent = effort.reasoningEffort; option.title = effort.description; effortSelect.append(option);
  }
  effortSelect.value = model?.supportedReasoningEfforts.some(item => item.reasoningEffort === preferred) ? preferred : model?.defaultReasoningEffort || "";
}
modelSelect.addEventListener("change", () => renderEfforts());
async function loadModels(session: BuildSession) {
  if (modelSessionId === session.id || modelsLoading === session.id) return;
  modelsLoading = session.id;
  try {
    const result = await workerRequest<{ models: ModelOption[] }>(`/v1/sessions/${session.id}/models`);
    if (activeSession?.id !== session.id || activeSession.state === "stopped") return;
    availableModels = result.models; modelSelect.replaceChildren();
    for (const model of availableModels) {
      const option = document.createElement("option"); option.value = model.model; option.textContent = model.displayName; modelSelect.append(option);
    }
    modelSelect.value = availableModels.some(item => item.model === session.selectedModel) ? session.selectedModel! : (availableModels.find(item => item.isDefault) || availableModels[0])?.model || "";
    renderEfforts(session.selectedEffort); modelSessionId = session.id;
    modelSelect.disabled = effortSelect.disabled = activeSession.state !== "ready";
    renderSession(activeSession);
  } catch { setNotice("Model choices could not load. Reopen the workspace to try again.", true); }
  finally { modelsLoading = ""; }
}

function renderSession(session: BuildSession) {
  activeSession = session;
  document.querySelectorAll<HTMLButtonElement>(".build-task-reopen").forEach(button => { button.disabled = session.state !== "stopped"; });
  byId("build-close").hidden = !session.canClose || session.state !== "ready";
  if (session.state !== "ready") { byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false"); }
  renderActivity(session.state === "working" ? session.progress || "Working on your request…" : sending ? "Sending your request…" : "");
  if (session.state === "stopped") {
    workspace.hidden = true; setup.hidden = false; showOnly("start");
    setSetup("Workspace closed", "All changes were verified on GitHub. Open the workspace to sync the latest repository changes.");
    previewFrame.src = "about:blank"; openPreviewLink.hidden = true;
    checkpointButton.disabled = pushButton.disabled = true;
    byId<HTMLButtonElement>("build-publish").disabled = byId<HTMLButtonElement>("build-close").disabled = byId<HTMLButtonElement>("build-sync").disabled = true;
    renderActivity(); void loadSavedTasks(); return;
  }
  const needsConnection = session.codexAuthenticated === false && session.state === "ready";
  setup.hidden = !needsConnection;
  if (needsConnection) {
    setSetup("Connect Codex to this website", "Sign in once for this isolated workspace. Its files and conversation stay separate from your other websites.");
    showOnly("connect");
  } else byId("build-device-code").hidden = true;
  workspace.hidden = false;
  byId("build-branch").textContent = session.workingBranch;
  byId("build-change-count").textContent = session.changedFileCount ? `${session.changedFileCount} changed file${session.changedFileCount === 1 ? "" : "s"}` : "No changes";
  checkpointButton.disabled = session.state !== "ready" || session.previewState === "starting";
  pushButton.disabled = session.state !== "ready" || session.previewState === "starting";
  const pauseButton = document.getElementById("build-pause") as HTMLButtonElement | null;
  if (pauseButton) pauseButton.disabled = session.state !== "ready" || session.previewState === "offline" || session.previewState === "starting";
  const cancel = byId<HTMLButtonElement>("build-cancel"); cancel.hidden = !session.cancellable; cancel.disabled = !session.cancellable;
  byId<HTMLButtonElement>("build-publish").disabled = byId<HTMLButtonElement>("build-close").disabled = byId<HTMLButtonElement>("build-sync").disabled = session.state !== "ready" || session.previewState === "starting";
  const syncIssue = byId("build-sync-issue"); syncIssue.textContent = session.syncIssue || ""; syncIssue.hidden = !session.syncIssue;
  modelSelect.disabled = effortSelect.disabled = session.state !== "ready" || modelSessionId !== session.id;
  if (session.codexAuthenticated && session.state === "ready") void loadModels(session);
  prompt.disabled = Boolean(session.codexAuthenticated && modelSessionId !== session.id) || Boolean(session.syncIssue) || sending || session.state !== "ready" || session.codexAuthenticated === false;
  composer.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = prompt.disabled;
  byId<HTMLButtonElement>("build-upload-files").disabled = sending;
  renderPreview(session);
}

function renderPreview(session: BuildSession) {
  const dot = byId("build-preview-dot");
  const label = byId("build-preview-status");
  dot.classList.toggle("is-ready", session.previewState === "ready");
  dot.classList.toggle("is-error", session.previewState === "failed");
  label.textContent = session.previewState === "ready" ? "Live preview" : session.previewState === "failed" ? "Preview needs attention" : session.previewState === "offline" ? "Preview paused — refresh to resume" : "Preview starting";
  const previousState = previewFrame.dataset.previewState || "offline";
  const previousUrl = previewFrame.dataset.previewUrl || "";
  openPreviewLink.hidden = session.previewState !== "ready" || !session.previewUrl;
  if (session.previewUrl) openPreviewLink.href = session.previewUrl;
  if (session.previewState === "ready" && session.previewUrl && (previousState !== "ready" || previousUrl !== session.previewUrl)) {
    const previewUrl = new URL(session.previewUrl);
    previewUrl.searchParams.set("refresh", Date.now().toString());
    previewFrame.src = previewUrl.toString();
    previewFrame.dataset.previewUrl = session.previewUrl;
  } else if ((session.previewState === "starting" || session.previewState === "offline") && previousState === "ready") {
    previewFrame.src = "about:blank";
  }
  previewFrame.dataset.previewState = session.previewState;
}

function handleWorkerEvent(event: WorkerEvent) {
  if (event.eventType === "progress") {
    const session = event.metadata?.session as BuildSession | undefined;
    if (!event.replay && session && session.id === activeSession?.id) renderSession(session);
    return;
  }
  if (event.id !== undefined) {
    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);
  }
  if (event.history) return;
  // Older development output stays stored unchanged; the toggle controls its presentation.
  const legacyDiagnostic = event.replay && event.metadata?.conversationVersion !== 2 && ["agent_message", "status", "error"].includes(event.eventType);
  if (legacyDiagnostic && event.message) addMessage("technical", event.message);
  else {
    if (["user_message", "agent_message"].includes(event.eventType) && event.message) addMessage(event.eventType === "user_message" ? "user" : "agent", event.message);
    if (["status", "error", "checkpoint", "push"].includes(event.eventType) && event.message) addMessage("status", event.message);
  }
  if (event.technicalNotes) addMessage("technical", event.technicalNotes);
  if (event.replay) return;
  const session = event.metadata?.session as BuildSession | undefined;
  if (session?.state === "failed") {
    activeSession = null; modelSessionId = ""; availableModels = [];
    renderActivity();
    eventAbort?.abort();
    workspace.hidden = true;
    setup.hidden = false;
    openPreviewLink.hidden = true;
    byId("build-branch").textContent = "No session";
    setSetup("The workspace could not open", event.message || "The build worker reported an error. You can safely try again.");
    showOnly("start");
    return;
  }
  if (session && (!activeSession || session.id === activeSession.id)) renderSession(session);
  if (event.eventType === "agent_message" && activeSession?.previewState === "ready" && activeSession.previewUrl) {
    const url = new URL(activeSession.previewUrl);
    url.searchParams.set("refresh", Date.now().toString());
    previewFrame.src = url.toString();
  }
}

function connectEvents(sessionId: string) {
  eventAbort?.abort();
  const controller = new AbortController();
  eventAbort = controller;
  void (async () => {
    let failures = 0;
    while (!controller.signal.aborted && activeSession?.id === sessionId) {
      try {
        const response = await fetch(`${workerBase}/v1/sessions/${encodeURIComponent(sessionId)}/events`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("The build event stream could not open.");
        setNotice("");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          failures = 0;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";
          blocks.forEach((block) => {
            const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
            if (data) handleWorkerEvent(JSON.parse(data) as WorkerEvent);
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Connection interrupted.", true);
      }
      if (controller.signal.aborted) return;
      setNotice("Reconnecting to Build Studio…", true);
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, Math.min(1000 * 2 ** failures++, 15_000));
        controller.signal.addEventListener("abort", finish, { once: true });
      });
    }
  })();
}

async function inspectWorker() {
  const selectedWebsiteId = currentWebsite?.id;
  byId("build-history-messages").replaceChildren(); byId("build-history").hidden = true;
  (byId("build-history") as HTMLDetailsElement).open = false;
  const repository = currentWebsite ? repositories.find((item) => item.website_id === currentWebsite?.id) : null;
  byId("build-project-name").textContent = currentWebsite?.name || "No website selected";
  byId("build-repository-name").textContent = repository?.full_name || "No repository connected";
  if (!currentWebsite) {
    setSetup("Select a website", "Choose an N3XRA website workspace to begin.");
    showOnly("none");
    return;
  }
  if (!repository) {
    setSetup("Connect a repository first", "Build Studio works from the selected website’s GitHub repository.");
    showOnly("repository");
    return;
  }
  if (!workerBase) {
    setSetup("Build Studio worker is ready to install", "Add its private URL to N3XRA configuration to enable Codex, branches, and live preview.");
    showOnly("none");
    setNotice("The Build Studio interface and secure worker package are installed; deployment configuration remains.", true);
    return;
  }
  try {
    const health = await workerRequest<{ ready: boolean; codexAuthenticated: boolean; requiresWorkspace?: boolean }>("/v1/account");
    if (currentWebsite?.id !== selectedWebsiteId) return;
    byId("build-worker-dot").classList.toggle("is-ready", health.ready);
    if (!health.codexAuthenticated && !health.requiresWorkspace) {
      setSetup("Connect the N3XRA Codex account", "This one-time connection lets Build Studio use the same ChatGPT-managed Codex access on the private worker.");
      showOnly("connect");
      return;
    }
    const active = await workerRequest<{ session: BuildSession | null; events?: WorkerEvent[]; closed?: boolean }>(`/v1/projects/${encodeURIComponent(currentWebsite.id)}/active`);
    if (currentWebsite?.id !== selectedWebsiteId) return;
    activeSession = active.session;
    void loadSavedTasks();
    if (active.session) {
      messages.replaceChildren();
    byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false");

      technicalEntries.length = 0;
      seenEvents.clear();
      (active.events || []).forEach((event) => handleWorkerEvent({ ...event, replay: true }));
      renderSession(active.session);
      connectEvents(active.session.id);
      setNotice(active.session.state === "preparing" ? "Restored the workspace. Preparation is still running." : "Workspace restored.");
      return;
    }
    setSetup(active.closed ? "Workspace closed" : "Ready to build", active.closed ? "All changes were verified on GitHub. Open the workspace to sync the latest repository changes." : "Open a secure branch and live preview for this website.");
    showOnly("start");
  } catch (error) {
    setSetup("Build worker is offline", "Start the private worker, then refresh this page.");
    showOnly("none");
    setNotice(error instanceof Error ? error.message : "Unable to reach the build worker.", true);
  }
}

async function startSession(taskId = "") {
  if (!currentWebsite) return;
  const selectedWebsiteId = currentWebsite.id;
  startButton.disabled = true;
  setSetup("Opening the repository", "Preparing the branch, installing the site, and starting its preview.");
  try {
    const result = await workerRequest<{ session: BuildSession; events?: WorkerEvent[] }>("/v1/projects/open", {
      method: "POST",
      body: JSON.stringify({ websiteId: currentWebsite.id, taskId }),
    });
    if (currentWebsite?.id !== selectedWebsiteId) return;
    messages.replaceChildren();
    byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false");

    technicalEntries.length = 0;
    seenEvents.clear();
    (result.events || []).forEach((event) => handleWorkerEvent({ ...event, replay: true }));
    renderSession(result.session);
    void loadSavedTasks();
    addMessage("status", "Build Studio reserved the branch. Repository and preview preparation will continue here.");
    connectEvents(result.session.id);
  } catch (error) {
    setSetup("The workspace could not open", error instanceof Error ? error.message : "Try again in a moment.");
    showOnly("start");
  } finally {
    startButton.disabled = false;
  }
}

async function initialize() {
  const context = await getAdminSession();
  if (!context.allowed || !context.session) return;
  accessToken = context.session.access_token;
  assetPicker = setupAssetPicker(context.supabase, context.session.user.id, () => currentWebsite, prompt);
  const [websiteResult, repositoryResult] = await Promise.all([
    context.supabase.from("client_websites").select("id,name,organization_id").order("name"),
    context.supabase.from("website_repositories").select("website_id,full_name,default_branch,html_url").order("created_at", { ascending: false }),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (repositoryResult.error) throw repositoryResult.error;
  const websites = (websiteResult.data || []) as Website[];
  repositories = (repositoryResult.data || []) as Repository[];
  const saved = readWorkspaceContext("admin", context.session.user.id);
  currentWebsite = websites.find((item) => item.id === saved.websiteId) || websites[0] || null;
  websiteSelect.replaceChildren(...websites.map(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; return option; }));
  websiteSelect.value = currentWebsite?.id || "";
  websiteSelect.addEventListener("change", () => {
    currentWebsite = websites.find((item) => item.id === websiteSelect.value) || null;
    assetPicker?.reset();
    if (currentWebsite) writeWorkspaceContext("admin", context.session!.user.id, { websiteId: currentWebsite.id, name: currentWebsite.name });
    activeSession = null; modelSessionId = ""; availableModels = [];
    renderActivity();
    eventAbort?.abort();
    messages.replaceChildren();
    byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false");

    technicalEntries.length = 0;
    seenEvents.clear();
    previewFrame.src = "about:blank";
    previewFrame.dataset.previewState = "offline";
    previewFrame.dataset.previewUrl = "";
    openPreviewLink.hidden = true;
    setup.hidden = false;
    workspace.hidden = true;
    inspectWorker();
  });
  await inspectWorker();
  studio.ariaBusy = "false";
  document.body.classList.remove("portal-loading");
  byId("portal-status").setAttribute("hidden", "");
}

startButton.addEventListener("click", () => startSession());
connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    const result = await workerRequest<{ verificationUrl: string; userCode: string }>("/v1/account/connect", { method: "POST", body: JSON.stringify({ sessionId: activeSession?.id }) });
    const code = byId("build-device-code");
    code.hidden = false;
    code.textContent = `Open ${result.verificationUrl}\nEnter code: ${result.userCode}`;
    window.open(result.verificationUrl, "_blank", "noopener");
  } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start Codex sign in.", true); }
  finally { connectButton.disabled = false; }
});
composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeSession || activeSession.state !== "ready" || sending || !prompt.value.trim()) return;
  const sessionId = activeSession.id;
  const text = prompt.value.trim() + (assetPicker?.context() || "");
  sending = true;
  renderSession(activeSession);
  try {
    await workerRequest(`/v1/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ text, model: modelSelect.value, effort: effortSelect.value }) });
    if (activeSession?.id === sessionId) { prompt.value = ""; assetPicker?.clear(); }
  } catch (error) {
    if (activeSession?.id === sessionId) addMessage("status", "The request could not be completed. Check the connection and try again.");
  } finally {
    sending = false;
    if (activeSession?.id === sessionId) renderSession(activeSession);
  }
});
for (const action of ["close", "sync", "cancel", "publish", "push"] as const) {
  byId<HTMLButtonElement>(`build-${action}`).addEventListener("click", async () => {
    if (!activeSession) return;
    const id = activeSession.id;
    if (action === "publish" || action === "push") { byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false"); }
    byId<HTMLButtonElement>(`build-${action}`).disabled = true;
    renderActivity(action === "publish" ? "Preparing to publish to main…" : action === "push" ? "Saving to your working branch…" : action === "close" ? "Verifying and closing your workspace…" : action === "sync" ? "Syncing with GitHub…" : "Canceling your request…");
    try {
      const result = await workerRequest<{ session: BuildSession }>(`/v1/sessions/${id}/${action === "push" ? "save" : action}`, { method: "POST", body: "{}" });
      if (activeSession?.id === id) { renderSession(result.session); if (action === "close") { eventAbort?.abort(); modelSessionId = ""; } }
    } catch (error) { setNotice(error instanceof Error ? error.message : "The action could not finish.", true); if (activeSession?.id === id) renderSession(activeSession); }
  });
}

checkpointButton.addEventListener("click", () => {
  if (!activeSession || checkpointButton.disabled) return;
  const panel = byId("build-save-options"); panel.hidden = !panel.hidden;
  checkpointButton.setAttribute("aria-expanded", String(!panel.hidden));
});
byId("build-save-cancel").addEventListener("click", () => {
  byId("build-save-options").hidden = true; checkpointButton.setAttribute("aria-expanded", "false");
});
byId("build-refresh-preview").addEventListener("click", async () => {
  if (!activeSession) return;
  try {
    const result = await workerRequest<{ session: BuildSession }>(`/v1/sessions/${activeSession.id}/preview/restart`, { method: "POST", body: "{}" });
    renderSession(result.session);
    addMessage("status", "Restarting the live preview.");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The preview could not restart.", true);
  }
});
document.getElementById("build-pause")?.addEventListener("click", async () => {
  if (!activeSession) return;
  try {
    const result = await workerRequest<{ session: BuildSession }>(`/v1/sessions/${activeSession.id}/pause`, { method: "POST", body: "{}" });
    renderSession(result.session); setNotice("Workspace paused. Your work is saved.");
  } catch (error) { setNotice(error instanceof Error ? error.message : "Could not pause the workspace.", true); }
});
document.querySelectorAll<HTMLButtonElement>("[data-preview-width]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-preview-width]").forEach((item) => item.classList.remove("is-current"));
  button.classList.add("is-current");
  previewFrame.style.width = button.dataset.previewWidth || "100%";
}));

initialize().catch((error) => {
  studio.ariaBusy = "false";
  setSetup("Build Studio could not open", error instanceof Error ? error.message : "Please refresh and try again.");
  setNotice("The page is safe; no repository changes were made.", true);
});
