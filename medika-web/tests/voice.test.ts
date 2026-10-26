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
