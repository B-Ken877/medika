Last updated: 2026-10-29T19:11:09Z (cron-202610300304)

## Active issue
- #71 IN PROGRESS (cron-202610300304), branch fix/issue-71-desktop-nav-calm-expiration
  (from main 3c67168). Owner scope: (A) desktop navigation gap - AppShell.tsx renders
  only the mobile .bottom-nav (hidden >=900px per globals.css ~line 645), so desktop
  widths have NO primary nav; (B) remove visible ticking countdowns for 1h acceptance /
  5h validity windows, keep server-side enforcement
  (src/consultation-lifecycle.js enforceDueDeadlines), add idempotent gentle
  pre-expiration reminder via the durable notification path; verify active call/chat
  deadline behavior without changing lifecycle contract. Queue after #71: #72
  (notifications + Web Push, NEW, created 18:26Z).

## Recently completed
- #70 CLOSED: owner merged PR #73 as main 3c67168 (2026-10-29T19:05:08Z); Vercel
  production deploy SUCCESS (19:06:05Z). Stale IN REVIEW label removed (cleanup
  pattern: closed issues keep type/priority/NEW, drop workflow-status labels).
- #68 CLOSED: owner merged PR #69 as main 57a1e6a; deploy SUCCESS (17:25:13Z).
- #66 CLOSED: owner merged PR #67 (082aa6c; LiveKit fully removed, ZEGO sole provider).
- #62 CLOSED: owner merged PR #63 (d48258b; LiveKit->ZEGO preview switch).
- #60 CLOSED: owner merged PR #61 (e1fb9cc; one active consultation per patient/doctor).
- #56 CLOSED: owner merged PR #59 (e66a420; start consultations directly in video).
- #53 CLOSED: owner merged PR #58 (a71cbdd).
- #51 CLOSED: owner merged PR #57; remaining steps owner-only (Vercel dashboard).
- #50: PR #55 merged; VAPID env config owner-side.
- Earlier: #36 (PR #41), #43 (PR #44), #40 (PR #46), #45 (PR #49, 5904fbc),
  #47 (PR #52, 641add2), #48 (PR #54, d4757b2).

## Open PRs awaiting owner review: NONE (all agent PRs merged; #73 merged this cycle).

## Infra notes
- vercel.json git.deploymentEnabled["agent-state"]=false: agent-state pushes create NO
  Vercel deployments (expected, not a regression).
- Vercel production deploys verified via commit statuses on main HEAD.
- Live state mechanism: LOCK.json + agent-state commit messages + issue comments;
  this STATE.md is the consolidated summary.

## Next action (next run)
1. Check lock -> owner feedback on PR for #71.
2. If PR open: verify CI/deploy, address feedback; do NOT start #72 until #71 is
   merged/closed (one issue at a time).
3. If #71 merged & closed: clean stale labels, then claim #72 (notifications + Web Push).
