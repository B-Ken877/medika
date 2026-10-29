Last updated: 2026-10-29T21:20:00Z (cron-202610300451)

## Active issue
- NONE. #77 IN REVIEW via PR #78 (run cron-202610300451), branch
  fix/issue-77-beta-payment-simulation (6096847, from main a2fcdc1).
  Safe beta-wide payment simulation: PAYMENT_SIMULATION_BETA_USERNAMES
  (explicit reversible allowlist, server-verified usernames only) + per-user
  simulationAllowed in resolveVerifiedPayment + honest web 503 message +
  DEPLOYMENT.md/README enable/rollback docs. Root cause: prod sim bound to ONE
  test username -> 503 for every other tester (routes/payments.js 503 +
  web generic 5xx message); global simAllowed() blocked PENDING simulated rows
  at consult creation. Tests: 447 backend + 491 web PASS; typecheck/lint/build
  clean; API-level E2E with synthetic beta account t.patient2 (create -> verify
  -> consultation -> doctor visibility). Owner next: review PR #78, then set
  PAYMENT_SIMULATION_BETA_USERNAMES env (owner-only). Do NOT mark DONE
  unverified. Android has pre-existing no-auth-header payment gap -> follow-up
  candidate (owner decision).

## Recently completed
- #72 CLOSED: owner merged PR #76 as main a2fcdc1; Vercel deploy SUCCESS
  19:55:45Z (verified this run). Stale IN REVIEW removed from #72 this run.
- #70 (PR #73 -> 3c67168), #68 (PR #69 -> 57a1e6a) merged + closed, deploys OK.
- #74 closed by owner 19:42:15Z (no agent PR).

## Queue
- EMPTY. No open issues, no open PRs. #77 awaits owner review (IN REVIEW).

## Infra notes
- vercel.json git.deploymentEnabled["agent-state"]=false: agent-state pushes
  create NO Vercel deployments (expected).
- Test env needs: npm ci at root + medika-web; vitest via npx; embedded
  PostgreSQL auto-managed by global-setup.

## Next action (next run)
1. Check lock. If free: check owner feedback on PR #78 (reviews/comments) and
   whether #77/PR #78 were merged/closed.
2. If merged + #77 closed: remove stale IN REVIEW label from #77, verify main
   deploy status, report QUEUE EMPTY unless new issues appeared.
3. If feedback exists: address on the same branch (one issue at a time).
4. Any NEW issue the owner files takes priority by its labels (oldest first
   within same priority).