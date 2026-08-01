import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPath = new URL("../../n3xra-records/lib/desktop-shell.js", import.meta.url);
const stylesPath = new URL("../../n3xra-records/styles.css", import.meta.url);
const voiceApiPath = new URL("../../api/elevenlabs-text-to-speech.js", import.meta.url);

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
  assert.match(shell, /hasPriorSelection \? "Then" : "First"/);
  assert.match(shell, /hasPriorSelection \? "Next selection" : "First selection"/);
  assert.match(shell, /First selection/);
  assert.match(shell, /You’re here/);
  assert.match(shell, /activationSelector: "#search-mode-ai"/);
  assert.match(shell, /playRecordsAiGuidePlan/);
  assert.match(shell, /findRecordsAiGuideTarget/);
  assert.match(shell, /getRecordsAiGuideCandidates/);
  assert.match(shell, /getRecordsAiGuideCommonTarget/);
  assert.match(shell, /getRecordsAiGuideHighlightTarget/);
  assert.match(shell, /getRecordsAiGuideReadableText/);
  assert.match(shell, /\[aria-hidden='true'\], script, style/);
  assert.match(shell, /clone\.textContent/);
  assert.match(shell, /document\.getElementById\(target\.htmlFor\)/);
  assert.match(shell, /getRecordsAiGuideHiddenContainer/);
  assert.match(shell, /getRecordsAiGuideRevealControl/);
  assert.match(shell, /revealRecordsAiGuideTarget/);
  assert.match(shell, /waitForRecordsAiGuidePageReady/);
  assert.match(shell, /new MutationObserver\(scheduleQuietCheck\)/);
  assert.match(shell, /document\.readyState === "complete"/);
  assert.match(shell, /maxWaitMs = 15000, quietMs = 650/);
  assert.match(shell, /resolveRecordsAiGuideTarget/);
  assert.match(shell, /const target = await resolveRecordsAiGuideTarget\(step\.target\)/);
  assert.match(shell, /Date\.now\(\) < deadline/);
  assert.doesNotMatch(shell, /attempt < 24 && !target/);
  assert.match(shell, /document\.querySelectorAll\("\[aria-controls\]"\)/);
  assert.doesNotMatch(shell, /prepareRecordsAiGuideWorkspace/);
  assert.match(shell, /safelyRevealRecordsAiGuideTarget/);
  assert.match(shell, /canRecordsAiSafelyRevealGuideTarget/);
  assert.match(shell, /button\[type='button'\]/);
  assert.match(shell, /!\/\\b\(\?:delete\|remove\|revoke/);
  assert.match(shell, /button, a, summary, label/);
  assert.match(shell, /target\.matches\("summary"\)/);
  assert.match(shell, /RECORDS_AI_GUIDE_ROUTES/);
  assert.match(shell, /narrateRecordsAiGuide\(instruction\)/);
  assert.match(shell, /You’ve reached \$\{getRecordsAiSpokenDestination\(action\)\}/);
  assert.doesNotMatch(shell, /You’re here\. \$\{action\.label\}/);
  assert.doesNotMatch(shell, /narrateRecordsAiGuide\(`Opening/);
  assert.match(shell, /n3xra-records-guide-voice/);
  assert.match(shell, /getRecordsAiGuideContentSteps/);
  assert.match(shell, /RECORDS_AI_ACCOUNT_NAVIGATION_LABELS/);
  assert.match(shell, /spotlightRecordsAiGuideDestination/);
  assert.match(shell, /RECORDS_AI_PENDING_ACTION_KEY/);
  assert.match(shell, /recordsAiActionGuidance/);
  assert.match(shell, /guidanceMode: action\?\.guidanceMode === "task" \? "task"/);
  assert.match(shell, /arrivalNarration/);
  assert.match(shell, /What to do here/);
  assert.match(shell, /RECORDS_AI_ROUTE_NAVIGATION_LABELS/);
  assert.match(shell, /attempt < 2/);
  assert.match(shell, /getRecordsAiGuideSpeechTimeoutMs/);
  assert.match(shell, /Guide audio timed out/);
  assert.doesNotMatch(shell, /guideLeadIn/);
  assert.match(shell, /canplaythrough/);
  assert.match(shell, /HAVE_FUTURE_DATA/);
  assert.match(shell, /Math\.min\(45000, Math\.max\(15000/);
  assert.match(shell, /new Promise\(\(resolve\) => window\.setTimeout\(resolve, 4200\)\)/);
  assert.doesNotMatch(shell, /fallbackRecordsAiGuideSpeech/);
  assert.doesNotMatch(shell, /SpeechSynthesisUtterance/);
  assert.match(styles, /\.records-ai-guide-note/);
  assert.match(styles, /outline: 4px solid #078779/);
  assert.match(styles, /outline-offset: -4px/);
  assert.doesNotMatch(styles, /inset 0 0 0 4px #087f72/);
  assert.doesNotMatch(shell, /recordsAiHighlightFrame/);
  assert.doesNotMatch(styles, /\.records-ai-highlight-frame/);
});

test("guide narration starts with the meaningful sentence without an artificial hesitation", async () => {
  const voiceApi = await readFile(voiceApiPath, "utf8");

  assert.doesNotMatch(voiceApi, /guideLeadIn/);
  assert.match(voiceApi, /text,\n\s+model_id/);
});

test("the generic guide engine can discover reveal relationships across Records pages", async () => {
  const meetingNotes = await readFile(new URL("../../n3xra-records/meeting-notes/index.html", import.meta.url), "utf8");
  const account = await readFile(new URL("../../n3xra-records/account/index.html", import.meta.url), "utf8");

  assert.match(meetingNotes, /id="record-panel-toggle"[^>]+aria-controls="record-panel-body"/);
  assert.match(meetingNotes, /id="record-panel-body"/);
  assert.match(account, /role="tab"[^>]+aria-controls="admin-contacts-panel"/);
  assert.match(account, /<details class="settings-subsection admin-disclosure"/);
  assert.match(account, /<summary class="admin-disclosure-summary">/);
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
