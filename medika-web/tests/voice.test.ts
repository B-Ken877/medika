/**
 * Voice recorder helpers — codec feature detection, duration formatting,
 * filename generation.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RECORDING_SECONDS,
  MIN_RECORDING_SECONDS,
  detectRecorderSupport,
  formatRecordingDuration,
  recordingFilename,
} from "@/lib/chat/voice";

describe("detectRecorderSupport", () => {
  it("is unsupported without MediaRecorder or getUserMedia", () => {
    expect(detectRecorderSupport({ MediaRecorder: undefined, mediaDevices: {} }).supported).toBe(false);
    expect(
      detectRecorderSupport({
        MediaRecorder: class {} as unknown as typeof MediaRecorder,
        mediaDevices: {},
      }).supported,
    ).toBe(false);
  });

  it("picks the first supported codec from the preference order", () => {
    const scope = {
      MediaRecorder: {
        isTypeSupported: (m: string) => m === "audio/mp4",
      } as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: () => Promise.resolve([]) },
    };
    const support = detectRecorderSupport(scope);
    expect(support.supported).toBe(true);
    expect(support.mime).toBe("audio/mp4");
    expect(support.ext).toBe("m4a");
  });

  it("prefers opus/webm when the browser supports it (Chromium/Android)", () => {
    const scope = {
      MediaRecorder: {
        isTypeSupported: (m: string) => m === "audio/webm;codecs=opus",
      } as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: () => Promise.resolve([]) },
    };
    const support = detectRecorderSupport(scope);
    expect(support.mime).toBe("audio/webm;codecs=opus");
    expect(support.ext).toBe("webm");
  });

  it("is unsupported when no candidate MIME is supported", () => {
    const scope = {
      MediaRecorder: { isTypeSupported: () => false } as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: () => Promise.resolve([]) },
    };
    expect(detectRecorderSupport(scope).supported).toBe(false);
  });

  it("survives isTypeSupported throwing (keeps probing)", () => {
    const scope = {
      MediaRecorder: {
        isTypeSupported: (m: string) => {
          if (m === "audio/webm;codecs=opus") throw new Error("boom");
          return m === "audio/mp4";
        },
      } as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: () => Promise.resolve([]) },
    };
    const support = detectRecorderSupport(scope);
    expect(support.supported).toBe(true);
    expect(support.mime).toBe("audio/mp4");
  });
});

describe("guards and formatting", () => {
  it("duration guard keeps recordings under the upload budget", () => {
    expect(MAX_RECORDING_SECONDS).toBeLessThanOrEqual(300);
    expect(MIN_RECORDING_SECONDS).toBe(1);
  });

  it("formats m:ss", () => {
    expect(formatRecordingDuration(0)).toBe("0:00");
    expect(formatRecordingDuration(59)).toBe("0:59");
    expect(formatRecordingDuration(61)).toBe("1:01");
    expect(formatRecordingDuration(-5)).toBe("0:00");
  });

  it("builds a filename from the chosen extension", () => {
    expect(recordingFilename("webm")).toMatch(/^mesaj_vwa_\d+\.webm$/);
    expect(recordingFilename("")).toMatch(/^mesaj_vwa_\d+\.webm$/);
  });
});

// ─── Recording state machine ─────────────────────────────────────────────────

import {
  VOICE_BAR_COUNT,
  clipTooLarge,
  clipTooShort,
  initialVoiceState,
  normalizeAmplitude,
  pushSample,
  recordingExceedsCap,
  rmsAmplitude,
  supportsPauseResume,
  voiceReducer,
  type VoiceRecorderState,
} from "@/lib/chat/voice";

function fromIdle(): VoiceRecorderState {
  // idle → requesting_permission → recording (the only legal entry path)
  let s = voiceReducer(initialVoiceState(), { type: "PERMISSION_REQUEST" });
  s = voiceReducer(s, { type: "PERMISSION_GRANTED" });
  return s;
}

describe("voiceReducer — required transitions", () => {
  it("idle → requesting_permission → recording on a successful permission grant", () => {
    const s = fromIdle();
    expect(s.mode).toBe("recording");
    expect(s.recordedMs).toBe(0);
    expect(s.bars).toEqual([]);
  });

  it("requesting_permission → idle when denied", () => {
    let s = voiceReducer(initialVoiceState(), { type: "PERMISSION_REQUEST" });
    s = voiceReducer(s, { type: "PERMISSION_DENIED", error: "pa gen mikwofòn" });
    expect(s.mode).toBe("idle");
    expect(s.error).toBe("pa gen mikwofòn");
  });

  it("recording → preview on STOP keeps the clip (duration + waveform survive)", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "TICK", recordedMs: 4200 });
    s = voiceReducer(s, { type: "SAMPLE", amplitude: 0.7 });
    s = voiceReducer(s, { type: "SAMPLE", amplitude: 0.3 });
    s = voiceReducer(s, { type: "STOP" });
    expect(s.mode).toBe("preview");
    expect(s.recordedMs).toBe(4200);
    expect(s.bars).toHaveLength(2);
    expect(s.playing).toBe(false);
  });

  it("recording → idle on CANCEL discards the clip", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "TICK", recordedMs: 900 });
    s = voiceReducer(s, { type: "CANCEL" });
    expect(s.mode).toBe("idle");
    expect(s.recordedMs).toBe(0);
    expect(s.bars).toEqual([]);
  });

  it("preview → recording on RESUME preserves the accumulated clip", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "TICK", recordedMs: 3000 });
    s = voiceReducer(s, { type: "SAMPLE", amplitude: 0.5 });
    s = voiceReducer(s, { type: "STOP" });
    s = voiceReducer(s, { type: "RESUME" });
    expect(s.mode).toBe("recording");
    expect(s.recordedMs).toBe(3000); // history survives for the appended span
    expect(s.bars).toHaveLength(1);
    // The next tick accumulates on top of the earlier span.
    s = voiceReducer(s, { type: "TICK", recordedMs: 5500 });
    expect(s.recordedMs).toBe(5500);
  });

  it("preview → uploading → sent on a durable send", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "STOP" });
    s = voiceReducer(s, { type: "SEND_START" });
    expect(s.mode).toBe("uploading");
    s = voiceReducer(s, { type: "SEND_PROGRESS", fraction: 0.5 });
    expect(s.uploadProgress).toBe(0.5);
    s = voiceReducer(s, { type: "SEND_PROGRESS", fraction: 1 });
    s = voiceReducer(s, { type: "SEND_OK" });
    expect(s.mode).toBe("sent");
    // sent → idle acknowledges completion
    s = voiceReducer(s, { type: "SENT_ACK" });
    expect(s.mode).toBe("idle");
  });

  it("uploading → preview on a retryable failure — the clip is NEVER destroyed", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "TICK", recordedMs: 2600 });
    s = voiceReducer(s, { type: "SAMPLE", amplitude: 0.9 });
    s = voiceReducer(s, { type: "STOP" });
    s = voiceReducer(s, { type: "SEND_START" });
    s = voiceReducer(s, { type: "SEND_FAIL" });
    expect(s.mode).toBe("preview");
    expect(s.recordedMs).toBe(2600); // recording intact
    expect(s.bars).toHaveLength(1);
    expect(s.error).toContain("eseye ankò");
  });

  it("preview → idle on user-confirmed deletion", () => {
    let s = fromIdle();
    s = voiceReducer(s, { type: "STOP" });
    s = voiceReducer(s, { type: "CANCEL" });
    expect(s.mode).toBe("idle");
  });

  it("rejects contradictory transitions (defensive no-ops)", () => {
    // STOP is only legal while recording
    expect(voiceReducer(initialVoiceState(), { type: "STOP" }).mode).toBe("idle");
    // SEND_START is only legal from preview
    expect(voiceReducer(fromIdle(), { type: "SEND_START" }).mode).toBe("recording");
    // RESUME is only legal from preview
    expect(voiceReducer(fromIdle(), { type: "RESUME" }).mode).toBe("recording");
    // Samples/ticks are ignored outside recording
    const idle = voiceReducer(initialVoiceState(), { type: "SAMPLE", amplitude: 1 });
    expect(idle.bars).toEqual([]);
    // PERMISSION_GRANTED is only legal from requesting_permission
    expect(voiceReducer(fromIdle(), { type: "PERMISSION_GRANTED" }).mode).toBe("recording");
    // SHOW_ERROR only on the idle surface
    const preview = voiceReducer(voiceReducer(fromIdle(), { type: "STOP" }), {
      type: "SHOW_ERROR",
      error: "x",
    });
    expect(preview.error).toBeNull();
    const idleErr = voiceReducer(initialVoiceState(), { type: "SHOW_ERROR", error: "twò kout" });
    expect(idleErr.error).toBe("twò kout");
  });
});

describe("waveform helpers", () => {
  it("keeps a BOUNDED bar history (no unbounded growth)", () => {
    let bars: number[] = [];
    for (let i = 0; i < 500; i++) bars = pushSample(bars, 0.5);
    expect(bars).toHaveLength(VOICE_BAR_COUNT);
    expect(VOICE_BAR_COUNT).toBeLessThanOrEqual(60);
  });

  it("clamps amplitudes into 0..1", () => {
    expect(pushSample([], 5)[0]).toBe(1);
    expect(pushSample([], -3)[0]).toBe(0);
    expect(pushSample([], Number.NaN)[0]).toBe(0);
  });

  it("rmsAmplitude reflects signal energy (silence ≈ 0, loud ≈ high)", () => {
    const silence = new Uint8Array(256).fill(128);
    expect(rmsAmplitude(silence)).toBeCloseTo(0, 5);
    const loud = new Uint8Array(256);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 228 : 28; // ±100%
    expect(rmsAmplitude(loud)).toBeGreaterThan(0.7);
  });

  it("normalizeAmplitude keeps a visible floor and saturates at 1", () => {
    expect(normalizeAmplitude(0)).toBe(0.05);
    expect(normalizeAmplitude(0.01)).toBeGreaterThan(0.03);
    expect(normalizeAmplitude(10)).toBe(1);
  });
});

describe("resume capability detection", () => {
  it("detects pause/res support on the prototype", () => {
    class Full extends Object {
      pause() {}
      resume() {}
    }
    class Partial extends Object {
      pause() {}
    }
    expect(supportsPauseResume(Full as unknown as typeof MediaRecorder)).toBe(true);
    expect(supportsPauseResume(Partial as unknown as typeof MediaRecorder)).toBe(false);
    expect(supportsPauseResume(undefined)).toBe(false);
  });
});

describe("clip guards", () => {
  it("flags recordings past the cap", () => {
    expect(recordingExceedsCap(MAX_RECORDING_SECONDS * 1000)).toBe(true);
    expect(recordingExceedsCap(1000)).toBe(false);
  });
  it("flags clips over the byte budget", () => {
    expect(clipTooLarge(5 * 1024 * 1024, 4 * 1024 * 1024)).toBe(true);
    expect(clipTooLarge(1024, 4 * 1024 * 1024)).toBe(false);
  });
  it("flags accidental-tap clips", () => {
    expect(clipTooShort(400)).toBe(true);
    expect(clipTooShort(1200)).toBe(false);
  });
});
