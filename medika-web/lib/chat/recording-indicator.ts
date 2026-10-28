/**
 * Recording indicator bus (issue #19).
 *
 * The VoiceRecorder (composer) owns the MediaRecorder lifecycle, its live
 * amplitude samples and its segment timer. The chat-area RecordingBubble
 * needs the same telemetry WITHOUT re-rendering the whole chat page several
 * times a second — so the recorder publishes lightweight events here and the
 * bubble subscribes with its own local state. Only components that subscribe
 * re-render.
 *
 * Events stop naturally when recording stops/cancels/fails (the bubble
 * unmounts on the mode change), so no explicit "clear" event is needed.
 */

export type RecordingIndicatorEvent =
  | { type: "sample"; amplitude: number }
  | { type: "tick"; recordedMs: number };

type Listener = (event: RecordingIndicatorEvent) => void;

const listeners = new Set<Listener>();

/** Publish one telemetry event to every subscribed indicator. */
export function publishRecordingEvent(event: RecordingIndicatorEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken indicator must never break the recording itself.
    }
  }
}

/** Subscribe; returns an unsubscribe function. */
export function subscribeRecordingIndicator(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — drop every subscriber. */
export function clearRecordingIndicatorSubscribers(): void {
  listeners.clear();
}
