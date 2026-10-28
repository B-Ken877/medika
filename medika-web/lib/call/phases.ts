/**
 * Call lifecycle state machine (issue #45) — pure, testable logic that used
 * to be scattered across ad-hoc refs and setState calls in the call page.
 *
 * Guarantees encoded here:
 *  - "ended" is terminal: once the user hangs up (or the partner does), no
 *    later room event can resurrect or re-end the call (no duplicate
 *    endCall signaling, no ghost reconnect after hang-up).
 *  - A dropped connection after the call was live becomes "failed" WITH a
 *    real retry affordance (canRetry) — the UI must never claim a
 *    reconnection is happening unless LiveKit's automatic reconnection is
 *    actually in progress (phase "reconnecting").
 *  - View switching (chat <-> video) is NOT a call event: toggling the
 *    in-call chat panel never reaches this machine, so it cannot end the
 *    call, disconnect the room or stop local tracks.
 */

export type CallPhase =
  | "connecting"
  | "active"
  | "reconnecting"
  | "ended"
  | "failed";

/** Why a call landed in "failed" — drives the user-facing copy. */
export type CallFailureKind = "generic" | "permission";

export type CallEvent =
  /** Remote media subscribed / room fully up — the call is live. */
  | { type: "connected" }
  /** LiveKit RoomEvent.Reconnecting — an automatic retry IS in progress. */
  | { type: "reconnecting" }
  /** LiveKit RoomEvent.Reconnected — the automatic retry succeeded. */
  | { type: "reconnected" }
  /** RoomEvent.Disconnected while the user never hung up. */
  | { type: "unexpected-disconnect" }
  /** Initial connect attempt threw. `kind` distinguishes permission denials. */
  | { type: "connect-failed"; kind?: CallFailureKind }
  /** Explicit End call by this user (the ONLY user-driven terminal event). */
  | { type: "hang-up" }
  /** Partner sent call:ended / call:rejected over the Medika WS. */
  | { type: "partner-hung-up" }
  /** User clicked the Retry button on the failure screen — fresh attempt
   *  with a newly minted token. Only valid from "failed". */
  | { type: "retry-requested" };

export interface CallState {
  phase: CallPhase;
  failureKind: CallFailureKind;
  /** A real retry is possible: re-fetch a token and reconnect the room. */
  canRetry: boolean;
  /** True once the call had actually been established (used for copy). */
  everConnected: boolean;
}

export const INITIAL_CALL_STATE: CallState = {
  phase: "connecting",
  failureKind: "generic",
  canRetry: false,
  everConnected: false,
};

/** Pure reducer — same input always yields the same next state. */
export function reduceCallState(state: CallState, event: CallEvent): CallState {
  // Terminal: after hang-up (ours or the partner's) every later event is
  // ignored — late Disconnect/TrackUnsubscribed noise must not flip the UI
  // back to "failed" or fire a second endCall.
  if (state.phase === "ended") return state;

  if (event.type === "hang-up" || event.type === "partner-hung-up") {
    return { ...state, phase: "ended", canRetry: false };
  }

  if (event.type === "reconnecting") {
    // LiveKit is genuinely auto-retrying — a REAL state, safe to surface.
    return state.phase === "connecting" || state.phase === "active"
      ? { ...state, phase: "reconnecting" }
      : state;
  }

  if (event.type === "connected" || event.type === "reconnected") {
    // Idempotent: a repeated connected event keeps the call active.
    if (state.phase === "active") return state;
    return { ...state, phase: "active", everConnected: true, canRetry: false };
  }

  if (event.type === "unexpected-disconnect") {
    // Network loss: offer a real retry regardless of whether media had been
    // established — the retry action re-fetches a fresh token.
    return { ...state, phase: "failed", failureKind: "generic", canRetry: true };
  }

  if (event.type === "connect-failed") {
    const kind = event.kind ?? "generic";
    // Permission denial is retryable (the user can grant access and retry);
    // a generic failure (server 5xx, bad config) is retriable too, but the
    // copy differs. Never claim "reconnecting" here — nothing is retrying.
    return { ...state, phase: "failed", failureKind: kind, canRetry: true };
  }

  if (event.type === "retry-requested") {
    // Retry is only meaningful from the failure screen; elsewhere it is a
    // no-op (a live call cannot be "restarted" without ending it first).
    if (state.phase !== "failed" || !state.canRetry) return state;
    return { ...INITIAL_CALL_STATE };
  }

  return state;
}

/** User-facing phase label used for aria-live status on the call screen. */
export function callPhaseAnnouncement(phase: CallPhase): string | null {
  switch (phase) {
    case "connecting":
      return null; // component supplies its own bootstrap copy
    case "active":
      return "Apèl la ap pase";
    case "reconnecting":
      return "Rezo a entèwopti. N ap rekonekte otomatikman...";
    case "failed":
      return "Koneksyon an koupe.";
    case "ended":
      return "Apèl la fini.";
  }
}

/** Whether the Chat control should be offered in this phase. Safe states
 *  only — never during "ended" (nothing left to chat about mid-call) and
 *  never during "failed" (retry owns the screen). */
export function chatControlVisible(phase: CallPhase): boolean {
  return phase === "connecting" || phase === "active" || phase === "reconnecting";
}
