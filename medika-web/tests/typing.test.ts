/**
 * Typing behavior — throttling, stop conditions, timeouts, isolation,
 * cleanup, reconnect safety. Pure logic tests with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerTypingTracker, TypingNotifier } from "@/lib/ws/typing";
import type { WsTypingEvent } from "@/lib/api/types";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TypingNotifier (outgoing)", () => {
  function harness(throttleMs = 2000) {
    const sent: Array<{ isTyping: boolean; at: number }> = [];
    let clock = 1_000_000;
    const notifier = new TypingNotifier(
      (isTyping) => sent.push({ isTyping, at: clock }),
      throttleMs,
      () => clock,
    );
    return {
      sent,
      advance: (ms: number) => {
        clock += ms;
      },
      notifier,
    };
  }

  it("sends typing:true once per throttle window — never per keystroke", () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.notifier.notify(`k${i} `);
    expect(h.sent).toEqual([{ isTyping: true, at: 1_000_000 }]);
  });

  it("re-sends after the throttle window elapses", () => {
    const h = harness();
    h.notifier.notify("bonjou");
    h.advance(2100);
    h.notifier.notify("bonjou doktè");
    expect(h.sent.filter((s) => s.isTyping)).toHaveLength(2);
  });

  it("signals typing:false when the draft becomes empty", () => {
    const h = harness();
    h.notifier.notify("bonjou");
    expect(h.sent).toHaveLength(1);
    h.notifier.notify("");
    expect(h.sent).toEqual([
      { isTyping: true, at: 1_000_000 },
      { isTyping: false, at: 1_000_000 },
    ]);
  });

  it("whitespace-only drafts count as empty", () => {
    const h = harness();
    h.notifier.notify("bonjou");
    h.notifier.notify("   ");
    expect(h.sent.some((s) => !s.isTyping)).toBe(true);
  });

  it("stop() sends typing:false exactly once (send success / blur / leave)", () => {
    const h = harness();
    h.notifier.notify("bonjou");
    h.notifier.stop();
    h.notifier.stop(); // second stop is a no-op
    expect(h.sent.filter((s) => !s.isTyping)).toHaveLength(1);
  });

  it("stop() on an idle notifier sends nothing", () => {
    const h = harness();
    h.notifier.stop();
    expect(h.sent).toHaveLength(0);
  });

  it("reset() forgets the room WITHOUT signaling (consultation change)", () => {
    const h = harness();
    h.notifier.notify("bonjou");
    h.notifier.reset();
    h.notifier.notify("nouvo mesaj");
    // reset cleared the active state → the new notify re-signals immediately.
    expect(h.sent).toEqual([
      { isTyping: true, at: 1_000_000 },
      { isTyping: true, at: 1_000_000 },
    ]);
  });
});

describe("PartnerTypingTracker (incoming)", () => {
  const opts = { consultationId: "cons_1", selfId: "me" };

  function event(overrides: Partial<WsTypingEvent> = {}): WsTypingEvent {
    return {
      type: "typing",
      consultationId: "cons_1",
      senderId: "partner",
      isTyping: true,
      ...overrides,
    };
  }

  it("shows typing for the remote participant and refreshes the timeout", () => {
    const tracker = new PartnerTypingTracker(4000);
    expect(tracker.applyEvent(event(), opts)).toBe(true);
    // A second event re-arms the timeout.
    tracker.applyEvent(event(), opts);
    vi.advanceTimersByTime(3500);
    expect(tracker.isTyping).toBe(true);
    vi.advanceTimersByTime(600);
    expect(tracker.isTyping).toBe(false); // stale state cleared
  });

  it("typing:false clears immediately", () => {
    const tracker = new PartnerTypingTracker(4000);
    tracker.applyEvent(event(), opts);
    expect(tracker.applyEvent(event({ isTyping: false }), opts)).toBe(false);
  });

  it("ignores events from other consultations", () => {
    const tracker = new PartnerTypingTracker(4000);
    tracker.applyEvent(event({ consultationId: "cons_other" }), opts);
    expect(tracker.isTyping).toBe(false);
  });

  it("ignores the user's own typing echoes", () => {
    const tracker = new PartnerTypingTracker(4000);
    tracker.applyEvent(event({ senderId: "me" }), opts);
    expect(tracker.isTyping).toBe(false);
  });

  it("clear() is safe on reconnect — no permanent typing bubble", () => {
    const tracker = new PartnerTypingTracker(4000);
    tracker.applyEvent(event(), opts);
    tracker.clear();
    expect(tracker.isTyping).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(tracker.isTyping).toBe(false);
  });

  it("notifies the UI through onExpire when the timeout fires", () => {
    const tracker = new PartnerTypingTracker(4000);
    let expired = false;
    tracker.onExpire = () => {
      expired = true;
    };
    tracker.applyEvent(event(), opts);
    vi.advanceTimersByTime(4001);
    expect(expired).toBe(true);
  });
});
