"use strict";
const script = document.currentScript;
const apiOrigin = (() => {
    try {
        const url = new URL(script?.src || window.location.href);
        // n3xra.com redirects before the API handler can attach CORS headers.
        // Calling the canonical host directly keeps client website embeds working.
        if (url.hostname === "n3xra.com")
            url.hostname = "www.n3xra.com";
        return url.origin;
    }
    catch {
        return window.location.origin;
    }
})();
function hide(root) {
    root.hidden = true;
    root.dataset.n3xraCounterState = "hidden";
}
function target(root, name) {
    const selector = `[data-n3xra-counter-${name}]`;
    const existing = root.querySelector(selector);
    if (existing)
        return existing;
    const element = document.createElement("span");
    element.setAttribute(`data-n3xra-counter-${name}`, "");
    root.append(element);
    return element;
}
async function load(root) {
    hide(root);
    const key = String(root.dataset.n3xraTrafficCounter || "").trim();
    if (!key)
        return;
    try {
        const response = await fetch(`${apiOrigin}/api/public-traffic-counter?key=${encodeURIComponent(key)}&v=3`, { headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok || payload.enabled !== true || !Number.isFinite(Number(payload.value)))
            return;
        target(root, "value").textContent = Math.max(0, Math.round(Number(payload.value))).toLocaleString();
        target(root, "label").textContent = String(payload.label || "Website visits");
        root.dataset.n3xraCounterMetric = String(payload.metric || "all_time_pageviews");
        root.dataset.n3xraCounterState = "ready";
        root.hidden = false;
        root.dispatchEvent(new CustomEvent("n3xra:traffic-counter", { bubbles: true, detail: payload }));
    }
    catch {
        hide(root);
    }
}
document.querySelectorAll("[data-n3xra-traffic-counter]").forEach((root) => { void load(root); });
