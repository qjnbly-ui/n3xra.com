export function getSuggestionText(item) {
  return String(item?.text || item?.note || item?.issue || "").trim();
}

export function getSuggestionStatus(item) {
  return String(item?.status || "").trim().toLowerCase();
}

export function isSuggestionResolved(item) {
  return ["applied", "dismissed"].includes(getSuggestionStatus(item));
}

export function getOpenSuggestionIndexes(review) {
  return (Array.isArray(review?.suggested_additions) ? review.suggested_additions : [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => getSuggestionText(item) && !isSuggestionResolved(item))
    .map(({ index }) => index);
}

function cloneReview(review) {
  return JSON.parse(JSON.stringify(review && typeof review === "object" ? review : {}));
}

function getTargetDocumentId(recording) {
  return recording?.final_document_id || recording?.ai_draft_document_id || "";
}

async function saveReviewJson(supabase, recordingId, review) {
  const { error } = await supabase
    .from("meeting_recordings")
    .update({
      ai_review_json: review,
      ai_reviewed_at: new Date().toISOString(),
    })
    .eq("id", recordingId);
  if (error) throw error;
}

function markSuggestions(review, indexes, status) {
  const nextReview = cloneReview(review);
  const items = Array.isArray(nextReview.suggested_additions) ? nextReview.suggested_additions : [];
  const now = new Date().toISOString();
  indexes.forEach((index) => {
    if (!items[index]) return;
    items[index] = {
      ...items[index],
      status,
      resolved_at: now,
    };
    if (status === "applied") items[index].applied_at = now;
    if (status === "dismissed") items[index].dismissed_at = now;
  });
  nextReview.suggested_additions = items;
  return nextReview;
}

export async function applyRecordingSuggestions({ supabase, recording, indexes }) {
  const review = recording?.ai_review_json || {};
  const safeIndexes = Array.from(new Set((Array.isArray(indexes) ? indexes : [])
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0)));

  const items = Array.isArray(review?.suggested_additions) ? review.suggested_additions : [];
  const actionableIndexes = safeIndexes.filter((index) => items[index] && getSuggestionText(items[index]) && !isSuggestionResolved(items[index]));
  if (!actionableIndexes.length) return { review, appliedCount: 0, document: null };

  if (!recording?.id) throw new Error("Recording is missing.");
  if (!getTargetDocumentId(recording)) throw new Error("Create an AI draft before applying suggestions.");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || "";
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

  const response = await fetch("/api/finalize-recording-notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recordingId: recording.id,
      acceptedSuggestionIndexes: actionableIndexes,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Unable to apply suggestions.");

  return {
    review: data.review || review,
    appliedCount: Number(data.appliedCount || actionableIndexes.length),
    document: data.draftDocument || null,
    recording: data.recording || null,
    usage: data.usage || null,
  };
}

export async function dismissRecordingSuggestion({ supabase, recording, index }) {
  const review = recording?.ai_review_json || {};
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) return { review };
  const items = Array.isArray(review?.suggested_additions) ? review.suggested_additions : [];
  if (!items[numericIndex] || isSuggestionResolved(items[numericIndex])) return { review };

  const nextReview = markSuggestions(review, [numericIndex], "dismissed");
  await saveReviewJson(supabase, recording.id, nextReview);
  return { review: nextReview };
}

export async function clearRecordingReview({ supabase, recording }) {
  if (!recording?.id) throw new Error("Recording is missing.");

  const nextReview = cloneReview(recording.ai_review_json);
  nextReview.suggested_additions = [];
  nextReview.conflicts = [];
  nextReview.review_cleared_at = new Date().toISOString();

  await saveReviewJson(supabase, recording.id, nextReview);
  return { review: nextReview };
}
