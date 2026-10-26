/**
 * Voice recording helpers — pure, testable pieces of the recorder.
 *
 * Codec selection uses MediaRecorder.isTypeSupported() ONLY (feature-detected
 * per browser); the chosen MIME drives the file extension. The duration guard
 * keeps recordings compatible with the server upload cap so users never
 * record for minutes only to discover the limit at send time.
 */

/** Ordered preference: wide support first (Chromium/Firefox → Safari/iOS). */
export const RECORDER_MIME_CANDIDATES: ReadonlyArray<{ mime: string; ext: string }> = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/mpeg", ext: "mp3" },
  { mime: "audio/aac", ext: "aac" },
];

/** Hard stop so the recorded blob stays well under the 4 MB upload cap
 *  (Opus ~32 kbps → ~2.9 MB; AAC ~64 kbps → ~5.8 MB at 12 min — the guard
 *  also checks the actual blob size before upload). */
export const MAX_RECORDING_SECONDS = 300;

/** Recordings shorter than this are treated as accidental taps. */
export const MIN_RECORDING_SECONDS = 1;

export interface RecorderSupport {
  supported: boolean;
  mime: string;
  ext: string;
}

/** Feature-detect MediaRecorder and pick a supported audio MIME. */
export function detectRecorderSupport(scope: {
  MediaRecorder?: typeof MediaRecorder | undefined;
  mediaDevices?: { getUserMedia?: unknown } | undefined;
} = {}): RecorderSupport {
  const MR = scope.MediaRecorder ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  const hasMic = scope.mediaDevices?.getUserMedia != null ||
    (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia != null);
  if (!MR || !hasMic) return { supported: false, mime: "", ext: "" };
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (MR.isTypeSupported?.(candidate.mime)) return { supported: true, mime: candidate.mime, ext: candidate.ext };
    } catch {
      // isTypeSupported can throw on malformed inputs in some engines — keep probing.
    }
  }
  return { supported: false, mime: "", ext: "" };
}

/** "m:ss" for the recording timer. */
export function formatRecordingDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Build the upload filename from the chosen extension. */
export function recordingFilename(ext: string): string {
  return `mesaj_vwa_${Date.now()}.${ext || "webm"}`;
}

// ─── Recording state machine (WhatsApp-style composer) ─────────────────────
//
// One authoritative `mode` at a time — never contradictory booleans:
//   idle → requesting_permission → recording ⇄ preview → uploading → sent → idle
// Explicit transitions only; anything else returns the state unchanged.

export type VoiceMode =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "preview"
  | "uploading"
  | "sent";

export interface VoiceRecorderState {
  mode: VoiceMode;
  /** User-safe Kreyòl error for the CURRENT surface (cleared on retry). */
  error: string | null;
  /** Accumulated RECORDED milliseconds (paused spans excluded). */
  recordedMs: number;
  /** Amplitude history 0..1 for the waveform (fixed length, oldest first). */
  bars: number[];
  /** Upload fraction 0..1 while uploading. */
  uploadProgress: number;
  /** Preview playback state. */
  playing: boolean;
  /** Playback position as a fraction of the duration 0..1. */
  playbackFraction: number;
}

/** Number of waveform bars kept (bounded — no unbounded growth). */
export const VOICE_BAR_COUNT = 44;

export function initialVoiceState(): VoiceRecorderState {
  return {
    mode: "idle",
    error: null,
    recordedMs: 0,
    bars: [],
    uploadProgress: 0,
    playing: false,
    playbackFraction: 0,
  };
}

export type VoiceAction =
  | { type: "PERMISSION_REQUEST" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "PERMISSION_DENIED"; error?: string }
  | { type: "TICK"; recordedMs: number }
  | { type: "SAMPLE"; amplitude: number }
  | { type: "STOP" }
  | { type: "RESUME" }
  | { type: "CANCEL" }
  | { type: "SEND_START" }
  | { type: "SEND_PROGRESS"; fraction: number }
  | { type: "SEND_OK" }
  | { type: "SEND_FAIL"; error?: string }
  | { type: "SENT_ACK" }
  | { type: "PLAYBACK"; playing: boolean; fraction?: number }
  | { type: "SHOW_ERROR"; error: string }
  | { type: "RESET" };

export function voiceReducer(state: VoiceRecorderState, action: VoiceAction): VoiceRecorderState {
  switch (action.type) {
    case "PERMISSION_REQUEST":
      if (state.mode !== "idle") return state;
      return { ...state, mode: "requesting_permission", error: null };

    case "PERMISSION_GRANTED":
      if (state.mode !== "requesting_permission") return state;
      // Fresh recording (idle path): reset history. Returning from preview is
      // expressed with RESUME, which preserves the accumulated clip.
      return { ...initialVoiceState(), mode: "recording" };

    case "PERMISSION_DENIED":
      if (state.mode !== "requesting_permission") return state;
      return { ...initialVoiceState(), error: action.error ?? null };

    case "TICK":
      if (state.mode !== "recording") return state;
      return { ...state, recordedMs: Math.max(0, action.recordedMs) };

    case "SAMPLE":
      if (state.mode !== "recording") return state;
      return { ...state, bars: pushSample(state.bars, action.amplitude) };

    case "STOP":
      if (state.mode !== "recording") return state;
      // Keep recordedMs + bars: they ARE the preview's waveform and duration.
      return { ...state, mode: "preview", playing: false, playbackFraction: 0, error: null };

    case "RESUME":
      if (state.mode !== "preview") return state;
      // Append more speech to the SAME clip: history survives.
      return { ...state, mode: "recording", playing: false, playbackFraction: 0, error: null };

    case "CANCEL":
      return initialVoiceState();

    case "SEND_START":
      if (state.mode !== "preview") return state;
      return { ...state, mode: "uploading", uploadProgress: 0, playing: false, playbackFraction: 0, error: null };

    case "SEND_PROGRESS":
      if (state.mode !== "uploading") return state;
      return { ...state, uploadProgress: Math.max(0, Math.min(1, action.fraction)) };

    case "SEND_OK":
      if (state.mode !== "uploading") return state;
      return { ...state, mode: "sent", uploadProgress: 1 };

    case "SEND_FAIL":
      if (state.mode !== "uploading") return state;
      // The clip is INTACT — back to preview for retry or delete. Never
      // destroy the recording on a delivery failure.
      return { ...state, mode: "preview", uploadProgress: 0, playing: false, playbackFraction: 0, error: action.error ?? "Nou pa t kapab voye mesaj vwa a. Tanpri, eseye ankò." };

    case "SENT_ACK":
      if (state.mode !== "sent") return state;
      return initialVoiceState();

    case "SHOW_ERROR":
      // Surface an error on the IDLE composer (e.g. a too-short clip was
      // discarded, or resume failed) without changing the mode.
      if (state.mode !== "idle") return state;
      return { ...state, error: action.error };

    case "PLAYBACK":
      if (state.mode !== "preview") return state;
      return {
        ...state,
        playing: action.playing,
        playbackFraction: action.fraction === undefined ? state.playbackFraction : Math.max(0, Math.min(1, action.fraction)),
      };

    case "RESET":
      return initialVoiceState();

    default:
      return state;
  }
}

/** Append one amplitude sample to the bounded waveform history. */
export function pushSample(bars: number[], amplitude: number, max: number = VOICE_BAR_COUNT): number[] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(amplitude) ? amplitude : 0));
  const next = bars.length >= max ? bars.slice(bars.length - max + 1) : bars.slice();
  next.push(clamped);
  return next;
}

/** RMS of AnalyserNode byte time-domain data (0..1). */
export function rmsAmplitude(buf: Uint8Array): number {
  if (!buf || buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/** Speech-level normalization: quiet mics still show visible bars, clipping
 *  saturates at 1. The floor keeps the waveform alive during silence. */
export function normalizeAmplitude(rms: number, gain = 3.2, floor = 0.05): number {
  if (!Number.isFinite(rms) || rms <= 0) return floor;
  return Math.max(floor, Math.min(1, rms * gain));
}

/** True when the recorder + browser support pause()/resume() (single valid
 *  container across a stopped-and-continued recording). Feature-detected,
 *  never assumed. */
export function supportsPauseResume(
  MR: { prototype?: { pause?: unknown; resume?: unknown } } | undefined,
): boolean {
  return typeof MR?.prototype?.pause === "function" && typeof MR?.prototype?.resume === "function";
}

/** Guard used by the composer: recording must auto-stop at the cap. */
export function recordingExceedsCap(recordedMs: number): boolean {
  return recordedMs >= MAX_RECORDING_SECONDS * 1000;
}

/** Guard used at send time: the FINAL clip must respect the server cap. */
export function clipTooLarge(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes > maxBytes;
}

/** Guard used at stop time: accidental taps produce nothing. */
export function clipTooShort(recordedMs: number): boolean {
  return recordedMs < MIN_RECORDING_SECONDS * 1000;
}
