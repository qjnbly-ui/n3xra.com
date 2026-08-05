import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const speakerIdentification = require("../../api/_records-speaker-identification.js");
const transcriptionPath = new URL("../../api/transcribe-recording.js", import.meta.url);
const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const allRecordingsPath = new URL("../../n3xra-records/all-recordings.js", import.meta.url);
const correctionModalPath = new URL("../../n3xra-records/lib/speaker-correction-modal.js", import.meta.url);
const correctionApiPath = new URL("../../api/correct-recording-speaker.js", import.meta.url);
const accountPath = new URL("../../n3xra-records/account/index.html", import.meta.url);
const dashboardPath = new URL("../../n3xra-records/dashboard.js", import.meta.url);
const helpKnowledgePath = new URL("../../api/records-help-knowledge.md", import.meta.url);
const publicKnowledgePath = new URL("../../api/ask-knowledge.md", import.meta.url);
const projectPulseBuilderPath = new URL("../../scripts/build-project-pulse.js", import.meta.url);
const migrationPath = new URL(
  "../../supabase/migrations/20260805150308_meeting_speaker_identification.sql",
  import.meta.url,
);
const settingMigrationPath = new URL(
  "../../supabase/migrations/20260805154152_records_speaker_detection_setting.sql",
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

test("generic diarization labels speakers without enrolled voice profiles", () => {
  const timing = {
    words: [
      { word: "Motion", start: 0.1, end: 0.5 },
      { word: "made.", start: 0.6, end: 1.1 },
      { word: "Seconded.", start: 1.6, end: 2.2 },
    ],
  };
  const output = {
    exclusiveDiarization: [
      { speaker: "SPEAKER_00", start: 0, end: 1.4 },
      { speaker: "SPEAKER_01", start: 1.4, end: 2.5 },
    ],
  };

  const result = speakerIdentification.buildSpeakerTranscript(timing, output, []);

  assert.match(result.text, /Speaker 1 \[0:00\]\nMotion made\./);
  assert.match(result.text, /Speaker 2 \[0:01\]\nSeconded\./);
  assert.equal(result.utterances.every((utterance) => utterance.userId === null), true);
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
  const [recordings, allRecordings, correctionModal, correctionApi] = await Promise.all([
    readFile(recordingsPath, "utf8"),
    readFile(allRecordingsPath, "utf8"),
    readFile(correctionModalPath, "utf8"),
    readFile(correctionApiPath, "utf8"),
  ]);

  assert.match(recordings, /Correct a speaker name|correctRecordingSpeakerName/);
  assert.match(recordings, /openSpeakerCorrectionModal/);
  assert.match(allRecordings, /openSpeakerCorrectionModal/);
  assert.doesNotMatch(recordings, /window\.prompt/);
  assert.doesNotMatch(allRecordings, /window\.prompt/);
  assert.match(correctionModal, /Choose a speaker/);
  assert.match(correctionModal, /Correct name/);
  assert.match(correctionModal, /Save correction/);
  assert.match(correctionModal, /Play sample/);
  assert.match(correctionModal, /audioElement\.currentTime = sample\.start/);
  assert.match(correctionModal, /aria-modal="true"/);
  assert.match(correctionModal, /event\.key === "Escape"/);
  assert.match(correctionApi, /utterance\.speakerKey === speakerKey/);
  assert.match(correctionApi, /speakerTranscriptFromUtterances/);
  assert.match(correctionApi, /uploadTranscriptDocument/);
});

test("speaker correction chooses a useful, bounded voice sample", async () => {
  const { findSpeakerSample } = await import(correctionModalPath);
  const utterances = [
    { speakerKey: "unknown:SPEAKER_00", start: 1, end: 3, text: "Short sample." },
    { speakerKey: "unknown:SPEAKER_01", start: 4, end: 20, text: "Different speaker." },
    { speakerKey: "unknown:SPEAKER_00", start: 22, end: 34, text: "The clearest longer sample." },
  ];

  assert.deepEqual(findSpeakerSample(utterances, "unknown:SPEAKER_00"), {
    start: 22,
    end: 30,
    text: "The clearest longer sample.",
  });
  assert.equal(findSpeakerSample(utterances, "unknown:SPEAKER_99"), null);
});

test("speaker detection is enabled by default and can be disabled in AI settings", async () => {
  const [speakerApi, account, dashboard, migration] = await Promise.all([
    readFile(new URL("../../api/_records-speaker-identification.js", import.meta.url), "utf8"),
    readFile(accountPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(settingMigrationPath, "utf8"),
  ]);

  assert.match(migration, /records_speaker_detection_enabled boolean not null default true/);
  assert.match(account, /id="organization-speaker-detection-enabled"[^>]*checked/);
  assert.match(dashboard, /records_speaker_detection_enabled: organizationSpeakerDetectionEnabledInput\?\.checked !== false/);
  assert.match(speakerApi, /hasVoiceprints \? "\/identify" : "\/diarize"/);
  assert.match(speakerApi, /Speaker detection is disabled in AI settings/);
});

test("Records AI and Project Pulse describe the speaker workflow", async () => {
  const [helpKnowledge, publicKnowledge, projectPulseBuilder] = await Promise.all([
    readFile(helpKnowledgePath, "utf8"),
    readFile(publicKnowledgePath, "utf8"),
    readFile(projectPulseBuilderPath, "utf8"),
  ]);

  assert.match(helpKnowledge, /With no enrolled voice profiles, the transcript uses generic labels/);
  assert.match(helpKnowledge, /Voice profiles.*always available/s);
  assert.match(publicKnowledge, /Optional, consent-based voice profiles/);
  assert.match(helpKnowledge, /play control for each detected speaker/);
  assert.match(projectPulseBuilder, /Human-reviewed speaker identification/);
  assert.match(projectPulseBuilder, /short per-speaker audio samples/);
});
