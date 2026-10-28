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
 *
 * Issue #56 adds the pre-call WAIT stage:
 *  - "waiting" — the consultation exists but is not yet call-eligible
 *    (RECHERCHE_MEDECIN). It is a calm, NEUTRAL state (the doctor simply
 *    has not accepted yet) — never rendered as an error. The call page
 *    polls the authoritative consultation status with bounded backoff and
 *    only creates/connects the LiveKit room once the server authorizes a
 *    token. No room exists during "waiting", so waiting cannot leak media
 *    or signaling.
 *  - "failed" with failureKind "ineligible" — a genuinely terminal server
 *    state (REFUSE / TERMINE / EXPIRE, or the bounded wait budget ran out).
 *    Shown clearly, WITHOUT an automatic retry loop (retrying a terminal
 *    state would be a request storm against a closed door).
 */

export type CallPhase =
  | "connecting"
  | "waiting"
  | "active"
  | "reconnecting"
  | "ended"
  | "failed";

/** Why a call landed in "failed" — drives the user-facing copy.
 *  "ineligible" (issue #56): terminal consultation status or the bounded
 *  eligibility wait ran out — NOT a transient failure; no auto-retry. */
export type CallFailureKind = "generic" | "permission" | "ineligible";

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
  | { type: "retry-requested" }
  /** Issue #56: the consultation is not call-eligible yet (server says
   *  RECHERCHE_MEDECIN). A quiet, bounded wait-and-poll loop is running —
   *  this is NOT an error and must not render as one. */
  | { type: "waiting-for-eligibility" }
  /** Issue #56: the server reports a terminal status (REFUSE / TERMINE /
   *  EXPIRE) or the bounded wait budget ran out. No further polling. */
  | { type: "terminal-status" };

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

  if (event.type === "waiting-for-eligibility") {
    // Only the bootstrap (pre-room) stages may wait. A live/reconnecting
    // call never goes back to "waiting" — that would lie about the room.
    if (state.phase !== "connecting" && state.phase !== "waiting") return state;
    return { ...state, phase: "waiting" };
  }

  if (event.type === "terminal-status") {
    // Terminal server state: clear, honest, and NOT retryable (retrying a
    // refused/expired/finished consultation cannot succeed). ("ended" is
    // already excluded by the terminal guard above — a hang-up wins.)
    return { ...state, phase: "failed", failureKind: "ineligible", canRetry: false };
  }

  return state;
}

/** User-facing phase label used for aria-live status on the call screen. */
export function callPhaseAnnouncement(phase: CallPhase): string | null {
  switch (phase) {
    case "connecting":
    case "waiting":
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
 *  only — never during "ended" (nothing left to chat about mid-call),
 *  never during "failed" (retry owns the screen), and never during
 *  "waiting" (issue #56: pre-acceptance the server does not allow chat
 *  messages either — the control would only produce failed sends). */
export function chatControlVisible(phase: CallPhase): boolean {
  return phase === "connecting" || phase === "active" || phase === "reconnecting";
}

// ─── Eligibility wait budget (issue #56) ──────────────────────────────

/** Bounded, cancellable poll cadence while the consultation is not yet
 *  call-eligible. Exponential (3s base, ×1.5) with a 15s cap — long enough
 *  to never storm the API, short enough that the patient enters the call
 *  promptly after the doctor accepts. */
export function eligibilityBackoffMs(attempt: number): number {
  const base = 3000;
  const cap = 15000;
  const delay = base * Math.pow(1.5, Math.max(0, attempt));
  return Math.min(Math.round(delay), cap);
}

/** Hard bound on background polls before the loop stops and hands control
 *  back to the user (a REAL manual action — never a fake auto-retry). With
 *  the capped cadence this is roughly 8 minutes of quiet waiting, which
 *  covers a doctor reviewing an incoming request; after that the patient
 *  gets a clear "still not accepted" screen instead of an endless spinner. */
export const MAX_ELIGIBILITY_ATTEMPTS = 40;

/** Terminal consultation statuses — no call, no polling, clear copy. */
export const TERMINAL_CONSULTATION_STATUSES = ["REFUSE", "TERMINE", "EXPIRE"] as const;
