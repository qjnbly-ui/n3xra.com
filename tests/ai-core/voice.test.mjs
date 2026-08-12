import assert from "node:assert/strict";
import test from "node:test";

const voiceModuleUrl = new URL("../../assets/site-assistant/voice.mjs", import.meta.url);

test("voice module chooses a supported efficient recording format", async () => {
  const { chooseRecordingMimeType } = await import(voiceModuleUrl.href);
  assert.equal(chooseRecordingMimeType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(chooseRecordingMimeType(() => false), "");
});

test("spoken answers remove markdown, links, URLs, and code fences", async () => {
  const { prepareSpeechText } = await import(voiceModuleUrl.href);
  const result = prepareSpeechText("## **Answer**\n[Open Records](/records/) https://example.com\n```js\nsecret()\n```");
  assert.equal(result, "Answer Open Records");
});
