/**
 * Recording indicator (issue #19) — the telemetry bus between the voice
 * composer and the chat-area bubble, the bubble's SSR smoke, and source
 * contracts for the recording lifecycle wiring.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  clearRecordingIndicatorSubscribers,
  publishRecordingEvent,
  subscribeRecordingIndicator,
} from "@/lib/chat/recording-indicator";
import { RecordingBubble } from "@/components/consultation/RecordingBubble";

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

describe("RecordingBubble (SSR smoke)", () => {
  it("renders as a status — never as a sent message", () => {
    const html = renderToString(createElement(RecordingBubble));
    expect(html).toContain('role="status"');
    expect(html).toContain("N ap anrejistre yon mesaj vwa");
  });

  it("renders the mic indicator, a waveform and a timer (decorative)", () => {
    const html = renderToString(createElement(RecordingBubble));
    expect(html).toContain("voice-rec-dot");
    expect(html).toContain("recording-wave");
    expect(html).toContain("recording-timer");
    expect(html).toContain("0:00");
    // Pre-first-sample fallback keeps the bubble alive instantly.
    expect(html).toContain("height:20%"); // 12 flat bars at 0.2
  });

  it("does not render inside a bubble-row (it is not a message)", () => {
    const html = renderToString(createElement(RecordingBubble));
    expect(html).not.toContain("bubble-row");
    expect(html).not.toContain('class="bubble"');
  });
});

describe("Source contracts — recording lifecycle (issue #19)", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("the recorder publishes amplitude + duration telemetry", async () => {
    const src = await read("components/consultation/VoiceRecorder.tsx");
    expect(src).toContain("publishRecordingEvent({ type: \"sample\", amplitude })");
    expect(src).toContain("publishRecordingEvent({ type: \"tick\", recordedMs: total })");
    // The publish must be INSIDE the same loops that drive the composer UI.
    expect(src).toMatch(/dispatch\(\{ type: "SAMPLE", amplitude \}\);\s*\n\s*\/\/ Chat-area recording bubble[\s\S]*?publishRecordingEvent/);
  });

  it("the chat page shows the bubble ONLY while actually recording", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    expect(src).toContain('voiceMode === "recording" && <RecordingBubble />');
  });

  it("the bubble is removed on every exit path (mode-gated render)", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    // The page derives voiceMode from the recorder's authoritative mode —
    // stop / cancel / failure all leave "recording", so the bubble unmounts.
    expect(src).toContain("onModeChange={setVoiceMode}");
  });

  it("globals.css ships the recording bubble styles (typing-bubble language)", async () => {
    const css = await read("app/globals.css");
    expect(css).toContain(".recording-row {");
    expect(css).toContain(".recording-wave");
    expect(css).toContain(".recording-timer");
  });
});
