export function normalizeRecordingDurationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(Math.round(seconds), 0);
}

export function getRecordingDurationSeconds(recording) {
  const storedDuration = normalizeRecordingDurationSeconds(recording?.duration_seconds);
  if (storedDuration) return storedDuration;

  const startedAt = recording?.started_at || recording?.created_at;
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const endedMs = recording?.ended_at ? new Date(recording.ended_at).getTime() : Number.NaN;
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs <= startedMs) return 0;
  return normalizeRecordingDurationSeconds((endedMs - startedMs) / 1000);
}

export function formatRecordingDuration(value) {
  const safeSeconds = normalizeRecordingDurationSeconds(value);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
