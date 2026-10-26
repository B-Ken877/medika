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
