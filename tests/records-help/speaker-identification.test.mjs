import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const speakerIdentification = require("../../api/_records-speaker-identification.js");
const transcriptionPath = new URL("../../api/transcribe-recording.js", import.meta.url);
const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const correctionApiPath = new URL("../../api/correct-recording-speaker.js", import.meta.url);
const migrationPath = new URL(
  "../../supabase/migrations/20260805150308_meeting_speaker_identification.sql",
  import.meta.url,
);

test("timestamped transcript words are assigned to known and unknown speakers", () => {
  const directory = [{ userId: "user-1", displayName: "Quentin Nichols" }];
  const timing = {
    words: [
      { word: "Hello", start: 0.1, end: 0.6 },
      { word: "team.", start: 0.7, end: 1.2 },
      { word: "Thanks", start: 2.2, end: 2.8 },
      { word: "Quentin.", start: 2.9, end: 3.7 },
    ],
  };
  const output = {
    identification: [
      { speaker: "user-1", match: "user-1", diarizationSpeaker: "SPEAKER_00", start: 0, end: 2 },
      { speaker: "SPEAKER_01", match: null, diarizationSpeaker: "SPEAKER_01", start: 2, end: 4 },
    ],
    voiceprints: [
      { speaker: "SPEAKER_00", match: "user-1", confidence: { "user-1": 87 } },
    ],
  };

  const result = speakerIdentification.buildSpeakerTranscript(timing, output, directory);

  assert.match(result.text, /Quentin Nichols \[0:00\]\nHello team\./);
  assert.match(result.text, /Speaker 1 \[0:02\]\nThanks Quentin\./);
  assert.equal(result.utterances[0].userId, "user-1");
  assert.equal(result.utterances[0].confidence, 87);
  assert.equal(result.utterances[1].userId, null);
});

test("the recording pipeline requests Groq timestamps and pyannote identification", async () => {
  const [transcription, recordings] = await Promise.all([
    readFile(transcriptionPath, "utf8"),
    readFile(recordingsPath, "utf8"),
  ]);

  assert.match(transcription, /response_format", "verbose_json"/);
  assert.match(transcription, /timestamp_granularities\[\]", "word"/);
  assert.match(transcription, /identifyRecordingSpeakers/);
  assert.match(recordings, /recording\.speaker_transcript_text \|\| recording\.transcript_text/);
  assert.match(recordings, /\/api\/identify-recording-speakers/);
});

test("meeting identification stores sanitized results separately from biometric profiles", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /speaker_transcript_text text/);
  assert.match(migration, /speaker_identification_json jsonb/);
  assert.match(migration, /Never stores biometric voiceprints/);
  assert.doesNotMatch(migration, /add column[^\n]*voiceprint/i);
});

test("editors can correct a speaker label across the transcript and saved document", async () => {
  const [recordings, correctionApi] = await Promise.all([
    readFile(recordingsPath, "utf8"),
    readFile(correctionApiPath, "utf8"),
  ]);

  assert.match(recordings, /Correct a speaker name|correctRecordingSpeakerName/);
  assert.match(correctionApi, /utterance\.speakerKey === speakerKey/);
  assert.match(correctionApi, /speakerTranscriptFromUtterances/);
  assert.match(correctionApi, /uploadTranscriptDocument/);
});
