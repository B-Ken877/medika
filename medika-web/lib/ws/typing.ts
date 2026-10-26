/**
 * Typing-indicator logic — extracted from the chat page so it is testable.
 *
 * Outgoing (TypingNotifier): throttled "typing: true" while the draft is
 * non-empty; explicit "typing: false" on send, on empty draft, on blur and on
 * teardown. Never fires per keystroke.
 *
 * Incoming (PartnerTypingTracker): consumes typing events for ONE
 * consultation/participant, self-events ignored, stale state cleared by a
 * client-side timeout and on reconnect — a dropped socket can never leave a
 * permanent "typing" bubble behind.
 */
import type { WsTypingEvent } from "../api/types";

/** How long a received "typing: true" stays valid without a refresh. */
export const PARTNER_TYPING_TIMEOUT_MS = 4000;
/** Minimum interval between two outgoing "typing: true" signals. */
export const TYPING_THROTTLE_MS = 2000;

export class TypingNotifier {
  private lastSentAt = 0;
  private active = false;

  constructor(
    private send: (isTyping: boolean) => void,
    private throttleMs = TYPING_THROTTLE_MS,
    private now: () => number = () => Date.now(),
  ) {}

  /** To be called on every draft change. */
  notify(text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      const now = this.now();
      if (now - this.lastSentAt >= this.throttleMs) {
        this.lastSentAt = now;
        this.active = true;
        this.send(true);
      }
    } else if (this.active) {
      this.stop();
    }
  }

  /** Explicit stop (send succeeded / composer blurred / leaving). */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lastSentAt = 0;
    this.send(false);
  }

  /** Consultation changed: forget state WITHOUT signaling the old room. */
  reset(): void {
    this.active = false;
    this.lastSentAt = 0;
  }

  get isSignaling(): boolean {
    return this.active;
  }
}

export class PartnerTypingTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private typing = false;

  constructor(private timeoutMs = PARTNER_TYPING_TIMEOUT_MS) {}

  /** Apply one typing event; returns the (possibly new) partner-typing state. */
  applyEvent(event: WsTypingEvent, opts: { consultationId: string; selfId: string | null | undefined }): boolean {
    if (event.consultationId !== opts.consultationId) return this.typing; // other consultation
    if (event.senderId === opts.selfId) return this.typing; // own echo — ignore
    this.clearTimer();
    this.typing = Boolean(event.isTyping);
    if (this.typing) {
      this.timer = setTimeout(() => {
        this.typing = false;
        this.onExpire?.();
      }, this.timeoutMs);
    }
    return this.typing;
  }

  /** Server-side/client-side staleness guard — clears without an event. */
  clear(): void {
    this.clearTimer();
    this.typing = false;
  }

  /** Called when the timeout fires, so the UI can re-render. */
  onExpire: (() => void) | null = null;

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isTyping(): boolean {
    return this.typing;
  }
}
