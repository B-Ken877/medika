"use client";

/**
 * RecordingBubble — in-conversation recording status (issue #19).
 *
 * A compact right-aligned bubble in the chat log while the user records a
 * voice message, visually aligned with the existing typing indicator (same
 * surface/border/radius language, own-side alignment). Shows a live waveform
 * (real amplitude from the recorder's Web Audio analysis) and a duration
 * timer; removed the instant recording stops, is cancelled or fails (the
 * page only renders it while the recorder mode is "recording").
 *
 * Accessibility: ONE polite announcement when it appears — the ticking timer
 * and the waveform are decorative (aria-hidden) so screen readers are never
 * spammed 4×/second. It is a STATUS, never a sent message.
 */
import { useEffect, useState } from "react";
import { pushSample, formatRecordingDuration, VOICE_BAR_COUNT } from "@/lib/chat/voice";
import { subscribeRecordingIndicator } from "@/lib/chat/recording-indicator";

const FLAT_BARS = 12; // pre-first-sample fallback, mirrors the composer

export function RecordingBubble() {
  const [bars, setBars] = useState<number[]>([]);
  const [recordedMs, setRecordedMs] = useState(0);

  useEffect(() => {
    return subscribeRecordingIndicator((event) => {
      if (event.type === "sample") {
        setBars((prev) => pushSample(prev, event.amplitude, VOICE_BAR_COUNT));
      } else {
        setRecordedMs(event.recordedMs);
      }
    });
  }, []);

  const shown =
    bars.length > 0
      ? bars
      : Array.from({ length: FLAT_BARS }, () => 0.2);

  return (
    <div className="recording-row" role="status" aria-label="N ap anrejistre yon mesaj vwa">
      <span className="voice-rec-dot" aria-hidden="true" />
      <span className="recording-wave" aria-hidden="true">
        {shown.map((b, i) => (
          <span key={i} style={{ height: `${Math.round(Math.max(0.14, b) * 100)}%` }} />
        ))}
      </span>
      <span className="recording-timer" aria-hidden="true">
        {formatRecordingDuration(recordedMs / 1000)}
      </span>
    </div>
  );
}
