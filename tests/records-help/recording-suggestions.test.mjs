import assert from "node:assert/strict";
import test from "node:test";

import { clearRecordingReview } from "../../n3xra-records/lib/recording-suggestions.js";

test("clearing a review persists empty review lists while preserving its draft", async () => {
  let savedPatch = null;
  const supabase = {
    from(table) {
      assert.equal(table, "meeting_recordings");
      return {
        update(patch) {
          savedPatch = patch;
          return {
            async eq(column, value) {
              assert.equal(column, "id");
              assert.equal(value, "recording-1");
              return { error: null };
            },
          };
        },
      };
    },
  };
  const recording = {
    id: "recording-1",
    ai_review_json: {
      final_document_text: "Saved AI draft",
      suggested_additions: [{ text: "Applied suggestion", status: "applied" }],
      conflicts: [{ text: "Possible conflict" }],
    },
  };

  const result = await clearRecordingReview({ supabase, recording });

  assert.deepEqual(result.review.suggested_additions, []);
  assert.deepEqual(result.review.conflicts, []);
  assert.equal(result.review.final_document_text, "Saved AI draft");
  assert.equal(savedPatch.ai_review_json.final_document_text, "Saved AI draft");
  assert.match(savedPatch.ai_review_json.review_cleared_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(savedPatch.ai_reviewed_at, /^\d{4}-\d{2}-\d{2}T/);
});
