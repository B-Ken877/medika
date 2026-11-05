Last updated: 2026-11-05T05:42:00Z (cron-202611051316)

## Active issue
- NONE. #83 IN REVIEW via PR #87, branch feat/issue-83-medication-orders
  (from main ed02c26, commit b4776ec). Medication orders + manual pharmacy
  quote operations: migration 010 (partner_pharmacies / medication_orders /
  pharmacy_quotes / medication_order_events — no pharmacy credentials or
  portal), repo src/repos/medication-orders.js (row-locked transitions,
  1:1 quote lines → prescription indices, server-recomputed HTG totals,
  30-min SLA from requested_at, lazy+cron ESCALATED/EXPIRED sweeps),
  patient routes + admin ops routes (router-level admin guard) +
  /api/crons/medication-deadlines; admin « Médicaments et pharmacies »
  (queue buckets, read-only Rx snapshot, WhatsApp handoff w/o patient data,
  quote form, unreachable, history, directory CRUD); patient web
  MedicationOrderPanel (FR CTA, quote review, accept/decline/cancel,
  payment = honest next-step note for #84).
  Tests (real): backend 497/497 (41 files, 23 new), web 538/538 (42 files,
  17 new), typecheck/lint/build + admin build clean. Owner next: review +
  merge PR #87. Do NOT close #83 or mark DONE until owner verifies/merges.

## Queue
- #84 MonCash medication payments — depends on #83 merged (PR #87).
- #85 delivery ops + staff portal — depends on #83 + #84 merged.
- Priority: all default (unlabeled), oldest first.

## Infra notes (carried forward)
- vercel.json git.deploymentEnabled["agent-state"]=false (safe to push state).
- agent-state branch worktree at /home/z/my-project/agent-state-worktree
  (git worktree add ../agent-state-worktree agent-state from medika clone).
  Push state via that worktree. The stray /home/z/my-project/agent-state
  folder only holds .gh_token (gitignored outer repo, NOT the state repo).
- Test env: npm ci at root + medika-web (+ medika-admin for builds);
  embedded PostgreSQL auto-managed by vitest global-setup; migrations
  auto-applied.
- Issue #60 invariants: ONE active consultation per patient AND per doctor.
  Test helpers must issue AND accept (or reject) — any consultation left
  EN_COURS/RECHERCHE_MEDECIN blocks the next scenario for doctor_t1
  (releaseConsultation() pattern in issue-83 tests).
- ApiError on the web: server French error lands in err.detail (ErrorAlert
  shows it); err.message is the generic Creole fallback.
- notifications CATEGORY_FOR_EVENT is DB-CHECK-constrained to
  consultations/messages/calls/wallet — new event types MUST map to an
  existing category or emit() silently no-ops (bit once this run).
- QueryResult rows: destructure { rows } or use .rows — array-style indexing
  on a pg QueryResult silently yields undefined (bit once this run).
- Temp PAT lives ONLY in agent-state/.gh_token (chmod 600, gitignored).

## Next action (next run)
1. Check lock. If free: check PR #87 review state and whether #83 was
   merged/closed; if review feedback exists, address it on the same branch.
2. If #83 merged: verify labels, report; #84 becomes eligible (rebase from
   latest main; MonCash payments for ACCEPTED medication orders).
3. One issue at a time. Never merge. Never duplicate branches/PRs.
