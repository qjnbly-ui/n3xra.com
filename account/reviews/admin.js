let supabase;
let escapeHtml;
let formatDate;
let setStatus;
let confirmAdminAction;
let reviews = [];
let subjects = new Map();
let selectedReviewId = "";
const element = (id) => {
    const found = document.getElementById(id);
    if (!found)
        throw new Error(`Customer Reviews control is missing: ${id}`);
    return found;
};
const statusLabel = (status) => ({ pending: "Awaiting review", changes_requested: "Changes requested", published: "Published", hidden: "Hidden", rejected: "Not approved" }[status] || status);
const scopeLabel = (scope) => scope === "organization" ? "Official organization review" : "Personal review";
const reviewerLabel = (review) => review.scope === "organization" ? review.organization_name_snapshot || "Organization" : review.reviewer_name_snapshot || "Customer";
const subjectLabel = (review) => subjects.get(review.subject_key)?.name || String(review.subject_key || "").replaceAll("_", " ");
function filteredReviews() {
    const query = element("reviews-admin-search").value.trim().toLowerCase();
    const status = element("reviews-admin-status-filter").value;
    const scope = element("reviews-admin-scope-filter").value;
    return reviews.filter((review) => {
        if (status !== "all" && review.status !== status)
            return false;
        if (scope !== "all" && review.scope !== scope)
            return false;
        return !query || [review.reviewer_name_snapshot, review.organization_name_snapshot, review.review_text, subjectLabel(review), statusLabel(review.status)].join(" ").toLowerCase().includes(query);
    });
}
function renderMetrics() {
    element("reviews-pending-count").textContent = String(reviews.filter((review) => review.status === "pending").length);
    element("reviews-published-count").textContent = String(reviews.filter((review) => review.status === "published").length);
    element("reviews-personal-count").textContent = String(reviews.filter((review) => review.scope === "personal").length);
    element("reviews-organization-count").textContent = String(reviews.filter((review) => review.scope === "organization").length);
}
function renderList() {
    const rows = filteredReviews();
    element("reviews-admin-list").innerHTML = rows.length ? rows.map((review) => `<button class="reviews-admin-row${review.id === selectedReviewId ? " is-selected" : ""}" type="button" data-review-id="${escapeHtml(review.id)}"><span class="reviews-admin-row-main"><strong>${escapeHtml(reviewerLabel(review))}</strong><small>${escapeHtml(subjectLabel(review))} · ${escapeHtml(scopeLabel(review.scope))}</small></span><span class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${"★".repeat(Number(review.rating))}${"☆".repeat(5 - Number(review.rating))}</span><span class="review-status-pill" data-status="${escapeHtml(review.status)}">${escapeHtml(statusLabel(review.status))}</span></button>`).join("") : '<div class="review-list-empty"><strong>No reviews match this view</strong><p>Try another status, ownership type, or search.</p></div>';
    setStatus(`${rows.length} review${rows.length === 1 ? "" : "s"} shown.`);
}
function renderDetail() {
    const review = reviews.find((item) => item.id === selectedReviewId);
    const detail = element("reviews-admin-detail");
    if (!review) {
        detail.innerHTML = '<div class="review-list-empty"><strong>Select a review</strong><p>Choose a submission to read it and make a moderation decision.</p></div>';
        return;
    }
    detail.innerHTML = `<div class="reviews-admin-detail-head"><div><p class="portal-kicker">${escapeHtml(scopeLabel(review.scope))}</p><h2>${escapeHtml(reviewerLabel(review))}</h2><span>${escapeHtml(subjectLabel(review))} · submitted by ${escapeHtml(review.reviewer_name_snapshot || "Customer")} · ${escapeHtml(formatDate(review.created_at))}</span></div><span class="review-status-pill" data-status="${escapeHtml(review.status)}">${escapeHtml(statusLabel(review.status))}</span></div><div class="reviews-admin-rating"><span class="review-stars">${"★".repeat(Number(review.rating))}${"☆".repeat(5 - Number(review.rating))}</span><strong>${Number(review.rating)} out of 5</strong></div><blockquote>${escapeHtml(review.review_text)}</blockquote><label class="reviews-admin-note"><span>Review note for the customer</span><textarea id="reviews-admin-note" rows="4" maxlength="2000" placeholder="Explain requested changes or leave a note the customer can see.">${escapeHtml(review.moderation_note || "")}</textarea></label><div class="reviews-admin-actions"><button class="portal-button" type="button" data-review-status="published">Publish</button>${review.status === "published" ? `<button class="portal-button portal-button-secondary" type="button" data-review-featured="${review.is_featured ? "false" : "true"}">${review.is_featured ? "Remove from featured" : "Feature publicly"}</button>` : ""}<button class="portal-button portal-button-secondary" type="button" data-review-status="changes_requested">Request changes</button><button class="portal-button portal-button-secondary" type="button" data-review-status="hidden">Hide</button><button class="reviews-admin-reject" type="button" data-review-status="rejected">Do not approve</button></div><p class="reviews-message" id="reviews-admin-detail-status" role="status"></p>`;
}
function render() { renderMetrics(); renderList(); renderDetail(); }
async function loadReviews() {
    setStatus("Loading customer reviews…");
    const [subjectResult, reviewResult] = await Promise.all([supabase.from("platform_review_subjects").select("*").order("sort_order"), supabase.from("platform_reviews").select("*").order("created_at", { ascending: false })]);
    if (subjectResult.error || reviewResult.error)
        throw subjectResult.error || reviewResult.error;
    subjects = new Map((subjectResult.data || []).map((subject) => [subject.subject_key, subject]));
    reviews = reviewResult.data || [];
    if (selectedReviewId && !reviews.some((review) => review.id === selectedReviewId))
        selectedReviewId = "";
    render();
}
async function moderate(status) {
    const review = reviews.find((item) => item.id === selectedReviewId);
    if (!review)
        return;
    const note = element("reviews-admin-note").value.trim();
    if (status === "changes_requested" && note.length < 3) {
        element("reviews-admin-detail-status").textContent = "Add a short note explaining what should change.";
        return;
    }
    const action = status === "published" ? "Publish" : status === "hidden" ? "Hide" : status === "rejected" ? "Decline" : "Return";
    const confirmed = await confirmAdminAction(`${action} this ${review.scope} review?`, { confirmLabel: status === "published" ? "Publish review" : "Confirm decision" });
    if (!confirmed)
        return;
    element("reviews-admin-detail-status").textContent = "Saving moderation decision…";
    const { error } = await supabase.from("platform_reviews").update({ status, moderation_note: note || null }).eq("id", review.id);
    if (error) {
        element("reviews-admin-detail-status").textContent = error.message;
        return;
    }
    await loadReviews();
    setStatus(status === "published" ? "Review published." : "Moderation decision saved.", "success");
}
async function setFeatured(isFeatured) {
    const review = reviews.find((item) => item.id === selectedReviewId);
    if (!review || review.status !== "published")
        return;
    const confirmed = await confirmAdminAction(`${isFeatured ? "Feature" : "Remove"} this review ${isFeatured ? "on" : "from"} the public reviews page?`, { confirmLabel: isFeatured ? "Feature review" : "Remove feature" });
    if (!confirmed)
        return;
    element("reviews-admin-detail-status").textContent = "Updating public feature status…";
    const { error } = await supabase.from("platform_reviews").update({ is_featured: isFeatured }).eq("id", review.id);
    if (error) {
        element("reviews-admin-detail-status").textContent = error.message;
        return;
    }
    await loadReviews();
    setStatus(isFeatured ? "Review is now featured publicly." : "Review removed from featured placement.", "success");
}
function bindEvents() {
    element("reviews-admin-search").addEventListener("input", renderList);
    element("reviews-admin-status-filter").addEventListener("change", renderList);
    element("reviews-admin-scope-filter").addEventListener("change", renderList);
    element("reviews-admin-refresh").addEventListener("click", () => void loadReviews());
    element("reviews-admin-list").addEventListener("click", (event) => { const row = event.target.closest("[data-review-id]"); if (!row)
        return; selectedReviewId = row.dataset.reviewId || ""; renderList(); renderDetail(); });
    element("reviews-admin-detail").addEventListener("click", (event) => {
        const target = event.target;
        const statusButton = target.closest("[data-review-status]");
        if (statusButton?.dataset.reviewStatus) {
            void moderate(statusButton.dataset.reviewStatus);
            return;
        }
        const featuredButton = target.closest("[data-review-featured]");
        if (featuredButton?.dataset.reviewFeatured)
            void setFeatured(featuredButton.dataset.reviewFeatured === "true");
    });
}
export async function startReviews(context) {
    supabase = context.supabase;
    escapeHtml = context.escapeHtml;
    formatDate = context.formatDate;
    setStatus = context.setStatus;
    confirmAdminAction = context.confirmAdminAction;
    bindEvents();
    await loadReviews();
}
