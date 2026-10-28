/**
 * Voice-recording activity signaling (issue #26) — the WhatsApp-style,
 * recipient-only counterpart of typing.ts.
 *
 * Outgoing (RecordingSignaler): ONE "recording:true" the moment microphone
 * capture is genuinely active, refreshed by a slow heartbeat so the
 * recipient's indicator survives a lost frame, and an explicit
 * "recording:false" on every exit path (stop into preview, cancel, discard,
 * cap reached, failure, unmount, consultation change). Never fires during
 * permission requests, preview, upload or send retries — the caller gates on
 * the recorder's authoritative "recording" mode.
 *
 * Incoming (PartnerRecordingTracker): consumes recording events for ONE
 * consultation/participant, self-echo ignored, stale state cleared by a
 * client-side timeout and on reconnect — a dropped socket or a lost stop
 * frame can never leave a permanent microphone indicator behind.
 */
import type { WsRecordingEvent } from "../api/types";

/** How long a received "recording:true" stays valid without a heartbeat. */
export const PARTNER_RECORDING_TIMEOUT_MS = 10_000;
/** Heartbeat interval for an active outgoing recording signal. */
export const RECORDING_HEARTBEAT_MS = 4_000;

export class RecordingSignaler {
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(
    private send: (isRecording: boolean) => void,
    private heartbeatMs = RECORDING_HEARTBEAT_MS,
  ) {}

  /** Microphone capture just became genuinely active. Idempotent: while
   *  already active the existing heartbeat simply keeps refreshing the
   *  recipient's indicator. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.send(true);
    if (this.heartbeatMs > 0) {
      this.heartbeat = setInterval(() => this.send(true), this.heartbeatMs);
    }
  }

  /** Recording ended for ANY reason (stop/pause into preview, cancel,
   *  discard, cap, failure). Sends an explicit stop exactly once. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.clearHeartbeat();
    this.send(false);
  }

  /** Consultation changed / socket replaced: forget state WITHOUT signaling
   *  the old room (the recipient's stale timeout handles cleanup). */
  reset(): void {
    this.active = false;
    this.clearHeartbeat();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  get isSignaling(): boolean {
    return this.active;
  }
}

export class PartnerRecordingTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recording = false;

  constructor(private timeoutMs = PARTNER_RECORDING_TIMEOUT_MS) {}

  /** Apply one recording event; returns the (possibly new) state. */
  applyEvent(
    event: WsRecordingEvent,
    opts: { consultationId: string; selfId: string | null | undefined },
  ): boolean {
    if (event.consultationId !== opts.consultationId) return this.recording; // other consultation
    if (event.senderId === opts.selfId) return this.recording; // own echo — ignore
    this.clearTimer();
    this.recording = Boolean(event.isRecording);
    if (this.recording) {
      this.timer = setTimeout(() => {
        this.recording = false;
        this.onExpire?.();
      }, this.timeoutMs);
    }
    return this.recording;
  }

  /** Staleness guard — clears without an event (consultation change,
   *  socket disconnect/reconnect). */
  clear(): void {
    this.clearTimer();
    this.recording = false;
  }

  /** Called when the stale timeout fires, so the UI can re-render. */
  onExpire: (() => void) | null = null;

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isRecording(): boolean {
    return this.recording;
  }
}
