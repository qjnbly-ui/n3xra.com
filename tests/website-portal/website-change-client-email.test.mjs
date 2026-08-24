import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildWebsiteChangeEmail, sendWebsiteChangeClientEmail } = require("../../api/_website-change-client-email.js");

test("preview-ready email clearly says the change is not live", () => {
  const email = buildWebsiteChangeEmail({
    stage: "preview_ready",
    requesterName: "Quentin Nichols",
    websiteName: "RORC",
    requestSubject: "Change the membership button",
    actionUrl: "https://rorc-preview.vercel.app/",
  });
  assert.equal(email.subject, "Your RORC preview is ready");
  assert.match(email.text, /Nothing has been published to the live website yet\./);
  assert.match(email.html, /Review private preview/);
  assert.match(email.html, /https:\/\/rorc-preview\.vercel\.app\//);
});

test("published email confirms the approved change is live", () => {
  const email = buildWebsiteChangeEmail({
    stage: "published",
    requesterName: "Quentin Nichols",
    websiteName: "RORC",
    requestSubject: "Change the membership button",
    actionUrl: "https://ruthobenchainrc.com/",
  });
  assert.equal(email.subject, "Your RORC update is live");
  assert.match(email.text, /Vercel finished the production deployment successfully/);
  assert.match(email.html, /Open live website/);
});

test("email delivery uses a stable per-run idempotency key", async () => {
  let request;
  const result = await sendWebsiteChangeClientEmail({
    stage: "preview_ready",
    runId: "11111111-1111-4111-8111-111111111111",
    requesterEmail: "client@example.com",
    websiteName: "RORC",
    actionUrl: "https://rorc-preview.vercel.app/",
  }, {
    apiKey: "test-key",
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: "email-1" }) };
    },
  });
  assert.equal(result.id, "email-1");
  assert.equal(request.options.headers["Idempotency-Key"], "website-change/11111111-1111-4111-8111-111111111111/preview_ready");
  assert.deepEqual(JSON.parse(request.options.body).to, ["client@example.com"]);
});

test("email delivery rejects an invalid client address", async () => {
  await assert.rejects(() => sendWebsiteChangeClientEmail({
    stage: "preview_ready",
    runId: "run-1",
    requesterEmail: "not-an-email",
  }, { apiKey: "test-key", fetch: async () => { throw new Error("should not fetch"); } }), /valid client email address/);
});
