/**
 * Recording indicator (issues #19 → #26) — the telemetry bus between the
 * voice composer and any subscribed indicator, plus the recipient-only
 * REMOTE recording activity contracts.
 *
 * Issue #26 changed the contract: the sender's own chat log no longer shows
 * a recording bubble (their controls live in the composer only); instead the
 * RECIPIENT sees a transient pulsing-microphone status row while the other
 * participant's capture is genuinely active. These tests cover the bus, the
 * remote indicator's SSR, and the source contracts for the wiring.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  clearRecordingIndicatorSubscribers,
  publishRecordingEvent,
  subscribeRecordingIndicator,
} from "@/lib/chat/recording-indicator";
import { RemoteRecordingIndicator } from "@/components/consultation/RemoteRecordingIndicator";

describe("recording indicator bus", () => {
  beforeEach(() => clearRecordingIndicatorSubscribers());
  afterEach(() => clearRecordingIndicatorSubscribers());

  it("delivers events to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeRecordingIndicator(a);
    subscribeRecordingIndicator(b);

    publishRecordingEvent({ type: "sample", amplitude: 0.42 });
    publishRecordingEvent({ type: "tick", recordedMs: 1250 });

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenNthCalledWith(1, { type: "sample", amplitude: 0.42 });
    expect(b).toHaveBeenNthCalledWith(2, { type: "tick", recordedMs: 1250 });

    unsubA();
    publishRecordingEvent({ type: "tick", recordedMs: 1500 });
    expect(a).toHaveBeenCalledTimes(2); // unsubscribed — no more events
    expect(b).toHaveBeenCalledTimes(3);
  });

  it("a throwing subscriber never breaks the recorder", () => {
    const ok = vi.fn();
    subscribeRecordingIndicator(() => {
      throw new Error("broken indicator");
    });
    subscribeRecordingIndicator(ok);
    expect(() => publishRecordingEvent({ type: "tick", recordedMs: 1 })).not.toThrow();
    expect(ok).toHaveBeenCalledWith({ type: "tick", recordedMs: 1 });
  });
});

describe("RemoteRecordingIndicator (SSR smoke, issue #26)", () => {
  it("renders as a status — never as a sent message", () => {
    const html = renderToString(createElement(RemoteRecordingIndicator));
    expect(html).toContain('role="status"');
    expect(html).toContain("Lòt moun nan ap anrejistre yon mesaj vwa");
  });

  it("shows a pulsing microphone pill (decorative) in the typing-row language", () => {
    const html = renderToString(createElement(RemoteRecordingIndicator));
    expect(html).toContain("recording-remote-row");
    expect(html).toContain("recording-remote-pill");
    expect(html).toContain("recording-remote-mic");
    expect(html).toContain("Ap anrejistre…");
    // The animated icon is decorative — screen readers get the label once.
    expect(html).toContain('aria-hidden="true"');
  });

  it("does not render inside a bubble-row (it is not a message)", () => {
    const html = renderToString(createElement(RemoteRecordingIndicator));
    expect(html).not.toContain("bubble-row");
    expect(html).not.toContain('class="bubble"');
    // No duration/timer/waveform in the REMOTE indicator — activity only.
    expect(html).not.toContain("recording-timer");
    expect(html).not.toContain("recording-wave");
  });
});

describe("Source contracts — recipient-only recording activity (issue #26)", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("the sender's own chat log shows NO recording bubble", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    expect(src).not.toContain("<RecordingBubble");
    expect(src).not.toContain("RecordingBubble");
  });

  it("the remote indicator renders from the partner's activity state", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    expect(src).toContain("{partnerRecording && <RemoteRecordingIndicator />}");
  });

  it("outgoing activity is signaled only while capture is genuinely active", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    // The recorder's authoritative mode is the trigger: "recording" excludes
    // permission requests (requesting_permission), preview, upload, retries.
    expect(src).toMatch(
      /if \(voiceMode === "recording"\) recordingSignalerRef\.current\?\.start\(\);/,
    );
    expect(src).toContain("else recordingSignalerRef.current?.stop();");
    // The signaler is torn down (explicit stop) on unmount/consultation change.
    expect(src).toMatch(/signaler\.stop\(\);\s*\n\s*recordingSignalerRef\.current = null;/);
  });

  it("the socket sends the minimal activity payload (no media/duration metadata)", async () => {
    const src = await read("lib/ws/socket.ts");
    expect(src).toContain(
      'return this.send({ type: "recording", consultationId, isRecording });',
    );
    // Nothing else rides along on the recording frame.
    const frame = src.slice(
      src.indexOf("sendRecording("),
      src.indexOf("}", src.indexOf("type: \"recording\"")),
    );
    expect(frame).not.toContain("duration");
    expect(frame).not.toContain("fileUrl");
    expect(frame).not.toContain("senderName");
  });

  it("a dropped socket clears the remote indicator (no permanent mic)", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    expect(src).toMatch(
      /recordingTrackerRef\.current\?\.clear\(\);\s*\n\s*setPartnerRecording\(false\);/,
    );
  });

  it("globals.css ships the remote indicator + pulse + reduced-motion styles", async () => {
    const css = await read("app/globals.css");
    expect(css).toContain(".recording-remote-row");
    expect(css).toContain("remote-mic-pulse");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?\.recording-remote-mic \{ animation: none;/);
  });

  it("the composer's local recording UI (telemetry publishing) is untouched", async () => {
    const src = await read("components/consultation/VoiceRecorder.tsx");
    expect(src).toContain('publishRecordingEvent({ type: "sample", amplitude })');
    expect(src).toContain('publishRecordingEvent({ type: "tick", recordedMs: total })');
    // The recorder still reports its authoritative mode to the page — the
    // composer controls (timer/waveform/preview) remain fully in place.
    expect(src).toContain("onModeChange?.(state.mode)");
  });
});
