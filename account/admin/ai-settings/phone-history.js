import { renderAdminNavigation } from "/account/admin/admin-navigation.js?v=30";
import { getAdminSession } from "/account/admin/admin-session.js";
const node = (id) => document.getElementById(id);
const status = node("status"), calls = node("calls");
const note = node("note"), instruction = node("instruction"), effect = node("effect");
let access;
let selected = "", generation = 0;
let repairRunning = false;
let repairTimer;
let current = { instruction: "", expected_effect: "", version: null };
let proposal = null;
const date = (value) => new Date(value).toLocaleString();
async function request(path = "", body) {
    const session = await access.supabase.auth.getSession();
    const token = session.data?.session?.access_token;
    if (!token)
        throw Error("Your session expired. Sign in again.");
    const response = await fetch(`/api/phone-history${path}`, { method: body ? "POST" : "GET", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok)
        throw Error(data.error || "Unable to load phone history.");
    return data;
}
function entry(target, title, text, when, kind = "") {
    const article = document.createElement("article");
    article.className = "entry";
    article.dataset.kind = kind;
    const heading = document.createElement("h3");
    heading.textContent = title;
    const time = document.createElement("time");
    time.dateTime = when;
    time.textContent = date(when);
    const p = document.createElement("p");
    p.textContent = text;
    article.append(heading, time, p);
    target.append(article);
}
function resetApproval() { proposal = null; node("approval").hidden = true; }
async function loadCall(id) {
    const version = ++generation;
    selected = id;
    node("detail").hidden = true;
    resetApproval();
    if (repairTimer)
        clearTimeout(repairTimer);
    if (!id)
        return;
    status.textContent = "Loading conversation…";
    try {
        const data = await request(`?id=${encodeURIComponent(id)}`);
        if (version !== generation)
            return;
        current = data.instruction;
        node("call-title").textContent = date(data.call.created_at);
        node("coverage").textContent = data.call.status === "closed" && !data.call.dropped_events
            ? "Connection ended; no dropped events were reported. Capture covers the verified portion only, with sensitive text omitted."
            : `Partial record: ${data.call.dropped_events || 0} dropped events reported. The connection may still be open, or capture may have stopped unexpectedly.`;
        node("provenance").textContent = `Assistant: Nex phone. Provider: Groq. Configured model: ${data.call.configured_model}. Exact returned model was not recorded. Rules: ${data.call.rules_version}. Reviewed additions version: ${data.call.instruction_version || "none"}. Expires: ${date(data.call.expires_at)}.`;
        const timeline = node("events");
        timeline.replaceChildren();
        const labels = { caller: "You · speech transcript", caller_ignored: "You · received while busy, not processed", nex_sent: "Nex · sent for speech", interrupt: "Interruption · Twilio-reported spoken portion", notice: "Recording note" };
        for (const event of data.events)
            entry(timeline, labels[event.kind] || event.kind, event.text, event.created_at, event.kind);
        if (!data.events.length)
            timeline.textContent = "No phone text was saved for this connection.";
        const builds = node("builds");
        builds.replaceChildren();
        for (const build of data.builds) {
            entry(builds, `Nex → builder · ${build.configuredModel || "model not recorded"}`, build.instruction, build.created_at);
            entry(builds, build.outcome === "error" ? "Builder reported a problem" : "Builder response", build.reply || "No matching saved reply yet. Refresh later or check Build Studio; do not assume the edit succeeded.", build.replyAt || build.created_at);
            for (const work of build.work || []) {
                if (["push", "status"].includes(work.kind))
                    entry(builds, "Saved action", work.message, work.at);
                if (work.notes) {
                    const details = document.createElement("details");
                    const summary = document.createElement("summary");
                    summary.textContent = "Builder work notes";
                    const pre = document.createElement("pre");
                    pre.textContent = work.notes;
                    details.append(summary, pre);
                    builds.append(details);
                }
            }
        }
        if (!data.builds.length)
            builds.textContent = "No saved builder instructions are linked to this call.";
        if (data.buildsMayBeTruncated)
            builds.append(document.createTextNode("Showing the first 50 builder requests for this call."));
        note.value = data.call.review_note || "";
        instruction.value = current.instruction;
        effect.value = current.expected_effect;
        node("detail").hidden = false;
        status.textContent = "Conversation loaded.";
        void loadRepairs();
    }
    catch (error) {
        if (version === generation)
            status.textContent = String(error.message);
    }
}
async function refresh() {
    const data = await request();
    current = data.instruction;
    calls.replaceChildren(new Option("Choose a conversation", ""));
    for (const call of data.calls)
        calls.add(new Option(`${date(call.created_at)} · ${call.status}${call.review_note ? " · reviewed" : ""}`, call.id));
    calls.value = data.calls.some((call) => call.id === selected) ? selected : "";
    node("history").hidden = false;
    if (calls.value)
        await loadCall(calls.value);
    else {
        node("detail").hidden = true;
        status.textContent = data.calls.length ? "Choose a conversation to review. Showing the latest 50." : "No saved phone conversations yet. New verified phone-building sessions will appear here.";
    }
}
async function action(button, run) {
    button.disabled = true;
    try {
        await run();
    }
    catch (error) {
        status.textContent = error.message;
    }
    finally {
        button.disabled = button.id === "analyze" && repairRunning;
    }
}
calls.addEventListener("change", () => void loadCall(calls.value));
node("refresh").onclick = (event) => void action(event.currentTarget, refresh);
async function repairRequest(action = "", body) {
    const session = await access.supabase.auth.getSession();
    const token = session.data?.session?.access_token;
    if (!token)
        throw Error("Your session expired. Sign in again.");
    const config = window.RECORDS_APP_CONFIG;
    const origin = config?.buildWorkerUrl;
    if (!origin || (new URL(origin).protocol !== "https:" && !(location.hostname === "127.0.0.1" && new URL(origin).hostname === "127.0.0.1")))
        throw Error("The builder connection is unavailable.");
    const response = await fetch(`${origin}/v1/conversation-repairs${action ? `/${action}` : `?conversationId=${encodeURIComponent(selected)}`}`, {
        method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
        throw Error(data.error || "The conversation review is unavailable.");
    return data;
}
async function loadRepairs() {
    const id = selected;
    try {
        const data = await repairRequest();
        if (id !== selected)
            return;
        const target = node("repair-results");
        target.replaceChildren();
        const activeStates = ["queued", "analyzing", "testing", "publishing", "verifying"];
        let running = false;
        for (const run of data.runs) {
            if (activeStates.includes(run.state))
                running = true;
            entry(target, `${run.model === "gpt-6-astra" ? "Astra" : "Sol"} · ${run.state}`, run.report?.summary || (activeStates.includes(run.state) ? "Review in progress" : run.report?.error || "Review finished without a verified repair"), run.created_at);
            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "Progress and results";
            details.append(summary);
            details.open = run === data.runs[0];
            for (const update of run.updates || [])
                entry(details, "Progress", update.message, update.at);
            for (const key of ["findings", "changes", "liveChecks", "limitations"]) {
                if (run.report?.[key]?.length) {
                    const p = document.createElement("p");
                    p.textContent = `${key === "liveChecks" ? "Live checks" : key}: ${run.report[key].join(" · ")}`;
                    details.append(p);
                }
            }
            if (run.report?.assessment) {
                const p = document.createElement("p");
                p.textContent = `Outcome review: ${run.report.assessment.approved ? "passed" : "needs more work"} — ${run.report.assessment.summary}. ${(run.report.assessment.issues || []).join(" · ")}`;
                details.append(p);
            }
            if (run.report?.partialWork) {
                const work = document.createElement("details");
                const label = document.createElement("summary");
                label.textContent = "Work notes";
                const pre = document.createElement("pre");
                pre.textContent = run.report.partialWork;
                work.append(label, pre);
                details.append(work);
            }
            if (run.report?.error) {
                const p = document.createElement("p");
                p.textContent = run.report.error;
                details.append(p);
            }
            const usage = document.createElement("p");
            usage.textContent = `Attempt ${run.attempt}/3 · ${run.tokens || 0} budgeted tokens · Limit: ${date(run.deadline)}`;
            details.append(usage);
            target.append(details);
            if (activeStates.includes(run.state)) {
                const stop = document.createElement("button");
                stop.textContent = "Stop run";
                stop.type = "button";
                stop.onclick = () => void action(stop, async () => { await repairRequest("stop", { id: run.id }); await loadRepairs(); });
                target.append(stop);
            }
        }
        repairRunning = running;
        node("analyze").disabled = running;
        node("repair-status").textContent = running ? "Working in the background. You can leave this page." : data.runs.length ? "The latest results are saved below." : "Ready to analyze this conversation.";
        if (repairTimer)
            clearTimeout(repairTimer);
        if (running)
            repairTimer = setTimeout(() => void loadRepairs(), 5000);
    }
    catch (error) {
        if (id === selected)
            node("repair-status").textContent = error.message;
    }
}
node("analyze").onclick = event => void action(event.currentTarget, async () => {
    node("repair-status").textContent = "Starting the review…";
    try {
        await repairRequest("start", { conversationId: selected, model: node("repair-model").value });
        await loadRepairs();
    }
    catch (error) {
        node("repair-status").textContent = error.message;
    }
});
node("connect-repair").onclick = event => void action(event.currentTarget, async () => {
    const data = await repairRequest("connect", {});
    const target = node("repair-connection");
    target.replaceChildren();
    if (data.connected) {
        target.textContent = "Codex is connected.";
        return;
    }
    const url = new URL(data.verificationUrl);
    if (url.protocol !== "https:" || url.hostname !== "auth.openai.com")
        throw Error("Unexpected sign-in address.");
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Sign in to Codex";
    target.append(link, document.createTextNode(` — code: ${data.userCode}. After signing in, select Analyze conversation.`));
});
node("save-note").onclick = (event) => void action(event.currentTarget, async () => { await request("", { id: selected, action: "note", note: note.value }); status.textContent = "Review note saved."; });
node("preview").onclick = () => {
    if (!effect.value.trim()) {
        status.textContent = "Explain the expected effect before reviewing this change.";
        effect.focus();
        return;
    }
    proposal = { id: selected, action: "apply", instruction: instruction.value, expectedEffect: effect.value, expectedVersion: current.version };
    node("before").textContent = current.instruction || "No additional instructions.";
    node("after").textContent = instruction.value || "Clear the additional instructions; use Nex’s standard rules.";
    node("expected").textContent = effect.value;
    node("approval").hidden = false;
};
instruction.addEventListener("input", resetApproval);
effect.addEventListener("input", resetApproval);
node("cancel").onclick = resetApproval;
node("apply").onclick = (event) => void action(event.currentTarget, async () => {
    if (!proposal || proposal.id !== selected)
        return;
    const result = await request("", proposal);
    current = result.instruction;
    resetApproval();
    status.textContent = "Instruction applied. It will take effect in your next verified phone-building session.";
});
void (async () => {
    try {
        access = await getAdminSession();
        if (!access.allowed || !access.session)
            return;
        document.body.classList.add("admin-ready");
        renderAdminNavigation();
        await refresh();
    }
    catch (error) {
        document.body.classList.add("admin-ready");
        status.textContent = error.message;
    }
})();
