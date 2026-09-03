import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const element = (id) => {
    const found = document.getElementById(id);
    if (!found)
        throw new Error(`Review control is missing: ${id}`);
    return found;
};
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const statusLabel = (value) => ({ pending: "Pending review", changes_requested: "Changes requested", published: "Published", hidden: "Hidden", rejected: "Not approved" }[value] || "Draft");
const supabase = createBrowserSupabase();
let session;
let subjects = [];
let reviews = [];
function selectedReview() {
    const key = element("personal-review-subject").value;
    return reviews.find((review) => review.subject_key === key) || null;
}
function subjectName(key) {
    return subjects.find((subject) => subject.subject_key === key)?.name || key.replaceAll("_", " ");
}
function setMessage(copy = "", tone = "") {
    const message = element("personal-review-message");
    message.textContent = copy;
    message.className = `reviews-message${tone ? ` is-${tone}` : ""}`;
}
function renderEditor() {
    const review = selectedReview();
    element("personal-review-rating").value = String(review?.rating || 5);
    element("personal-review-text").value = review?.review_text || "";
    element("personal-review-title").textContent = review ? `Edit ${subjectName(review.subject_key)}` : "Write a review";
    const pill = element("personal-review-status-pill");
    pill.textContent = review ? statusLabel(review.status) : "Draft";
    review ? pill.dataset.status = review.status : delete pill.dataset.status;
    element("personal-review-delete").hidden = !review;
    const note = element("personal-moderation-note");
    note.hidden = !review?.moderation_note;
    note.innerHTML = review?.moderation_note ? `<strong>Review note</strong><br>${escapeHtml(review.moderation_note)}` : "";
    setMessage();
}
function renderList() {
    element("personal-review-count").textContent = `${reviews.length} review${reviews.length === 1 ? "" : "s"}`;
    element("personal-review-list").innerHTML = reviews.length ? reviews.map((review) => `<article class="review-card${review === selectedReview() ? " is-selected" : ""}"><div class="review-card-head"><div><strong>${escapeHtml(subjectName(review.subject_key))}</strong><small>Updated ${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(review.updated_at)))}</small></div><span class="review-status-pill" data-status="${escapeHtml(review.status)}">${escapeHtml(statusLabel(review.status))}</span></div><span class="review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><p>${escapeHtml(review.review_text)}</p><button type="button" data-edit-review="${escapeHtml(review.id)}">Edit review</button></article>`).join("") : '<div class="review-list-empty"><strong>No reviews yet</strong><p>Choose a subject and write your first review.</p></div>';
}
async function loadReviews() {
    const { data, error } = await supabase.from("platform_reviews").select("*").eq("scope", "personal").order("updated_at", { ascending: false });
    if (error)
        throw error;
    reviews = data || [];
}
async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity())
        return;
    const current = selectedReview();
    const submit = form.querySelector('button[type="submit"]');
    if (submit)
        submit.disabled = true;
    setMessage(current?.status === "published" ? "Saving changes and returning this review to moderation…" : "Submitting for moderation…");
    const payload = { scope: "personal", subject_key: element("personal-review-subject").value, author_user_id: session.user.id, organization_id: null, rating: Number(element("personal-review-rating").value), review_text: element("personal-review-text").value.trim(), reviewer_name_snapshot: "N3XRA customer", organization_name_snapshot: null, status: "pending" };
    const result = current ? await supabase.from("platform_reviews").update(payload).eq("id", current.id) : await supabase.from("platform_reviews").insert(payload);
    if (submit)
        submit.disabled = false;
    if (result.error) {
        setMessage(result.error.message, "error");
        return;
    }
    await loadReviews();
    renderEditor();
    renderList();
    setMessage("Submitted. N3XRA will review it before it is published.", "success");
}
async function remove() {
    const current = selectedReview();
    if (!current || !window.confirm("Delete this review? This cannot be undone."))
        return;
    const { error } = await supabase.from("platform_reviews").delete().eq("id", current.id);
    if (error) {
        setMessage(error.message, "error");
        return;
    }
    await loadReviews();
    renderEditor();
    renderList();
    setMessage("Review deleted.", "success");
}
async function init() {
    if (!hasConfig() || !supabase)
        throw new Error("Reviews are temporarily unavailable.");
    session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace("/account/?next=%2Faccount%2Freviews%2F");
        return;
    }
    const subjectResult = await supabase.from("platform_review_subjects").select("subject_key,name,personal_reviews_enabled").eq("is_active", true).eq("personal_reviews_enabled", true).order("sort_order");
    if (subjectResult.error)
        throw subjectResult.error;
    subjects = subjectResult.data || [];
    element("personal-review-subject").innerHTML = subjects.map((subject) => `<option value="${escapeHtml(subject.subject_key)}">${escapeHtml(subject.name)}</option>`).join("");
    await loadReviews();
    element("personal-review-subject").addEventListener("change", () => { renderEditor(); renderList(); });
    element("personal-review-form").addEventListener("submit", (event) => void save(event));
    element("personal-review-delete").addEventListener("click", () => void remove());
    element("personal-review-list").addEventListener("click", (event) => { const id = event.target.closest("[data-edit-review]")?.dataset.editReview; const review = reviews.find((item) => item.id === id); if (review) {
        element("personal-review-subject").value = review.subject_key;
        renderEditor();
        renderList();
    } });
    element("reviews-sign-out").addEventListener("click", () => void supabase.auth.signOut({ scope: "local" }).then(() => window.location.replace("/account/")));
    renderEditor();
    renderList();
    document.body.classList.remove("reviews-loading-state");
    element("reviews-loading").hidden = true;
}
void init().catch((error) => { document.body.classList.remove("reviews-loading-state"); element("reviews-loading").textContent = error instanceof Error ? error.message : "Reviews could not be opened."; });
