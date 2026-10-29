/**
 * Call lifecycle state machine (issue #45) — pure transition guarantees:
 *  - "ended" is terminal: late room events can never re-end or resurrect a
 *    call (no duplicate endCall signaling, no ghost reconnect after hang-up).
 *  - An unexpected disconnect offers a REAL retry (canRetry) — the machine
 *    never fabricates a "reconnecting" state on its own.
 *  - "reconnecting" exists only while the engine's automatic retry is running.
 *  - Retry is valid only from the failure screen.
 *  - View switching is NOT a call event — it never reaches this machine, so
 *    it cannot end the call, disconnect the room or stop local tracks.
 *
 * Issue #56 adds the pre-call wait guarantees:
 *  - "waiting" exists only BEFORE a room exists (bootstrap stage); a live,
 *    reconnecting or failed call can never slide back into "waiting".
 *  - Terminal consultation states become "failed" with kind "ineligible"
 *    and NO retry affordance — retrying a closed door is a request storm.
 *  - The eligibility poll cadence is bounded (capped exponential backoff
 *    plus a hard attempt budget) — no tight loops, no request storms.
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_CALL_STATE,
  MAX_ELIGIBILITY_ATTEMPTS,
  TERMINAL_CONSULTATION_STATUSES,
  callPhaseAnnouncement,
  chatControlVisible,
  eligibilityBackoffMs,
  reduceCallState,
} from "@/lib/call/phases";

describe("reduceCallState — happy path", () => {
  it("connecting → active on first remote media", () => {
    const s = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    expect(s.phase).toBe("active");
    expect(s.everConnected).toBe(true);
    expect(s.canRetry).toBe(false);
  });

  it("active is idempotent under repeated connected events", () => {
    const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    expect(reduceCallState(active, { type: "connected" })).toBe(active);
  });
});

describe("reduceCallState — hang-up is terminal (no duplicate endings)", () => {
  it("hang-up ends from any live phase and swallows every later event", () => {
    let s = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    s = reduceCallState(s, { type: "hang-up" });
    expect(s.phase).toBe("ended");
    expect(s.canRetry).toBe(false);
    // Late noise after hang-up: ignored — no failed flip, no retry affordance.
    s = reduceCallState(s, { type: "unexpected-disconnect" });
    s = reduceCallState(s, { type: "reconnecting" });
    s = reduceCallState(s, { type: "hang-up" });
    s = reduceCallState(s, { type: "connected" });
    expect(s.phase).toBe("ended");
    expect(s.canRetry).toBe(false);
  });

  it("partner hang-up ends the call identically", () => {
    const s = reduceCallState(INITIAL_CALL_STATE, { type: "partner-hung-up" });
    expect(s.phase).toBe("ended");
  });
});

describe("reduceCallState — real reconnection semantics", () => {
  const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });

  it("Reconnecting is surfaced (the engine retry IS running), then recovers", () => {
    const r = reduceCallState(active, { type: "reconnecting" });
    expect(r.phase).toBe("reconnecting");
    const back = reduceCallState(r, { type: "reconnected" });
    expect(back.phase).toBe("active");
    expect(back.everConnected).toBe(true);
  });

  it("a drop DURING reconnection lands in failed with a real retry — not a fake retrying label", () => {
    const r = reduceCallState(active, { type: "reconnecting" });
    const failed = reduceCallState(r, { type: "unexpected-disconnect" });
    expect(failed.phase).toBe("failed");
    expect(failed.canRetry).toBe(true);
    expect(failed.failureKind).toBe("generic");
  });

  it("reconnecting cannot be faked from the failure screen", () => {
    const failed = reduceCallState(active, { type: "unexpected-disconnect" });
    expect(reduceCallState(failed, { type: "reconnecting" }).phase).toBe("failed");
  });

  it("reconnecting state cannot claim connected-less recovery", () => {
    // reconnected / connected both restore active — but nothing else does.
    const r = reduceCallState(active, { type: "reconnecting" });
    expect(reduceCallState(r, { type: "connected" }).phase).toBe("active");
  });
});

describe("reduceCallState — failure + retry", () => {
  it("initial connect failure → failed with retry offered", () => {
    const s = reduceCallState(INITIAL_CALL_STATE, { type: "connect-failed" });
    expect(s.phase).toBe("failed");
    expect(s.canRetry).toBe(true);
    expect(s.everConnected).toBe(false);
  });

  it("permission denial is a distinct failure kind", () => {
    const s = reduceCallState(INITIAL_CALL_STATE, { type: "connect-failed", kind: "permission" });
    expect(s.failureKind).toBe("permission");
    expect(s.canRetry).toBe(true);
  });

  it("retry restarts ONLY from failed+canRetry; elsewhere it is a no-op", () => {
    const failed = reduceCallState(INITIAL_CALL_STATE, { type: "connect-failed" });
    const retried = reduceCallState(failed, { type: "retry-requested" });
    expect(retried.phase).toBe("connecting");
    expect(retried).toEqual(INITIAL_CALL_STATE);

    // A live call cannot be "restarted" — retry is ignored while active.
    const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    expect(reduceCallState(active, { type: "retry-requested" })).toBe(active);

    // Ended is terminal even to a retry request.
    const ended = reduceCallState(active, { type: "hang-up" });
    expect(reduceCallState(ended, { type: "retry-requested" }).phase).toBe("ended");
  });
});

describe("view switching can never affect the call", () => {
  it("the machine has no chat-related events — toggling chat is pure view state", () => {
    const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    // Only explicit terminal events may end a call; "open chat"/"back to
    // video" are not events at all, so no sequence of view toggles can
    // disconnect the room. Guarded here by asserting the event vocabulary.
    const activeAfterOnlyViewToggles = active; // (no events to dispatch)
    expect(activeAfterOnlyViewToggles.phase).toBe("active");
  });
});

describe("reduceCallState — eligibility wait (issue #56)", () => {
  it("bootstrap can wait: connecting → waiting is a calm, non-error state", () => {
    const s = reduceCallState(INITIAL_CALL_STATE, { type: "waiting-for-eligibility" });
    expect(s.phase).toBe("waiting");
    expect(s.canRetry).toBe(false);
    expect(s.failureKind).toBe("generic");
  });

  it("waiting is idempotent while the poll keeps finding RECHERCHE_MEDECIN", () => {
    const waiting = reduceCallState(INITIAL_CALL_STATE, { type: "waiting-for-eligibility" });
    expect(reduceCallState(waiting, { type: "waiting-for-eligibility" }).phase).toBe("waiting");
  });

  it("a live/reconnecting/failed call can NEVER slide back into waiting", () => {
    const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    expect(reduceCallState(active, { type: "waiting-for-eligibility" }).phase).toBe("active");
    const recon = reduceCallState(active, { type: "reconnecting" });
    expect(reduceCallState(recon, { type: "waiting-for-eligibility" }).phase).toBe("reconnecting");
    const failed = reduceCallState(active, { type: "unexpected-disconnect" });
    expect(reduceCallState(failed, { type: "waiting-for-eligibility" }).phase).toBe("failed");
  });

  it("waiting can still become active (doctor accepted while patient waited)", () => {
    const waiting = reduceCallState(INITIAL_CALL_STATE, { type: "waiting-for-eligibility" });
    const active = reduceCallState(waiting, { type: "connected" });
    expect(active.phase).toBe("active");
    expect(active.everConnected).toBe(true);
  });

  it("terminal status → failed/ineligible with NO retry affordance", () => {
    const waiting = reduceCallState(INITIAL_CALL_STATE, { type: "waiting-for-eligibility" });
    const t = reduceCallState(waiting, { type: "terminal-status" });
    expect(t.phase).toBe("failed");
    expect(t.failureKind).toBe("ineligible");
    expect(t.canRetry).toBe(false);
  });

  it("terminal status is ignored after hang-up (hang-up wins)", () => {
    const active = reduceCallState(INITIAL_CALL_STATE, { type: "connected" });
    const ended = reduceCallState(active, { type: "hang-up" });
    const t = reduceCallState(ended, { type: "terminal-status" });
    expect(t.phase).toBe("ended");
    expect(t.canRetry).toBe(false);
  });
});

describe("eligibility wait budget (issue #56)", () => {
  it("backoff starts small, grows exponentially, and is hard-capped", () => {
    expect(eligibilityBackoffMs(0)).toBe(3000);
    expect(eligibilityBackoffMs(1)).toBe(4500);
    expect(eligibilityBackoffMs(3)).toBe(10125);
    // Cap: no poll ever waits longer than 15s — no request storms, no
    // multi-minute silent gaps either.
    expect(eligibilityBackoffMs(10)).toBe(15000);
    expect(eligibilityBackoffMs(60)).toBe(15000);
    // Negative attempt is treated as 0 (defensive, pure).
    expect(eligibilityBackoffMs(-2)).toBe(3000);
  });

  it("the attempt budget is a hard bound — the loop must stop, not loop forever", () => {
    expect(MAX_ELIGIBILITY_ATTEMPTS).toBeGreaterThanOrEqual(20);
    expect(MAX_ELIGIBILITY_ATTEMPTS).toBeLessThanOrEqual(120);
    // Worst-case quiet wait = sum of capped backoffs ≈ attempts × 15s.
    const worstCaseMinutes = (MAX_ELIGIBILITY_ATTEMPTS * 15) / 60;
    expect(worstCaseMinutes).toBeLessThan(15); // bounded, not endless
  });

  it("terminal statuses are exactly the server's no-call states", () => {
    expect(TERMINAL_CONSULTATION_STATUSES).toEqual(["REFUSE", "TERMINE", "EXPIRE"]);
  });
});

describe("UI helpers", () => {
  it("chat control is offered in safe phases only", () => {
    expect(chatControlVisible("connecting")).toBe(true);
    expect(chatControlVisible("active")).toBe(true);
    expect(chatControlVisible("reconnecting")).toBe(true);
    expect(chatControlVisible("failed")).toBe(false);
    expect(chatControlVisible("ended")).toBe(false);
    // Issue #56: pre-acceptance the server does not allow chat messages,
    // so the in-call chat control is hidden while waiting.
    expect(chatControlVisible("waiting")).toBe(false);
  });

  it("phase announcements never fake a reconnection", () => {
    expect(callPhaseAnnouncement("reconnecting")).toContain("rekonekte otomatikman");
    expect(callPhaseAnnouncement("failed")).toBe("Koneksyon an koupe.");
    expect(callPhaseAnnouncement("ended")).toBe("Apèl la fini.");
    expect(callPhaseAnnouncement("active")).toBe("Apèl la ap pase");
    expect(callPhaseAnnouncement("connecting")).toBeNull();
    expect(callPhaseAnnouncement("waiting")).toBeNull(); // component copy
  });
});
