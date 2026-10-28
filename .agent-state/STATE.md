# Medika Autonomous Agent State
Last updated: 2026-10-28T19:12Z (run cron-20261029-0258)

## Active issue
- #40 (NEW [HIGH PRIORITY], bug) - IN PROGRESS
- Branch: fix/issue-40-auto-submit-v2 (NEW branch - owner CLOSED old PR #42 at
  18:52Z unmerged and re-flagged #40 as NEW at 18:50Z; old branch kept untouched)
- Progress: cherry-picking verified commit 728d370 (security-reviewed + tests
  green in run 0240) onto current main a8017292 (which now includes merged
  PR #41). Expect conflicts in src/routes/consultations.js and
  medika-web/tests/consult-flow.test.ts (PR #41 touched both).
- Next action: resolve conflicts preserving BOTH notification hooks (from #41)
  and idempotent-replay logic (from #40), re-run backend+web verification,
  open one new PR referencing #40, mark IN REVIEW.

## Completed
- #36 CLOSED by owner merging PR #41 at 18:45Z (verified green in run 0230).
- #43 IN REVIEW via PR #44 (verified green, browser-audited).
- PR #42 closed by owner unmerged (decision respected; no reopen).

## Lock mechanism
- agent-state branch: STATE.md + LOCK.json (best-effort GitHub lock).
- Rule: active=true AND heartbeat < 45 min old -> another run active, do not start.
- Limitation: no atomic test-and-set; sub-minute races possible.
