const INTERRUPTION_MARKER_SOURCE = "\\[Recording interruption\\s+(\\d+):\\s+(.+?)\\s+to\\s+(.+?)\\.\\s+No audio was captured during (?:this )?gap\\.\\]";

function interruptionMarkerPattern() {
  return new RegExp(INTERRUPTION_MARKER_SOURCE, "gi");
}

export function stripRecordingInterruptionMarkers(transcriptText) {
  return String(transcriptText || "").replace(interruptionMarkerPattern(), "").trim();
}

export function getRecordingInterruptions(recording) {
  const stored = Array.isArray(recording?.metadata?.interruptions)
    ? recording.metadata.interruptions
    : [];
  if (stored.length) return stored;

  const parsed = [];
  const transcriptText = String(recording?.transcript_text || "");
  for (const match of transcriptText.matchAll(interruptionMarkerPattern())) {
    parsed.push({
      number: Number(match[1]),
      reason: "recording_interrupted",
      started_at: match[2],
      ended_at: match[3] === "recording was not resumed" ? null : match[3],
    });
  }
  return parsed;
}
