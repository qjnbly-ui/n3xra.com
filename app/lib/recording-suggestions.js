const ACCEPTED_ADDITIONS_TITLE = "Accepted additions";

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

function inlineContentFromText(text) {
  const parts = String(text || "").split("\n");
  const content = [];
  parts.forEach((part, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (part) content.push({ type: "text", text: part });
  });
  return content.length ? content : undefined;
}

function paragraphNode(text) {
  const content = inlineContentFromText(text);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

function headingNode(text) {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  };
}

function listItemNode(text) {
  return {
    type: "listItem",
    content: [paragraphNode(text)],
  };
}

function textFromTiptapNode(node, parts = []) {
  if (!node || typeof node !== "object") return parts;
  if (node.type === "text" && node.text) parts.push(node.text);
  if (node.type === "hardBreak") parts.push("\n");
  if (Array.isArray(node.content)) node.content.forEach((child) => textFromTiptapNode(child, parts));
  if (["paragraph", "heading", "listItem", "tableRow"].includes(node.type)) parts.push("\n");
  if (["tableCell", "tableHeader"].includes(node.type)) parts.push("\t");
  return parts;
}

function plainTextFromContentJson(contentJson) {
  return textFromTiptapNode(contentJson || {}, [])
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getInlineText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return Array.isArray(node.content) ? node.content.map(getInlineText).join("") : "";
}

function findAcceptedAdditionsHeadingIndex(content) {
  return content.findIndex((node) => (
    node?.type === "heading" &&
    getInlineText(node).trim().toLowerCase() === ACCEPTED_ADDITIONS_TITLE.toLowerCase()
  ));
}

function appendSuggestionTextsToContentJson(contentJson, suggestionTexts) {
  const texts = suggestionTexts.map((text) => String(text || "").trim()).filter(Boolean);
  const doc = contentJson?.type === "doc" && Array.isArray(contentJson.content)
    ? JSON.parse(JSON.stringify(contentJson))
    : {
        type: "doc",
        content: plainTextFromContentJson(contentJson)
          ? [paragraphNode(plainTextFromContentJson(contentJson))]
          : [{ type: "paragraph" }],
      };

  const headingIndex = findAcceptedAdditionsHeadingIndex(doc.content);
  let listIndex = -1;
  if (headingIndex >= 0) {
    for (let index = headingIndex + 1; index < doc.content.length; index += 1) {
      const node = doc.content[index];
      if (node?.type === "heading") break;
      if (node?.type === "bulletList") {
        listIndex = index;
        break;
      }
    }
  }

  if (headingIndex < 0) {
    doc.content.push(headingNode(ACCEPTED_ADDITIONS_TITLE));
  }

  if (listIndex < 0) {
    const bulletList = {
      type: "bulletList",
      content: [],
    };
    if (headingIndex >= 0) {
      doc.content.splice(headingIndex + 1, 0, bulletList);
      listIndex = headingIndex + 1;
    } else {
      doc.content.push(bulletList);
      listIndex = doc.content.length - 1;
    }
  }

  texts.forEach((text) => {
    doc.content[listIndex].content.push(listItemNode(text));
  });

  return doc;
}

function appendSuggestionTextsToPlainText(existingText, suggestionTexts) {
  const current = String(existingText || "").trim();
  const texts = suggestionTexts.map((text) => String(text || "").trim()).filter(Boolean);
  if (!texts.length) return current;

  const section = [
    ACCEPTED_ADDITIONS_TITLE,
    ...texts.map((text) => `- ${text}`),
  ].join("\n");

  if (!current) return section;
  if (current.toLowerCase().includes(ACCEPTED_ADDITIONS_TITLE.toLowerCase())) {
    return `${current}\n${texts.map((text) => `- ${text}`).join("\n")}`.trim();
  }
  return `${current}\n\n${section}`.trim();
}

function getTargetDocumentId(recording) {
  return recording?.final_document_id || recording?.ai_draft_document_id || "";
}

async function loadDraftDocument(supabase, documentId) {
  const { data, error } = await supabase
    .from("app_documents")
    .select("id, content_json, plain_text")
    .eq("id", documentId)
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("The AI draft document could not be found.");
  return data;
}

async function saveDraftDocument(supabase, document, suggestionTexts) {
  const contentJson = appendSuggestionTextsToContentJson(document.content_json || {}, suggestionTexts);
  const plainText = appendSuggestionTextsToPlainText(document.plain_text || plainTextFromContentJson(document.content_json), suggestionTexts);
  const { error } = await supabase
    .from("app_documents")
    .update({
      content_json: contentJson,
      plain_text: plainText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", document.id);
  if (error) throw error;
  return {
    ...document,
    content_json: contentJson,
    plain_text: plainText,
  };
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

  const documentId = getTargetDocumentId(recording);
  if (!documentId) throw new Error("Create an AI draft before applying suggestions.");

  const document = await loadDraftDocument(supabase, documentId);
  const suggestionTexts = actionableIndexes.map((index) => getSuggestionText(items[index]));
  const updatedDocument = await saveDraftDocument(supabase, document, suggestionTexts);
  const nextReview = markSuggestions(review, actionableIndexes, "applied");
  await saveReviewJson(supabase, recording.id, nextReview);
  return {
    review: nextReview,
    appliedCount: actionableIndexes.length,
    document: updatedDocument,
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
