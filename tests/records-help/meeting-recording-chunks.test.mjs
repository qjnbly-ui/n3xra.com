import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  PLAYBACK_AUDIO_SETTINGS,
  buildInterruptionMetadata,
  buildPlaybackTranscodeArgs,
  extensionForMimeType,
  validateAndGroupChunks,
} = require("../../api/_recording-chunk-core.js");
const { isTranscriptionDerivativeFile } = require("../../api/transcribe-recording.js")._test;
const ffmpegPath = require("ffmpeg-static");
const clientPath = new URL("../../n3xra-records/lib/meeting-recording-chunks.js", import.meta.url);
const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const finalizerPath = new URL("../../api/finalize-recording-chunks.js", import.meta.url);
const transcriptionPath = new URL("../../api/transcribe-recording.js", import.meta.url);
const cleanupPath = new URL("../../api/cleanup-recording-chunks.js", import.meta.url);
const migrationPath = new URL("../../supabase/migrations/20260801030703_meeting_recording_resumable_chunks.sql", import.meta.url);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr)));
  });
}

test("chunk manifest sorts sequences and groups resumed capture sessions", () => {
  const chunks = [
    { sequence_number: 2, capture_session_id: "session-b" },
    { sequence_number: 0, capture_session_id: "session-a" },
    { sequence_number: 1, capture_session_id: "session-a" },
  ];
  const result = validateAndGroupChunks(chunks, 2);
  assert.deepEqual(result.ordered.map((item) => item.sequence_number), [0, 1, 2]);
  assert.deepEqual(result.groups.map((group) => group.chunks.length), [2, 1]);
});

test("chunk manifest rejects missing and duplicate sequences", () => {
  assert.throws(() => validateAndGroupChunks([
    { sequence_number: 0, capture_session_id: "a" },
    { sequence_number: 2, capture_session_id: "a" },
  ], 2), /missing: 1/i);
  assert.throws(() => validateAndGroupChunks([
    { sequence_number: 0, capture_session_id: "a" },
    { sequence_number: 0, capture_session_id: "a" },
  ], 0), /duplicate/i);
});

test("browser recording MIME types keep compatible fragment extensions", () => {
  assert.equal(extensionForMimeType("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionForMimeType("audio/mp4"), "m4a");
  assert.equal(extensionForMimeType("audio/ogg;codecs=opus"), "ogg");
});

test("interruption metadata preserves gaps without claiming captured audio", () => {
  const result = buildInterruptionMetadata([{ interruption_number: 1, reason: "microphone_interrupted", started_at: "start", ended_at: "end" }]);
  assert.deepEqual(result, [{ number: 1, reason: "microphone_interrupted", started_at: "start", ended_at: "end" }]);
});

test("client queues locally, retries, deduplicates, and resumes after network loss", async () => {
  const client = await readFile(clientPath, "utf8");
  assert.match(client, /indexedDB\.open/);
  assert.match(client, /window\.addEventListener\("online"/);
  assert.match(client, /upsert\(\{/);
  assert.match(client, /onConflict: "meeting_recording_id,sequence_number"/);
  assert.match(client, /window\.setTimeout/);
  assert.match(client, /getLocalChunks\(recordingId\)/);
});

test("Meeting Notes detects interruptions and offers same-meeting resume", async () => {
  const recordings = await readFile(recordingsPath, "utf8");
  assert.match(recordings, /track\.addEventListener\("mute"/);
  assert.match(recordings, /track\.addEventListener\("unmute"/);
  assert.match(recordings, /track\.addEventListener\("ended"/);
  assert.match(recordings, /mediaRecorder\.addEventListener\("error", handleUnexpectedRecordingEnd\)/);
  assert.match(recordings, /handleResumeRecording/);
  assert.match(recordings, /No audio was captured during the interruption/);
  assert.match(recordings, /status: "interrupted"/);
  assert.match(recordings, /mediaRecorder\.start\(5000\)/);
});

test("finalization verifies fragments and assembles resumed sessions with FFmpeg", async () => {
  const finalizer = await readFile(finalizerPath, "utf8");
  assert.match(finalizer, /failed its checksum check/);
  assert.match(finalizer, /validateAndGroupChunks/);
  assert.match(finalizer, /runFfmpeg/);
  assert.match(finalizer, /status: "finalizing"/);
  assert.match(finalizer, /status: "uploaded"/);
});

test("permanent playback is 48 kHz mono MP3 at 96 kbps without chunk boundary changes", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "n3xra-playback-quality-"));
  try {
    const sourcePath = path.join(tempDirectory, "source.webm");
    const reassembledPath = path.join(tempDirectory, "reassembled.webm");
    const sourceOutputPath = path.join(tempDirectory, "source.mp3");
    const chunkedOutputPath = path.join(tempDirectory, "chunked.mp3");
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=1.2",
      "-ar", "48000", "-ac", "1", "-codec:a", "libopus", "-b:a", "64k", sourcePath,
    ]);
    const source = await readFile(sourcePath);
    const oneThird = Math.floor(source.length / 3);
    const fragments = [source.subarray(0, oneThird), source.subarray(oneThird, oneThird * 2), source.subarray(oneThird * 2)];
    const reassembled = Buffer.concat(fragments);
    assert.deepEqual(reassembled, source);
    await writeFile(reassembledPath, reassembled);

    await runFfmpeg(buildPlaybackTranscodeArgs(sourcePath, sourceOutputPath));
    await runFfmpeg(buildPlaybackTranscodeArgs(reassembledPath, chunkedOutputPath));
    assert.deepEqual(await readFile(chunkedOutputPath), await readFile(sourceOutputPath));

    const inspection = await runFfmpeg(["-hide_banner", "-i", chunkedOutputPath, "-f", "null", "-"]);
    assert.match(inspection, /Audio: mp3, 48000 Hz, mono/);
    assert.match(inspection, /96 kb\/s/);
    const duration = inspection.match(/Duration:\s+00:00:([0-9.]+)/)?.[1];
    assert.ok(Number(duration) >= 1.15 && Number(duration) <= 1.3);
    assert.deepEqual(PLAYBACK_AUDIO_SETTINGS, {
      codec: "libmp3lame", mimeType: "audio/mpeg", extension: "mp3", sampleRate: 48000, channels: 1, bitrate: "96k",
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("transcription includes explicit interruption markers", async () => {
  const transcription = await readFile(transcriptionPath, "utf8");
  assert.match(transcription, /No audio was captured during this gap/);
  assert.match(transcription, /addInterruptionMarkers/);
  assert.match(transcription, /transcribeTemporaryDerivative/);
  assert.match(transcription, /"-ar",\s*"16000"/);
  assert.match(transcription, /TRANSCRIPTION_SEGMENT_BITRATE/);
});

test("transcription excludes the MP3 playback source from derivative segments", () => {
  const files = ["source.mp3", "part-001.mp3", "notes.txt", "part-000.mp3", "part-bad.mp3"];
  assert.deepEqual(files.filter(isTranscriptionDerivativeFile).sort(), ["part-000.mp3", "part-001.mp3"]);
});

test("private chunk manifests use organization-aware RLS", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /meeting_recording_chunks enable row level security/);
  assert.match(migration, /can_change_records_recordings\(organization_id\)/);
  assert.match(migration, /created_by_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /unique \(meeting_recording_id, sequence_number\)/i);
});

test("abandoned chunks are retained before authenticated cleanup", async () => {
  const cleanup = await readFile(cleanupPath, "utf8");
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /interval '30 days'/);
  assert.match(cleanup, /CRON_SECRET/);
  assert.match(cleanup, /\["recording", "finalizing"\]/);
  assert.match(cleanup, /expires_at=lt/);
});
