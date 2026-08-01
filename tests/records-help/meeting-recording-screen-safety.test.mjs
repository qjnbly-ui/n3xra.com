import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const meetingNotesPath = new URL("../../n3xra-records/meeting-notes/index.html", import.meta.url);

test("meeting recording keeps supported device screens awake", async () => {
  const recordings = await readFile(recordingsPath, "utf8");

  assert.match(recordings, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(recordings, /releaseRecordingWakeLock\(\)/);
  assert.match(recordings, /document\.addEventListener\("visibilitychange"/);
});

test("meeting recording flushes audio and preserves an interrupted capture", async () => {
  const recordings = await readFile(recordingsPath, "utf8");

  assert.match(recordings, /mediaRecorder\.requestData\(\)/);
  assert.match(recordings, /track\.addEventListener\("ended", handleUnexpectedRecordingEnd\)/);
  assert.match(recordings, /Preserving the audio recorded so far/);
  assert.match(recordings, /window\.addEventListener\("pagehide", flushActiveRecordingChunk\)/);
});

test("meeting notes explains screen-lock recording safety", async () => {
  const meetingNotes = await readFile(meetingNotesPath, "utf8");

  assert.match(meetingNotes, /id="recording-screen-safety"/);
  assert.match(meetingNotes, /screen will be kept awake automatically/i);
});
