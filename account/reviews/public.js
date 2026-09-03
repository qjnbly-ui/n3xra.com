const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const grid = document.getElementById("public-reviews-grid");
const statusElement = document.getElementById("public-reviews-status");
function render(reviews) {
    if (!grid || !statusElement)
        return;
    if (!reviews.length) {
        grid.innerHTML = '<div class="public-reviews-empty"><strong>Published reviews are coming soon.</strong><p>Customer reviews appear here after N3XRA verifies and publishes them.</p></div>';
        statusElement.textContent = "";
        return;
    }
    grid.innerHTML = reviews.map((review) => {
        const displayName = review.scope === "organization" ? review.organization_name || "N3XRA organization" : review.reviewer_name;
        const attribution = review.scope === "organization" ? `Official organization review · submitted by ${review.reviewer_name}` : "Personal customer review";
        return `<article class="public-review-card${review.is_featured ? " is-featured" : ""}">
      <div class="public-review-card-top"><span class="review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>${review.is_featured ? '<span class="public-review-featured">Featured</span>' : ""}</div>
      <blockquote>${escapeHtml(review.review_text)}</blockquote>
      <footer><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(review.subject_name)} · ${escapeHtml(attribution)}</span></footer>
    </article>`;
    }).join("");
    statusElement.textContent = `${reviews.length} verified review${reviews.length === 1 ? "" : "s"}`;
}
async function start() {
    if (!grid || !statusElement)
        return;
    const config = window.RECORDS_APP_CONFIG || {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
        grid.innerHTML = '<div class="public-reviews-empty"><strong>Reviews are temporarily unavailable.</strong><p>Please check back shortly.</p></div>';
        statusElement.textContent = "Reviews are temporarily unavailable.";
        return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/list_published_platform_reviews`, {
            method: "POST",
            headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ input_subject_key: null, input_limit: 60 }),
            signal: controller.signal,
        });
        if (!response.ok)
            throw new Error(`Review request failed with ${response.status}`);
        render((await response.json()));
    }
    catch {
        grid.innerHTML = '<div class="public-reviews-empty"><strong>Reviews are temporarily unavailable.</strong><p>Please check back shortly.</p></div>';
        statusElement.textContent = "";
    }
    finally {
        window.clearTimeout(timeoutId);
    }
}
void start();
export {};
