# Medika Autonomous Agent State
Last updated: 2026-10-28T19:10Z (run cron-20261029-0303)

## Active issue
- #45 IN PROGRESS (LiveKit video+chat integration). Branch:
  feat/issue-45-livekit-chat-integration (from main 6f5b9cf). Phase: IMPLEMENT.

## Audit findings (verified this run)
- call/page.tsx owns Room in roomRef; effect cleanup DISCONNECTS on unmount;
  no chat control during call; on unexpected Disconnect it ends the call with
  a FAKE "retrying" message (violates issue rule 8).
- In-call chat panel chosen (issue's preferred architecture) — no route
  navigation, no shared provider needed.
- Chat page (1162 lines) pattern to reuse: getMessages/sendConsultationMessage/
  markConsultationRead + socket message:new/typing/messages:read +
  receipts/delivery/typing libs. UI language: Haitian Creole.
- Backend POST /call/token checks ONLY participant identity. RECHERCHE_MEDECIN
  rows CAN carry doctor_id (offer holder) -> offered doctor could mint a token
  before accepting. Fix: require status === 'EN_COURS' (payment verified
  pre-creation, so EN_COURS = accepted+paid). Fail closed 403 otherwise.
- Existing backend tests (upload-call.test.js): shape/403/503 only — no
  status eligibility tests. Web tests use vitest node env + renderToString
  SSR smoke pattern (no jsdom).

## Plan
1. lib/call/phases.ts pure state machine (connecting/active/reconnecting/
   failed+retry/ended; ended swallows late events).
2. components/consultation/InCallChat.tsx (text + receipts + typing; reuses
   existing endpoints/socket/libs; Esc = back to video).
3. call/page.tsx: Chat toggle (connecting+active), panel overlay, real
   Reconnecting/Reconnected handling, retry-on-unexpected-disconnect,
   permission-denied state, startCall emitted once per session.
4. globals.css: panel/mobile sheet + floating local preview (pure CSS
   re-layout of existing node), reduced-motion respected.
5. src/routes/call.js: EN_COURS-only token (403 otherwise).
6. Tests: backend tests/call-token-eligibility.test.js; web call-phases.test.ts
   + in-call-chat.test.tsx (SSR smoke).
7. Full verification: backend npm test; web vitest/tsc/lint/build.
8. One PR; document REAL results; #45 -> IN REVIEW; release lock.

## Completed / history
- #36 CLOSED (PR #41 merged); #43 CLOSED (PR #44 merged 19:00Z).
- #40 IN REVIEW via PR #46 (mergeable=True, unstable=checks pending only).

## Open PRs awaiting OWNER review: #46 (issue #40).
