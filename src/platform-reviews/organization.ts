import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

type Subject = { subject_key: string; name: string; organization_reviews_enabled: boolean };
type Review = { id: string; subject_key: string; rating: number; review_text: string; status: string; moderation_note: string | null; updated_at: string };
type Organization = { id: string; name: string; owner_user_id: string };

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Organization review control is missing: ${id}`);
  return found as T;
};
const escapeHtml = (value: unknown): string => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const statusLabel = (value: string): string => ({ pending: "Pending review", changes_requested: "Changes requested", published: "Published", hidden: "Hidden", rejected: "Not approved" }[value] || "Draft");

const supabase = createBrowserSupabase();
let session: any;
let organization: Organization;
let subjects: Subject[] = [];
let reviews: Review[] = [];

function selectedReview(): Review | null {
  const key = element<HTMLSelectElement>("organization-review-subject").value;
  return reviews.find((review) => review.subject_key === key) || null;
}

function renderEditor(): void {
  const review = selectedReview();
  element<HTMLSelectElement>("organization-review-rating").value = String(review?.rating || 5);
  element<HTMLTextAreaElement>("organization-review-text").value = review?.review_text || "";
  element("organization-review-title").textContent = review ? `Edit ${subjects.find((subject) => subject.subject_key === review.subject_key)?.name || "review"}` : "Write a review";
  const pill = element("organization-review-status-pill");
  pill.textContent = review ? statusLabel(review.status) : "Draft";
  review ? pill.dataset.status = review.status : delete pill.dataset.status;
  element<HTMLButtonElement>("organization-review-delete").hidden = !review;
  const note = element("organization-moderation-note");
  note.hidden = !review?.moderation_note;
  note.innerHTML = review?.moderation_note ? `<strong>Review note</strong><br>${escapeHtml(review.moderation_note)}` : "";
  element("organization-review-message").textContent = "";
}

function renderList(): void {
  element("organization-review-count").textContent = `${reviews.length} review${reviews.length === 1 ? "" : "s"}`;
  element("organization-review-list").innerHTML = reviews.length ? reviews.map((review) => `<article class="review-card${review === selectedReview() ? " is-selected" : ""}"><div class="review-card-head"><div><strong>${escapeHtml(subjects.find((subject) => subject.subject_key === review.subject_key)?.name || review.subject_key)}</strong><small>${escapeHtml(organization.name)}</small></div><span class="review-status-pill" data-status="${escapeHtml(review.status)}">${escapeHtml(statusLabel(review.status))}</span></div><span class="review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><p>${escapeHtml(review.review_text)}</p><button type="button" data-edit-review="${escapeHtml(review.id)}">Edit review</button></article>`).join("") : '<div class="review-list-empty"><strong>No organization reviews yet</strong><p>Choose a subject and write the first official review.</p></div>';
}

async function loadReviews(): Promise<void> {
  const { data, error } = await supabase.from("platform_reviews").select("*").eq("scope", "organization").eq("organization_id", organization.id).order("updated_at", { ascending: false });
  if (error) throw error;
  reviews = data || [];
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const current = selectedReview();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  element("organization-review-message").textContent = "Submitting for moderation…";
  const payload = { scope: "organization", subject_key: element<HTMLSelectElement>("organization-review-subject").value, author_user_id: session.user.id, organization_id: organization.id, rating: Number(element<HTMLSelectElement>("organization-review-rating").value), review_text: element<HTMLTextAreaElement>("organization-review-text").value.trim(), reviewer_name_snapshot: "Organization administrator", organization_name_snapshot: organization.name, status: "pending" };
  const result = current ? await supabase.from("platform_reviews").update(payload).eq("id", current.id) : await supabase.from("platform_reviews").insert(payload);
  if (submit) submit.disabled = false;
  if (result.error) { element("organization-review-message").textContent = result.error.message; return; }
  await loadReviews(); renderEditor(); renderList();
  element("organization-review-message").textContent = "Submitted for review.";
}

async function remove(): Promise<void> {
  const current = selectedReview();
  if (!current || !window.confirm("Delete this review? This cannot be undone.")) return;
  const { error } = await supabase.from("platform_reviews").delete().eq("id", current.id);
  if (error) { element("organization-review-message").textContent = error.message; return; }
  await loadReviews(); renderEditor(); renderList();
}

async function init(): Promise<void> {
  if (!hasConfig() || !supabase) throw new Error("Organization reviews are temporarily unavailable.");
  session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace("/client-portal/login/"); return; }
  const organizationId = new URLSearchParams(window.location.search).get("organization") || "";
  if (!organizationId) throw new Error("Choose an organization from Organization Admin first.");
  const [organizationResult, membershipResult, subjectResult] = await Promise.all([
    supabase.from("organizations").select("id,name,owner_user_id").eq("id", organizationId).maybeSingle(),
    supabase.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("user_id", session.user.id).eq("role", "account_admin").maybeSingle(),
    supabase.from("platform_review_subjects").select("subject_key,name,organization_reviews_enabled").eq("is_active", true).eq("organization_reviews_enabled", true).order("sort_order"),
  ]);
  if (organizationResult.error || membershipResult.error || subjectResult.error) throw organizationResult.error || membershipResult.error || subjectResult.error;
  organization = organizationResult.data;
  if (!organization || (organization.owner_user_id !== session.user.id && membershipResult.data?.role !== "account_admin")) throw new Error("Only organization owners and administrators can manage official reviews.");
  subjects = subjectResult.data || [];
  element("organization-review-heading").textContent = `${organization.name} reviews`;
  element<HTMLSelectElement>("organization-review-subject").innerHTML = subjects.map((subject) => `<option value="${escapeHtml(subject.subject_key)}">${escapeHtml(subject.name)}</option>`).join("");
  await loadReviews();
  element("organization-review-subject").addEventListener("change", () => { renderEditor(); renderList(); });
  element<HTMLFormElement>("organization-review-form").addEventListener("submit", (event) => void save(event));
  element("organization-review-delete").addEventListener("click", () => void remove());
  element("organization-review-list").addEventListener("click", (event) => { const id = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-edit-review]")?.dataset.editReview; const review = reviews.find((item) => item.id === id); if (review) { element<HTMLSelectElement>("organization-review-subject").value = review.subject_key; renderEditor(); renderList(); } });
  renderEditor(); renderList();
  document.body.classList.remove("portal-loading"); element("reviews-loading").hidden = true;
}

void init().catch((error: unknown) => { document.body.classList.remove("portal-loading"); element("reviews-loading").textContent = error instanceof Error ? error.message : "Organization reviews could not be opened."; });
