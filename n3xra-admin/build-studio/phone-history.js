import { getAdminSession } from "/account/admin/admin-session.js";
const node = (id) => document.getElementById(id);
const status = node("status"), calls = node("calls");
const note = node("note"), instruction = node("instruction"), effect = node("effect");
let access;
let selected = "", generation = 0;
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
        button.disabled = false;
    }
}
calls.addEventListener("change", () => void loadCall(calls.value));
node("refresh").onclick = (event) => void action(event.currentTarget, refresh);
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
        await refresh();
    }
    catch (error) {
        status.textContent = error.message;
    }
})();
