import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { extractOutputText, openAIFilePart } = require("../../api/website-proposal-ai.js")._test;

test("Responses API structured text is extracted from raw output", () => {
  const text = extractOutputText({
    output: [{ type: "message", content: [{ type: "output_text", text: '{"summary":"ok","operations":[]}' }] }],
  });
  assert.equal(text, '{"summary":"ok","operations":[]}');
});

test("Responses API refusals and incomplete output fail closed", () => {
  assert.throws(() => extractOutputText({
    output: [{ content: [{ type: "refusal", refusal: "Cannot comply" }] }],
  }), /Cannot comply/);
  assert.throws(() => extractOutputText({ incomplete_details: { reason: "max_output_tokens" } }), /could not complete/i);
});

test("selected images and documents use the appropriate Responses API input type", () => {
  const image = openAIFilePart({ filename: "logo.png", mime_type: "image/png", bytes: Buffer.from("image") });
  const document = openAIFilePart({ filename: "brief.pdf", mime_type: "application/pdf", bytes: Buffer.from("pdf") });
  assert.equal(image.type, "input_image");
  assert.match(image.image_url, /^data:image\/png;base64,/);
  assert.equal(document.type, "input_file");
  assert.equal(document.filename, "brief.pdf");
  assert.match(document.file_data, /^data:application\/pdf;base64,/);
});

test("unsupported file types are rejected before an OpenAI request", () => {
  assert.throws(() => openAIFilePart({ filename: "archive.zip", mime_type: "application/zip", bytes: Buffer.from("zip") }), /not a supported/i);
});
