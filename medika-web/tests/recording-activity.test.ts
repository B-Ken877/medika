/**
 * Recording activity signaling (issue #26) — unit tests mirroring the typing
 * suite: heartbeat lifecycle, idempotency, consultation scoping, self-echo
 * filtering, stale timeout and cleanup paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PartnerRecordingTracker,
  RecordingSignaler,
  RECORDING_HEARTBEAT_MS,
  PARTNER_RECORDING_TIMEOUT_MS,
} from "@/lib/ws/recording";

describe("RecordingSignaler (outgoing)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one start signal and then only slow heartbeats", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send, 4000);
    s.start();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(4000 * 5); // 5 heartbeat periods
    expect(send).toHaveBeenCalledTimes(6); // start + 5 refreshes, all `true`
    expect(send.mock.calls.every(([v]) => v === true)).toBe(true);
  });

  it("stop sends an explicit false exactly once and stops the heartbeat", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send, 4000);
    s.start();
    vi.advanceTimersByTime(8000); // start + 2 heartbeats
    s.stop();
    expect(send).toHaveBeenLastCalledWith(false);

    const callsAtStop = send.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(callsAtStop); // heartbeat is dead
  });

  it("stop while inactive is a no-op (no spurious false frames)", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send);
    s.stop();
    expect(send).not.toHaveBeenCalled();
  });

  it("double start is idempotent — one signal, one heartbeat", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send, 4000);
    s.start();
    s.start();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("resume after stop signals fresh (start → stop → start)", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send, 4000);
    s.start();
    s.stop();
    s.start(); // resumed capture is genuinely active again
    expect(send.mock.calls.map(([v]) => v)).toEqual([true, false, true]);
  });

  it("reset forgets state WITHOUT signaling the old room", () => {
    const send = vi.fn();
    const s = new RecordingSignaler(send, 4000);
    s.start();
    s.reset(); // consultation changed — recipient's stale timeout cleans up
    expect(send).toHaveBeenCalledTimes(1); // only the initial true
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(1); // heartbeat gone, no false sent
  });

  it("exports a sane heartbeat < stale timeout ratio", () => {
    // At least two heartbeats must fit inside the recipient's stale window
    // so one lost frame never clears a live indicator.
    expect(RECORDING_HEARTBEAT_MS * 2).toBeLessThanOrEqual(PARTNER_RECORDING_TIMEOUT_MS);
  });
});

describe("PartnerRecordingTracker (incoming)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const ev = (isRecording: boolean, consultationId = "c1", senderId = "other") =>
    ({ type: "recording" as const, consultationId, senderId, isRecording });

  it("a start event shows the indicator; the stale timeout clears it", () => {
    const t = new PartnerRecordingTracker(1000);
    t.onExpire = vi.fn();
    expect(t.applyEvent(ev(true), { consultationId: "c1", selfId: "me" })).toBe(true);
    vi.advanceTimersByTime(999);
    expect(t.isRecording).toBe(true);
    vi.advanceTimersByTime(2);
    expect(t.isRecording).toBe(false);
    expect(t.onExpire).toHaveBeenCalledTimes(1);
  });

  it("a heartbeat refresh keeps a live indicator alive indefinitely", () => {
    const t = new PartnerRecordingTracker(1000);
    for (let i = 0; i < 25; i++) {
      t.applyEvent(ev(true), { consultationId: "c1", selfId: "me" });
      vi.advanceTimersByTime(700); // under the window
    }
    expect(t.isRecording).toBe(true);
  });

  it("an explicit stop event clears immediately — no timeout wait", () => {
    const t = new PartnerRecordingTracker(5000);
    t.applyEvent(ev(true), { consultationId: "c1", selfId: "me" });
    expect(t.applyEvent(ev(false), { consultationId: "c1", selfId: "me" })).toBe(false);
    vi.advanceTimersByTime(50_000);
    expect(t.isRecording).toBe(false);
  });

  it("ignores events for another consultation", () => {
    const t = new PartnerRecordingTracker();
    expect(t.applyEvent(ev(true, "OTHER"), { consultationId: "c1", selfId: "me" })).toBe(false);
    expect(t.isRecording).toBe(false);
  });

  it("ignores the sender's own socket echo", () => {
    const t = new PartnerRecordingTracker();
    expect(t.applyEvent(ev(true, "c1", "me"), { consultationId: "c1", selfId: "me" })).toBe(false);
    expect(t.isRecording).toBe(false);
  });

  it("clear() wipes state without an event (consultation change/disconnect)", () => {
    const t = new PartnerRecordingTracker(1000);
    t.applyEvent(ev(true), { consultationId: "c1", selfId: "me" });
    t.clear();
    expect(t.isRecording).toBe(false);
    vi.advanceTimersByTime(5000);
    // onExpire never fires after clear — no ghost re-render
  });
});
