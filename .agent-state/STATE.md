Last updated: 2026-10-28T20:25:00Z (run cron-20261029-0358)
Last updated: 2026-10-28T20:04Z (run cron-20261029-0347)

## Active issue
- NONE IN PROGRESS.
- #51: IN REVIEW via PR #57 (run cron-20261029-0358). Root cause evidenced as
  EXTERNAL: per-preview resource provisioning fails pre-build (identical code
  READY in production; 21+ docs-only agent-state previews failed; matches the
  documented Neon per-preview branch-limit case). Repo-side mitigation shipped:
  vercel.json git.deploymentEnabled["agent-state"]=false + contract tests +
  docs/VERCEL_PREVIEW_PROVISIONING.md owner runbook. Owner-only next steps:
  dashboard -> Storage/Integrations -> check DB branch quota -> delete stale
  preview branches -> re-trigger a preview -> verify READY (doc section 4).
- #50: owner merged PR #55; issue stays open pending OWNER-ONLY Vercel VAPID
  env config + real-device verification (do NOT attempt).
- #53 (black suggestions bar) is the ONLY remaining unclaimed issue (NEW).

## Completed / history
- #36 CLOSED (PR #41), #43 CLOSED (PR #44), #40 CLOSED (PR #46).
- #45 CLOSED: owner merged PR #49 (squash-landed as main 5904fbc ~20:00Z).
- #47 CLOSED: owner merged PR #52 (main 641add2).
- #48 CLOSED: owner merged PR #54 (main d4757b2).
- #50: PR #55 MERGED by owner; issue open pending owner env config.

## Open PRs awaiting OWNER review: #57 (issue #51) only. All other agent PRs
## (#41/#44/#46/#49/#52/#54/#55) merged; mergeable=True vs main 5904fbc.

## Next action (next run)
1. Check lock -> state -> owner feedback on PR #57 (or issue #51).
2. If #57 unchanged and queue unchanged: claim #53 (black keyboard
   suggestions bar; per issue body, first determine app-rendered vs
   Gboard/IME-owned; audit composer attributes from PR #52; do not regress
   the merged viewport fix; likely mostly documentation unless evidence
   shows an app-rendered bar).
3. Keep git.deploymentEnabled[agent-state]=false in mind: agent-state pushes
   no longer create Vercel deployments (fewer status X marks on agent-state
   commits is EXPECTED, not a regression).


## Next action (next run)
1. Check lock -> inspect state -> no owner change requests on #49/#54/#55 ->
   consider #51 (Vercel preview provisioning; root cause likely owner-side
   Vercel dashboard/account — audit repo-side only) then #53 (black
   suggestions bar; likely OS/keyboard-owned — audit + document, do not
   regress PR #52).
2. If owner reviews any open PR with change requests, resume that issue FIRST.
3. If owner merges any open PR, merge-tree the others vs main; rebranch if
   needed (last check: 0 conflicts among #49/#54/#55).


## Active issue (updated run cron-20261029-0414 at 20:18Z)
- #53 IN PROGRESS: NEW [HIGH PRIORITY] Remove unwanted black keyboard suggestions bar from mobile chat input.
  - Branch: fix/issue-53-keyboard-suggestions-bar (to be created from latest main).
  - Plan: (1) audit composer DOM in consultations+tickets pages to rule out app-rendered bar; (2) smallest evidence-based app change (form-level autocomplete=off if form wrapper exists; no removal of PR #52 attrs); (3) docs/MOBILE_KEYBOARD_SUGGESTION_BAR.md identification runbook (Gboard dark-theme strip vs Chrome autofill strip vs app-rendered); (4) contract tests; (5) vitest/tsc/lint/build.
  - Constraint: do not regress PR #52 viewport fix or its contract tests. Device verification likely unavailable - must state honestly.
- #51: PR #57 MERGED by owner (20:12Z). Remaining #51 steps are OWNER-ONLY (Vercel dashboard quota + re-trigger preview). Issue label still IN REVIEW - leave for owner.
- Queue after #53: #56 (LiveKit video consultations, created 20:11Z, oldest-first next). #50 remains owner-only env config.
