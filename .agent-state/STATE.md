Last updated: 2026-10-29T19:33:56Z (cron-202610300304)

## Active issue
- #71 IN REVIEW via PR #75 (cron-202610300304), branch fix/issue-71-desktop-nav-calm-expiration
  (bb61da1). Scope done: (A) desktop header-nav >=900px w/ shared navLink renderer,
  compact 900-1100px, bottom bar contract untouched; (B) ALL ticking countdowns removed
  (OfferCountdown/formatCountdown/.offer-countdown CSS deleted), chat page calm static
  copy, NEW idempotent durable pre-expiration reminder (consultation:expiry-reminder,
  EXPIRY_REMINDER_MINUTES=45, per-party, no schema change, dispatch-time preferences).
  Tests: 480 web + 423 backend PASS; typecheck/lint/build clean; visual evidence
  docs/evidence/issue-71/ (9 screenshots + evidence.json, fixture users only).
  Owner next: review PR #75, merge, device verification. Do NOT mark DONE unverified.

## Recently completed
- #70 CLOSED: owner merged PR #73 as main 3c67168 (19:05:08Z); Vercel deploy SUCCESS
  (19:06:05Z). Stale IN REVIEW label removed from #70 (cleanup pattern: closed issues
  keep type/priority/NEW, drop workflow-status labels).
- #68 CLOSED: owner merged PR #69 as main 57a1e6a; deploy SUCCESS.
- #66 (PR #67), #62 (PR #63), #60 (PR #61), #56 (PR #59), #53 (PR #58), #51 (PR #57),
  #50 (PR #55), #48 (PR #54), #47 (PR #52), #45 (PR #49), #43/#40/#36 (PRs #44/#46/#41).

## Queue
- #72 [HIGH PRIORITY] notifications + Web Push (NEW) — claim AFTER #71 merges/closes.
- No other open issues. Open PRs: #75 (issue #71) only.

## Infra notes
- vercel.json git.deploymentEnabled["agent-state"]=false: agent-state pushes create NO
  Vercel deployments (expected).
- Live state: LOCK.json + agent-state commit messages + issue comments; this file is
  the consolidated summary.

## Next action (next run)
1. Check lock -> owner feedback on PR #75 (reviews/comments/merge).
2. If merged + #71 closed: remove stale IN REVIEW label from #71, verify main deploy
   status, then claim #72 (audit: bell unread count, notification center wiring,
   Web Push end-to-end; VAPID env is OWNER-ONLY per #50 pattern).
3. If feedback: address it on the same branch. One issue at a time.
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
