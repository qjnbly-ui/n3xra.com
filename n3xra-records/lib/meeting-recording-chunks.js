const DB_NAME = "n3xra-recording-recovery";
const DB_VERSION = 1;
const STORE_NAME = "audio_chunks";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("recording_id", "recordingId", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Unable to open recording recovery storage.")), { once: true });
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result;
      request.addEventListener("success", () => { result = request.result; }, { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
      transaction.addEventListener("complete", () => resolve(result), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("Local recording save was interrupted.")), { once: true });
    });
  } finally {
    database.close();
  }
}

function localChunkKey(recordingId, sequenceNumber) {
  return `${recordingId}:${String(sequenceNumber).padStart(8, "0")}`;
}

async function putLocalChunk(chunk) {
  return withStore("readwrite", (store) => store.put(chunk));
}

async function deleteLocalChunk(key) {
  return withStore("readwrite", (store) => store.delete(key));
}

async function getLocalChunks(recordingId) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const index = transaction.objectStore(STORE_NAME).index("recording_id");
      const request = index.getAll(recordingId);
      request.addEventListener("success", () => resolve((request.result || []).sort((a, b) => a.sequenceNumber - b.sequenceNumber)), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
  } finally {
    database.close();
  }
}

async function sha256(blob) {
  if (!crypto.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionForMimeType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("ogg")) return "ogg";
  return "webm";
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function createMeetingRecordingChunkManager(options) {
  const { supabase, bucket, organizationId, recordingId, userId, maxBytes = Infinity, onStatus = () => {} } = options;
  let nextSequence = 0;
  let draining = null;
  let retryTimer = null;
  let disposed = false;
  let accumulatedBytes = 0;

  async function remoteChunks() {
    const { data, error } = await supabase
      .from("meeting_recording_chunks")
      .select("sequence_number, file_size, checksum_sha256, storage_path")
      .eq("meeting_recording_id", recordingId)
      .order("sequence_number", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function initialize() {
    const [remote, local] = await Promise.all([remoteChunks(), getLocalChunks(recordingId)]);
    const sequences = [...remote.map((item) => Number(item.sequence_number)), ...local.map((item) => Number(item.sequenceNumber))];
    accumulatedBytes = remote.reduce((sum, item) => sum + Number(item.file_size || 0), 0)
      + local.filter((item) => !remote.some((remoteItem) => Number(remoteItem.sequence_number) === item.sequenceNumber))
        .reduce((sum, item) => sum + Number(item.blob?.size || 0), 0);
    nextSequence = sequences.length ? Math.max(...sequences) + 1 : 0;
    if (local.length) void drain();
    return { nextSequence, localCount: local.length, remoteCount: remote.length };
  }

  async function uploadChunk(chunk) {
    const extension = extensionForMimeType(chunk.mimeType);
    const storagePath = `${organizationId}/${recordingId}/chunks/${chunk.captureSessionId}/${String(chunk.sequenceNumber).padStart(8, "0")}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, chunk.blob, {
      contentType: chunk.mimeType,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { error: manifestError } = await supabase.from("meeting_recording_chunks").upsert({
      meeting_recording_id: recordingId,
      organization_id: organizationId,
      created_by_user_id: userId,
      capture_session_id: chunk.captureSessionId,
      sequence_number: chunk.sequenceNumber,
      storage_path: storagePath,
      mime_type: chunk.mimeType,
      file_size: chunk.blob.size,
      checksum_sha256: chunk.checksum,
      captured_started_at: chunk.startedAt,
      captured_ended_at: chunk.endedAt,
      status: "uploaded",
    }, { onConflict: "meeting_recording_id,sequence_number" });
    if (manifestError) throw manifestError;
    await deleteLocalChunk(chunk.key);
  }

  async function drain() {
    if (disposed) return;
    if (draining) return draining;
    draining = (async () => {
      while (!disposed) {
        const chunks = await getLocalChunks(recordingId);
        if (!chunks.length) {
          onStatus("saved");
          return;
        }
        if (!navigator.onLine) {
          onStatus("offline");
          return;
        }
        onStatus("saving");
        for (const chunk of chunks) {
          if (disposed) return;
          await uploadChunk(chunk);
        }
      }
    })().catch(() => {
      onStatus(navigator.onLine ? "retrying" : "offline");
      if (!retryTimer && !disposed) {
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void drain();
        }, 3000);
      }
    }).finally(() => {
      draining = null;
    });
    return draining;
  }

  async function enqueue(blob, details) {
    if (!blob?.size) return null;
    if (accumulatedBytes + blob.size > maxBytes) throw new Error("This recording reached the maximum supported audio size.");
    const sequenceNumber = nextSequence;
    nextSequence += 1;
    const chunk = {
      key: localChunkKey(recordingId, sequenceNumber), recordingId, organizationId, userId,
      sequenceNumber, captureSessionId: details.captureSessionId, mimeType: details.mimeType,
      startedAt: details.startedAt, endedAt: details.endedAt, blob, checksum: await sha256(blob),
    };
    await putLocalChunk(chunk);
    accumulatedBytes += blob.size;
    onStatus(navigator.onLine ? "saving" : "offline");
    void drain();
    return sequenceNumber;
  }

  async function flush({ attempts = 8 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await drain();
      const pending = await getLocalChunks(recordingId);
      if (!pending.length) return { lastSequence: nextSequence - 1 };
      onStatus(navigator.onLine ? "retrying" : "offline");
      await wait(Math.min(1000 * (attempt + 1), 5000));
    }
    throw new Error("Some audio is still saved locally. Reconnect and try again before completing this meeting note.");
  }

  function handleOnline() { void drain(); }
  window.addEventListener("online", handleOnline);

  return {
    initialize, enqueue, drain, flush,
    getNextSequence: () => nextSequence,
    dispose() {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      if (retryTimer) window.clearTimeout(retryTimer);
    },
  };
}

export { getLocalChunks };
