import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPath = new URL("../../n3xra-records/lib/desktop-shell.js", import.meta.url);
const stylesPath = new URL("../../n3xra-records/styles.css", import.meta.url);

test("Ask Records AI exposes voice input and answer playback controls", async () => {
  const shell = await readFile(shellPath, "utf8");

  assert.match(shell, /data-records-ai-voice/);
  assert.match(shell, /Talk to Records AI/);
  assert.match(shell, /data-records-ai-listen/);
  assert.match(shell, /data-records-ai-stop-audio/);
  assert.match(shell, /data-records-ai-guide-voice/);
});

test("Records AI actions demonstrate the navigation path before the destination", async () => {
  const shell = await readFile(new URL("../../n3xra-records/lib/desktop-shell.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../../n3xra-records/styles.css", import.meta.url), "utf8");

  assert.match(shell, /Open Manage library/);
  assert.match(shell, /Then, choose \$\{selectionLabel\}/);
  assert.match(shell, /First selection/);
  assert.match(shell, /You’re here/);
  assert.match(shell, /activationSelector: "#search-mode-ai"/);
  assert.match(shell, /playRecordsAiGuidePlan/);
  assert.match(shell, /findRecordsAiGuideTarget/);
  assert.match(shell, /safelyRevealRecordsAiGuideTarget/);
  assert.match(shell, /RECORDS_AI_GUIDE_ROUTES/);
  assert.match(shell, /narrateRecordsAiGuide\(instruction\)/);
  assert.match(shell, /You’ve reached \$\{getRecordsAiSpokenDestination\(action\)\}/);
  assert.doesNotMatch(shell, /You’re here\. \$\{action\.label\}/);
  assert.doesNotMatch(shell, /narrateRecordsAiGuide\(`Opening/);
  assert.match(shell, /n3xra-records-guide-voice/);
  assert.match(shell, /fallbackRecordsAiGuideSpeech/);
  assert.match(styles, /\.records-ai-guide-note/);
});

test("voice input records, transcribes, and submits the spoken question", async () => {
  const shell = await readFile(shellPath, "utf8");

  assert.match(shell, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(shell, /new MediaRecorder/);
  assert.match(shell, /\/api\/elevenlabs-speech-to-text/);
  assert.match(shell, /recordsAiVoiceSubmission = true/);
  assert.match(shell, /input\?\.form\?\.requestSubmit\(\)/);
});

test("voice input protects short recordings from automatic screen sleep", async () => {
  const shell = await readFile(shellPath, "utf8");

  assert.match(shell, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(shell, /document\.addEventListener\("visibilitychange"/);
  assert.match(shell, /recordsAiMediaRecorder\.requestData\(\)/);
  assert.match(shell, /releaseRecordsAiWakeLock\(\)/);
});

test("spoken questions automatically receive spoken answers", async () => {
  const shell = await readFile(shellPath, "utf8");

  assert.match(shell, /\/api\/elevenlabs-text-to-speech/);
  assert.match(shell, /if \(shouldSpeak\) void speakRecordsAiAnswer\(answer\)/);
  assert.match(shell, /URL\.revokeObjectURL/);
});

test("voice controls have responsive and reduced-motion styling", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.records-ai-voice-controls/);
  assert.match(styles, /@keyframes records-ai-voice-pulse/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
