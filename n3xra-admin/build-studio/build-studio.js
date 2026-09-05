import { getAdminSession } from "/account/admin/admin-session.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
const workerBase = String(window.RECORDS_APP_CONFIG?.buildWorkerUrl || "").replace(/\/+$/, "");
const byId = (id) => document.getElementById(id);
const studio = byId("build-studio");
const setup = byId("build-setup");
const workspace = byId("build-workspace");
const websiteSelect = byId("build-website-select");
const startButton = byId("build-start");
const connectButton = byId("build-connect");
const servicesLink = byId("build-open-services");
const composer = byId("build-composer");
const prompt = byId("build-prompt");
const messages = byId("build-messages");
const notice = byId("build-notice");
const previewFrame = byId("build-preview-frame");
const checkpointButton = byId("build-checkpoint");
const pushButton = byId("build-push");
const openPreviewLink = byId("build-open-preview");
let accessToken = "";
let currentWebsite = null;
let repositories = [];
let activeSession = null;
let eventAbort = null;
const seenEvents = new Set();
let sending = false;
function setNotice(value = "", error = false) {
    notice.textContent = value;
    notice.style.color = error ? "#9f453e" : "#28766c";
}
function setSetup(title, copy) {
    byId("build-setup-title").textContent = title;
    byId("build-setup-copy").textContent = copy;
}
function showOnly(action) {
    startButton.hidden = action !== "start";
    connectButton.hidden = action !== "connect";
    servicesLink.hidden = action !== "repository";
}
async function workerRequest(path, options = {}) {
    if (!workerBase)
        throw new Error("The private Build Studio worker has not been connected yet.");
    const response = await fetch(`${workerBase}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || `Build worker returned ${response.status}.`);
    return data;
}
function addMessage(role, text) {
    if (!text.trim())
        return;
    const item = document.createElement("article");
    item.className = `build-message${role === "user" ? " is-user" : ""}`;
    const label = role === "agent" ? "Codex" : role === "user" ? "You" : "Build Studio";
    const small = document.createElement("small");
    small.textContent = label;
    const body = document.createElement("div");
    body.textContent = text;
    item.append(small, body);
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
}
function renderSession(session) {
    activeSession = session;
    const needsConnection = session.codexAuthenticated === false && session.state === "ready";
    setup.hidden = !needsConnection;
    if (needsConnection) {
        setSetup("Connect Codex to this website", "Sign in once for this isolated workspace. Its files and conversation stay separate from your other websites.");
        showOnly("connect");
    }
    else
        byId("build-device-code").hidden = true;
    workspace.hidden = false;
    byId("build-branch").textContent = session.workingBranch;
    byId("build-change-count").textContent = session.changedFileCount ? `${session.changedFileCount} changed file${session.changedFileCount === 1 ? "" : "s"}` : "No changes";
    checkpointButton.disabled = session.state !== "ready" || session.changedFileCount === 0;
    pushButton.disabled = session.state !== "ready" || !session.hasUnpushedCommits;
    const pauseButton = document.getElementById("build-pause");
    if (pauseButton)
        pauseButton.disabled = session.state !== "ready" || session.previewState === "offline" || session.previewState === "starting";
    prompt.disabled = sending || session.state !== "ready" || session.codexAuthenticated === false;
    composer.querySelector('button[type="submit"]').disabled = prompt.disabled;
    renderPreview(session);
}
function renderPreview(session) {
    const dot = byId("build-preview-dot");
    const label = byId("build-preview-status");
    dot.classList.toggle("is-ready", session.previewState === "ready");
    dot.classList.toggle("is-error", session.previewState === "failed");
    label.textContent = session.previewState === "ready" ? "Live preview" : session.previewState === "failed" ? "Preview needs attention" : session.previewState === "offline" ? "Preview paused — refresh to resume" : "Preview starting";
    const previousState = previewFrame.dataset.previewState || "offline";
    const previousUrl = previewFrame.dataset.previewUrl || "";
    openPreviewLink.hidden = session.previewState !== "ready" || !session.previewUrl;
    if (session.previewUrl)
        openPreviewLink.href = session.previewUrl;
    if (session.previewState === "ready" && session.previewUrl && (previousState !== "ready" || previousUrl !== session.previewUrl)) {
        const previewUrl = new URL(session.previewUrl);
        previewUrl.searchParams.set("refresh", Date.now().toString());
        previewFrame.src = previewUrl.toString();
        previewFrame.dataset.previewUrl = session.previewUrl;
    }
    else if ((session.previewState === "starting" || session.previewState === "offline") && previousState === "ready") {
        previewFrame.src = "about:blank";
    }
    previewFrame.dataset.previewState = session.previewState;
}
function handleWorkerEvent(event) {
    if (event.id !== undefined) {
        if (seenEvents.has(event.id))
            return;
        seenEvents.add(event.id);
    }
    if (["user_message", "agent_message"].includes(event.eventType) && event.message)
        addMessage(event.eventType === "user_message" ? "user" : "agent", event.message);
    if (["status", "error", "checkpoint", "push"].includes(event.eventType) && event.message)
        addMessage("status", event.message);
    if (event.replay)
        return;
    const session = event.metadata?.session;
    if (session?.state === "failed") {
        activeSession = null;
        eventAbort?.abort();
        workspace.hidden = true;
        setup.hidden = false;
        openPreviewLink.hidden = true;
        byId("build-branch").textContent = "No session";
        setSetup("The workspace could not open", event.message || "The build worker reported an error. You can safely try again.");
        showOnly("start");
        return;
    }
    if (session && (!activeSession || session.id === activeSession.id))
        renderSession(session);
    if (event.eventType === "agent_message" && activeSession?.previewState === "ready" && activeSession.previewUrl) {
        const url = new URL(activeSession.previewUrl);
        url.searchParams.set("refresh", Date.now().toString());
        previewFrame.src = url.toString();
    }
}
function connectEvents(sessionId) {
    eventAbort?.abort();
    const controller = new AbortController();
    eventAbort = controller;
    void (async () => {
        let failures = 0;
        while (!controller.signal.aborted && activeSession?.id === sessionId) {
            try {
                const response = await fetch(`${workerBase}/v1/sessions/${encodeURIComponent(sessionId)}/events`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
                if (!response.ok || !response.body)
                    throw new Error("The build event stream could not open.");
                setNotice("");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (!controller.signal.aborted) {
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    failures = 0;
                    buffer += decoder.decode(value, { stream: true });
                    const blocks = buffer.split("\n\n");
                    buffer = blocks.pop() || "";
                    blocks.forEach((block) => {
                        const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
                        if (data)
                            handleWorkerEvent(JSON.parse(data));
                    });
                }
            }
            catch (error) {
                if (!controller.signal.aborted)
                    setNotice(error instanceof Error ? error.message : "Connection interrupted.", true);
            }
            if (controller.signal.aborted)
                return;
            setNotice("Reconnecting to Build Studio…", true);
            await new Promise((resolve) => {
                const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
                const timer = setTimeout(finish, Math.min(1000 * 2 ** failures++, 15_000));
                controller.signal.addEventListener("abort", finish, { once: true });
            });
        }
    })();
}
async function inspectWorker() {
    const selectedWebsiteId = currentWebsite?.id;
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
        const health = await workerRequest("/v1/account");
        if (currentWebsite?.id !== selectedWebsiteId)
            return;
        byId("build-worker-dot").classList.toggle("is-ready", health.ready);
        if (!health.codexAuthenticated && !health.requiresWorkspace) {
            setSetup("Connect the N3XRA Codex account", "This one-time connection lets Build Studio use the same ChatGPT-managed Codex access on the private worker.");
            showOnly("connect");
            return;
        }
        const active = await workerRequest(`/v1/projects/${encodeURIComponent(currentWebsite.id)}/active`);
        if (currentWebsite?.id !== selectedWebsiteId)
            return;
        if (active.session) {
            messages.replaceChildren();
            seenEvents.clear();
            (active.events || []).forEach((event) => handleWorkerEvent({ ...event, replay: true }));
            renderSession(active.session);
            connectEvents(active.session.id);
            setNotice(active.session.state === "preparing" ? "Restored the workspace. Preparation is still running." : "Workspace restored.");
            return;
        }
        setSetup("Ready to build", "Open a secure branch and live preview for this website.");
        showOnly("start");
    }
    catch (error) {
        setSetup("Build worker is offline", "Start the private worker, then refresh this page.");
        showOnly("none");
        setNotice(error instanceof Error ? error.message : "Unable to reach the build worker.", true);
    }
}
async function startSession() {
    if (!currentWebsite)
        return;
    const selectedWebsiteId = currentWebsite.id;
    startButton.disabled = true;
    setSetup("Opening the repository", "Preparing the branch, installing the site, and starting its preview.");
    try {
        const result = await workerRequest("/v1/projects/open", {
            method: "POST",
            body: JSON.stringify({ websiteId: currentWebsite.id }),
        });
        if (currentWebsite?.id !== selectedWebsiteId)
            return;
        messages.replaceChildren();
        seenEvents.clear();
        (result.events || []).forEach((event) => handleWorkerEvent({ ...event, replay: true }));
        renderSession(result.session);
        addMessage("status", "Build Studio reserved the branch. Repository and preview preparation will continue here.");
        connectEvents(result.session.id);
    }
    catch (error) {
        setSetup("The workspace could not open", error instanceof Error ? error.message : "Try again in a moment.");
        showOnly("start");
    }
    finally {
        startButton.disabled = false;
    }
}
async function initialize() {
    const context = await getAdminSession();
    if (!context.allowed || !context.session)
        return;
    accessToken = context.session.access_token;
    const [websiteResult, repositoryResult] = await Promise.all([
        context.supabase.from("client_websites").select("id,name,organization_id").order("name"),
        context.supabase.from("website_repositories").select("website_id,full_name,default_branch,html_url").order("created_at", { ascending: false }),
    ]);
    if (websiteResult.error)
        throw websiteResult.error;
    if (repositoryResult.error)
        throw repositoryResult.error;
    const websites = (websiteResult.data || []);
    repositories = (repositoryResult.data || []);
    const saved = readWorkspaceContext("admin", context.session.user.id);
    currentWebsite = websites.find((item) => item.id === saved.websiteId) || websites[0] || null;
    websiteSelect.replaceChildren(...websites.map(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; return option; }));
    websiteSelect.value = currentWebsite?.id || "";
    websiteSelect.addEventListener("change", () => {
        currentWebsite = websites.find((item) => item.id === websiteSelect.value) || null;
        if (currentWebsite)
            writeWorkspaceContext("admin", context.session.user.id, { websiteId: currentWebsite.id, name: currentWebsite.name });
        activeSession = null;
        eventAbort?.abort();
        messages.replaceChildren();
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
startButton.addEventListener("click", startSession);
connectButton.addEventListener("click", async () => {
    connectButton.disabled = true;
    try {
        const result = await workerRequest("/v1/account/connect", { method: "POST", body: JSON.stringify({ sessionId: activeSession?.id }) });
        const code = byId("build-device-code");
        code.hidden = false;
        code.textContent = `Open ${result.verificationUrl}\nEnter code: ${result.userCode}`;
        window.open(result.verificationUrl, "_blank", "noopener");
    }
    catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not start Codex sign in.", true);
    }
    finally {
        connectButton.disabled = false;
    }
});
composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeSession || activeSession.state !== "ready" || sending || !prompt.value.trim())
        return;
    const sessionId = activeSession.id;
    const text = prompt.value.trim();
    sending = true;
    renderSession(activeSession);
    try {
        await workerRequest(`/v1/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
        if (activeSession?.id === sessionId)
            prompt.value = "";
    }
    catch (error) {
        addMessage("status", error instanceof Error ? error.message : "The message could not be sent.");
    }
    finally {
        sending = false;
        if (activeSession?.id === sessionId)
            renderSession(activeSession);
    }
});
checkpointButton.addEventListener("click", async () => {
    if (!activeSession)
        return;
    await workerRequest(`/v1/sessions/${activeSession.id}/checkpoint`, { method: "POST", body: JSON.stringify({ message: "Build Studio checkpoint" }) }).catch((error) => setNotice(error.message, true));
});
pushButton.addEventListener("click", async () => {
    if (!activeSession)
        return;
    await workerRequest(`/v1/sessions/${activeSession.id}/push`, { method: "POST", body: "{}" }).catch((error) => setNotice(error.message, true));
});
byId("build-refresh-preview").addEventListener("click", async () => {
    if (!activeSession)
        return;
    try {
        const result = await workerRequest(`/v1/sessions/${activeSession.id}/preview/restart`, { method: "POST", body: "{}" });
        renderSession(result.session);
        addMessage("status", "Restarting the live preview.");
    }
    catch (error) {
        setNotice(error instanceof Error ? error.message : "The preview could not restart.", true);
    }
});
document.getElementById("build-pause")?.addEventListener("click", async () => {
    if (!activeSession)
        return;
    try {
        const result = await workerRequest(`/v1/sessions/${activeSession.id}/pause`, { method: "POST", body: "{}" });
        renderSession(result.session);
        setNotice("Workspace paused. Your work is saved.");
    }
    catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not pause the workspace.", true);
    }
});
document.querySelectorAll("[data-preview-width]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-preview-width]").forEach((item) => item.classList.remove("is-current"));
    button.classList.add("is-current");
    previewFrame.style.width = button.dataset.previewWidth || "100%";
}));
initialize().catch((error) => {
    studio.ariaBusy = "false";
    setSetup("Build Studio could not open", error instanceof Error ? error.message : "Please refresh and try again.");
    setNotice("The page is safe; no repository changes were made.", true);
});
