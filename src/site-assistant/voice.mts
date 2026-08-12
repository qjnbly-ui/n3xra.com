export interface VoiceControls {
  voiceButton: HTMLButtonElement;
  listenButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  status: HTMLElement;
}

export function chooseRecordingMimeType(isSupported: (type: string) => boolean): string {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(isSupported) || "";
}

export function prepareSpeechText(value: string): string {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>`~|]/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export class AssistantVoiceController {
  private readonly controls: VoiceControls;
  private readonly onTranscript: (text: string) => void;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private recordingTimer: number | null = null;
  private audio: HTMLAudioElement | null = null;
  private lastAnswer = "";
  private autoSpeakNextAnswer = false;
  private assistantName = "N3XRA";

  constructor(controls: VoiceControls, onTranscript: (text: string) => void) {
    this.controls = controls;
    this.onTranscript = onTranscript;
    const supported = typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
    this.controls.voiceButton.hidden = !supported;
    this.controls.voiceButton.addEventListener("click", () => void this.toggleRecording());
    this.controls.listenButton.addEventListener("click", () => void this.speak());
    this.controls.stopButton.addEventListener("click", () => this.stopPlayback());
    window.addEventListener("pagehide", () => this.destroy(), { once: true });
  }

  setAssistantName(name: string): void {
    this.assistantName = name;
    if (this.mediaRecorder?.state !== "recording") this.setRecordingState(false);
  }

  prepareForRequest(): void {
    this.stopPlayback();
    this.controls.listenButton.hidden = true;
    this.controls.stopButton.hidden = true;
    this.lastAnswer = "";
  }

  handleAnswer(answer: string): void {
    this.lastAnswer = answer.trim();
    this.controls.listenButton.hidden = !this.lastAnswer;
    if (this.autoSpeakNextAnswer && this.lastAnswer) void this.speak();
    this.autoSpeakNextAnswer = false;
  }

  destroy(): void {
    if (this.recordingTimer !== null) window.clearTimeout(this.recordingTimer);
    this.recordingTimer = null;
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    this.stopStream();
    this.stopPlayback();
  }

  private async toggleRecording(): Promise<void> {
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      return;
    }

    try {
      this.controls.status.textContent = `Allow microphone access to speak with ${this.assistantName}.`;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = chooseRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType })
        : new MediaRecorder(this.mediaStream);
      this.chunks = [];
      this.mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) this.chunks.push(event.data);
      });
      this.mediaRecorder.addEventListener("stop", () => void this.finishRecording(), { once: true });
      this.mediaRecorder.start();
      this.setRecordingState(true);
      this.controls.status.textContent = "Listening… Select stop when you are finished.";
      this.recordingTimer = window.setTimeout(() => this.mediaRecorder?.stop(), 30_000);
    } catch {
      this.stopStream();
      this.setRecordingState(false);
      this.controls.status.textContent = `Microphone access is needed to talk with ${this.assistantName}.`;
    }
  }

  private async finishRecording(): Promise<void> {
    if (this.recordingTimer !== null) window.clearTimeout(this.recordingTimer);
    this.recordingTimer = null;
    this.stopStream();
    this.setRecordingState(false);
    this.controls.voiceButton.disabled = true;
    this.controls.status.textContent = "Transcribing…";

    try {
      const recording = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || "audio/webm" });
      const response = await fetch("/api/elevenlabs-speech-to-text", {
        method: "POST",
        headers: { "Content-Type": recording.type || "audio/webm" },
        body: recording,
      });
      const data = await response.json().catch(() => ({})) as { error?: unknown; text?: unknown };
      if (!response.ok) throw new Error(String(data.error || "I could not hear that. Please try again."));
      const transcript = String(data.text || "").trim();
      if (!transcript) throw new Error("I could not hear a question. Please try again.");
      this.autoSpeakNextAnswer = true;
      this.onTranscript(transcript);
    } catch (error) {
      this.autoSpeakNextAnswer = false;
      this.controls.status.textContent = errorMessage(error, "I could not hear that. Please try again.");
    } finally {
      this.controls.voiceButton.disabled = false;
      this.chunks = [];
    }
  }

  private async speak(): Promise<void> {
    const speechText = prepareSpeechText(this.lastAnswer);
    if (!speechText) return;
    this.stopPlayback();
    this.controls.listenButton.hidden = true;
    this.controls.stopButton.hidden = false;

    try {
      this.audio = new Audio(`/api/elevenlabs-text-to-speech?text=${encodeURIComponent(speechText)}`);
      this.audio.preload = "none";
      this.audio.addEventListener("ended", () => this.stopPlayback(), { once: true });
      this.audio.addEventListener("error", () => this.stopPlayback(), { once: true });
      await this.audio.play();
      this.controls.status.textContent = "";
    } catch (error) {
      const blocked = error instanceof Error && (error.name === "NotAllowedError" || /not allowed|user agent|current context/i.test(error.message));
      this.stopPlayback();
      this.controls.listenButton.textContent = blocked ? "Play audio" : "Listen";
      this.controls.status.textContent = blocked
        ? "Audio is ready. Select Play audio to hear it."
        : "Voice playback is unavailable right now.";
    }
  }

  private stopPlayback(): void {
    this.audio?.pause();
    this.audio = null;
    this.controls.listenButton.hidden = !this.lastAnswer;
    this.controls.listenButton.textContent = "Listen";
    this.controls.stopButton.hidden = true;
  }

  private stopStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private setRecordingState(recording: boolean): void {
    this.controls.voiceButton.classList.toggle("is-recording", recording);
    this.controls.voiceButton.setAttribute("aria-pressed", String(recording));
    this.controls.voiceButton.innerHTML = recording
      ? '<span aria-hidden="true">●</span> Stop recording'
      : `<span aria-hidden="true">●</span> Talk to ${this.assistantName}`;
  }
}
