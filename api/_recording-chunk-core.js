function validateAndGroupChunks(chunks, expectedLastSequence) {
  const ordered = [...(Array.isArray(chunks) ? chunks : [])]
    .sort((left, right) => Number(left.sequence_number) - Number(right.sequence_number));
  const expected = Number(expectedLastSequence);
  if (!Number.isInteger(expected) || expected < 0) throw new Error("A valid final chunk sequence is required.");

  const seen = new Set();
  for (const chunk of ordered) {
    const sequence = Number(chunk.sequence_number);
    if (!Number.isInteger(sequence) || sequence < 0) throw new Error("A chunk has an invalid sequence number.");
    if (seen.has(sequence)) throw new Error(`Duplicate audio chunk ${sequence}.`);
    seen.add(sequence);
  }

  const missing = [];
  for (let sequence = 0; sequence <= expected; sequence += 1) {
    if (!seen.has(sequence)) missing.push(sequence);
  }
  if (missing.length) {
    const error = new Error(`Audio chunks are still missing: ${missing.slice(0, 20).join(", ")}.`);
    error.code = "MISSING_CHUNKS";
    error.missingSequences = missing;
    throw error;
  }

  const selected = ordered.filter((chunk) => Number(chunk.sequence_number) <= expected);
  const groups = [];
  for (const chunk of selected) {
    const sessionId = String(chunk.capture_session_id || "");
    const current = groups[groups.length - 1];
    if (!current || current.captureSessionId !== sessionId) {
      groups.push({ captureSessionId: sessionId, chunks: [chunk] });
    } else {
      current.chunks.push(chunk);
    }
  }
  return { ordered: selected, groups };
}

function extensionForMimeType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("wav")) return "wav";
  if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
  return "webm";
}

function buildInterruptionMetadata(interruptions) {
  return (Array.isArray(interruptions) ? interruptions : []).map((item) => ({
    number: Number(item.interruption_number),
    reason: String(item.reason || "microphone_interrupted"),
    started_at: item.started_at,
    ended_at: item.ended_at || null,
  }));
}

const PLAYBACK_AUDIO_SETTINGS = Object.freeze({
  codec: "libmp3lame",
  mimeType: "audio/mpeg",
  extension: "mp3",
  sampleRate: 48000,
  channels: 1,
  bitrate: "96k",
});

function buildPlaybackTranscodeArgs(inputPath, outputPath) {
  return [
    "-hide_banner", "-loglevel", "error", "-i", inputPath, "-vn",
    "-ac", String(PLAYBACK_AUDIO_SETTINGS.channels),
    "-ar", String(PLAYBACK_AUDIO_SETTINGS.sampleRate),
    "-codec:a", PLAYBACK_AUDIO_SETTINGS.codec,
    "-b:a", PLAYBACK_AUDIO_SETTINGS.bitrate,
    outputPath,
  ];
}

module.exports = {
  PLAYBACK_AUDIO_SETTINGS,
  buildInterruptionMetadata,
  buildPlaybackTranscodeArgs,
  extensionForMimeType,
  validateAndGroupChunks,
};
